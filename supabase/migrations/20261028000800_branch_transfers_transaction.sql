-- Stock transfer between two branches of one restaurant, in a single transaction.
-- * public.transfer_stock_between_branches(): owners and chefs only; the tenant comes from the caller's
--   membership, never from a parameter. Both branches, every product and every place are checked
--   against that tenant. All source rows are locked (FOR UPDATE) and every item is checked before
--   anything is written; any shortage or error aborts the whole call, so nothing is half moved.
-- * Stock leaves the source branch FEFO, skipping expired rows, as one 'transfer' movement per source
--   row (stock_id path of handle_stock_movement): expiry date and cost travel with the goods, and
--   product_stocks changes only in that trigger. product_lots (labels) are not touched.
-- * branch_transfers / branch_transfer_items keep the document; stock_movements.branch_transfer_id
--   links each movement to it. Writes only through the function.
-- Run after 20261028000700_import_catalog.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.require_tenant_member()') is null
     or to_regprocedure('public.current_member_role()') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or to_regprocedure('public.tenant_today(uuid)') is null
     or to_regprocedure('public.handle_stock_movement()') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'stock_id'
     ) then
    raise exception 'Run 20261022000000_product_storage_rules.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Transfer documents
-- ---------------------------------------------------------------------------
create table if not exists public.branch_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_branch_id uuid not null references public.branches(id),
  to_branch_id uuid not null references public.branches(id),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint branch_transfers_distinct check (from_branch_id <> to_branch_id),
  constraint branch_transfers_note_length check (note is null or char_length(note) <= 500)
);
create index if not exists idx_branch_transfers_tenant_created on public.branch_transfers (tenant_id, created_at desc);

create table if not exists public.branch_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  transfer_id uuid not null references public.branch_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null,
  unit text,
  created_at timestamptz not null default now(),
  constraint branch_transfer_items_quantity check (quantity > 0)
);
create index if not exists idx_branch_transfer_items_transfer on public.branch_transfer_items (transfer_id);
create index if not exists idx_branch_transfer_items_tenant on public.branch_transfer_items (tenant_id);

alter table public.stock_movements add column if not exists branch_transfer_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_branch_transfer_id_fkey') then
    alter table public.stock_movements
      add constraint stock_movements_branch_transfer_id_fkey
      foreign key (branch_transfer_id) references public.branch_transfers(id) on delete set null;
  end if;
end;
$$;
create index if not exists idx_stock_movements_branch_transfer
  on public.stock_movements (branch_transfer_id) where branch_transfer_id is not null;

