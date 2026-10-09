-- Stock count polish on top of 20261011_parallel_count.sql:
-- * counted_by = everybody who counts (creator included); finished_by = who pressed "finish my count".
-- * merge_mode is fixed when the count is created (from tenant_settings.count_merge_mode).
-- * approve: branch from the storage place; surplus goes into the place's lot with the nearest expiry
--   (or a new lot without expiry); shortage is taken lot by lot, earliest expiry first. Each lot
--   change is one 'count' movement carrying the lot's expiry, so the stock_movements trigger applies
--   it to exactly that lot and the log shows which lot moved.
-- * difference value = difference x last purchase price, for roles that see costs.
-- Run after 20261013_paged_reads.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.approve_stock_count(uuid)') is null then
    raise exception 'Run 20261011_parallel_count.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. One open count per storage place (the 20261011 index, under its final name)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.stock_counts_one_open_per_location') is not null then
    if to_regclass('public.uniq_open_count_per_location') is null then
      alter index public.stock_counts_one_open_per_location rename to uniq_open_count_per_location;
    else
      drop index public.stock_counts_one_open_per_location;
    end if;
  end if;
end;
$$;
create unique index if not exists uniq_open_count_per_location
  on public.stock_counts (tenant_id, location_id)
  where status in ('draft', 'counting', 'merging');

-- ---------------------------------------------------------------------------
-- 2. counted_by = counters, finished_by = finished counters
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_counts' and column_name = 'finished_by'
  ) then
    alter table public.stock_counts add column finished_by uuid[] not null default '{}';
    -- Until now counted_by held the finished counters.
    update public.stock_counts c
    set finished_by = c.counted_by,
        counted_by = array(
          select distinct u
          from unnest(
            array_append(c.counted_by, c.user_id)
            || coalesce((select array_agg(i.user_id) from public.stock_count_items i
                         where i.stock_count_id = c.id and i.user_id is not null), '{}')
          ) as u
          where u is not null
        );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. merge_mode fixed at creation
-- ---------------------------------------------------------------------------
update public.stock_counts c
set merge_mode = s.count_merge_mode
from public.tenant_settings s
where c.merge_mode is null and s.tenant_id = c.tenant_id and c.status in ('draft', 'counting');
-- Closed counts without a mode (made before 20261011) were never merged.
update public.stock_counts set merge_mode = 'last' where merge_mode is null;
alter table public.stock_counts alter column merge_mode set default 'last';
alter table public.stock_counts alter column merge_mode set not null;
alter table public.stock_counts drop constraint if exists stock_counts_merge_mode_check;
alter table public.stock_counts add constraint stock_counts_merge_mode_check check (merge_mode in ('last', 'sum'));

-- A new count takes the tenant's merge mode; its creator is its first counter.
create or replace function public.stock_count_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.merge_mode := coalesce(
    (select s.count_merge_mode from public.tenant_settings s where s.tenant_id = new.tenant_id),
    new.merge_mode
  );
  if auth.uid() is not null then
    new.counted_by := array[auth.uid()];
    new.finished_by := '{}';
  end if;
  return new;
end;
$$;
revoke execute on function public.stock_count_defaults() from public, anon, authenticated;

drop trigger if exists trg_stock_count_defaults on public.stock_counts;
create trigger trg_stock_count_defaults
  before insert on public.stock_counts
  for each row execute function public.stock_count_defaults();

-- ---------------------------------------------------------------------------
-- 4. Policies follow finished_by
-- ---------------------------------------------------------------------------
drop policy if exists stock_counts_insert on public.stock_counts;
create policy stock_counts_insert on public.stock_counts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) in ('owner', 'chef', 'cook')
    and status = 'draft'
    and user_id = (select auth.uid())
    and finished_by = '{}'
    and merged_at is null and approved_by is null and approved_at is null
  );

