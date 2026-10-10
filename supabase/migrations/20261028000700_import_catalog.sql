-- Catalog import (block 1.1): CSV/Excel rows become products; rows with an initial stock are received
-- through receive_stock_with_lot(), i.e. one 'prihod' movement (product_stocks, the balance) and one
-- lot (the label, LOT-YYYYMMDD-NNNN from batch_daily_counters).
-- * One call is one transaction. Every row is checked first; with any error nothing is written and
--   the errors come back as [{row, field, code}]. A failure while writing aborts the whole call.
-- * p_dry_run runs the same checks and writes nothing: the preview uses it.
-- * Tenant from require_tenant_member(); branch and places must belong to it. Owners and chefs only.
-- * Internal codes come from products_internal_code_seq (products.internal_code default).
-- Run after 20261028000600_tech_card_editor.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.receive_stock_with_lot(uuid, numeric, uuid, numeric, date, integer, boolean)') is null
     or to_regprocedure('public.require_tenant_member()') is null
     or to_regprocedure('public.current_member_role()') is null
     or to_regprocedure('public.tenant_today(uuid)') is null
     or to_regclass('public.products_internal_code_seq') is null then
    raise exception 'Run 20261028000600_tech_card_editor.sql and the migrations before it first';
  end if;
end;
$$;

-- Units a catalog product may have; lib/anbar/types.ts UNITS lists the same (checked by the tests).
create or replace function public.catalog_units()
returns text[]
language sql
immutable
as $$
  select array['kg', 'g', 'l', 'ml', 'pcs', 'box']::text[]
$$;

