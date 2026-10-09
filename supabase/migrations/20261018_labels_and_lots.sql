-- Shelf-life rules, product lots with printable labels, preparations (zaqotovka).
-- * Shelf life of a product in a place: product_shelf_life_rules (product + storage place), else
--   products.shelf_life_days, else tenant_settings.default_shelf_life_days. No day counts in code.
-- * A lot is the label record of stock that came in: expiry_date = production_date + shelf life.
--   Receipt (receive_stock_with_lot) writes one 'prihod' movement with that expiry and the lot in one
--   transaction, so the stock row (product_stocks, keyed by expiry) and the label agree.
-- * Lot numbers: {branch code}-{storage type code}{storage number}-{DDMM}-{seq}, e.g. NIZ-SOY1-1610-001.
--   DDMM is the tenant-local day the lot is created, seq counts lots per branch per day (at least three
--   digits). Unique per tenant (branch codes are unique per tenant, not across tenants).
-- * Preparation: create_lots_from_preparation() scales the recipe by the source quantity, writes the
--   inputs off ('task' movements from the place they were taken from) and receives every output into its
--   storage place with its own shelf life, each as a 'semi' lot whose parent is the source lot. Not
--   enough stock -> nothing is saved.
-- Run after 20261017_cleanup_empty_tenants.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.storage_type_code(text)') is null
     or to_regprocedure('public.require_kitchen_lead()') is null
     or to_regprocedure('public.cleanup_empty_tenants()') is null then
    raise exception 'Run 20261015_storage_numbering.sql, 20261016_parlevel_forecast.sql and 20261017_cleanup_empty_tenants.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Settings and helpers
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists default_shelf_life_days integer not null default 3;
alter table public.tenant_settings drop constraint if exists tenant_settings_default_shelf_life_check;
alter table public.tenant_settings
  add constraint tenant_settings_default_shelf_life_check check (default_shelf_life_days between 0 and 3650);
grant update (default_shelf_life_days) on public.tenant_settings to authenticated;

create or replace function public.tenant_today(p_tenant_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone s.timezone)::date from public.tenant_settings s where s.tenant_id = p_tenant_id
$$;

-- Any member of the caller's tenant; returns the tenant.
create or replace function public.require_tenant_member()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if public.current_member_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

-- Owners, chefs and cooks set shelf-life rules (whoever receives goods and prepares).
create or replace function public.can_set_shelf_life()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() in ('owner', 'chef', 'cook'), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Shelf-life rules
-- ---------------------------------------------------------------------------
create table if not exists public.product_shelf_life_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  storage_location_id uuid not null references public.storage_locations(id) on delete cascade,
  shelf_life_days integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_shelf_life_rules_days_check check (shelf_life_days between 0 and 3650)
);
create unique index if not exists uniq_shelf_life_rule on public.product_shelf_life_rules (product_id, storage_location_id);
create index if not exists idx_shelf_life_rules_tenant on public.product_shelf_life_rules (tenant_id);

alter table public.product_shelf_life_rules enable row level security;
revoke all on table public.product_shelf_life_rules from anon, authenticated;
grant select on table public.product_shelf_life_rules to authenticated;
drop policy if exists shelf_life_rules_select on public.product_shelf_life_rules;
create policy shelf_life_rules_select on public.product_shelf_life_rules
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

-- Days a product keeps in a storage place: rule, else the product's own value, else the tenant default.
-- Null for a product outside the caller's tenant.
create or replace function public.get_shelf_life(p_product_id uuid, p_storage_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.shelf_life_days, p.shelf_life_days, s.default_shelf_life_days)
  from public.products p
  join public.tenant_settings s on s.tenant_id = p.tenant_id
  left join public.product_shelf_life_rules r on r.product_id = p.id and r.storage_location_id = p_storage_id
  where p.id = p_product_id
    and (auth.uid() is null or p.tenant_id = public.current_tenant_id())
$$;

-- p_days null removes the rule.
create or replace function public.set_shelf_life_rule(p_product_id uuid, p_storage_id uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  if not public.can_set_shelf_life() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.storage_locations where id = p_storage_id and tenant_id = v_tenant) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if p_days is null then
    delete from public.product_shelf_life_rules where product_id = p_product_id and storage_location_id = p_storage_id;
    return;
  end if;
  if p_days < 0 or p_days > 3650 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into public.product_shelf_life_rules (tenant_id, product_id, storage_location_id, shelf_life_days)
  values (v_tenant, p_product_id, p_storage_id, p_days)
  on conflict (product_id, storage_location_id) do update
    set shelf_life_days = excluded.shelf_life_days, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Preparations (recipes: inputs -> outputs)
