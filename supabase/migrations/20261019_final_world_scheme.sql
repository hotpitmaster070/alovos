-- Final stock scheme: raw material, preparations and usable trim kept apart, with cost (maya) and
-- sale value (satış).
-- * products: product_type raw|semi|ready|trim|waste, sale_price (hidden like cost), density_kg_per_l
--   (litres <-> kg; tenant_settings.default_density_kg_per_l otherwise) and trim_value_percent (value of
--   a trim product per kg against the input it was cut from; tenant_settings.default_trim_value_percent
--   otherwise). The purchase price stays products.cost / the latest receipt
--   (product_last_purchase_price()); the cost of preparations comes from their lots.
-- * product_lot_costs: cost and sale price per unit of every lot (lot_type raw|semi|trim), filled when the
--   lot is created from its movement; not readable by clients (cooks see no money).
-- * preparations: evaporation_percent; wastage_items [{name, norm_percent, usable, product_id?}]: usable
--   items are trim that goes back to stock (their sum is trim_norm_percent), the others are waste (their
--   sum is wastage_norm_percent). All recipe percents are of the gross input.
-- * create_lots_from_preparation(..., p_trims): usable trim [{product_id, qty, note?,
--   storage_location_id?}] goes back to stock as its own lot (parent: the input lot). Net input = gross -
--   trim; balance net = outputs + waste + evaporation. Cost: inputs at their FIFO lot cost, minus the trim
--   (at the input's cost per kg x trim_value_percent), shared by the outputs by weight. One transaction.
-- * preparation_runs: trim_base, net_base, evaporation_base, outputs and trims (lots); the money of a run
--   is in preparation_run_costs.
-- * stock_summary() / stock_items(): stock by kind (raw, semi incl. ready, trim) with quantities, and
--   for owners and chefs cost and sale value.
-- Run after 20261018000001_wastage_in_prep.sql. Idempotent; the older files skip what this one replaces.

begin;

do $$
begin
  if to_regclass('public.preparation_runs') is null
     or to_regprocedure('public.insert_wastage_log(uuid, public.storage_locations, uuid, numeric, text, text, uuid, uuid, uuid)') is null
     or to_regprocedure('public.product_last_purchase_price(uuid)') is null then
    raise exception 'Run 20261018000001_wastage_in_prep.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists default_density_kg_per_l numeric;
alter table public.tenant_settings add column if not exists default_trim_value_percent numeric not null default 100;
alter table public.tenant_settings drop constraint if exists tenant_settings_default_density_check;
alter table public.tenant_settings
  add constraint tenant_settings_default_density_check check (default_density_kg_per_l is null or default_density_kg_per_l > 0);
alter table public.tenant_settings drop constraint if exists tenant_settings_default_trim_value_check;
alter table public.tenant_settings
  add constraint tenant_settings_default_trim_value_check check (default_trim_value_percent between 0 and 100);
grant update (default_density_kg_per_l, default_trim_value_percent) on public.tenant_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Products
-- ---------------------------------------------------------------------------
-- Products made by a recipe are preparations; only when the column is first added.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'products' and column_name = 'product_type') then
    alter table public.products add column product_type text not null default 'raw';
    update public.products p set product_type = 'semi'
    where exists (
      select 1 from public.preparations pr cross join lateral jsonb_array_elements(pr.outputs) o
      where pr.tenant_id = p.tenant_id and o ->> 'product_id' = p.id::text
    );
  end if;
end;
$$;
alter table public.products drop constraint if exists products_product_type_check;
alter table public.products
  add constraint products_product_type_check check (product_type in ('raw', 'semi', 'ready', 'trim', 'waste'));
alter table public.products add column if not exists sale_price numeric;
alter table public.products add column if not exists density_kg_per_l numeric;
alter table public.products add column if not exists trim_value_percent numeric;
alter table public.products drop constraint if exists products_sale_price_check;
alter table public.products add constraint products_sale_price_check check (sale_price is null or sale_price >= 0);
alter table public.products drop constraint if exists products_density_check;
alter table public.products add constraint products_density_check check (density_kg_per_l is null or density_kg_per_l > 0);
alter table public.products drop constraint if exists products_trim_value_check;
alter table public.products
  add constraint products_trim_value_check check (trim_value_percent is null or trim_value_percent between 0 and 100);
create index if not exists idx_products_tenant_type on public.products (tenant_id, product_type);

-- sale_price is money: hidden from clients like products.cost (20261009_unify_tenant.sql lists it too).
revoke select (sale_price) on table public.products from authenticated;
grant select (product_type, density_kg_per_l, trim_value_percent) on table public.products to authenticated;

create or replace view public.product_sale_prices
with (security_barrier = true) as
select p.id, p.tenant_id, p.sale_price
from public.products p
where p.tenant_id = (select public.current_tenant_id())
  and (select public.can_see_costs());
revoke all on table public.product_sale_prices from anon, authenticated;
grant select on table public.product_sale_prices to authenticated;

-- Only owners and chefs set a sale price from a client (security definer callers pass).
create or replace function public.product_price_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and ((tg_op = 'INSERT' and new.sale_price is not null)
          or (tg_op = 'UPDATE' and new.sale_price is distinct from old.sale_price))
     and coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.product_price_guard() from public, anon, authenticated;
