-- Stock count as a document. Several people count one storage place in parallel; their entries are
-- kept per person and never touch stock. A chef or owner merges them (last entry or sum, per
-- tenant_settings.count_merge_mode) and approves: only approve_stock_count() writes 'count'
-- movements, in one transaction, so the balance changes once.
--
-- stock_counts: draft -> counting -> merging -> approved; draft/counting/merging -> cancelled.
-- stock_count_items: one row per (count, product, person) while counting; merged rows have
-- user_id null and carry system_quantity (the balance the difference is taken from).
-- Counts made before this migration already moved stock; they become 'approved'.
-- Run after 20261010_cleanup_and_hardcode.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.current_member_role()') is null or to_regclass('public.tenant_settings') is null then
    raise exception 'Run 20261009_unify_tenant.sql and 20261010_cleanup_and_hardcode.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.stock_counts
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists location_id uuid references public.storage_locations(id),
  add column if not exists status text,
  add column if not exists counted_by uuid[] not null default '{}',
  add column if not exists merge_mode text,
  add column if not exists merged_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz;

alter table public.stock_count_items
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists system_quantity numeric,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_count_items' and column_name = 'difference'
  ) then
    alter table public.stock_count_items
      add column difference numeric generated always as (counted_quantity - system_quantity) stored;
  end if;
end;
$$;

-- Legacy submissions (status still null) were applied to stock when they were made.
update public.stock_count_items i
set user_id = c.user_id
from public.stock_counts c
where i.stock_count_id = c.id and c.status is null and i.user_id is null;

update public.stock_counts
set status = 'approved',
    approved_at = coalesce(approved_at, created_at),
    approved_by = coalesce(approved_by, user_id)
where status is null;

update public.stock_counts c
set branch_id = l.branch_id
from public.storage_locations l
where c.branch_id is null and l.id = c.location_id;

alter table public.stock_counts alter column status set default 'draft';
alter table public.stock_counts alter column status set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_counts_status_check') then
    alter table public.stock_counts add constraint stock_counts_status_check
      check (status in ('draft', 'counting', 'merging', 'approved', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_counts_merge_mode_check') then
    alter table public.stock_counts add constraint stock_counts_merge_mode_check
      check (merge_mode is null or merge_mode in ('last', 'sum'));
  end if;
end;
$$;

create index if not exists idx_stock_counts_tenant_status_location on public.stock_counts (tenant_id, status, location_id);
-- One open count per storage place: everybody who counts it joins the same document.
create unique index if not exists stock_counts_one_open_per_location
  on public.stock_counts (tenant_id, location_id)
  where status in ('draft', 'counting', 'merging');
create unique index if not exists stock_count_items_per_counter
  on public.stock_count_items (stock_count_id, product_id, user_id)
  where user_id is not null;
create unique index if not exists stock_count_items_merged
  on public.stock_count_items (stock_count_id, product_id)
  where user_id is null;

create or replace function public.touch_stock_count_item()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stock_count_item_touch on public.stock_count_items;
create trigger trg_stock_count_item_touch
  before update on public.stock_count_items
  for each row execute function public.touch_stock_count_item();

-- How parallel entries for one product are merged.
alter table public.tenant_settings add column if not exists count_merge_mode text not null default 'last';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_settings_count_merge_mode_check') then
    alter table public.tenant_settings add constraint tenant_settings_count_merge_mode_check
      check (count_merge_mode in ('last', 'sum'));
  end if;
end;
$$;
grant update (count_merge_mode) on table public.tenant_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Access. Status changes only through the functions below; system quantities stay hidden.
-- ---------------------------------------------------------------------------
revoke all on table public.stock_counts, public.stock_count_items from anon, authenticated;
grant select, insert, delete on table public.stock_counts to authenticated;
grant select (id, tenant_id, stock_count_id, product_id, counted_quantity, user_id, updated_at)
  on table public.stock_count_items to authenticated;
grant insert (tenant_id, stock_count_id, product_id, counted_quantity, user_id)
  on table public.stock_count_items to authenticated;
grant update (counted_quantity) on table public.stock_count_items to authenticated;

drop policy if exists stock_counts_select on public.stock_counts;
drop policy if exists stock_counts_insert on public.stock_counts;
drop policy if exists stock_counts_update on public.stock_counts;
drop policy if exists stock_counts_delete on public.stock_counts;
create policy stock_counts_select on public.stock_counts
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy stock_counts_insert on public.stock_counts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) in ('owner', 'chef', 'cook')
    and status = 'draft'
    and user_id = (select auth.uid())
    and counted_by = '{}'
    and merged_at is null and approved_by is null and approved_at is null
  );
create policy stock_counts_delete on public.stock_counts
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) in ('owner', 'chef')
    and status in ('draft', 'cancelled')
  );

