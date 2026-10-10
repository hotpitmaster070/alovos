-- Lot (batch) numbers become tenant-wide: LOT-YYYYMMDD-NNNN, NNNN counting all lots of the restaurant
-- that day (tenant-local date from tenant_settings.timezone). No branch or storage code in the number.
-- * Lots live in public.product_lots.lot_number; the counter is batch_daily_counters (tenant, date).
-- * A BEFORE INSERT trigger numbers lots inserted without a number; insert_product_lot() now leaves the
--   number to it. Trim lots keep their parent's number + -R (trg_trim_lot_number runs after this one).
-- * Existing lots keep their numbers (printed labels stay valid). storage_locations is not touched.
-- Run after 20261020_waste_photo_ai.sql. Idempotent.

begin;

do $$
begin
  if to_regclass('public.product_lots') is null
     or to_regprocedure('public.insert_product_lot(uuid, uuid, numeric, uuid, date, date, text, uuid, jsonb, uuid, uuid, numeric)') is null
     or to_regprocedure('public.trim_lot_number()') is null then
    raise exception 'Run 20261018000000_labels_and_lots.sql .. 20261020_waste_photo_ai.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Daily counter per tenant (server-side only)
-- ---------------------------------------------------------------------------
create table if not exists public.batch_daily_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date date not null,
  counter integer not null default 0,
  primary key (tenant_id, date)
);
alter table public.batch_daily_counters enable row level security;
revoke all on table public.batch_daily_counters from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Number generator: takes the next number of the tenant's day
-- ---------------------------------------------------------------------------
drop trigger if exists trg_set_batch_number on public.product_lots;
drop function if exists public.trg_product_lots_set_number();
drop function if exists public.generate_batch_number(uuid);
drop function if exists public.generate_batch_number();