drop policy if exists stock_count_items_insert on public.stock_count_items;
create policy stock_count_items_insert on public.stock_count_items
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
    and (select public.current_member_role()) in ('owner', 'chef', 'cook')
    and exists (
      select 1 from public.stock_counts c
      where c.id = stock_count_id and c.tenant_id = (select public.current_tenant_id())
        and c.status = 'counting' and not ((select auth.uid()) = any (c.finished_by))
    )
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.tenant_id = (select public.current_tenant_id())
    )
  );
drop policy if exists stock_count_items_update on public.stock_count_items;
create policy stock_count_items_update on public.stock_count_items
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.stock_counts c
      where c.id = stock_count_id and c.status = 'counting' and not ((select auth.uid()) = any (c.finished_by))
    )
  )
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Functions
-- ---------------------------------------------------------------------------
create or replace function public.add_counter_to_count(p_count_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stock_counts
  set counted_by = array(select distinct unnest(array_append(coalesce(counted_by, '{}'), auth.uid())))
  where id = p_count_id and auth.uid() is not null and not (auth.uid() = any (coalesce(counted_by, '{}')));
$$;
revoke execute on function public.add_counter_to_count(uuid) from public, anon, authenticated;

-- Latest purchase (prihod) price of a product, else its catalog cost.
create or replace function public.product_last_purchase_price(p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.cost_per_unit from public.stock_movements m
      where m.product_id = p_product_id and m.movement_type = 'prihod' and m.cost_per_unit is not null
      order by m.created_at desc, m.id desc
      limit 1),
    (select p.cost from public.products p where p.id = p_product_id)
  );
$$;
revoke execute on function public.product_last_purchase_price(uuid) from public, anon, authenticated;
create index if not exists idx_stock_movements_product_prihod
  on public.stock_movements (product_id, created_at desc)
  where movement_type = 'prihod';

-- Branch of a count's storage place; the count must have one.
create or replace function public.stock_count_branch(p_count public.stock_counts)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch uuid;
begin
  if p_count.location_id is null then
    raise exception 'location_id required' using errcode = '22023';
  end if;
  select branch_id into v_branch
  from public.storage_locations
  where id = p_count.location_id and tenant_id = p_count.tenant_id;
  if not found then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  return v_branch;
end;
$$;
revoke execute on function public.stock_count_branch(public.stock_counts) from public, anon, authenticated;