-- ---------------------------------------------------------------------------
create table if not exists public.preparations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  inputs jsonb not null default '[]'::jsonb,
  outputs jsonb not null default '[]'::jsonb
);
alter table public.preparations add column if not exists inputs jsonb not null default '[]'::jsonb;
alter table public.preparations add column if not exists outputs jsonb not null default '[]'::jsonb;
alter table public.preparations add column if not exists is_active boolean not null default true;
alter table public.preparations add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.preparations add column if not exists created_at timestamptz not null default now();
alter table public.preparations add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_preparations_tenant on public.preparations (tenant_id, name);

-- inputs [{product_id, qty}] and outputs [{product_id, qty, portions?, name?}]: products of the tenant,
-- positive quantities, no product twice in a list. Stored normalised.
-- 20261018_wastage_in_prep.sql replaces this validator and create_lots_from_preparation(); once it has
-- run (public.preparation_runs exists) this file keeps its versions, so the order of re-runs does not
-- matter.
do $guard$
begin
  if to_regclass('public.preparation_runs') is not null then
    return;
  end if;
  execute $ddl$
create or replace function public.preparation_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_inputs jsonb := '[]'::jsonb;
  v_outputs jsonb := '[]'::jsonb;
  v_product uuid;
  v_qty numeric;
  v_portions numeric;
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' or char_length(new.name) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if jsonb_typeof(new.inputs) <> 'array' or jsonb_array_length(new.inputs) = 0
     or jsonb_typeof(new.outputs) <> 'array' or jsonb_array_length(new.outputs) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  begin
    for v_item in select * from jsonb_array_elements(new.inputs)
    loop
      v_product := (v_item ->> 'product_id')::uuid;
      v_qty := (v_item ->> 'qty')::numeric;
      if v_product is null or v_qty is null or v_qty <= 0 or v_inputs @> jsonb_build_array(jsonb_build_object('product_id', v_product)) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_inputs := v_inputs || jsonb_build_array(jsonb_build_object('product_id', v_product, 'qty', v_qty));
    end loop;
    for v_item in select * from jsonb_array_elements(new.outputs)
    loop
      v_product := (v_item ->> 'product_id')::uuid;
      v_qty := (v_item ->> 'qty')::numeric;
      v_portions := nullif(v_item ->> 'portions', '')::numeric;
      if v_product is null or v_qty is null or v_qty <= 0 or (v_portions is not null and v_portions <= 0)
         or v_outputs @> jsonb_build_array(jsonb_build_object('product_id', v_product)) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_outputs := v_outputs || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'product_id', v_product, 'qty', v_qty, 'portions', v_portions,
        'name', nullif(btrim(coalesce(v_item ->> 'name', '')), ''))));
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_input' using errcode = '22023';
  end;
  if exists (
    select 1 from jsonb_array_elements(v_inputs || v_outputs) e
    where not exists (select 1 from public.products p where p.id = (e ->> 'product_id')::uuid and p.tenant_id = new.tenant_id)
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  new.inputs := v_inputs;
  new.outputs := v_outputs;
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$
  $ddl$;
end;
$guard$;
revoke execute on function public.preparation_validate() from public, anon, authenticated;

drop trigger if exists trg_preparation_tenant on public.preparations;
create trigger trg_preparation_tenant
  before insert or update on public.preparations
  for each row execute function public.enforce_tenant_id();
drop trigger if exists trg_preparation_validate on public.preparations;
create trigger trg_preparation_validate
  before insert or update on public.preparations
  for each row execute function public.preparation_validate();

alter table public.preparations enable row level security;
revoke all on table public.preparations from anon, authenticated;
grant select, insert, update, delete on table public.preparations to authenticated;
drop policy if exists preparations_select on public.preparations;
create policy preparations_select on public.preparations
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists preparations_insert on public.preparations;
create policy preparations_insert on public.preparations
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'));
drop policy if exists preparations_update on public.preparations;
create policy preparations_update on public.preparations
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists preparations_delete on public.preparations;
create policy preparations_delete on public.preparations
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'));

-- ---------------------------------------------------------------------------
-- 4. Lots and label prints
-- ---------------------------------------------------------------------------
create table if not exists public.product_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  lot_number text not null,
  numbered_on date not null,
  seq integer not null,
  production_date date not null default current_date,
  expiry_date date not null,
  quantity numeric not null,
  unit text not null,
  portions numeric,
  storage_location_id uuid not null references public.storage_locations(id),
  lot_type text not null,
  parent_lot_id uuid references public.product_lots(id) on delete set null,
  composition_json jsonb not null default '[]'::jsonb,
  preparation_id uuid references public.preparations(id) on delete set null,
  movement_id uuid references public.stock_movements(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint product_lots_type_check check (lot_type in ('raw', 'semi')),
  constraint product_lots_quantity_check check (quantity > 0),
  constraint product_lots_portions_check check (portions is null or portions > 0),
  constraint product_lots_expiry_check check (expiry_date >= production_date),
  constraint product_lots_composition_check check (jsonb_typeof(composition_json) = 'array'),
  constraint product_lots_seq_check check (seq > 0)
);
-- DDMM carries no year: the same number may come back on the same date next year.
drop index if exists public.uniq_product_lot_number;
create unique index if not exists uniq_product_lot_number_day on public.product_lots (tenant_id, numbered_on, lot_number);
create unique index if not exists uniq_product_lot_seq on public.product_lots (branch_id, numbered_on, seq);
create index if not exists idx_product_lots_expiry on public.product_lots (tenant_id, expiry_date);
create index if not exists idx_product_lots_product on public.product_lots (product_id, storage_location_id, expiry_date);

alter table public.product_lots enable row level security;
revoke all on table public.product_lots from anon, authenticated;
grant select on table public.product_lots to authenticated;
drop policy if exists product_lots_select on public.product_lots;
create policy product_lots_select on public.product_lots
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

create table if not exists public.label_print_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lot_id uuid not null references public.product_lots(id) on delete cascade,
  copies integer not null,
  printed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  printed_at timestamptz not null default now(),
  constraint label_print_logs_copies_check check (copies > 0)
);
create index if not exists idx_label_print_logs_lot on public.label_print_logs (lot_id, printed_at desc);