drop trigger if exists trg_product_price_guard on public.products;
create trigger trg_product_price_guard
  before insert or update of sale_price on public.products
  for each row execute function public.product_price_guard();

-- Type, sale price, density and trim value of a product; owners and chefs. Null clears an optional value.
create or replace function public.set_product_economics(
  p_product_id uuid,
  p_product_type text,
  p_sale_price numeric,
  p_density_kg_per_l numeric,
  p_trim_value_percent numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  if coalesce(p_product_type, '') not in ('raw', 'semi', 'ready', 'trim', 'waste')
     or p_sale_price < 0 or p_density_kg_per_l <= 0 or p_trim_value_percent < 0 or p_trim_value_percent > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.products
  set product_type = p_product_type, sale_price = p_sale_price, density_kg_per_l = p_density_kg_per_l,
      trim_value_percent = p_trim_value_percent
  where id = p_product_id and tenant_id = v_tenant;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Density of a product: its own, else the tenant default.
create or replace function public.product_density(p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.density_kg_per_l, s.default_density_kg_per_l)
  from public.products p left join public.tenant_settings s on s.tenant_id = p.tenant_id
  where p.id = p_product_id
$$;

-- Amount of p_base (kg or l) in one unit of a line {product_id, qty?, portions?}: by the unit, pieces by
-- the portion weight, kg <-> l by the density; null when it does not convert.
create or replace function public.line_factor(p_line jsonb, p_base text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unit text;
  v_family text;
  v_factor numeric;
  v_weight numeric;
  v_density numeric;
begin
  select unit into v_unit from public.products where id = (p_line ->> 'product_id')::uuid;
  v_family := public.unit_family(v_unit);
  v_factor := public.unit_factor(v_unit);
  if v_family is null then
    v_weight := public.line_piece_weight(p_line);
    if not coalesce(v_weight > 0, false) then
      return null;
    end if;
    v_family := 'kg';
    v_factor := v_weight;
  end if;
  if v_family = p_base then
    return v_factor;
  end if;
  v_density := public.product_density((p_line ->> 'product_id')::uuid);
  if not coalesce(v_density > 0, false) then
    return null;
  end if;
  return case when p_base = 'kg' then v_factor * v_density else v_factor / v_density end;
end;
$$;

-- Value of p_qty taken FIFO (as handle_stock_movement() takes it) from a place; rows without a cost and
-- any part not in stock count at the latest purchase price.
create or replace function public.fifo_cost(p_tenant_id uuid, p_product_id uuid, p_location_id uuid, p_branch_id uuid, p_qty numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_left numeric := p_qty;
  v_take numeric;
  v_cost numeric := 0;
  v_fallback numeric := coalesce(public.product_last_purchase_price(p_product_id), 0);
begin
  for v_row in
    select ps.quantity, ps.cost_per_unit
    from public.product_stocks ps
    where ps.tenant_id = p_tenant_id and ps.product_id = p_product_id and ps.location_id = p_location_id
      and (p_branch_id is null or ps.branch_id is not distinct from p_branch_id) and ps.quantity > 0
    order by ps.expiry_date nulls last, ps.id
  loop
    exit when v_left <= 0;
    v_take := least(v_row.quantity, v_left);
    v_cost := v_cost + v_take * coalesce(v_row.cost_per_unit, v_fallback);
    v_left := v_left - v_take;
  end loop;
  return v_cost + greatest(v_left, 0) * v_fallback;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lots: trim lots and the money of every lot
-- ---------------------------------------------------------------------------
alter table public.product_lots drop constraint if exists product_lots_type_check;
alter table public.product_lots add constraint product_lots_type_check check (lot_type in ('raw', 'semi', 'trim'));

create table if not exists public.product_lot_costs (
  lot_id uuid primary key references public.product_lots(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cost_per_unit numeric,
  sale_per_unit numeric,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_lot_costs_tenant on public.product_lot_costs (tenant_id);
alter table public.product_lot_costs enable row level security;
revoke all on table public.product_lot_costs from anon, authenticated;

-- Cost: the lot's receipt, else the stock row it labels, else the latest purchase; sale: the product's.
create or replace function public.fill_lot_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.product_lot_costs (lot_id, tenant_id, cost_per_unit, sale_per_unit)
  select new.id, new.tenant_id,
    coalesce(
      (select m.cost_per_unit from public.stock_movements m where m.id = new.movement_id),
      (select ps.cost_per_unit from public.product_stocks ps
       where ps.product_id = new.product_id and ps.location_id = new.storage_location_id
         and ps.expiry_date is not distinct from new.expiry_date and ps.cost_per_unit is not null
       order by ps.updated_at desc, ps.id limit 1),
      public.product_last_purchase_price(new.product_id)),
    (select p.sale_price from public.products p where p.id = new.product_id)
  on conflict (lot_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.fill_lot_cost() from public, anon, authenticated;
drop trigger if exists trg_fill_lot_cost on public.product_lots;
create trigger trg_fill_lot_cost
  after insert on public.product_lots
  for each row execute function public.fill_lot_cost();

insert into public.product_lot_costs (lot_id, tenant_id, cost_per_unit, sale_per_unit)
select l.id, l.tenant_id,
  coalesce(
    (select m.cost_per_unit from public.stock_movements m where m.id = l.movement_id),
    (select ps.cost_per_unit from public.product_stocks ps
     where ps.product_id = l.product_id and ps.location_id = l.storage_location_id
       and ps.expiry_date is not distinct from l.expiry_date and ps.cost_per_unit is not null
     order by ps.updated_at desc, ps.id limit 1),
    public.product_last_purchase_price(l.product_id)),
  p.sale_price
from public.product_lots l join public.products p on p.id = l.product_id
on conflict (lot_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Recipes: evaporation, usable trim items
-- ---------------------------------------------------------------------------
alter table public.preparations add column if not exists evaporation_percent numeric not null default 0;
alter table public.preparations add column if not exists trim_norm_percent numeric not null default 0;
alter table public.preparations drop constraint if exists preparations_evaporation_check;
alter table public.preparations add constraint preparations_evaporation_check check (evaporation_percent between 0 and 100);
alter table public.preparations drop constraint if exists preparations_trim_norm_check;
alter table public.preparations add constraint preparations_trim_norm_check check (trim_norm_percent between 0 and 100);
alter table public.preparations drop constraint if exists preparations_percent_total_check;
alter table public.preparations
  add constraint preparations_percent_total_check check (wastage_norm_percent + trim_norm_percent + evaporation_percent <= 100);

-- Rules of 20261018000001_wastage_in_prep.sql; wastage_items [{name, norm_percent, usable?, product_id?}]:
-- usable items are trim returned to stock (product_id: a trim product of the tenant), their sum is
-- trim_norm_percent; the others are waste, their sum is wastage_norm_percent. Norms and evaporation
-- together at most 100%.
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
  v_items jsonb := '[]'::jsonb;
  v_product uuid;
  v_qty numeric;
  v_portions numeric;
  v_name text;
  v_percent numeric;
  v_usable boolean;
  v_trim_product uuid;
  v_sum numeric := 0;
  v_trim_sum numeric := 0;
begin
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if new.name = '' or char_length(new.name) > 120 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if jsonb_typeof(new.inputs) <> 'array' or jsonb_array_length(new.inputs) = 0
     or jsonb_typeof(new.outputs) <> 'array' or jsonb_array_length(new.outputs) = 0
     or jsonb_typeof(coalesce(new.wastage_items, '[]'::jsonb)) <> 'array' then
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
    for v_item in select * from jsonb_array_elements(coalesce(new.wastage_items, '[]'::jsonb))
    loop
      v_name := btrim(regexp_replace(coalesce(v_item ->> 'name', ''), '\s+', ' ', 'g'));
      v_percent := (v_item ->> 'norm_percent')::numeric;
      v_usable := coalesce((v_item ->> 'usable')::boolean, false);
      v_trim_product := case when v_usable then nullif(v_item ->> 'product_id', '')::uuid end;
      if v_name = '' or char_length(v_name) > 60 or v_percent is null or v_percent < 0 or v_percent > 100
         or exists (select 1 from jsonb_array_elements(v_items) e where lower(e ->> 'name') = lower(v_name))
         or (v_trim_product is not null and not exists (
               select 1 from public.products p where p.id = v_trim_product and p.tenant_id = new.tenant_id and p.product_type = 'trim')) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', v_name, 'norm_percent', v_percent, 'usable', v_usable, 'product_id', v_trim_product)));
      if v_usable then
        v_trim_sum := v_trim_sum + v_percent;
      else
        v_sum := v_sum + v_percent;
      end if;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_input' using errcode = '22023';
  end;
  if jsonb_array_length(v_items) > 0 then
    new.wastage_norm_percent := v_sum;
  end if;
  new.trim_norm_percent := v_trim_sum;
  if coalesce(new.wastage_norm_percent, 0) + v_trim_sum + coalesce(new.evaporation_percent, 0) > 100
     or coalesce(new.evaporation_percent, 0) < 0 or coalesce(new.wastage_norm_percent, 0) < 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_inputs || v_outputs) e
    where not exists (select 1 from public.products p where p.id = (e ->> 'product_id')::uuid and p.tenant_id = new.tenant_id)
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  new.inputs := v_inputs;
  new.outputs := v_outputs;
  new.wastage_items := v_items;
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke execute on function public.preparation_validate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Runs: gross / trim / net, lots made, and their money apart
-- ---------------------------------------------------------------------------
-- input_base is the gross input; net_base = input_base - trim_base is what the outputs, waste and
-- evaporation come from.
alter table public.preparation_runs add column if not exists trim_base numeric;
alter table public.preparation_runs add column if not exists net_base numeric;
alter table public.preparation_runs add column if not exists evaporation_base numeric;
alter table public.preparation_runs add column if not exists evaporation_percent numeric not null default 0;
alter table public.preparation_runs add column if not exists outputs jsonb not null default '[]'::jsonb;
alter table public.preparation_runs add column if not exists trims jsonb not null default '[]'::jsonb;
update public.preparation_runs set trim_base = 0, net_base = input_base, evaporation_base = 0
where base_unit is not null and net_base is null;

create table if not exists public.preparation_run_costs (
  run_id uuid primary key references public.preparation_runs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  input_cost numeric not null,
  trim_cost numeric not null,
  net_cost numeric not null,
  -- [{lot_id, product_id, qty, cost_per_unit}]
  outputs jsonb not null default '[]'::jsonb,
  trims jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_preparation_run_costs_tenant on public.preparation_run_costs (tenant_id, created_at desc);
alter table public.preparation_run_costs enable row level security;
revoke all on table public.preparation_run_costs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The preparation
-- ---------------------------------------------------------------------------
drop function if exists public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb);
drop function if exists public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb, jsonb, boolean);

-- p_source_qty of the first input (the others scale) from p_source_location_id (default: the place
-- holding enough of it, earliest expiry first); outputs to p_storage_id unless p_outputs [{product_id,
-- qty, storage_location_id?}] says otherwise (omitted: the recipe scaled). p_wastage {qty (unit of the
-- first input), reason cutting|cooking|other, note}. p_trims [{product_id (trim product), qty, note?,
-- storage_location_id?}]: usable trim back to stock. Balance in kg (else l): net = gross - trim =
-- outputs + waste + evaporation (recipe %, of the gross input); a difference above the tenant tolerance
-- needs p_confirm_loss and a confirmed shortfall is logged as waste. A yield without a weight counts at
-- the weight the recipe implies for it. Cost: inputs at their FIFO lot cost; trim at the first input's
-- cost per kg x its trim_value_percent; the rest shared by the outputs by weight (by quantity when a
-- weight is missing). Returns the output lots, then the trim lots.
create or replace function public.create_lots_from_preparation(
  p_preparation_id uuid,
  p_source_qty numeric,
  p_storage_id uuid,
  p_source_location_id uuid default null,
  p_outputs jsonb default null,
  p_wastage jsonb default null,
  p_confirm_loss boolean default false,
  p_trims jsonb default null
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
  v_first_need numeric;
  v_first_factor numeric;
  v_need numeric;
  v_item jsonb;
  v_plan jsonb;
  v_trims jsonb := '[]'::jsonb;
  v_qty numeric;
  v_factor numeric;
  v_lot public.product_lots;
  v_parent uuid;
  v_composition jsonb := '[]'::jsonb;
  v_storage public.storage_locations;
  v_target uuid;
  v_today date := public.tenant_today(v_tenant);
  v_expiry date;
  v_movement uuid;
  v_recipe jsonb;
  v_note text;
  v_base text;
  v_candidate text;
  v_input_base numeric;
  v_plan_input numeric;
  v_plan_known numeric := 0;
  v_unknown_plan numeric := 0;
  v_implied numeric;
  v_unknown_factor numeric;
  v_estimated numeric := 0;
  v_trim_base numeric := 0;
  v_net_base numeric;
  v_evaporation_base numeric;
  v_output_base numeric := 0;
  v_weights numeric[] := '{}';
  v_weight numeric;
  v_mass_sum numeric := 0;
  v_qty_sum numeric := 0;
  v_by_qty boolean := false;
  v_waste_qty numeric := 0;
  v_waste_reason text := 'cutting';
  v_waste_note text;
  v_diff numeric;
  v_tolerance numeric;
  v_tolerance_percent numeric;
  v_exceeds boolean := false;
  v_loss_qty numeric := 0;
  v_input_cost numeric := 0;
  v_cost numeric;
  v_first_cost numeric := 0;
  v_cost_per_base numeric := 0;
  v_trim_value_default numeric;
  v_trim_cost numeric := 0;
  v_net_cost numeric;
  v_unit_cost numeric;
  v_run uuid;
  v_i integer := 0;
  v_output_rows jsonb := '[]'::jsonb;
  v_output_costs jsonb := '[]'::jsonb;
  v_trim_rows jsonb := '[]'::jsonb;
  v_trim_costs jsonb := '[]'::jsonb;
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
  v_first_need := round((v_prep.inputs -> 0 ->> 'qty')::numeric * v_scale, 3);
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

  -- Waste entered by the cook, in the unit of the first input.
  if p_wastage is not null and jsonb_typeof(p_wastage) <> 'null' then
    if jsonb_typeof(p_wastage) <> 'object' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    begin
      v_waste_qty := coalesce(nullif(p_wastage ->> 'qty', '')::numeric, 0);
    exception
      when invalid_text_representation then
        raise exception 'invalid_input' using errcode = '22023';
    end;
    v_waste_reason := coalesce(nullif(p_wastage ->> 'reason', ''), 'cutting');
    v_waste_note := nullif(btrim(coalesce(p_wastage ->> 'note', '')), '');
    if v_waste_qty < 0 or v_waste_qty > v_first_need or v_waste_reason not in ('cutting', 'cooking', 'other')
       or char_length(v_waste_note) > 500 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;

  -- Usable trim: trim products of the tenant, each once, with a valid place.
  if p_trims is not null and jsonb_typeof(p_trims) <> 'null' then
    if jsonb_typeof(p_trims) <> 'array' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    for v_item in select * from jsonb_array_elements(p_trims)
    loop
      begin
        v_qty := (v_item ->> 'qty')::numeric;
        v_target := nullif(v_item ->> 'storage_location_id', '')::uuid;
        v_recipe := jsonb_build_object('product_id', (v_item ->> 'product_id')::uuid);
      exception
        when invalid_text_representation then
          raise exception 'invalid_input' using errcode = '22023';
      end;
      v_note := nullif(btrim(coalesce(v_item ->> 'note', '')), '');
      if v_qty is null or v_qty <= 0 or char_length(v_note) > 500 or v_recipe ->> 'product_id' is null
         or not exists (select 1 from public.products p
                        where p.id = (v_recipe ->> 'product_id')::uuid and p.tenant_id = v_tenant and p.product_type = 'trim')
         or v_trims @> jsonb_build_array(jsonb_build_object('product_id', v_recipe ->> 'product_id')) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      perform public.lot_target(v_tenant, (v_recipe ->> 'product_id')::uuid, coalesce(v_target, p_storage_id));
      v_trims := v_trims || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'product_id', v_recipe ->> 'product_id', 'qty', v_qty, 'note', v_note, 'storage_location_id', v_target)));
    end loop;
  end if;

  -- Base unit: kg when every input converts to it, else l; none -> no balance.
  foreach v_candidate in array array['kg', 'l']
  loop
    v_input_base := 0;
    v_plan_input := 0;
    for v_item in select * from jsonb_array_elements(v_prep.inputs)
    loop
      v_factor := public.line_factor(v_item, v_candidate);
      if v_factor is null then
        v_input_base := null;
        exit;
      end if;
      v_input_base := v_input_base + round((v_item ->> 'qty')::numeric * v_scale, 3) * v_factor;
      v_plan_input := v_plan_input + (v_item ->> 'qty')::numeric * v_factor;
    end loop;
    if v_input_base is not null then
      v_base := v_candidate;
      exit;
    end if;
  end loop;
  if v_base is not null then
    v_first_factor := public.line_factor(v_prep.inputs -> 0, v_base);
  end if;

  -- Trim in the base unit; it must convert and leave something to cook.
  if jsonb_array_length(v_trims) > 0 then
    if v_base is null then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    for v_item in select * from jsonb_array_elements(v_trims)
    loop
      v_factor := public.line_factor(v_item - 'qty', v_base);
      if v_factor is null then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_trim_base := v_trim_base + (v_item ->> 'qty')::numeric * v_factor;
    end loop;
    if v_trim_base >= v_input_base then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;
  if v_base is not null then
    v_net_base := v_input_base - v_trim_base;
    v_evaporation_base := v_input_base * v_prep.evaporation_percent / 100;
  end if;

  -- Recipe yields: known weights, and the weight per unit implied for the others.
  if v_base is not null then
    for v_item in select * from jsonb_array_elements(v_prep.outputs)
    loop
      v_factor := public.line_factor(v_item, v_base);
      if v_factor is not null then
        v_plan_known := v_plan_known + (v_item ->> 'qty')::numeric * v_factor;
      else
        v_unknown_plan := v_unknown_plan + (v_item ->> 'qty')::numeric;
      end if;
    end loop;
    if v_unknown_plan > 0 then
      v_implied := v_plan_input
        * (1 - (v_prep.wastage_norm_percent + v_prep.trim_norm_percent + v_prep.evaporation_percent) / 100)
        - v_plan_known;
      if v_implied > 0 then
        v_unknown_factor := v_implied / v_unknown_plan;
      end if;
    end if;
  end if;

  -- Outputs: the actual yields or the recipe scaled; validated before anything is written.
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
      v_target := nullif(v_item ->> 'storage_location_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid_input' using errcode = '22023';
    end;
    v_recipe := null;
    select o into v_recipe from jsonb_array_elements(v_prep.outputs) o where o ->> 'product_id' = v_item ->> 'product_id';
    if v_recipe is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_weight := null;
    if v_base is not null then
      v_factor := public.line_factor(v_recipe, v_base);
      if v_factor is not null then
        v_weight := v_qty * v_factor;
      elsif v_unknown_factor is not null then
        v_weight := v_qty * v_unknown_factor;
        v_estimated := v_estimated + v_weight;
      end if;
      v_output_base := v_output_base + coalesce(v_weight, 0);
    end if;
    v_weights := v_weights || v_weight;
    v_by_qty := v_by_qty or v_weight is null;
    v_mass_sum := v_mass_sum + coalesce(v_weight, 0);
    v_qty_sum := v_qty_sum + v_qty;
  end loop;

  -- Balance: net input = outputs + waste + evaporation, within the tenant's tolerance.
  if v_base is not null and v_net_base > 0 then
    v_diff := v_net_base - v_output_base - v_waste_qty * v_first_factor - v_evaporation_base;
    select s.prep_balance_tolerance, s.prep_balance_tolerance_percent into v_tolerance, v_tolerance_percent
    from public.tenant_settings s where s.tenant_id = v_tenant;
    v_exceeds := abs(v_diff) > v_tolerance or abs(v_diff) * 100 / v_net_base > v_tolerance_percent;
    if v_exceeds and not coalesce(p_confirm_loss, false) then
      raise exception 'balance_mismatch' using errcode = 'P0001';
    end if;
    if v_exceeds and v_diff > 0 then
      v_loss_qty := round(v_diff / v_first_factor, 3);
    end if;
  end if;

  -- Cost, from the lots about to be consumed.
  for v_item in select * from jsonb_array_elements(v_prep.inputs)
  loop
    v_need := round((v_item ->> 'qty')::numeric * v_scale, 3);
    v_cost := public.fifo_cost(v_tenant, (v_item ->> 'product_id')::uuid, v_source.id, v_source.branch_id, v_need);
    v_input_cost := v_input_cost + v_cost;
    if (v_item ->> 'product_id')::uuid = v_first then
      v_first_cost := v_cost;
    end if;
  end loop;
  if jsonb_array_length(v_trims) > 0 then
    select s.default_trim_value_percent into v_trim_value_default from public.tenant_settings s where s.tenant_id = v_tenant;
    v_cost_per_base := coalesce(v_first_cost / nullif(v_first_need * v_first_factor, 0), 0);
    select coalesce(jsonb_agg(e.t || jsonb_build_object('cost_per_unit',
             public.line_factor(e.t - 'qty', v_base) * v_cost_per_base * coalesce(p.trim_value_percent, v_trim_value_default) / 100)
             order by e.n), '[]'::jsonb)
    into v_trims
    from jsonb_array_elements(v_trims) with ordinality e(t, n)
    join public.products p on p.id = (e.t ->> 'product_id')::uuid;
    select coalesce(sum((t ->> 'qty')::numeric * (t ->> 'cost_per_unit')::numeric), 0) into v_trim_cost
    from jsonb_array_elements(v_trims) t;
  end if;
  v_net_cost := v_input_cost - v_trim_cost;

  insert into public.preparation_runs (
    tenant_id, branch_id, preparation_id, source_location_id, source_qty, base_unit, input_base, trim_base, net_base,
    output_base, estimated_base, waste_base, evaporation_base, loss_base, difference_base, norm_percent,
    evaporation_percent, confirmed_loss
  ) values (
    v_tenant, v_source.branch_id, v_prep.id, v_source.id, p_source_qty, v_base,
    case when v_base is not null then v_input_base end,
    case when v_base is not null then v_trim_base end,
    v_net_base,
    case when v_base is not null then v_output_base end,
    case when v_base is not null then v_estimated end,
    case when v_base is not null then v_waste_qty * v_first_factor end,
    v_evaporation_base,
    case when v_base is not null then v_loss_qty * v_first_factor end,
    v_diff, v_prep.wastage_norm_percent, v_prep.evaporation_percent, v_exceeds and coalesce(p_confirm_loss, false)
  )
  returning id into v_run;

  -- Waste logs first: their value comes from the lots the write-off is about to consume.
  v_parent := (public.first_lot_at(v_first, v_source.id)).id;
  if v_waste_qty > 0 then
    perform public.insert_wastage_log(v_tenant, v_source, v_first, v_waste_qty, v_waste_reason, v_waste_note, v_parent, v_prep.id, v_run);
  end if;
  if v_loss_qty > 0 then
    perform public.insert_wastage_log(v_tenant, v_source, v_first, v_loss_qty, 'other', 'balance', v_parent, v_prep.id, v_run);
  end if;

  -- Inputs: composition with their lots, then the gross write-off (FIFO through the movement trigger).
  for v_item in select * from jsonb_array_elements(v_prep.inputs)
  loop
    v_need := round((v_item ->> 'qty')::numeric * v_scale, 3);
    v_lot := public.first_lot_at((v_item ->> 'product_id')::uuid, v_source.id);
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

  -- Outputs: received with their own shelf life and cost, one lot each.
  for v_item in select * from jsonb_array_elements(v_plan)
  loop
    v_i := v_i + 1;
    v_qty := (v_item ->> 'qty')::numeric;
    v_target := coalesce(nullif(v_item ->> 'storage_location_id', '')::uuid, p_storage_id);
    v_recipe := null;
    select o into v_recipe from jsonb_array_elements(v_prep.outputs) o where o ->> 'product_id' = v_item ->> 'product_id';
    v_storage := public.lot_target(v_tenant, (v_recipe ->> 'product_id')::uuid, v_target);
    v_expiry := v_today + public.get_shelf_life((v_recipe ->> 'product_id')::uuid, v_storage.id);
    v_unit_cost := case
      when v_by_qty then v_net_cost / nullif(v_qty_sum, 0)
      else v_net_cost * v_weights[v_i] / nullif(v_mass_sum, 0) / v_qty
    end;

    insert into public.stock_movements (
      tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, cost_per_unit, reason, unit, user_id
    )
    select v_tenant, p.id, v_storage.branch_id, v_storage.id, v_qty, 'prihod', v_expiry, v_unit_cost, v_prep.name, p.unit, auth.uid()
    from public.products p where p.id = (v_recipe ->> 'product_id')::uuid
    returning id into v_movement;

    v_lot := public.insert_product_lot(
      v_tenant, (v_recipe ->> 'product_id')::uuid, v_qty, v_storage.id, v_today, v_expiry, 'semi', v_parent,
      v_composition, v_prep.id, v_movement,
      case when v_recipe ? 'portions'
        then round((v_recipe ->> 'portions')::numeric * v_qty / (v_recipe ->> 'qty')::numeric) end
    );
    update public.product_lots set preparation_run_id = v_run where id = v_lot.id returning * into v_lot;
    v_output_rows := v_output_rows || jsonb_build_array(jsonb_build_object('lot_id', v_lot.id, 'product_id', v_lot.product_id, 'qty', v_qty));
    v_output_costs := v_output_costs || jsonb_build_array(jsonb_build_object(
      'lot_id', v_lot.id, 'product_id', v_lot.product_id, 'qty', v_qty, 'cost_per_unit', v_unit_cost));
    return next v_lot;
  end loop;

  -- Trim back to stock: its own lot, traced to the input lot.
  for v_item in select * from jsonb_array_elements(v_trims)
  loop
    v_qty := (v_item ->> 'qty')::numeric;
    v_storage := public.lot_target(v_tenant, (v_item ->> 'product_id')::uuid,
      coalesce(nullif(v_item ->> 'storage_location_id', '')::uuid, p_storage_id));
    v_expiry := v_today + public.get_shelf_life((v_item ->> 'product_id')::uuid, v_storage.id);
    insert into public.stock_movements (
      tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, cost_per_unit, reason, unit, user_id
    )
    select v_tenant, p.id, v_storage.branch_id, v_storage.id, v_qty, 'prihod', v_expiry, (v_item ->> 'cost_per_unit')::numeric,
      v_prep.name, p.unit, auth.uid()
    from public.products p where p.id = (v_item ->> 'product_id')::uuid
    returning id into v_movement;
    v_lot := public.insert_product_lot(
      v_tenant, (v_item ->> 'product_id')::uuid, v_qty, v_storage.id, v_today, v_expiry, 'trim', v_parent,
      v_composition, v_prep.id, v_movement, null
    );
    update public.product_lots set preparation_run_id = v_run where id = v_lot.id returning * into v_lot;
    v_trim_rows := v_trim_rows || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lot_id', v_lot.id, 'product_id', v_lot.product_id, 'qty', v_qty, 'note', v_item ->> 'note')));
    v_trim_costs := v_trim_costs || jsonb_build_array(jsonb_build_object(
      'lot_id', v_lot.id, 'product_id', v_lot.product_id, 'qty', v_qty, 'cost_per_unit', (v_item ->> 'cost_per_unit')::numeric));
    return next v_lot;
  end loop;

  update public.preparation_runs set outputs = v_output_rows, trims = v_trim_rows where id = v_run;
  insert into public.preparation_run_costs (run_id, tenant_id, input_cost, trim_cost, net_cost, outputs, trims)
  values (v_run, v_tenant, v_input_cost, v_trim_cost, v_net_cost, v_output_costs, v_trim_costs);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Saving recipes: evaporation too
-- ---------------------------------------------------------------------------
drop function if exists public.save_preparation(uuid, text, jsonb, jsonb, numeric, jsonb, jsonb);

-- Saves a recipe (p_id null: new) and the portion weights of its products [{product_id,
-- portion_weight_kg}] in one transaction; owners and chefs. Null norm, items or evaporation keep the
-- stored values (the column defaults for a new recipe).
create or replace function public.save_preparation(
  p_id uuid,
  p_name text,
  p_inputs jsonb,
  p_outputs jsonb,
  p_wastage_norm_percent numeric default null,
  p_wastage_items jsonb default null,
  p_portion_weights jsonb default null,
  p_evaporation_percent numeric default null
)
returns public.preparations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_row public.preparations;
  v_item jsonb;
  v_product uuid;
  v_weight numeric;
begin
  if p_portion_weights is not null and jsonb_typeof(p_portion_weights) not in ('array', 'null') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_evaporation_percent < 0 or p_evaporation_percent > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.preparations (tenant_id, name, inputs, outputs)
    values (v_tenant, p_name, p_inputs, p_outputs)
    returning * into v_row;
  else
    update public.preparations set name = p_name, inputs = p_inputs, outputs = p_outputs
    where id = p_id and tenant_id = v_tenant
    returning * into v_row;
    if v_row.id is null then
      raise exception 'preparation_not_found' using errcode = 'P0002';
    end if;
  end if;
  if p_wastage_norm_percent is not null or p_wastage_items is not null or p_evaporation_percent is not null then
    update public.preparations
    set wastage_norm_percent = coalesce(p_wastage_norm_percent, wastage_norm_percent),
        wastage_items = coalesce(p_wastage_items, wastage_items),
        evaporation_percent = coalesce(p_evaporation_percent, evaporation_percent)
    where id = v_row.id
    returning * into v_row;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(nullif(p_portion_weights, 'null'::jsonb), '[]'::jsonb))
  loop
    begin
      v_product := (v_item ->> 'product_id')::uuid;
      v_weight := (v_item ->> 'portion_weight_kg')::numeric;
    exception
      when invalid_text_representation then
        raise exception 'invalid_input' using errcode = '22023';
    end;
    if v_product is null or v_weight is null or v_weight <= 0
       or not (v_row.inputs || v_row.outputs) @> jsonb_build_array(jsonb_build_object('product_id', v_product)) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    update public.products set portion_weight_kg = v_weight where id = v_product and tenant_id = v_tenant;
  end loop;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Stock by kind: how much, and for owners and chefs how much money
-- ---------------------------------------------------------------------------
-- raw: raw material (and anything else bought); semi: preparations and ready dishes; trim: usable trim.
create or replace function public.stock_kind(p_product_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_product_type when 'semi' then 'semi' when 'ready' then 'semi' when 'trim' then 'trim' else 'raw' end
$$;

-- Per kind: stock rows, kg / l / pieces, and (owners and chefs) cost at the lots' cost, sale value at the
-- products' sale price and the margin of the priced part; unpriced = rows without a sale price.
create or replace function public.stock_summary(p_branch_id uuid default null)
returns table (
  kind text, lines integer, kg numeric, liters numeric, pieces numeric,
  cost_value numeric, sale_value numeric, margin numeric, unpriced integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_money boolean := public.can_see_costs();
begin
  return query
  with s as (
    select public.stock_kind(p.product_type) as k, ps.quantity as q, public.unit_family(p.unit) as fam,
      public.unit_factor(p.unit) as fac,
      coalesce(ps.cost_per_unit, public.product_last_purchase_price(p.id), 0) as c, p.sale_price as sp
    from public.product_stocks ps
    join public.products p on p.id = ps.product_id
    join public.storage_locations sl on sl.id = ps.location_id
    where ps.tenant_id = v_tenant and ps.quantity > 0 and (p_branch_id is null or sl.branch_id = p_branch_id)
  )
  select s.k, count(*)::integer,
    coalesce(sum(s.q * s.fac) filter (where s.fam = 'kg'), 0),
    coalesce(sum(s.q * s.fac) filter (where s.fam = 'l'), 0),
    coalesce(sum(s.q) filter (where s.fam is null), 0),
    case when v_money then coalesce(sum(s.q * s.c), 0) end,
    case when v_money then coalesce(sum(s.q * s.sp), 0) end,
    case when v_money then coalesce(sum(s.q * (s.sp - s.c)) filter (where s.sp is not null), 0) end,
    (count(*) filter (where s.sp is null))::integer
  from s
  group by s.k
  order by array_position(array['raw', 'semi', 'trim'], s.k);
end;
$$;

-- Stock rows of a kind (null: all) FIFO (earliest expiry first) with their lot; p_expiring: fewer than
-- tenant_settings.expiry_warn_days left. Cost and sale price only for owners and chefs.
create or replace function public.stock_items(
  p_branch_id uuid default null,
  p_kind text default null,
  p_expiring boolean default false,
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  stock_id uuid, product_id uuid, product_name text, unit text, kind text, quantity numeric, expiry_date date,
  days_left integer, location_id uuid, location_name text, lot_number text, cost_per_unit numeric,
  sale_price numeric, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_money boolean := public.can_see_costs();
  v_today date := public.tenant_today(v_tenant);
  v_warn integer;
begin
  if (p_kind is not null and p_kind not in ('raw', 'semi', 'trim')) or p_offset is null or p_offset < 0
     or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select s.expiry_warn_days into v_warn from public.tenant_settings s where s.tenant_id = v_tenant;
  return query
  select ps.id, ps.product_id, p.name, p.unit, public.stock_kind(p.product_type), ps.quantity, ps.expiry_date,
    (ps.expiry_date - v_today)::integer, ps.location_id, sl.name,
    (select l.lot_number from public.product_lots l
     where l.tenant_id = v_tenant and l.product_id = ps.product_id and l.storage_location_id = ps.location_id
       and l.expiry_date = ps.expiry_date
     order by l.created_at desc, l.id limit 1),
    case when v_money then coalesce(ps.cost_per_unit, public.product_last_purchase_price(p.id)) end,
    case when v_money then p.sale_price end,
    count(*) over ()
  from public.product_stocks ps
  join public.products p on p.id = ps.product_id
  join public.storage_locations sl on sl.id = ps.location_id
  where ps.tenant_id = v_tenant and ps.quantity > 0
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and (p_kind is null or public.stock_kind(p.product_type) = p_kind)
    and (not coalesce(p_expiring, false) or (ps.expiry_date is not null and ps.expiry_date - v_today < v_warn))
  order by ps.expiry_date nulls last, p.name, ps.id
  offset p_offset limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.product_density(uuid)',
    'public.line_factor(jsonb, text)',
    'public.fifo_cost(uuid, uuid, uuid, uuid, numeric)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.set_product_economics(uuid, text, numeric, numeric, numeric)',
    'public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb, jsonb, boolean, jsonb)',
    'public.save_preparation(uuid, text, jsonb, jsonb, numeric, jsonb, jsonb, numeric)',
    'public.stock_kind(text)',
    'public.stock_summary(uuid)',
    'public.stock_items(uuid, text, boolean, integer, integer)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc where proname = 'create_lots_from_preparation' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'save_preparation' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'more than one preparation function';
  end if;
  if has_column_privilege('authenticated', 'public.products', 'sale_price', 'select')
     or has_table_privilege('authenticated', 'public.product_lot_costs', 'select')
     or has_table_privilege('authenticated', 'public.preparation_run_costs', 'select') then
    raise exception 'money readable by clients';
  end if;
  if has_function_privilege('authenticated', 'public.fifo_cost(uuid, uuid, uuid, uuid, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.line_factor(jsonb, text)', 'execute') then
    raise exception 'internal helpers callable by clients';
  end if;
end;
$$;

commit;