drop policy if exists stock_count_items_select on public.stock_count_items;
drop policy if exists stock_count_items_insert on public.stock_count_items;
drop policy if exists stock_count_items_update on public.stock_count_items;
drop policy if exists stock_count_items_delete on public.stock_count_items;
create policy stock_count_items_select on public.stock_count_items
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
-- Own entries, into a count that is open for counting and not finished by this person.
create policy stock_count_items_insert on public.stock_count_items
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
    and (select public.current_member_role()) in ('owner', 'chef', 'cook')
    and exists (
      select 1 from public.stock_counts c
      where c.id = stock_count_id and c.tenant_id = (select public.current_tenant_id())
        and c.status = 'counting' and not ((select auth.uid()) = any (c.counted_by))
    )
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.tenant_id = (select public.current_tenant_id())
    )
  );
create policy stock_count_items_update on public.stock_count_items
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.stock_counts c
      where c.id = stock_count_id and c.status = 'counting' and not ((select auth.uid()) = any (c.counted_by))
    )
  )
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- The caller's count, locked; raises unless the caller has one of the roles and the count one of the statuses.
create or replace function public.stock_count_for_update(p_count_id uuid, p_roles text[], p_statuses text[])
returns public.stock_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_member_role();
  v_count public.stock_counts;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_count from public.stock_counts where id = p_count_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if not (v_count.status = any (p_statuses)) then
    raise exception 'invalid_status' using errcode = '55000';
  end if;
  return v_count;
end;
$$;

revoke execute on function public.stock_count_for_update(uuid, text[], text[]) from public, anon, authenticated;

-- "Start count": opens the place's count (or joins the open one) and moves draft -> counting.
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
  return v_count.id;
end;
$$;

-- Saves the caller's own entries: [{"product_id": uuid, "quantity": number}, ...]. Stock is not touched.
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
  if auth.uid() = any (v_count.counted_by) then
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
  return v_saved;
end;
$$;

-- "Finish my count": the caller's entries are final.
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
  if not (auth.uid() = any (v_count.counted_by)) then
    update public.stock_counts set counted_by = array_append(counted_by, auth.uid()) where id = v_count.id;
  end if;
end;
$$;

-- "Merge" (chef/owner): counting closes; one merged row per counted product with the current balance.
create or replace function public.merge_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_mode text;
  v_rows integer;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef'], array['counting']);
  select count_merge_mode into v_mode from public.tenant_settings where tenant_id = v_count.tenant_id;
  if v_mode is null then
    raise exception 'tenant_settings_missing' using errcode = 'P0002';
  end if;

  insert into public.stock_count_items (tenant_id, stock_count_id, product_id, counted_quantity, user_id, system_quantity)
  select v_count.tenant_id, v_count.id, i.product_id,
    case when v_mode = 'sum' then sum(i.counted_quantity)
      else (array_agg(i.counted_quantity order by i.updated_at desc, i.id desc))[1] end,
    null,
    (select coalesce(sum(ps.quantity), 0) from public.product_stocks ps
      where ps.tenant_id = v_count.tenant_id and ps.product_id = i.product_id and ps.location_id = v_count.location_id)
  from public.stock_count_items i
  where i.stock_count_id = v_count.id and i.user_id is not null
  group by i.product_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'nothing_counted' using errcode = '55000';
  end if;

  update public.stock_counts
  set status = 'merging', merge_mode = v_mode, merged_at = now()
  where id = v_count.id;
  return v_rows;
end;
$$;

