-- Waste in preparations and expired stock write-offs.
-- * wastage_logs gains unit, reason_note, parent_lot_id (the lot it came from), preparation_id,
--   preparation_run_id and created_by; reasons add 'cutting' and 'cooking'.
-- * preparations gain wastage_norm_percent (norm of the input, default 5) and wastage_items
--   [{name, norm_percent}] (breakdown; when given, the norm is their sum).
-- * create_lots_from_preparation() takes the waste ({qty, reason, note}) and checks the balance
--   inputs = outputs + waste in kg or l. A difference above tenant_settings.prep_balance_tolerance
--   (absolute, kg/l) or prep_balance_tolerance_percent needs p_confirm_loss; a confirmed shortfall is
--   logged as waste ('other', note 'balance'). One transaction: raw written off, output lots, waste logs,
--   preparation_runs row. Waste logs are written before the write-off so trg_wastage_cost values them
--   from the lots being consumed; they move no stock themselves (the raw is written off in full).
-- * log_wastage(): a write-off with its 'waste' movement (POST /api/wastage).
-- * write_off_expired_stock(): writes one stock row off as 'expired' (storage page).
-- * wastage_list(), wastage_summary(), expired_stock(): reports.
-- Run after 20261018000000_labels_and_lots.sql. Idempotent; after 20261019_final_world_scheme.sql it keeps
-- that file's validator, preparation function and save_preparation().

begin;

do $$
begin
  if to_regclass('public.product_lots') is null
     or to_regprocedure('public.create_lot(uuid, numeric, uuid, date, text)') is null
     or to_regprocedure('public.create_wastage_with_movement(uuid, numeric, text, uuid, text)') is null then
    raise exception 'Run 20261012_wastage_atomic.sql and 20261018000000_labels_and_lots.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Settings and unit helpers
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists prep_balance_tolerance numeric not null default 0.3;
alter table public.tenant_settings add column if not exists prep_balance_tolerance_percent numeric not null default 5;
alter table public.tenant_settings drop constraint if exists tenant_settings_prep_balance_tolerance_check;
alter table public.tenant_settings
  add constraint tenant_settings_prep_balance_tolerance_check
  check (prep_balance_tolerance >= 0 and prep_balance_tolerance_percent between 0 and 100);
grant update (prep_balance_tolerance, prep_balance_tolerance_percent) on public.tenant_settings to authenticated;

-- Weight of one portion (or piece) in kg, for products counted in pieces; the tenant default applies
-- to products without one. Products are written through save_preparation() only.
alter table public.products add column if not exists portion_weight_kg numeric;
alter table public.products drop constraint if exists products_portion_weight_check;
alter table public.products add constraint products_portion_weight_check check (portion_weight_kg is null or portion_weight_kg > 0);
grant select (portion_weight_kg) on table public.products to authenticated;
alter table public.tenant_settings add column if not exists default_portion_weight_kg numeric;
alter table public.tenant_settings drop constraint if exists tenant_settings_default_portion_weight_check;
alter table public.tenant_settings
  add constraint tenant_settings_default_portion_weight_check check (default_portion_weight_kg is null or default_portion_weight_kg > 0);
grant update (default_portion_weight_kg) on public.tenant_settings to authenticated;

-- Base unit of a measurable unit (kg for mass, l for volume); null for pieces and custom units.
create or replace function public.unit_family(p_unit text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_unit, '')))
    when 'kg' then 'kg' when 'g' then 'kg'
    when 'l' then 'l' when 'ml' then 'l'
  end
$$;

-- Factor to the base unit: 1 g = 0.001 kg, 1 ml = 0.001 l.
create or replace function public.unit_factor(p_unit text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_unit, '')))
    when 'kg' then 1 when 'l' then 1
    when 'g' then 0.001 when 'ml' then 0.001
  end
$$;