-- A JSON number, null when absent, NaN when the value is not a number.
create or replace function public.import_numeric(p_value jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
    else 'NaN'::numeric
  end
$$;

-- A YYYY-MM-DD date, null when it is not one.
create or replace function public.import_date(p_value text)
returns date
language plpgsql
immutable
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return case when to_char(p_value::date, 'YYYY-MM-DD') = p_value then p_value::date end;
exception when others then
  return null;
end;
$$;

revoke execute on function public.import_numeric(jsonb) from public, anon, authenticated;
revoke execute on function public.import_date(text) from public, anon, authenticated;

create or replace function public.import_catalog(
  p_branch_id uuid,
  p_location_id uuid,
  p_rows jsonb,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_units text[] := public.catalog_units();
  v_today date;
  v_row jsonb;
  v_index integer;
  v_line integer;
  v_errors jsonb := '[]'::jsonb;
  v_plan jsonb := '[]'::jsonb;
  v_barcodes text[] := '{}';
  v_names text[] := '{}';
  v_name text;
  v_unit text;
  v_barcode text;
  v_category text;
  v_price numeric;
  v_shelf numeric;
  v_min numeric;
  v_qty numeric;
  v_expiry_text text;
  v_expiry date;
  v_location_text text;
  v_location uuid;
  v_days integer;
  v_item jsonb;
  v_product uuid;
  v_created integer := 0;
  v_stocked integer := 0;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if p_location_id is not null and (p_branch_id is null or not exists (
    select 1 from public.storage_locations
    where id = p_location_id and tenant_id = v_tenant and branch_id = p_branch_id and is_active
  )) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  -- Imports of one tenant run one after another, so the name and barcode checks hold until commit.
  perform pg_advisory_xact_lock(hashtextextended('import_catalog:' || v_tenant::text, 0));
  v_today := public.tenant_today(v_tenant);

  for v_row, v_index in
    select e.value, e.ordinality::integer from jsonb_array_elements(p_rows) with ordinality e
  loop
    v_line := case
      when jsonb_typeof(v_row -> 'row') = 'number' then round((v_row ->> 'row')::numeric)::integer
      else v_index
    end;
    if jsonb_typeof(v_row) <> 'object' then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'row', 'code', 'invalid');
      continue;
    end if;

    v_name := nullif(regexp_replace(btrim(coalesce(v_row ->> 'name', '')), '\s+', ' ', 'g'), '');
    v_unit := lower(nullif(btrim(coalesce(v_row ->> 'unit', '')), ''));
    v_barcode := nullif(btrim(coalesce(v_row ->> 'barcode', '')), '');
    v_category := nullif(btrim(coalesce(v_row ->> 'category', '')), '');
    v_price := public.import_numeric(v_row -> 'price');
    v_shelf := public.import_numeric(v_row -> 'shelf_life_days');
    v_min := public.import_numeric(v_row -> 'min_stock');
    v_qty := coalesce(public.import_numeric(v_row -> 'initial_stock'), 0);
    v_expiry_text := nullif(btrim(coalesce(v_row ->> 'expiry_date', '')), '');
    v_expiry := public.import_date(v_expiry_text);
    v_location_text := nullif(btrim(coalesce(v_row ->> 'location', '')), '');
    v_location := null;

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'name', 'code', 'required');
    elsif char_length(v_name) < 2 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'name', 'code', 'too_short');
    elsif char_length(v_name) > 120 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'name', 'code', 'too_long');
    elsif lower(v_name) = any (v_names) then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'name', 'code', 'duplicate_in_file');
    elsif exists (
      select 1 from public.products where tenant_id = v_tenant and lower(name) = lower(v_name) and location_id is null
    ) then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'name', 'code', 'exists');
    end if;
    if v_name is not null then
      v_names := v_names || lower(v_name);
    end if;

    if v_unit is null then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'unit', 'code', 'required');
    elsif not (v_unit = any (v_units)) then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'unit', 'code', 'invalid_unit');
    end if;

    if v_barcode is not null then
      if char_length(v_barcode) > 64 then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'barcode', 'code', 'too_long');
      elsif v_barcode = any (v_barcodes) then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'barcode', 'code', 'duplicate_in_file');
      elsif exists (
        select 1 from public.products where tenant_id = v_tenant and barcode = v_barcode and location_id is null
      ) then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'barcode', 'code', 'exists');
      end if;
      v_barcodes := v_barcodes || v_barcode;
    end if;

    if v_category is not null and char_length(v_category) > 60 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'category', 'code', 'too_long');
    end if;

    if v_price = 'NaN'::numeric then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'price', 'code', 'invalid_number');
    elsif v_price < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'price', 'code', 'negative');
    elsif v_price > 1000000000 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'price', 'code', 'too_large');
    end if;

    if v_shelf = 'NaN'::numeric or v_shelf <> trunc(v_shelf) then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'shelf_life_days', 'code', 'not_integer');
    elsif v_shelf < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'shelf_life_days', 'code', 'negative');
    elsif v_shelf > 3650 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'shelf_life_days', 'code', 'too_large');
    end if;

    if v_min = 'NaN'::numeric then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'min_stock', 'code', 'invalid_number');
    elsif v_min < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'min_stock', 'code', 'negative');
    elsif v_min > 1000000 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'min_stock', 'code', 'too_large');
    end if;

    if v_qty = 'NaN'::numeric then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'initial_stock', 'code', 'invalid_number');
    elsif v_qty < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'initial_stock', 'code', 'negative');
    elsif v_qty > 1000000 then
      v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'initial_stock', 'code', 'too_large');
    elsif v_qty > 0 then
      if p_branch_id is null then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'initial_stock', 'code', 'branch_required');
      elsif v_location_text is not null then
        select s.id into v_location
        from public.storage_locations s
        where s.tenant_id = v_tenant and s.branch_id = p_branch_id and s.is_active
          and (upper(s.code) = upper(v_location_text) or lower(s.name) = lower(v_location_text))
        order by (upper(s.code) = upper(v_location_text)) desc, s.number
        limit 1;
        if v_location is null then
          v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'location', 'code', 'location_not_found');
        end if;
      else
        v_location := p_location_id;
        if v_location is null then
          v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'location', 'code', 'required');
        end if;
      end if;
    end if;

    v_days := null;
    if v_expiry_text is not null then
      if v_expiry is null then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'expiry_date', 'code', 'invalid_date');
      elsif v_expiry < v_today then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'expiry_date', 'code', 'expiry_past');
      elsif v_expiry - v_today > 3650 then
        v_errors := v_errors || jsonb_build_object('row', v_line, 'field', 'expiry_date', 'code', 'too_large');
      else
        v_days := v_expiry - v_today;
      end if;
    end if;

    v_plan := v_plan || jsonb_build_object(
      'name', v_name, 'unit', v_unit, 'barcode', v_barcode, 'category', v_category, 'price', v_price,
      'shelf_life_days', v_shelf, 'min_stock', v_min, 'qty', v_qty, 'location', v_location, 'days', v_days
    );
  end loop;

  if jsonb_array_length(v_errors) > 0 or coalesce(p_dry_run, false) then
    return jsonb_build_object(
      'ok', jsonb_array_length(v_errors) = 0,
      'dry_run', coalesce(p_dry_run, false),
      'rows', jsonb_array_length(p_rows),
      'stocked', (select count(*) from jsonb_array_elements(v_plan) p where (p ->> 'qty')::numeric > 0),
      'errors', v_errors
    );
  end if;

  for v_item in select value from jsonb_array_elements(v_plan) loop
    insert into public.products (
      tenant_id, name, unit, barcode, category, cost, shelf_life_days, min_stock, storage_location_id
    ) values (
      v_tenant,
      v_item ->> 'name',
      v_item ->> 'unit',
      v_item ->> 'barcode',
      v_item ->> 'category',
      (v_item ->> 'price')::numeric,
      (v_item ->> 'shelf_life_days')::integer,
      (v_item ->> 'min_stock')::numeric,
      (v_item ->> 'location')::uuid
    )
    returning id into v_product;
    v_created := v_created + 1;

    if (v_item ->> 'qty')::numeric > 0 then
      perform public.receive_stock_with_lot(
        v_product,
        (v_item ->> 'qty')::numeric,
        (v_item ->> 'location')::uuid,
        (v_item ->> 'price')::numeric,
        v_today,
        (v_item ->> 'days')::integer,
        false
      );
      v_stocked := v_stocked + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', false, 'rows', v_created, 'stocked', v_stocked, 'errors', '[]'::jsonb);
end;
$$;

revoke execute on function public.import_catalog(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_catalog(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.catalog_units() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.import_catalog(uuid, uuid, jsonb, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.import_numeric(jsonb)', 'execute') then
    raise exception 'import_catalog privileges incomplete';
  end if;
end;
$$;

commit;