create or replace function public.start_stock_count(p_location_id uuid, p_group_key text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_member_role();
  v_branch uuid;
  v_count public.stock_counts;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select branch_id into v_branch
  from public.storage_locations
  where id = p_location_id and tenant_id = v_tenant and is_active;
  if not found then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  select * into v_count
  from public.stock_counts
  where tenant_id = v_tenant and location_id = p_location_id and status in ('draft', 'counting', 'merging')
  for update;
  if not found then
    begin
      insert into public.stock_counts (tenant_id, branch_id, location_id, group_key, user_id, status)
      values (v_tenant, v_branch, p_location_id, nullif(btrim(coalesce(p_group_key, '')), ''), auth.uid(), 'draft')
      returning * into v_count;
    exception when unique_violation then
      -- Somebody opened it at the same moment: join theirs.
      select * into v_count
      from public.stock_counts
      where tenant_id = v_tenant and location_id = p_location_id and status in ('draft', 'counting', 'merging')
      for update;
    end;
  end if;

  if v_count.status = 'merging' then
    raise exception 'invalid_status' using errcode = '55000';
  end if;
  if v_count.status = 'draft' then
    update public.stock_counts set status = 'counting' where id = v_count.id;
  end if;
  perform public.add_counter_to_count(v_count.id);
  return v_count.id;
end;
$$;

create or replace function public.save_stock_count_items(p_count_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_item jsonb;
  v_product uuid;
  v_quantity numeric;
  v_saved integer := 0;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef', 'cook'], array['counting']);
  if auth.uid() = any (v_count.finished_by) then
    raise exception 'already_finished' using errcode = '55000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'quantity'), '') <> 'number'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_product := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity < 0 or v_quantity > 1000000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products where id = v_product and tenant_id = v_count.tenant_id) then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;

    insert into public.stock_count_items (tenant_id, stock_count_id, product_id, counted_quantity, user_id)
    values (v_count.tenant_id, v_count.id, v_product, v_quantity, auth.uid())
    on conflict (stock_count_id, product_id, user_id) where user_id is not null
    do update set counted_quantity = excluded.counted_quantity;
    v_saved := v_saved + 1;
  end loop;
  perform public.add_counter_to_count(v_count.id);
  return v_saved;
end;
$$;

create or replace function public.finish_my_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef', 'cook'], array['counting']);
  perform public.add_counter_to_count(v_count.id);
  update public.stock_counts
  set finished_by = array(select distinct unnest(array_append(coalesce(finished_by, '{}'), auth.uid())))
  where id = v_count.id;
end;
$$;

-- "Merge" (chef/owner): one merged row per counted product, by the count's own merge mode, with the
-- balance of the place's lots in the place's branch.
create or replace function public.merge_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_branch uuid;
  v_rows integer;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef'], array['counting']);
  v_branch := public.stock_count_branch(v_count);

  insert into public.stock_count_items (tenant_id, stock_count_id, product_id, counted_quantity, user_id, system_quantity)
  select v_count.tenant_id, v_count.id, i.product_id,
    case when v_count.merge_mode = 'sum' then sum(i.counted_quantity)
      else (array_agg(i.counted_quantity order by i.updated_at desc, i.id desc))[1] end,
    null,
    (select coalesce(sum(ps.quantity), 0) from public.product_stocks ps
      where ps.tenant_id = v_count.tenant_id and ps.product_id = i.product_id
        and ps.location_id = v_count.location_id and ps.branch_id is not distinct from v_branch)
  from public.stock_count_items i
  where i.stock_count_id = v_count.id and i.user_id is not null
  group by i.product_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'nothing_counted' using errcode = '55000';
  end if;

  update public.stock_counts set status = 'merging', merged_at = now() where id = v_count.id;
  return v_rows;
end;
$$;

-- "Approve" (chef/owner): the only place a count changes stock, in one transaction. Branch comes from
-- the storage place. Surplus: into the place's lot with the nearest expiry, else a new lot without
-- expiry. Shortage: lots earliest expiry first until covered. One movement per lot change, carrying
-- that lot's expiry so the trigger touches exactly that lot. Returns the number of movements.
create or replace function public.approve_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_loc uuid;
  v_branch uuid;
  v_item record;
  v_lot record;
  v_system numeric;
  v_diff numeric;
  v_left numeric;
  v_take numeric;
  v_moves integer := 0;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef'], array['merging']);
  v_loc := v_count.location_id;
  v_branch := public.stock_count_branch(v_count);

  for v_item in
    select i.id, i.product_id, i.counted_quantity, p.name, p.unit
    from public.stock_count_items i
    join public.products p on p.id = i.product_id
    where i.stock_count_id = v_count.id and i.user_id is null
    order by i.product_id
  loop
    perform 1 from public.product_stocks
    where tenant_id = v_count.tenant_id and product_id = v_item.product_id
      and location_id = v_loc and branch_id is not distinct from v_branch
    for update;
    select coalesce(sum(quantity), 0) into v_system
    from public.product_stocks
    where tenant_id = v_count.tenant_id and product_id = v_item.product_id
      and location_id = v_loc and branch_id is not distinct from v_branch;

    update public.stock_count_items set system_quantity = v_system where id = v_item.id;
    v_diff := v_item.counted_quantity - v_system;
    continue when v_diff = 0;

    if v_diff > 0 then
      select expiry_date, cost_per_unit into v_lot
      from public.product_stocks
      where tenant_id = v_count.tenant_id and product_id = v_item.product_id
        and location_id = v_loc and branch_id is not distinct from v_branch
      order by expiry_date asc nulls last, id
      limit 1;
      if not found then
        select null::date as expiry_date, null::numeric as cost_per_unit into v_lot;
      end if;
      insert into public.stock_movements (
        tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
        reason, user_id, cost_per_unit, unit, expiry_date
      ) values (
        v_count.tenant_id, v_item.product_id, v_branch, null, v_loc, v_diff, 'count',
        'stock_count ' || v_count.id, auth.uid(),
        coalesce(v_lot.cost_per_unit, public.product_last_purchase_price(v_item.product_id)),
        v_item.unit, v_lot.expiry_date
      );
      v_moves := v_moves + 1;
    else
      v_left := -v_diff;
      for v_lot in
        select id, expiry_date, quantity, cost_per_unit
        from public.product_stocks
        where tenant_id = v_count.tenant_id and product_id = v_item.product_id
          and location_id = v_loc and branch_id is not distinct from v_branch and quantity > 0
        order by expiry_date asc nulls last, id
        for update
      loop
        exit when v_left <= 0;
        v_take := least(v_lot.quantity, v_left);
        insert into public.stock_movements (
          tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
          reason, user_id, cost_per_unit, unit, expiry_date
        ) values (
          v_count.tenant_id, v_item.product_id, v_branch, v_loc, null, v_take, 'count',
          'stock_count ' || v_count.id, auth.uid(), v_lot.cost_per_unit, v_item.unit, v_lot.expiry_date
        );
        v_left := v_left - v_take;
        v_moves := v_moves + 1;
      end loop;
      if v_left > 0 then
        raise exception 'insufficient_stock for product %', v_item.name using errcode = '22003';
      end if;
    end if;
  end loop;

  update public.stock_counts
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = v_count.id;
  return v_moves;
end;
$$;

-- Merged list of a count (signature unchanged). Mode from the count; the difference value uses the
-- last purchase price and is shown only to roles that see costs.
create or replace function public.stock_count_lines(p_count_id uuid)
returns table (
  product_id uuid,
  product_name text,
  unit text,
  counted_quantity numeric,
  counters integer,
  expected_quantity numeric,
  difference numeric,
  difference_value numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_count public.stock_counts;
  v_reveal boolean;
  v_money boolean := public.can_see_costs();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  select * into v_count from public.stock_counts c where c.id = p_count_id and c.tenant_id = v_tenant;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  v_reveal := v_count.status = 'approved'
    or (v_count.status = 'merging' and public.current_member_role() in ('owner', 'chef'));

  if v_count.status in ('merging', 'approved') then
    return query
      select i.product_id, p.name, p.unit, i.counted_quantity,
        (select count(*)::integer from public.stock_count_items e
          where e.stock_count_id = v_count.id and e.product_id = i.product_id and e.user_id is not null),
        case when v_reveal then i.system_quantity end,
        case when v_reveal then i.difference end,
        case when v_reveal and v_money then i.difference * coalesce(public.product_last_purchase_price(i.product_id), 0) end
      from public.stock_count_items i
      join public.products p on p.id = i.product_id
      where i.stock_count_id = v_count.id and i.user_id is null
      order by p.name, i.product_id;
    return;
  end if;

  return query
    select i.product_id, p.name, p.unit,
      case when v_count.merge_mode = 'sum' then sum(i.counted_quantity)
        else (array_agg(i.counted_quantity order by i.updated_at desc, i.id desc))[1] end,
      count(*)::integer,
      null::numeric, null::numeric, null::numeric
    from public.stock_count_items i
    join public.products p on p.id = i.product_id
    where i.stock_count_id = v_count.id and i.user_id is not null
    group by i.product_id, p.name, p.unit
    order by p.name, i.product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.uniq_open_count_per_location') is null
     or to_regclass('public.stock_counts_one_open_per_location') is not null then
    raise exception 'open count index not in place';
  end if;
  if exists (select 1 from public.stock_counts where merge_mode is null) then
    raise exception 'stock_counts without merge_mode remain';
  end if;
  if has_function_privilege('authenticated', 'public.add_counter_to_count(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.product_last_purchase_price(uuid)', 'execute') then
    raise exception 'internal count functions are callable by clients';
  end if;
end;
$$;

commit;