-- Base unit of an amount: the family of its unit, else kg when the weight of one piece is known.
create or replace function public.mass_family(p_unit text, p_piece_weight numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(public.unit_family(p_unit), case when p_piece_weight > 0 then 'kg' end)
$$;

-- Factor of one unit to that base: the unit factor, else the weight of one piece.
create or replace function public.mass_factor(p_unit text, p_piece_weight numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case when public.unit_family(p_unit) is not null then public.unit_factor(p_unit)
    when p_piece_weight > 0 then p_piece_weight end
$$;

-- Portion weight of a product: its own, else tenant_settings.default_portion_weight_kg.
create or replace function public.portion_weight(p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.portion_weight_kg, s.default_portion_weight_kg)
  from public.products p left join public.tenant_settings s on s.tenant_id = p.tenant_id
  where p.id = p_product_id
$$;

-- Weight of one unit of a recipe line {product_id, qty, portions?}: with portions, one unit holds
-- portions / qty of them.
create or replace function public.line_piece_weight(p_line jsonb)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.portion_weight((p_line ->> 'product_id')::uuid)
    * coalesce((p_line ->> 'portions')::numeric / nullif((p_line ->> 'qty')::numeric, 0), 1)
$$;

-- Owners, chefs and cooks write waste off (same roles as create_wastage_with_movement).
create or replace function public.require_waste_writer()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  if public.current_member_role() not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Preparations: waste norm
-- ---------------------------------------------------------------------------
alter table public.preparations add column if not exists wastage_norm_percent numeric not null default 5;
alter table public.preparations add column if not exists wastage_items jsonb not null default '[]'::jsonb;
alter table public.preparations drop constraint if exists preparations_wastage_norm_check;
alter table public.preparations
  add constraint preparations_wastage_norm_check check (wastage_norm_percent between 0 and 100);

-- Same rules as 20261018000000_labels_and_lots.sql, plus wastage_items [{name, norm_percent}]: names
-- 1..60 characters, unique, percents 0..100; when items are given the norm is their sum (<= 100).
-- Superseded by 20261019_final_world_scheme.sql (trim and evaporation): once that file has run
-- (preparations.evaporation_percent exists) this file keeps its versions of the validator,
-- create_lots_from_preparation() and save_preparation(), so the order of re-runs does not matter.
do $guard$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'preparations' and column_name = 'evaporation_percent') then
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
  v_items jsonb := '[]'::jsonb;
  v_product uuid;
  v_qty numeric;
  v_portions numeric;
  v_name text;
  v_percent numeric;
  v_sum numeric := 0;
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
      if v_name = '' or char_length(v_name) > 60 or v_percent is null or v_percent < 0 or v_percent > 100
         or exists (select 1 from jsonb_array_elements(v_items) e where lower(e ->> 'name') = lower(v_name)) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_items := v_items || jsonb_build_array(jsonb_build_object('name', v_name, 'norm_percent', v_percent));
      v_sum := v_sum + v_percent;
    end loop;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_input' using errcode = '22023';
  end;
  if jsonb_array_length(v_items) > 0 then
    if v_sum > 100 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    new.wastage_norm_percent := v_sum;
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
$$
  $ddl$;
end;
$guard$;
revoke execute on function public.preparation_validate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Preparation runs (one per "Hazırdır"), the base of the waste-vs-norm report
-- ---------------------------------------------------------------------------
create table if not exists public.preparation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  preparation_id uuid references public.preparations(id) on delete set null,
  source_location_id uuid references public.storage_locations(id) on delete set null,
  source_qty numeric not null check (source_qty > 0),
  -- kg or l when every input converts to it (by unit or portion weight); null otherwise (no balance check).
  base_unit text check (base_unit in ('kg', 'l')),
  input_base numeric,
  output_base numeric,
  waste_base numeric,
  loss_base numeric,
  difference_base numeric,
  norm_percent numeric not null check (norm_percent between 0 and 100),
  confirmed_loss boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
-- Part of output_base estimated from the recipe for yields without a known weight.
alter table public.preparation_runs add column if not exists estimated_base numeric;
create index if not exists idx_preparation_runs_tenant_created on public.preparation_runs (tenant_id, created_at desc);

alter table public.preparation_runs enable row level security;
revoke all on table public.preparation_runs from anon, authenticated;
grant select on table public.preparation_runs to authenticated;
drop policy if exists preparation_runs_select on public.preparation_runs;
create policy preparation_runs_select on public.preparation_runs
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

alter table public.product_lots add column if not exists preparation_run_id uuid references public.preparation_runs(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. wastage_logs columns
-- ---------------------------------------------------------------------------
alter table public.wastage_logs add column if not exists unit text;
alter table public.wastage_logs add column if not exists reason_note text;
alter table public.wastage_logs add column if not exists parent_lot_id uuid references public.product_lots(id) on delete set null;
alter table public.wastage_logs add column if not exists preparation_id uuid references public.preparations(id) on delete set null;
alter table public.wastage_logs add column if not exists preparation_run_id uuid references public.preparation_runs(id) on delete set null;
alter table public.wastage_logs add column if not exists created_by uuid references public.profiles(id) on delete set null default auth.uid();

update public.wastage_logs set created_by = user_id where created_by is null and user_id is not null;
update public.wastage_logs w set unit = p.unit from public.products p where w.unit is null and p.id = w.product_id;

alter table public.wastage_logs drop constraint if exists wastage_logs_reason_check;
alter table public.wastage_logs add constraint wastage_logs_reason_check
  check (reason in ('spoiled', 'overcooked', 'dropped', 'expired', 'theft', 'other', 'cutting', 'cooking'));
alter table public.wastage_logs drop constraint if exists wastage_logs_reason_note_check;
alter table public.wastage_logs add constraint wastage_logs_reason_note_check
  check (reason_note is null or char_length(reason_note) <= 500);

create index if not exists idx_wastage_logs_preparation on public.wastage_logs (tenant_id, preparation_id) where preparation_id is not null;
create index if not exists idx_wastage_logs_parent_lot on public.wastage_logs (parent_lot_id) where parent_lot_id is not null;

-- cost stays hidden (20261010); the new columns join the client column grant.
grant select (unit, reason_note, parent_lot_id, preparation_id, preparation_run_id, created_by) on table public.wastage_logs to authenticated;

-- One waste log row; trg_wastage_cost values it from the FEFO lots of the place as they are now.
create or replace function public.insert_wastage_log(
  p_tenant_id uuid,
  p_location public.storage_locations,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_reason_note text,
  p_parent_lot_id uuid,
  p_preparation_id uuid,
  p_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.wastage_logs (
    tenant_id, branch_id, location_id, product_id, quantity, unit, reason, reason_note,
    parent_lot_id, preparation_id, preparation_run_id, user_id, created_by
  )
  select p_tenant_id, p_location.branch_id, p_location.id, p.id, p_quantity, p.unit, p_reason, p_reason_note,
    p_parent_lot_id, p_preparation_id, p_run_id, auth.uid(), auth.uid()
  from public.products p where p.id = p_product_id
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Preparation with waste and balance
-- ---------------------------------------------------------------------------
drop function if exists public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb);

-- As in 20261018000000_labels_and_lots.sql, plus p_wastage {qty (unit of the first input), reason
-- cutting|cooking|other, note} and p_confirm_loss for a balance difference above the tolerance.
-- Balance in kg (or l): units convert by their factor, pieces by the portion weight (product, else the
-- tenant default). Inputs must all convert, else there is no balance. A yield without a known weight
-- is not skipped as zero: it counts at the weight the recipe implies for it (recipe input minus the
-- known yields and the norm waste, shared by the recipe quantities of such yields), so fewer portions
-- still show as a shortfall. Superseded by 20261019_final_world_scheme.sql (see the validator).
do $guard$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'preparations' and column_name = 'evaporation_percent') then
    return;
  end if;
  execute $ddl$
create or replace function public.create_lots_from_preparation(
  p_preparation_id uuid,
  p_source_qty numeric,
  p_storage_id uuid,
  p_source_location_id uuid default null,
  p_outputs jsonb default null,
  p_wastage jsonb default null,
  p_confirm_loss boolean default false
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
  v_unit text;
  v_weight numeric;
  v_fam text;
  v_fac numeric;
  v_base text;
  v_inputs_known boolean := true;
  v_first_factor numeric;
  v_plan_input numeric := 0;
  v_plan_known numeric := 0;
  v_unknown_plan numeric := 0;
  v_implied numeric;
  v_unknown_factor numeric;
  v_estimated numeric := 0;
  v_input_base numeric := 0;
  v_output_base numeric := 0;
  v_waste_qty numeric := 0;
  v_waste_reason text := 'cutting';
  v_waste_note text;
  v_diff numeric;
  v_tolerance numeric;
  v_tolerance_percent numeric;
  v_exceeds boolean := false;
  v_loss_qty numeric := 0;
  v_run uuid;
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
    if v_waste_qty < 0 or v_waste_reason not in ('cutting', 'cooking', 'other') or char_length(v_waste_note) > 500 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;

  -- Input total in the base unit (and the recipe's own, for the implied weights below).
  for v_item in select * from jsonb_array_elements(v_prep.inputs)
  loop
    v_need := round((v_item ->> 'qty')::numeric * v_scale, 3);
    select unit into v_unit from public.products where id = (v_item ->> 'product_id')::uuid;
    v_weight := public.line_piece_weight(v_item);
    v_fam := public.mass_family(v_unit, v_weight);
    v_fac := public.mass_factor(v_unit, v_weight);
    if v_fam is null or v_fam is distinct from coalesce(v_base, v_fam) then
      v_inputs_known := false;
    else
      v_base := v_fam;
      v_input_base := v_input_base + v_need * v_fac;
      v_plan_input := v_plan_input + (v_item ->> 'qty')::numeric * v_fac;
    end if;
    if (v_item ->> 'product_id')::uuid = v_first then
      v_first_need := v_need;
      v_first_factor := v_fac;
    end if;
  end loop;
  if not v_inputs_known then
    v_base := null;
  end if;
  if v_waste_qty > v_first_need then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Recipe yields: known weights, and the weight per unit implied for the others.
  if v_base is not null then
    for v_item in select * from jsonb_array_elements(v_prep.outputs)
    loop
      select unit into v_unit from public.products where id = (v_item ->> 'product_id')::uuid;
      v_weight := public.line_piece_weight(v_item);
      if public.mass_family(v_unit, v_weight) is not distinct from v_base then
        v_plan_known := v_plan_known + (v_item ->> 'qty')::numeric * public.mass_factor(v_unit, v_weight);
      else
        v_unknown_plan := v_unknown_plan + (v_item ->> 'qty')::numeric;
      end if;
    end loop;
    if v_unknown_plan > 0 then
      v_implied := v_plan_input - v_plan_known - v_plan_input * v_prep.wastage_norm_percent / 100;
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
    if v_base is not null then
      select unit into v_unit from public.products where id = (v_recipe ->> 'product_id')::uuid;
      v_weight := public.line_piece_weight(v_recipe);
      if public.mass_family(v_unit, v_weight) is not distinct from v_base then
        v_output_base := v_output_base + v_qty * public.mass_factor(v_unit, v_weight);
      elsif v_unknown_factor is not null then
        v_estimated := v_estimated + v_qty * v_unknown_factor;
        v_output_base := v_output_base + v_qty * v_unknown_factor;
      end if;
    end if;
  end loop;

  -- Balance: inputs = outputs + waste, within the tenant's tolerance.
  if v_base is not null and v_input_base > 0 then
    v_diff := v_input_base - v_output_base - v_waste_qty * v_first_factor;
    select s.prep_balance_tolerance, s.prep_balance_tolerance_percent into v_tolerance, v_tolerance_percent
    from public.tenant_settings s where s.tenant_id = v_tenant;
    v_exceeds := abs(v_diff) > v_tolerance or abs(v_diff) * 100 / v_input_base > v_tolerance_percent;
    if v_exceeds and not coalesce(p_confirm_loss, false) then
      raise exception 'balance_mismatch' using errcode = 'P0001';
    end if;
    if v_exceeds and v_diff > 0 then
      v_loss_qty := round(v_diff / v_first_factor, 3);
    end if;
  end if;

  insert into public.preparation_runs (
    tenant_id, branch_id, preparation_id, source_location_id, source_qty, base_unit, input_base, output_base,
    estimated_base, waste_base, loss_base, difference_base, norm_percent, confirmed_loss
  ) values (
    v_tenant, v_source.branch_id, v_prep.id, v_source.id, p_source_qty, v_base,
    case when v_base is not null then v_input_base end,
    case when v_base is not null then v_output_base end,
    case when v_base is not null then v_estimated end,
    case when v_base is not null then v_waste_qty * v_first_factor end,
    case when v_base is not null then v_loss_qty * v_first_factor end,
    v_diff, v_prep.wastage_norm_percent, v_exceeds and coalesce(p_confirm_loss, false)
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

  -- Inputs: composition with their lots, then the write-off (FIFO through the movement trigger).
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

  -- Outputs: received with their own shelf life, one lot each.
  for v_item in select * from jsonb_array_elements(v_plan)
  loop
    v_qty := (v_item ->> 'qty')::numeric;
    v_target := coalesce(nullif(v_item ->> 'storage_location_id', '')::uuid, p_storage_id);
    v_recipe := null;
    select o into v_recipe from jsonb_array_elements(v_prep.outputs) o where o ->> 'product_id' = v_item ->> 'product_id';
    v_storage := public.lot_target(v_tenant, (v_recipe ->> 'product_id')::uuid, v_target);
    v_expiry := v_today + public.get_shelf_life((v_recipe ->> 'product_id')::uuid, v_storage.id);

    insert into public.stock_movements (
      tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date, reason, unit, user_id
    )
    select v_tenant, p.id, v_storage.branch_id, v_storage.id, v_qty, 'prihod', v_expiry, v_prep.name, p.unit, auth.uid()
    from public.products p where p.id = (v_recipe ->> 'product_id')::uuid
    returning id into v_movement;

    v_lot := public.insert_product_lot(
      v_tenant, (v_recipe ->> 'product_id')::uuid, v_qty, v_storage.id, v_today, v_expiry, 'semi', v_parent,
      v_composition, v_prep.id, v_movement,
      case when v_recipe ? 'portions'
        then round((v_recipe ->> 'portions')::numeric * v_qty / (v_recipe ->> 'qty')::numeric) end
    );
    update public.product_lots set preparation_run_id = v_run where id = v_lot.id returning * into v_lot;
    return next v_lot;
  end loop;
end;
$$
  $ddl$;
  revoke execute on function public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb, jsonb, boolean) from public, anon;
  grant execute on function public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb, jsonb, boolean) to authenticated;
end;
$guard$;

-- Saves a recipe (p_id null: new) and the portion weights of its products [{product_id,
-- portion_weight_kg}] in one transaction; owners and chefs. p_wastage_norm_percent / p_wastage_items
-- null keep the stored values (the column defaults for a new recipe). Superseded by
-- 20261019_final_world_scheme.sql (see the validator).
do $guard$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'preparations' and column_name = 'evaporation_percent') then
    return;
  end if;
  execute $ddl$
create or replace function public.save_preparation(
  p_id uuid,
  p_name text,
  p_inputs jsonb,
  p_outputs jsonb,
  p_wastage_norm_percent numeric default null,
  p_wastage_items jsonb default null,
  p_portion_weights jsonb default null
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
  if p_wastage_norm_percent is not null or p_wastage_items is not null then
    update public.preparations
    set wastage_norm_percent = coalesce(p_wastage_norm_percent, wastage_norm_percent),
        wastage_items = coalesce(p_wastage_items, wastage_items)
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
$$
  $ddl$;
  revoke execute on function public.save_preparation(uuid, text, jsonb, jsonb, numeric, jsonb, jsonb) from public, anon;
  grant execute on function public.save_preparation(uuid, text, jsonb, jsonb, numeric, jsonb, jsonb) to authenticated;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 6. Write-offs: any waste (API) and expired stock (storage page)
-- ---------------------------------------------------------------------------
-- Logs the waste and takes it out of stock with a 'waste' movement (FEFO from the place). The place
-- is p_storage_location_id, else the place of p_parent_lot_id.
create or replace function public.log_wastage(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_reason_note text default null,
  p_parent_lot_id uuid default null,
  p_preparation_id uuid default null,
  p_storage_location_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_waste_writer();
  v_lot public.product_lots;
  v_location public.storage_locations;
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_branches uuid[];
  v_branchless boolean;
  v_movement_branch uuid;
  v_available numeric;
  v_log uuid;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or p_reason is null or p_reason not in ('cutting', 'cooking', 'expired', 'other') or char_length(v_note) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if p_parent_lot_id is not null then
    select * into v_lot from public.product_lots where id = p_parent_lot_id and tenant_id = v_tenant;
    if v_lot.id is null then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    if v_lot.product_id <> p_product_id then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;
  if p_preparation_id is not null
     and not exists (select 1 from public.preparations where id = p_preparation_id and tenant_id = v_tenant) then
    raise exception 'preparation_not_found' using errcode = 'P0002';
  end if;
  select * into v_location from public.storage_locations
  where id = coalesce(p_storage_location_id, v_lot.storage_location_id) and tenant_id = v_tenant;
  if v_location.id is null and coalesce(p_storage_location_id, v_lot.storage_location_id) is null then
    raise exception 'invalid_input' using errcode = '22023';
  elsif v_location.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  -- Concurrent write-offs of the same lots wait here and then see the reduced balance.
  perform 1 from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = v_location.id and quantity > 0
  for update;
  select coalesce(array_agg(distinct branch_id) filter (where branch_id is not null), '{}'),
         coalesce(bool_or(branch_id is null), false)
  into v_branches, v_branchless
  from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = v_location.id and quantity > 0;
  v_movement_branch := case when not v_branchless and cardinality(v_branches) = 1 then v_branches[1] end;
  select coalesce(sum(quantity), 0) into v_available
  from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = v_location.id and quantity > 0
    and (v_movement_branch is null or branch_id = v_movement_branch);
  if v_available < p_quantity then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  v_log := public.insert_wastage_log(v_tenant, v_location, p_product_id, p_quantity, p_reason, v_note, p_parent_lot_id, p_preparation_id, null);
  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, unit, user_id
  )
  select v_tenant, p.id, v_movement_branch, v_location.id, p_quantity, 'waste', p_reason, p.unit, auth.uid()
  from public.products p where p.id = p_product_id;
  return v_log;
end;
$$;

-- "Sil - xarab oldu": the whole stock row (one product, place and expiry) goes out as 'expired'.
-- The movement takes FEFO, i.e. this row unless an even older one is still in the place.
create or replace function public.write_off_expired_stock(p_stock_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_waste_writer();
  v_stock public.product_stocks;
  v_location public.storage_locations;
  v_parent uuid;
  v_log uuid;
begin
  select * into v_stock from public.product_stocks where id = p_stock_id and tenant_id = v_tenant for update;
  if v_stock.id is null then
    raise exception 'lot_not_found' using errcode = 'P0002';
  end if;
  if v_stock.quantity <= 0 or v_stock.expiry_date is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_location from public.storage_locations where id = v_stock.location_id;
  select l.id into v_parent from public.product_lots l
  where l.tenant_id = v_tenant and l.product_id = v_stock.product_id
    and l.storage_location_id = v_stock.location_id and l.expiry_date = v_stock.expiry_date
  order by l.created_at desc, l.id
  limit 1;

  v_log := public.insert_wastage_log(v_tenant, v_location, v_stock.product_id, v_stock.quantity, 'expired', null, v_parent, null, null);
  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, unit, user_id
  )
  select v_tenant, p.id, v_stock.branch_id, v_stock.location_id, v_stock.quantity, 'waste', 'expired', p.unit, auth.uid()
  from public.products p where p.id = v_stock.product_id;
  return v_log;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reports
-- ---------------------------------------------------------------------------
-- Waste of the last p_days tenant-local days (today included), newest first; cost only for those
-- who may see costs.
create or replace function public.wastage_list(p_days integer default 7)
returns table (
  id uuid, created_at timestamptz, product_id uuid, product_name text, quantity numeric, unit text,
  reason text, reason_note text, location_id uuid, location_name text, parent_lot_id uuid, lot_number text,
  preparation_id uuid, preparation_name text, cost numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_zone text;
  v_since timestamptz;
  v_costs boolean := public.can_see_costs();
begin
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select s.timezone into v_zone from public.tenant_settings s where s.tenant_id = v_tenant;
  v_since := ((public.tenant_today(v_tenant) - (p_days - 1))::timestamp) at time zone v_zone;
  return query
  select w.id, w.created_at, w.product_id, p.name, w.quantity, coalesce(w.unit, p.unit), w.reason, w.reason_note,
    w.location_id, sl.name, w.parent_lot_id, l.lot_number, w.preparation_id, pr.name,
    case when v_costs then w.cost end
  from public.wastage_logs w
  left join public.products p on p.id = w.product_id
  left join public.storage_locations sl on sl.id = w.location_id
  left join public.product_lots l on l.id = w.parent_lot_id
  left join public.preparations pr on pr.id = w.preparation_id
  where w.tenant_id = v_tenant and w.created_at >= v_since
  order by w.created_at desc, w.id;
end;
$$;

-- One tenant-local day: all waste in kg and its value, and the preparation runs measured in kg with
-- their input, norm (input x the recipe norm at run time) and waste including confirmed losses.
create or replace function public.wastage_summary(p_day date default null)
returns table (
  day date, waste_kg numeric, waste_cost numeric, runs integer, input_kg numeric, norm_kg numeric, prep_waste_kg numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_day date := coalesce(p_day, public.tenant_today(v_tenant));
  v_zone text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select s.timezone into v_zone from public.tenant_settings s where s.tenant_id = v_tenant;
  v_start := (v_day::timestamp) at time zone v_zone;
  v_end := ((v_day + 1)::timestamp) at time zone v_zone;
  return query
  select v_day,
    coalesce((
      select sum(w.quantity * public.mass_factor(coalesce(w.unit, p.unit), public.portion_weight(p.id)))
      from public.wastage_logs w left join public.products p on p.id = w.product_id
      where w.tenant_id = v_tenant and w.created_at >= v_start and w.created_at < v_end
        and public.mass_family(coalesce(w.unit, p.unit), public.portion_weight(p.id)) = 'kg'
    ), 0),
    case when public.can_see_costs() then coalesce((
      select sum(w.cost) from public.wastage_logs w
      where w.tenant_id = v_tenant and w.created_at >= v_start and w.created_at < v_end
    ), 0) end,
    r.runs, r.input_kg, r.norm_kg, r.waste_kg
  from (
    select count(*)::integer as runs,
      coalesce(sum(pr.input_base), 0) as input_kg,
      coalesce(sum(pr.input_base * pr.norm_percent / 100), 0) as norm_kg,
      coalesce(sum(coalesce(pr.waste_base, 0) + coalesce(pr.loss_base, 0)), 0) as waste_kg
    from public.preparation_runs pr
    where pr.tenant_id = v_tenant and pr.base_unit = 'kg' and pr.created_at >= v_start and pr.created_at < v_end
  ) r;
end;
$$;

-- Stock rows past or near their expiry (fewer than tenant_settings.expiry_warn_days left), soonest first.
create or replace function public.expired_stock(p_branch_id uuid default null)
returns table (
  stock_id uuid, product_id uuid, product_name text, unit text, quantity numeric, expiry_date date,
  days_left integer, location_id uuid, location_name text, lot_number text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := public.tenant_today(v_tenant);
  v_warn integer;
begin
  select s.expiry_warn_days into v_warn from public.tenant_settings s where s.tenant_id = v_tenant;
  return query
  select ps.id, ps.product_id, p.name, p.unit, ps.quantity, ps.expiry_date, (ps.expiry_date - v_today)::integer,
    ps.location_id, sl.name,
    (select l.lot_number from public.product_lots l
     where l.tenant_id = v_tenant and l.product_id = ps.product_id and l.storage_location_id = ps.location_id
       and l.expiry_date = ps.expiry_date
     order by l.created_at desc, l.id limit 1)
  from public.product_stocks ps
  join public.products p on p.id = ps.product_id
  join public.storage_locations sl on sl.id = ps.location_id
  where ps.tenant_id = v_tenant and ps.quantity > 0 and ps.expiry_date is not null
    and ps.expiry_date - v_today < v_warn
    and (p_branch_id is null or sl.branch_id = p_branch_id)
  order by ps.expiry_date, p.name, ps.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.require_waste_writer()',
    'public.insert_wastage_log(uuid, public.storage_locations, uuid, numeric, text, text, uuid, uuid, uuid)',
    'public.portion_weight(uuid)',
    'public.line_piece_weight(jsonb)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.unit_family(text)',
    'public.unit_factor(text)',
    'public.mass_family(text, numeric)',
    'public.mass_factor(text, numeric)',
    'public.log_wastage(uuid, numeric, text, text, uuid, uuid, uuid)',
    'public.write_off_expired_stock(uuid)',
    'public.wastage_list(integer)',
    'public.wastage_summary(date)',
    'public.expired_stock(uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.wastage_logs', 'insert')
     or has_table_privilege('authenticated', 'public.preparation_runs', 'insert')
     or has_function_privilege('authenticated', 'public.insert_wastage_log(uuid, public.storage_locations, uuid, numeric, text, text, uuid, uuid, uuid)', 'execute') then
    raise exception 'privileges too wide';
  end if;
  if has_column_privilege('authenticated', 'public.wastage_logs', 'cost', 'select') then
    raise exception 'wastage_logs.cost is still readable by clients';
  end if;
  if not has_column_privilege('authenticated', 'public.wastage_logs', 'reason_note', 'select') then
    raise exception 'wastage_logs.reason_note is not readable';
  end if;
  if to_regprocedure('public.create_lots_from_preparation(uuid, numeric, uuid, uuid, jsonb)') is not null then
    raise exception 'old create_lots_from_preparation still present';
  end if;
  if has_function_privilege('authenticated', 'public.portion_weight(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.line_piece_weight(jsonb)', 'execute') then
    raise exception 'portion weight helpers are callable by clients';
  end if;
end;
$$;

commit;