alter table public.branch_transfers enable row level security;
alter table public.branch_transfer_items enable row level security;
revoke all on public.branch_transfers, public.branch_transfer_items from anon, authenticated;
grant select on public.branch_transfers, public.branch_transfer_items to authenticated;
drop policy if exists branch_transfers_select on public.branch_transfers;
create policy branch_transfers_select on public.branch_transfers
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists branch_transfer_items_select on public.branch_transfer_items;
create policy branch_transfer_items_select on public.branch_transfer_items
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 2. The transfer
-- ---------------------------------------------------------------------------
-- p_items: [{product_id, quantity, from_location_id?, to_location_id?}], 1..200 items, one entry per
-- product and source place. Without from_location_id stock is taken from any place of the source
-- branch; without to_location_id each source row lands in the target branch's place of the same type
-- (lowest number). Errors (all abort): forbidden, invalid_input, same_branch, from_branch_not_found,
-- to_branch_not_found, product_not_found, location_not_found, open_count, and insufficient_stock with
-- DETAIL = [{product_id, requested, available}] for every short item.
create or replace function public.transfer_stock_between_branches(
  p_from_branch uuid,
  p_to_branch uuid,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := public.tenant_today(v_tenant);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_items jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_product uuid;
  v_from_loc uuid;
  v_to_loc uuid;
  v_qty numeric;
  v_unit text;
  v_available numeric;
  v_short jsonb := '[]'::jsonb;
  v_transfer uuid;
  v_lot public.product_stocks;
  v_source public.storage_locations;
  v_target public.storage_locations;
  v_left numeric;
  v_take numeric;
  v_movements integer := 0;
  v_total numeric := 0;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from_branch is null or p_to_branch is null
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 200
     or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_from_branch = p_to_branch then
    raise exception 'same_branch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_from_branch and tenant_id = v_tenant) then
    raise exception 'from_branch_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches where id = p_to_branch and tenant_id = v_tenant) then
    raise exception 'to_branch_not_found' using errcode = 'P0002';
  end if;

  -- Shape of every item; ordered by product so concurrent transfers lock rows in the same order.
  for v_elem in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_elem) is distinct from 'object'
       or coalesce(v_elem->>'product_id', '') !~ v_uuid
       or jsonb_typeof(v_elem->'quantity') is distinct from 'number'
       or (v_elem->>'quantity')::numeric <= 0
       or (v_elem->>'quantity')::numeric > 1000000
       or (v_elem ? 'from_location_id' and jsonb_typeof(v_elem->'from_location_id') <> 'null'
           and coalesce(v_elem->>'from_location_id', '') !~ v_uuid)
       or (v_elem ? 'to_location_id' and jsonb_typeof(v_elem->'to_location_id') <> 'null'
           and coalesce(v_elem->>'to_location_id', '') !~ v_uuid) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', lower(v_elem->>'product_id'),
      'quantity', (v_elem->>'quantity')::numeric,
      'from_location_id', lower(nullif(v_elem->>'from_location_id', '')),
      'to_location_id', lower(nullif(v_elem->>'to_location_id', ''))
    ));
  end loop;
  if (select count(*) from jsonb_array_elements(v_items))
     <> (select count(distinct (value->>'product_id', coalesce(value->>'from_location_id', '')))
         from jsonb_array_elements(v_items)) then
    raise exception 'invalid_input' using errcode = '22023', detail = 'duplicate_item';
  end if;
  select coalesce(jsonb_agg(value order by value->>'product_id', coalesce(value->>'from_location_id', '')), '[]'::jsonb)
  into v_items from jsonb_array_elements(v_items);

  -- Pass 1: ownership, places, locks and balances. Nothing is written yet.
  for v_elem in select value from jsonb_array_elements(v_items) loop
    v_product := (v_elem->>'product_id')::uuid;
    v_from_loc := (v_elem->>'from_location_id')::uuid;
    v_to_loc := (v_elem->>'to_location_id')::uuid;
    v_qty := (v_elem->>'quantity')::numeric;

    if not exists (select 1 from public.products where id = v_product and tenant_id = v_tenant) then
      raise exception 'product_not_found' using errcode = 'P0002', detail = v_product::text;
    end if;
    if v_from_loc is not null and not exists (
      select 1 from public.storage_locations
      where id = v_from_loc and tenant_id = v_tenant and branch_id = p_from_branch
    ) then
      raise exception 'location_not_found' using errcode = 'P0002', detail = v_from_loc::text;
    end if;
    if v_to_loc is not null and not exists (
      select 1 from public.storage_locations
      where id = v_to_loc and tenant_id = v_tenant and branch_id = p_to_branch and is_active
    ) then
      raise exception 'location_not_found' using errcode = 'P0002', detail = v_to_loc::text;
    end if;

    select coalesce(sum(locked.quantity), 0) into v_available
    from (
      select ps.quantity
      from public.product_stocks ps
      join public.storage_locations sl on sl.id = ps.location_id and sl.tenant_id = v_tenant
      where ps.tenant_id = v_tenant
        and ps.product_id = v_product
        and sl.branch_id = p_from_branch
        and (v_from_loc is null or ps.location_id = v_from_loc)
        and ps.quantity > 0
        and (ps.expiry_date is null or ps.expiry_date >= v_today)
      order by ps.id
      for update of ps
    ) locked;
    if v_available < v_qty then
      v_short := v_short || jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'requested', v_qty, 'available', v_available
      ));
    end if;
  end loop;
  if jsonb_array_length(v_short) > 0 then
    raise exception 'insufficient_stock' using errcode = '22003', detail = v_short::text;
  end if;

  -- Pass 2: the document, then one movement per source row (FEFO).
  insert into public.branch_transfers (tenant_id, from_branch_id, to_branch_id, note, created_by)
  values (v_tenant, p_from_branch, p_to_branch, v_note, auth.uid())
  returning id into v_transfer;

  for v_elem in select value from jsonb_array_elements(v_items) loop
    v_product := (v_elem->>'product_id')::uuid;
    v_from_loc := (v_elem->>'from_location_id')::uuid;
    v_to_loc := (v_elem->>'to_location_id')::uuid;
    v_qty := (v_elem->>'quantity')::numeric;
    select unit into v_unit from public.products where id = v_product;

    insert into public.branch_transfer_items (tenant_id, transfer_id, product_id, quantity, unit)
    values (v_tenant, v_transfer, v_product, v_qty, v_unit);

    v_left := v_qty;
    for v_lot in
      select ps.*
      from public.product_stocks ps
      join public.storage_locations sl on sl.id = ps.location_id and sl.tenant_id = v_tenant
      where ps.tenant_id = v_tenant
        and ps.product_id = v_product
        and sl.branch_id = p_from_branch
        and (v_from_loc is null or ps.location_id = v_from_loc)
        and ps.quantity > 0
        and (ps.expiry_date is null or ps.expiry_date >= v_today)
      order by ps.expiry_date nulls last, ps.id
    loop
      exit when v_left <= 0;
      v_take := least(v_lot.quantity, v_left);

      select * into v_source from public.storage_locations where id = v_lot.location_id;
      if v_to_loc is not null then
        select * into v_target from public.storage_locations where id = v_to_loc;
      else
        select * into v_target
        from public.storage_locations
        where tenant_id = v_tenant and branch_id = p_to_branch and is_active and type = v_source.type
        order by number nulls last, id
        limit 1;
        if v_target.id is null then
          raise exception 'location_not_found' using errcode = 'P0002', detail = v_source.type;
        end if;
      end if;
      if exists (
        select 1 from public.stock_counts
        where tenant_id = v_tenant
          and location_id in (v_source.id, v_target.id)
          and status in ('draft', 'counting', 'merging')
      ) then
        raise exception 'open_count' using errcode = '55000';
      end if;

      perform set_config('app.lot_move', 'on', true);
      insert into public.stock_movements (
        tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
        expiry_date, previous_expiry_date, stock_id, cost_per_unit, reason, unit, user_id, branch_transfer_id
      ) values (
        v_tenant, v_product, p_to_branch, v_source.id, v_target.id, v_take, 'transfer',
        v_lot.expiry_date, v_lot.expiry_date, v_lot.id, v_lot.cost_per_unit, v_note, v_lot.unit, auth.uid(), v_transfer
      );
      perform set_config('app.lot_move', 'off', true);

      v_left := v_left - v_take;
      v_movements := v_movements + 1;
    end loop;
    if v_left > 0 then
      raise exception 'insufficient_stock' using errcode = '22003',
        detail = jsonb_build_array(jsonb_build_object(
          'product_id', v_product, 'requested', v_qty, 'available', v_qty - v_left
        ))::text;
    end if;
    v_total := v_total + v_qty;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'transfer_id', v_transfer,
    'items', jsonb_array_length(v_items),
    'movements', v_movements,
    'quantity', v_total
  );
end;
$$;

revoke execute on function public.transfer_stock_between_branches(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.transfer_stock_between_branches(uuid, uuid, jsonb, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.transfer_stock_between_branches(uuid, uuid, jsonb, text)', 'execute') then
    raise exception 'transfer_stock_between_branches must not be callable by anon';
  end if;
end;
$$;

commit;