alter table public.label_print_logs enable row level security;
revoke all on table public.label_print_logs from anon, authenticated;
grant select on table public.label_print_logs to authenticated;
drop policy if exists label_print_logs_select on public.label_print_logs;
create policy label_print_logs_select on public.label_print_logs
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

-- Branch part of a lot number for a storage place: NIZ-SOY1.
create or replace function public.lot_number_prefix(p_storage_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.code || '-' || public.storage_type_code(s.type) || s.number
  from public.storage_locations s
  join public.branches b on b.id = s.branch_id
  where s.id = p_storage_id
$$;

create or replace function public.format_lot_number(p_storage_id uuid, p_day date, p_seq integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.lot_number_prefix(p_storage_id) || '-' || to_char(p_day, 'DDMM') || '-'
    || lpad(p_seq::text, greatest(3, char_length(p_seq::text)), '0')
$$;

-- Next number a lot in this place would get today (preview; create_* functions reserve it under a lock).
create or replace function public.generate_lot_number(p_branch_id uuid, p_storage_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_storage public.storage_locations;
  v_day date;
begin
  select * into v_storage from public.storage_locations where id = p_storage_id;
  if v_storage.id is null or v_storage.branch_id is distinct from p_branch_id
     or (auth.uid() is not null and v_storage.tenant_id is distinct from public.current_tenant_id()) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  v_day := public.tenant_today(v_storage.tenant_id);
  return public.format_lot_number(
    p_storage_id, v_day,
    coalesce((select max(seq) from public.product_lots where branch_id = p_branch_id and numbered_on = v_day), 0) + 1
  );
end;
$$;

-- Inserts a lot with the next number of its branch for today. Callers have checked tenant and inputs.
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
    p_tenant_id, v_storage.branch_id, p_product_id, public.format_lot_number(p_storage_id, v_day, v_seq), v_day, v_seq,
    p_production_date, p_expiry_date, p_qty, v_unit, p_portions, p_storage_id, p_lot_type,
    p_parent_lot_id, coalesce(p_composition, '[]'::jsonb), p_preparation_id, p_movement_id
  )
  returning * into v_lot;
  return v_lot;
end;
$$;

-- Product and active storage place of the tenant, or the stable error.
create or replace function public.lot_target(p_tenant_id uuid, p_product_id uuid, p_storage_id uuid)
returns public.storage_locations
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_storage public.storage_locations;
begin
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = p_tenant_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  select * into v_storage from public.storage_locations
  where id = p_storage_id and tenant_id = p_tenant_id and is_active;
  if v_storage.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  return v_storage;
end;
$$;

-- A label for stock that is already in place (no movement).
create or replace function public.create_lot(
  p_product_id uuid,
  p_qty numeric,
  p_storage_id uuid,
  p_production_date date default null,
  p_lot_type text default 'raw'
)
returns public.product_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_production date;
begin
  perform public.lot_target(v_tenant, p_product_id, p_storage_id);
  if p_qty is null or p_qty <= 0 or coalesce(p_lot_type, '') not in ('raw', 'semi') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_production := coalesce(p_production_date, public.tenant_today(v_tenant));
  return public.insert_product_lot(
    v_tenant, p_product_id, p_qty, p_storage_id, v_production,
    v_production + public.get_shelf_life(p_product_id, p_storage_id),
    p_lot_type, null, '[]'::jsonb, null, null, null
  );
end;
$$;

-- Goods receipt with its label: one 'prihod' movement (expiry from the shelf-life rule) and the lot.
-- p_shelf_life_days overrides the rule for this receipt; with p_remember it becomes the rule.
create or replace function public.receive_stock_with_lot(
  p_product_id uuid,
  p_qty numeric,
  p_storage_id uuid,
  p_price numeric default null,
  p_production_date date default null,
  p_shelf_life_days integer default null,
  p_remember boolean default false
)
returns public.product_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_storage public.storage_locations;
  v_production date;
  v_expiry date;
  v_movement uuid;
begin
  v_storage := public.lot_target(v_tenant, p_product_id, p_storage_id);
  if p_qty is null or p_qty <= 0 or (p_price is not null and p_price < 0)
     or (p_shelf_life_days is not null and (p_shelf_life_days < 0 or p_shelf_life_days > 3650)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_shelf_life_days is not null and coalesce(p_remember, false) then
    perform public.set_shelf_life_rule(p_product_id, p_storage_id, p_shelf_life_days);
  end if;
  v_production := coalesce(p_production_date, public.tenant_today(v_tenant));
  v_expiry := v_production + coalesce(p_shelf_life_days, public.get_shelf_life(p_product_id, p_storage_id));

  insert into public.stock_movements (
    tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, cost_per_unit, unit, user_id
  )
  select v_tenant, p.id, v_storage.branch_id, v_storage.id, p_qty, 'prihod', v_expiry, p_price, p.unit, auth.uid()
  from public.products p where p.id = p_product_id
  returning id into v_movement;

  return public.insert_product_lot(
    v_tenant, p_product_id, p_qty, p_storage_id, v_production, v_expiry, 'raw', null, '[]'::jsonb, null, v_movement, null
  );
end;
$$;

-- Earliest-expiry lot of a product in a place (the one FIFO consumption takes first).
create or replace function public.first_lot_at(p_product_id uuid, p_storage_id uuid)
returns public.product_lots
language sql
stable
security definer
set search_path = public
as $$
  select * from public.product_lots
  where product_id = p_product_id and storage_location_id = p_storage_id
  order by expiry_date, created_at, id
  limit 1
$$;

-- Preparation: p_source_qty of the first input (the others scale with it) taken from
-- p_source_location_id (default: the place holding enough of the first input, earliest expiry first);
-- outputs go to p_storage_id unless p_outputs says otherwise. p_outputs [{product_id, qty,
-- storage_location_id?}] lists the actual yields; omitted -> the recipe scaled. One lot per output.
-- Superseded by the version with waste and balance in 20261018_wastage_in_prep.sql (see the validator).
do $guard$
begin
  if to_regclass('public.preparation_runs') is not null then
    return;
  end if;
  execute $ddl$
create or replace function public.create_lots_from_preparation(
  p_preparation_id uuid,
  p_source_qty numeric,
  p_storage_id uuid,
  p_source_location_id uuid default null,
  p_outputs jsonb default null
)
returns setof public.product_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_prep public.preparations;
  v_scale numeric;
  v_source public.storage_locations;
  v_first uuid;
  v_need numeric;
  v_item jsonb;
  v_plan jsonb;
  v_qty numeric;
  v_lot public.product_lots;
  v_parent uuid;
  v_composition jsonb := '[]'::jsonb;
  v_storage public.storage_locations;
  v_target uuid;
  v_today date := public.tenant_today(v_tenant);
  v_expiry date;
  v_movement uuid;
  v_recipe jsonb;
begin
  select * into v_prep from public.preparations where id = p_preparation_id and tenant_id = v_tenant and is_active;
  if v_prep.id is null then
    raise exception 'preparation_not_found' using errcode = 'P0002';
  end if;
  if p_source_qty is null or p_source_qty <= 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_first := (v_prep.inputs -> 0 ->> 'product_id')::uuid;
  v_scale := p_source_qty / (v_prep.inputs -> 0 ->> 'qty')::numeric;
  perform public.lot_target(v_tenant, v_first, p_storage_id);

  -- Where the inputs come from.
  if p_source_location_id is not null then
    select * into v_source from public.storage_locations
    where id = p_source_location_id and tenant_id = v_tenant and is_active;
  else
    select l.* into v_source
    from public.storage_locations l
    join public.product_stocks ps on ps.location_id = l.id and ps.product_id = v_first
    where l.tenant_id = v_tenant and l.is_active
    group by l.id
    having sum(ps.quantity) >= p_source_qty
    order by min(ps.expiry_date) nulls last, l.id
    limit 1;
  end if;
  if v_source.id is null and p_source_location_id is null then
    raise exception 'insufficient_stock' using errcode = '22003';
  elsif v_source.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  -- Inputs: composition with their lots, then the write-off (FIFO through the movement trigger).
  for v_item in select * from jsonb_array_elements(v_prep.inputs)
  loop
    v_need := round((v_item ->> 'qty')::numeric * v_scale, 3);
    v_lot := public.first_lot_at((v_item ->> 'product_id')::uuid, v_source.id);
    if v_parent is null and (v_item ->> 'product_id')::uuid = v_first then
      v_parent := v_lot.id;
    end if;
    v_composition := v_composition || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', v_item ->> 'product_id',
      'name', (select name from public.products where id = (v_item ->> 'product_id')::uuid),
      'qty', v_need,
      'unit', (select unit from public.products where id = (v_item ->> 'product_id')::uuid),
      'lot_number', v_lot.lot_number)));
    insert into public.stock_movements (
      tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, unit, user_id
    )
    select v_tenant, p.id, v_source.branch_id, v_source.id, v_need, 'task', v_prep.name, p.unit, auth.uid()
    from public.products p where p.id = (v_item ->> 'product_id')::uuid;
  end loop;

  -- Outputs: the actual yields or the recipe scaled.
  if p_outputs is not null then
    if jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) = 0 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_plan := p_outputs;
  else
    select coalesce(jsonb_agg(jsonb_build_object('product_id', o ->> 'product_id', 'qty', round((o ->> 'qty')::numeric * v_scale, 3))), '[]')
    into v_plan from jsonb_array_elements(v_prep.outputs) o;
  end if;

  for v_item in select * from jsonb_array_elements(v_plan)
  loop
    begin
      v_qty := (v_item ->> 'qty')::numeric;
      v_target := coalesce(nullif(v_item ->> 'storage_location_id', '')::uuid, p_storage_id);
    exception
      when invalid_text_representation then
        raise exception 'invalid_input' using errcode = '22023';
    end;
    v_recipe := null;
    select o into v_recipe from jsonb_array_elements(v_prep.outputs) o where o ->> 'product_id' = v_item ->> 'product_id';
    if v_recipe is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_storage := public.lot_target(v_tenant, (v_recipe ->> 'product_id')::uuid, v_target);
    v_expiry := v_today + public.get_shelf_life((v_recipe ->> 'product_id')::uuid, v_storage.id);

    insert into public.stock_movements (
      tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, reason, unit, user_id
    )
    select v_tenant, p.id, v_storage.branch_id, v_storage.id, v_qty, 'prihod', v_expiry, v_prep.name, p.unit, auth.uid()
    from public.products p where p.id = (v_recipe ->> 'product_id')::uuid
    returning id into v_movement;

    return next public.insert_product_lot(
      v_tenant, (v_recipe ->> 'product_id')::uuid, v_qty, v_storage.id, v_today, v_expiry, 'semi', v_parent,
      v_composition, v_prep.id, v_movement,
      case when v_recipe ? 'portions'
        then round((v_recipe ->> 'portions')::numeric * v_qty / (v_recipe ->> 'qty')::numeric) end
    );
  end loop;