-- "Approve" (chef/owner): the only place a count changes stock. Each merged product is brought to
-- the counted quantity with one 'count' movement against the balance at this moment (lots locked);
-- the stock_movements trigger adds the surplus as a lot or takes the shortage FEFO. Any error rolls
-- everything back; the row lock on the count makes a second approval wait and then fail.
create or replace function public.approve_stock_count(p_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
  v_location_branch uuid;
  v_item record;
  v_system numeric;
  v_diff numeric;
  v_branch uuid;
  v_cost numeric;
  v_moves integer := 0;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef'], array['merging']);
  select branch_id into v_location_branch from public.storage_locations where id = v_count.location_id;

  for v_item in
    select i.id, i.product_id, i.counted_quantity, p.unit, p.cost
    from public.stock_count_items i
    join public.products p on p.id = i.product_id
    where i.stock_count_id = v_count.id and i.user_id is null
    order by i.product_id
  loop
    perform 1 from public.product_stocks
    where tenant_id = v_count.tenant_id and product_id = v_item.product_id and location_id = v_count.location_id
    for update;
    select coalesce(sum(quantity), 0) into v_system
    from public.product_stocks
    where tenant_id = v_count.tenant_id and product_id = v_item.product_id and location_id = v_count.location_id;

    update public.stock_count_items set system_quantity = v_system where id = v_item.id;
    v_diff := v_item.counted_quantity - v_system;
    continue when v_diff = 0;

    if v_diff > 0 then
      -- Surplus joins the place's lot without expiry, valued like the stock already there.
      select coalesce(
        (select cost_per_unit from public.product_stocks
          where tenant_id = v_count.tenant_id and product_id = v_item.product_id and location_id = v_count.location_id
            and branch_id is not distinct from v_location_branch and expiry_date is null),
        (select sum(quantity * cost_per_unit) / nullif(sum(quantity), 0) from public.product_stocks
          where tenant_id = v_count.tenant_id and product_id = v_item.product_id and location_id = v_count.location_id
            and quantity > 0 and cost_per_unit is not null),
        v_item.cost
      ) into v_cost;
      insert into public.stock_movements (
        tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
        reason, user_id, cost_per_unit, unit
      ) values (
        v_count.tenant_id, v_item.product_id, v_location_branch, null, v_count.location_id, v_diff, 'count',
        'stock_count ' || v_count.id, auth.uid(), v_cost, v_item.unit
      );
    else
      -- The trigger matches lots by branch only when the movement has one: lots of another or no
      -- branch at this place are taken with a null movement branch.
      v_branch := case when exists (
        select 1 from public.product_stocks
        where tenant_id = v_count.tenant_id and product_id = v_item.product_id and location_id = v_count.location_id
          and quantity > 0 and branch_id is distinct from v_location_branch
      ) then null else v_location_branch end;
      insert into public.stock_movements (
        tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
        reason, user_id, unit
      ) values (
        v_count.tenant_id, v_item.product_id, v_branch, v_count.location_id, null, -v_diff, 'count',
        'stock_count ' || v_count.id, auth.uid(), v_item.unit
      );
    end if;
    v_moves := v_moves + 1;
  end loop;

  update public.stock_counts
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = v_count.id;
  return v_moves;
end;
$$;

create or replace function public.cancel_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
begin
  v_count := public.stock_count_for_update(p_count_id, array['owner', 'chef'], array['draft', 'counting', 'merging']);
  update public.stock_counts set status = 'cancelled' where id = v_count.id;
end;
$$;

-- Merged list of a count. While counting: entries merged on the fly (tenant's mode). After the merge:
-- the merged rows. Blind: expected quantity and difference are null until approval, except for chefs
-- and owners once the count is merged (they decide on approval). Money only for roles that see costs.
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
  v_mode text;
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
        case when v_reveal and v_money then i.difference * coalesce(
          (select sum(ps.quantity * ps.cost_per_unit) / nullif(sum(ps.quantity), 0) from public.product_stocks ps
            where ps.tenant_id = v_tenant and ps.product_id = i.product_id and ps.location_id = v_count.location_id
              and ps.quantity > 0 and ps.cost_per_unit is not null),
          p.cost, 0) end
      from public.stock_count_items i
      join public.products p on p.id = i.product_id
      where i.stock_count_id = v_count.id and i.user_id is null
      order by p.name, i.product_id;
    return;
  end if;

  v_mode := coalesce(v_count.merge_mode, (select s.count_merge_mode from public.tenant_settings s where s.tenant_id = v_tenant));
  return query
    select i.product_id, p.name, p.unit,
      case when v_mode = 'sum' then sum(i.counted_quantity)
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

-- The caller's own entries in a count (to show what they typed).
create or replace function public.my_stock_count_items(p_count_id uuid)
returns table (product_id uuid, counted_quantity numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select i.product_id, i.counted_quantity
  from public.stock_count_items i
  where i.stock_count_id = p_count_id and i.user_id = (select auth.uid())
    and i.tenant_id = (select public.current_tenant_id());
$$;

-- Products of one storage place (default place or a lot there), a page at a time.
create or replace function public.count_products_page(p_location_id uuid, p_offset integer default 0, p_limit integer default 50)
returns table (id uuid, name text, unit text, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.name, p.unit, count(*) over ()
  from public.products p
  where p.tenant_id = (select public.current_tenant_id())
    and (
      p.storage_location_id = p_location_id
      or exists (select 1 from public.product_stocks ps where ps.product_id = p.id and ps.location_id = p_location_id)
    )
  order by p.name, p.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 0), 0);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.start_stock_count(uuid, text)',
    'public.save_stock_count_items(uuid, jsonb)',
    'public.finish_my_stock_count(uuid)',
    'public.merge_stock_count(uuid)',
    'public.approve_stock_count(uuid)',
    'public.cancel_stock_count(uuid)',
    'public.stock_count_lines(uuid)',
    'public.my_stock_count_items(uuid)',
    'public.count_products_page(uuid, integer, integer)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke execute on function public.touch_stock_count_item() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Final checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.stock_counts where status is null) then
    raise exception 'stock_counts without status remain';
  end if;
  if has_column_privilege('authenticated', 'public.stock_count_items', 'system_quantity', 'select')
     or has_table_privilege('authenticated', 'public.stock_counts', 'update') then
    raise exception 'count access not restricted';
  end if;
end;
$$;

commit;
