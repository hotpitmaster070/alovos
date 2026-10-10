-- Close direct stock writes, step 1 (safe to apply before the app update):
-- * A 'transfer' movement can only come from transfer_stock_between_branches(): a client insert of that
--   type (role authenticated/anon) is refused, and every transfer movement must belong to a transfer
--   document of the same tenant. Receipts and write-offs keep working through the old path until the
--   app switches to the RPCs below; 20261028001000 then revokes INSERT on stock_movements.
-- * receive_stock_rpc / wastage_stock_rpc / move_stock_rpc: the remaining client writes as SECURITY
--   DEFINER functions (tenant from require_tenant_member(), product and places checked).
-- * Transfer documents get a number TRF-YYYYMMDD-NNNN (tenant's day, counter per tenant and day) and a
--   status; transfer_stock_options() feeds the transfer screen (available stock, nearest expiry).
-- Run after 20261028000800_branch_transfers_transaction.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.transfer_stock_between_branches(uuid, uuid, jsonb, text)') is null
     or to_regclass('public.branch_transfers') is null
     or to_regprocedure('public.require_tenant_member()') is null
     or to_regprocedure('public.tenant_today(uuid)') is null then
    raise exception 'Run 20261028000800_branch_transfers_transaction.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. No direct 'transfer' movements
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is the client role for a direct insert and the function
-- owner inside transfer_stock_between_branches().
create or replace function public.guard_stock_movement_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.movement_type = 'transfer' then
    if current_user in ('authenticated', 'anon') then
      raise exception 'direct_transfer_forbidden' using errcode = '42501';
    end if;
    if new.branch_transfer_id is null or not exists (
      select 1 from public.branch_transfers where id = new.branch_transfer_id and tenant_id = new.tenant_id
    ) then
      raise exception 'direct_transfer_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_stock_movement_insert() from public, anon, authenticated;

drop trigger if exists stock_movements_guard_transfer on public.stock_movements;
create trigger stock_movements_guard_transfer
  before insert on public.stock_movements
  for each row execute function public.guard_stock_movement_insert();

-- ---------------------------------------------------------------------------
-- 2. RPCs for the client writes that are left
-- ---------------------------------------------------------------------------
-- Goods in: one 'prihod' movement into an active place.
create or replace function public.receive_stock_rpc(
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_cost_per_unit numeric default null,
  p_expiry_date date default null,
  p_unit text default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_location public.storage_locations;
  v_product_unit text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or (p_cost_per_unit is not null and (p_cost_per_unit < 0 or p_cost_per_unit > 1000000000))
     or char_length(coalesce(v_reason, '')) > 500 or char_length(coalesce(v_unit, '')) > 40 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select unit into v_product_unit from public.products where id = p_product_id and tenant_id = v_tenant;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  select * into v_location from public.storage_locations where id = p_location_id and tenant_id = v_tenant and is_active;
  if v_location.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (
    tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, cost_per_unit, unit, reason, user_id
  ) values (
    v_tenant, p_product_id, v_location.branch_id, v_location.id, p_quantity, 'prihod', p_expiry_date, p_cost_per_unit,
    coalesce(v_unit, v_product_unit, 'unit'), v_reason, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Goods out of a place (FEFO in the trigger): 'spisanie' (write-off, sale) or 'waste'.
create or replace function public.wastage_stock_rpc(
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_movement_type text default 'spisanie',
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_location public.storage_locations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or coalesce(p_movement_type, '') not in ('spisanie', 'waste')
     or char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  select * into v_location from public.storage_locations where id = p_location_id and tenant_id = v_tenant;
  if v_location.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, user_id
  ) values (
    v_tenant, p_product_id, v_location.branch_id, v_location.id, p_quantity, p_movement_type, v_reason, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Between two places of the same branch (FEFO, dates kept). Other branches: transfer_stock_between_branches().
create or replace function public.move_stock_rpc(
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_from public.storage_locations;
  v_to public.storage_locations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or p_from_location_id is null or p_to_location_id is null or p_from_location_id = p_to_location_id
     or char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  select * into v_from from public.storage_locations where id = p_from_location_id and tenant_id = v_tenant;
  select * into v_to from public.storage_locations where id = p_to_location_id and tenant_id = v_tenant and is_active;
  if v_from.id is null or v_to.id is null or v_from.branch_id is distinct from v_to.branch_id then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type, reason, user_id
  ) values (
    v_tenant, p_product_id, v_from.branch_id, v_from.id, v_to.id, p_quantity, 'peremeshchenie', v_reason, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.receive_stock_rpc(uuid, uuid, numeric, numeric, date, text, text) from public, anon;
revoke execute on function public.wastage_stock_rpc(uuid, uuid, numeric, text, text) from public, anon;
revoke execute on function public.move_stock_rpc(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.receive_stock_rpc(uuid, uuid, numeric, numeric, date, text, text) to authenticated;
grant execute on function public.wastage_stock_rpc(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.move_stock_rpc(uuid, uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Transfer number and status
-- ---------------------------------------------------------------------------
create table if not exists public.branch_transfer_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date date not null,
  counter integer not null default 0,
  primary key (tenant_id, date)
);
alter table public.branch_transfer_counters enable row level security;
revoke all on table public.branch_transfer_counters from public, anon, authenticated;

alter table public.branch_transfers add column if not exists number text;
alter table public.branch_transfers add column if not exists status text not null default 'completed';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'branch_transfers_status_check') then
    alter table public.branch_transfers
      add constraint branch_transfers_status_check check (status in ('completed'));
  end if;
end;
$$;

-- The tenant's day (tenant_settings.timezone, UTC when unset) of p_at.
create or replace function public.transfer_number_next(p_tenant_id uuid, p_at timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (p_at at time zone coalesce(
    (select timezone from public.tenant_settings where tenant_id = p_tenant_id), 'UTC'))::date;
  v_counter integer;
begin
  insert into public.branch_transfer_counters as c (tenant_id, date, counter)
  values (p_tenant_id, v_date, 1)
  on conflict (tenant_id, date) do update set counter = c.counter + 1
  returning c.counter into v_counter;
  return 'TRF-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, greatest(4, char_length(v_counter::text)), '0');
end;
$$;
revoke execute on function public.transfer_number_next(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.trg_branch_transfers_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is null then
    new.number := public.transfer_number_next(new.tenant_id, coalesce(new.created_at, now()));
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_branch_transfers_number() from public, anon, authenticated;

drop trigger if exists trg_branch_transfers_number on public.branch_transfers;
create trigger trg_branch_transfers_number
  before insert on public.branch_transfers
  for each row execute function public.trg_branch_transfers_number();

do $$
declare
  v_row record;
begin
  for v_row in select id, tenant_id, created_at from public.branch_transfers where number is null order by created_at, id loop
    update public.branch_transfers
    set number = public.transfer_number_next(v_row.tenant_id, v_row.created_at)
    where id = v_row.id;
  end loop;
end;
$$;
alter table public.branch_transfers alter column number set not null;
create unique index if not exists uq_branch_transfers_tenant_number on public.branch_transfers (tenant_id, number);

-- ---------------------------------------------------------------------------
-- 4. Stock the transfer screen can send
-- ---------------------------------------------------------------------------
-- Non-expired stock of the branch (or one place of it) per product, with the nearest expiry (FEFO).
-- With p_product_ids: those products, zero when out of stock. Otherwise products in stock matching
-- p_search on name, barcode or internal code (exact code first). Owners and chefs only.
create or replace function public.transfer_stock_options(
  p_branch_id uuid,
  p_location_id uuid default null,
  p_search text default null,
  p_product_ids uuid[] default null,
  p_limit integer default 20
)
returns table (
  product_id uuid,
  name text,
  internal_code text,
  barcode text,
  unit text,
  available numeric,
  nearest_expiry date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := coalesce(public.tenant_today(v_tenant), (now() at time zone 'UTC')::date);
  v_query text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_branch_id is null or char_length(coalesce(v_query, '')) > 100
     or coalesce(array_length(p_product_ids, 1), 0) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.storage_locations where id = p_location_id and tenant_id = v_tenant and branch_id = p_branch_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  v_pattern := '%' || replace(replace(replace(coalesce(v_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with stock as (
    select ps.product_id, sum(ps.quantity) as available, min(ps.expiry_date) as nearest
    from public.product_stocks ps
    join public.storage_locations sl on sl.id = ps.location_id and sl.tenant_id = v_tenant
    where ps.tenant_id = v_tenant
      and sl.branch_id = p_branch_id
      and (p_location_id is null or ps.location_id = p_location_id)
      and ps.quantity > 0
      and (ps.expiry_date is null or ps.expiry_date >= v_today)
    group by ps.product_id
  )
  select p.id, p.name, p.internal_code, p.barcode, p.unit, coalesce(s.available, 0)::numeric, s.nearest
  from public.products p
  left join stock s on s.product_id = p.id
  where p.tenant_id = v_tenant
    and case
      when p_product_ids is not null then p.id = any(p_product_ids)
      else coalesce(s.available, 0) > 0
        and (v_query is null or p.name ilike v_pattern or p.barcode ilike v_pattern or p.internal_code ilike v_pattern)
    end
  order by
    (v_query is not null and (lower(coalesce(p.barcode, '')) = lower(v_query) or lower(coalesce(p.internal_code, '')) = lower(v_query))) desc,
    p.name, p.id
  limit case when p_product_ids is not null then 200 else v_limit end;
end;
$$;
revoke execute on function public.transfer_stock_options(uuid, uuid, text, uuid[], integer) from public, anon;
grant execute on function public.transfer_stock_options(uuid, uuid, text, uuid[], integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.receive_stock_rpc(uuid, uuid, numeric, numeric, date, text, text)', 'execute')
     or has_function_privilege('anon', 'public.transfer_stock_options(uuid, uuid, text, uuid[], integer)', 'execute') then
    raise exception 'stock RPCs must not be callable by anon';
  end if;
end;
$$;

commit;