end;
$$
  $ddl$;
  revoke execute on function public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb) from public, anon;
  grant execute on function public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb) to authenticated;
end;
$guard$;

-- Records printed labels; returns the number of lots logged.
create or replace function public.print_labels(p_lot_ids uuid[], p_copies integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_count integer;
begin
  if p_lot_ids is null or cardinality(p_lot_ids) = 0 or p_copies is null or p_copies <= 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_lot_ids) as u(id)
    where not exists (select 1 from public.product_lots l where l.id = u.id and l.tenant_id = v_tenant)
  ) then
    raise exception 'lot_not_found' using errcode = 'P0002';
  end if;
  insert into public.label_print_logs (tenant_id, lot_id, copies, printed_by)
  select v_tenant, u.id, p_copies, auth.uid() from (select distinct unnest(p_lot_ids) as id) u;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Lots that expire within p_days (default: tenant_settings.expiry_warn_days) and still have stock at
-- that expiry in their place; expired ones included (days_left < 0).
create or replace function public.expiring_lots(p_days integer default null)
returns table (
  id uuid, lot_number text, product_id uuid, product_name text, unit text, quantity numeric, portions numeric,
  production_date date, expiry_date date, days_left integer, storage_location_id uuid, storage_name text,
  lot_type text, in_stock numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := public.tenant_today(v_tenant);
  v_days integer;
begin
  select coalesce(p_days, s.expiry_warn_days) into v_days from public.tenant_settings s where s.tenant_id = v_tenant;
  if v_days is null or v_days < 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return query
  select l.id, l.lot_number, l.product_id, p.name, l.unit, l.quantity, l.portions, l.production_date, l.expiry_date,
    (l.expiry_date - v_today)::integer, l.storage_location_id, s.name, l.lot_type, st.qty
  from public.product_lots l
  join public.products p on p.id = l.product_id
  join public.storage_locations s on s.id = l.storage_location_id
  join lateral (
    select sum(ps.quantity) as qty from public.product_stocks ps
    where ps.product_id = l.product_id and ps.location_id = l.storage_location_id and ps.expiry_date = l.expiry_date
  ) st on st.qty > 0
  where l.tenant_id = v_tenant and l.expiry_date <= v_today + v_days
  order by l.expiry_date, l.lot_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.tenant_today(uuid)',
    'public.require_tenant_member()',
    'public.lot_number_prefix(uuid)',
    'public.format_lot_number(uuid, date, integer)',
    'public.insert_product_lot(uuid, uuid, numeric, uuid, date, date, text, uuid, jsonb, uuid, uuid, numeric)',
    'public.lot_target(uuid, uuid, uuid)',
    'public.first_lot_at(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.can_set_shelf_life()',
    'public.get_shelf_life(uuid, uuid)',
    'public.set_shelf_life_rule(uuid, uuid, integer)',
    'public.generate_lot_number(uuid, uuid)',
    'public.create_lot(uuid, numeric, uuid, date, text)',
    'public.receive_stock_with_lot(uuid, numeric, uuid, numeric, date, integer, boolean)',
    'public.print_labels(uuid[], integer)',
    'public.expiring_lots(integer)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.insert_product_lot(uuid, uuid, numeric, uuid, date, date, text, uuid, jsonb, uuid, uuid, numeric)', 'execute')
     or has_table_privilege('authenticated', 'public.product_lots', 'insert')
     or has_table_privilege('authenticated', 'public.label_print_logs', 'insert')
     or has_table_privilege('authenticated', 'public.product_shelf_life_rules', 'insert') then
    raise exception 'privileges too wide';
  end if;
  if (select default_shelf_life_days from public.tenant_settings limit 1) is null and exists (select 1 from public.tenant_settings) then
    raise exception 'default_shelf_life_days missing';
  end if;
end;
$$;

commit;