create or replace function public.batch_number_day(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select nullif(btrim(s.timezone), '') into v_tz from public.tenant_settings s where s.tenant_id = p_tenant_id;
  begin
    return (now() at time zone coalesce(v_tz, 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;
  end;
end;
$$;
revoke execute on function public.batch_number_day(uuid) from public, anon, authenticated;

create or replace function public.generate_batch_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := public.batch_number_day(p_tenant_id);
  v_counter integer;
begin
  if p_tenant_id is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('batch_number:' || p_tenant_id::text || ':' || v_date::text, 0));
  insert into public.batch_daily_counters as c (tenant_id, date, counter)
  values (p_tenant_id, v_date, 1)
  on conflict (tenant_id, date) do update set counter = c.counter + 1
  returning c.counter into v_counter;
  return 'LOT-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_counter::text, greatest(4, char_length(v_counter::text)), '0');
end;
$$;
revoke execute on function public.generate_batch_number(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trigger: number lots inserted without one
-- ---------------------------------------------------------------------------
create or replace function public.trg_product_lots_set_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(new.lot_number), '') <> '' then
    return new;
  end if;
  -- Trim lots take the parent's number in trg_trim_lot_number; do not spend a counter value on them.
  if new.lot_type = 'trim' and new.parent_lot_id is not null and exists (
    select 1 from public.product_lots where id = new.parent_lot_id and tenant_id = new.tenant_id
  ) then
    new.lot_number := '';
    return new;
  end if;
  new.lot_number := public.generate_batch_number(new.tenant_id);
  return new;
end;
$$;
revoke execute on function public.trg_product_lots_set_number() from public, anon, authenticated;

-- Fires before trg_trim_lot_number (triggers run in name order).
create trigger trg_set_batch_number
  before insert on public.product_lots
  for each row execute function public.trg_product_lots_set_number();

-- Trim suffix must be free across the tenant now, not only on the same day.
create or replace function public.trim_lot_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent text;
  v_number text;
  v_n integer := 1;
begin
  if new.lot_type is distinct from 'trim' or new.parent_lot_id is null then
    return new;
  end if;
  select lot_number into v_parent from public.product_lots where id = new.parent_lot_id and tenant_id = new.tenant_id;
  if v_parent is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('trim_lot:' || new.parent_lot_id::text, 0));
  v_number := v_parent || '-R';
  while exists (
    select 1 from public.product_lots where tenant_id = new.tenant_id and lot_number = v_number
  ) loop
    v_n := v_n + 1;
    v_number := v_parent || '-R' || v_n;
  end loop;
  new.lot_number := v_number;
  return new;
end;
$$;
revoke execute on function public.trim_lot_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. insert_product_lot leaves the number to the trigger (seq per branch/day stays for ordering)
-- ---------------------------------------------------------------------------
create or replace function public.insert_product_lot(
  p_tenant_id uuid,
  p_product_id uuid,
  p_qty numeric,
  p_storage_id uuid,
  p_production_date date,
  p_expiry_date date,
  p_lot_type text,
  p_parent_lot_id uuid,
  p_composition jsonb,
  p_preparation_id uuid,
  p_movement_id uuid,
  p_portions numeric
)
returns public.product_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_storage public.storage_locations;
  v_unit text;
  v_day date := public.tenant_today(p_tenant_id);
  v_seq integer;
  v_lot public.product_lots;
begin
  select * into v_storage from public.storage_locations where id = p_storage_id and tenant_id = p_tenant_id;
  select unit into v_unit from public.products where id = p_product_id and tenant_id = p_tenant_id;
  perform pg_advisory_xact_lock(hashtextextended('product_lot:' || v_storage.branch_id::text || ':' || v_day::text, 0));
  v_seq := coalesce((select max(seq) from public.product_lots where branch_id = v_storage.branch_id and numbered_on = v_day), 0) + 1;
  insert into public.product_lots (
    tenant_id, branch_id, product_id, lot_number, numbered_on, seq, production_date, expiry_date, quantity, unit,
    portions, storage_location_id, lot_type, parent_lot_id, composition_json, preparation_id, movement_id
  ) values (
    p_tenant_id, v_storage.branch_id, p_product_id, null, v_day, v_seq,
    p_production_date, p_expiry_date, p_qty, v_unit, p_portions, p_storage_id, p_lot_type,
    p_parent_lot_id, coalesce(p_composition, '[]'::jsonb), p_preparation_id, p_movement_id
  )
  returning * into v_lot;
  return v_lot;
end;
$$;
revoke execute on function public.insert_product_lot(uuid, uuid, numeric, uuid, date, date, text, uuid, jsonb, uuid, uuid, numeric)
  from public, anon, authenticated;

-- Preview of the next number (does not take it).
create or replace function public.generate_lot_number(p_branch_id uuid, p_storage_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_storage public.storage_locations;
  v_date date;
  v_next integer;
begin
  select * into v_storage from public.storage_locations where id = p_storage_id;
  if v_storage.id is null or v_storage.branch_id is distinct from p_branch_id
     or (auth.uid() is not null and v_storage.tenant_id is distinct from public.current_tenant_id()) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  v_date := public.batch_number_day(v_storage.tenant_id);
  v_next := coalesce((
    select counter from public.batch_daily_counters where tenant_id = v_storage.tenant_id and date = v_date
  ), 0) + 1;
  return 'LOT-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_next::text, greatest(4, char_length(v_next::text)), '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Uniqueness of the new numbers across the tenant (old numbers keep their per-day index)
-- ---------------------------------------------------------------------------
create unique index if not exists uq_product_lots_tenant_batch_number
  on public.product_lots (tenant_id, lot_number)
  where lot_number ~ '^LOT-[0-9]{8}-[0-9]{4,}';

do $$
begin
  if to_regclass('public.uq_product_lots_tenant_batch_number') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_set_batch_number' and tgrelid = 'public.product_lots'::regclass)
     or has_function_privilege('authenticated', 'public.generate_batch_number(uuid)', 'execute') then
    raise exception 'tenant-wide batch numbering incomplete';
  end if;
end;
$$;

commit;
