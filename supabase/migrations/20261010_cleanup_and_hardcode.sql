-- Phase 1.1: one stock model and tenant settings the code can rely on. One transaction.
--   * Legacy balances in products.quantity / products.qty become prihod movements (lots in
--     product_stocks) when the product has no lots yet; then both columns are dropped.
--   * public.locations (the organization-era storage list) is dropped; storage_locations replaces it.
--     products.location_id stays: the unique barcode index of catalog rows is defined on it.
--   * wastage_logs.cost is hidden like products.cost: owners and chefs read it through wastage_costs.
--   * memberships(tenant_id, user_id) index; tenant_settings validates timezone and expiry order.
--   * stamp_stock_movement() trusts server-side callers like enforce_tenant_id() does.
-- Run after 20261009_unify_tenant.sql. Idempotent.

begin;

do $$
begin
  if to_regclass('public.tenant_settings') is null or to_regprocedure('public.can_see_costs()') is null then
    raise exception 'Run 20261009_unify_tenant.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. stamp_stock_movement() required an end-user JWT, so the SQL Editor and service_role could not
-- write movements. Same rule as enforce_tenant_id(): callers without an anon/authenticated JWT are
-- trusted and keep their explicit tenant_id; client requests are still stamped and checked.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if new.tenant_id is not null and coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if new.tenant_id is not null and new.tenant_id is distinct from v_tenant then
    raise exception 'tenant_mismatch' using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_stock_movement() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Legacy balances -> product_stocks, through stock_movements so the log explains them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_qty boolean;
  v_has_quantity boolean;
  v_has_cost boolean;
  v_balance text;
  v_orphans integer;
  v_moved integer;
begin
  select
    bool_or(column_name = 'qty'),
    bool_or(column_name = 'quantity'),
    bool_or(column_name = 'cost')
  into v_has_qty, v_has_quantity, v_has_cost
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products';

  if not coalesce(v_has_qty, false) and not coalesce(v_has_quantity, false) then
    return;
  end if;

  -- quantity was backfilled from qty; move_stock() later changed only qty.
  v_balance := case
    when v_has_qty and v_has_quantity then 'coalesce(nullif(p.quantity, 0), p.qty::numeric, 0)'
    when v_has_quantity then 'coalesce(p.quantity, 0)'
    else 'coalesce(p.qty::numeric, 0)'
  end;

  execute format($q$
    select count(*)
    from public.products p
    where %1$s > 0
      and not exists (select 1 from public.product_stocks ps where ps.product_id = p.id)
      and not exists (
        select 1 from public.storage_locations s where s.tenant_id = p.tenant_id and s.is_active
      )
  $q$, v_balance) into v_orphans;
  if v_orphans > 0 then
    raise exception '% products hold a legacy balance but their tenant has no active storage location', v_orphans;
  end if;

  execute format($q$
    insert into public.stock_movements (
      tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, expiry_date,
      cost_per_unit, unit, reason
    )
    select p.tenant_id, p.id, s.branch_id, s.id, %1$s, 'prihod', p.expiry_date,
      %2$s, coalesce(p.unit, 'unit'), 'legacy products balance'
    from public.products p
    cross join lateral (
      select sl.id, sl.branch_id
      from public.storage_locations sl
      where sl.tenant_id = p.tenant_id and sl.is_active
      order by (sl.branch_id is not distinct from p.branch_id) desc, sl.name, sl.id
      limit 1
    ) s
    where %1$s > 0
      and not exists (select 1 from public.product_stocks ps where ps.product_id = p.id)
  $q$, v_balance, case when v_has_cost then 'p.cost' else 'null::numeric' end);
  get diagnostics v_moved = row_count;
  raise notice 'legacy balances moved to product_stocks: %', v_moved;
end;
$$;

-- Function bodies are not dependency-tracked: stop if one still reads products.qty.
do $$
declare
  v_list text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_list
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ '\mqty\M'
    and p.prosrc ~ '\mproducts\M';
  if v_list is not null then
    raise exception 'Functions still use products.qty: %', v_list;
  end if;
end;
$$;

-- No CASCADE: a view on these columns aborts the migration. Their checks and indexes go with them.
alter table public.products drop column if exists qty;
alter table public.products drop column if exists quantity;

-- ---------------------------------------------------------------------------
-- 2. public.locations
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_rows bigint;
begin
  if to_regclass('public.locations') is null then
    return;
  end if;

  select string_agg(distinct v.oid::regclass::text, ', ')
  into v_list
  from pg_depend d
  join pg_rewrite r on d.classid = 'pg_rewrite'::regclass and r.oid = d.objid
  join pg_class v on v.oid = r.ev_class
  where d.refobjid = 'public.locations'::regclass and v.oid <> 'public.locations'::regclass;
  if v_list is not null then
    raise exception 'Views still read public.locations: %', v_list;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
  into v_list
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~ '\mpublic\.locations\M|\mfrom\s+locations\M|\mjoin\s+locations\M';
  if v_list is not null then
    raise exception 'Functions still use public.locations: %', v_list;
  end if;

  execute 'select count(*) from public.locations' into v_rows;
  raise notice 'dropping public.locations with % rows (names only; stock lives in product_stocks)', v_rows;
end;
$$;

-- CASCADE removes the foreign keys that pointed at it (products.location_id) and its policies.
drop table if exists public.locations cascade;

-- ---------------------------------------------------------------------------
-- 3. wastage_logs.cost: only owners and chefs, through wastage_costs.
-- New wastage_logs columns must be added to the client grant explicitly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'wastage_logs' and column_name <> 'cost';

  revoke select on table public.wastage_logs from authenticated;
  revoke select (cost) on table public.wastage_logs from authenticated;
  execute format('grant select (%s) on table public.wastage_logs to authenticated', v_cols);
end;
$$;

create or replace view public.wastage_costs
with (security_barrier = true) as
select w.id, w.tenant_id, w.cost
from public.wastage_logs w
where w.tenant_id = (select public.current_tenant_id())
  and (select public.can_see_costs());

revoke all on table public.wastage_costs from anon, authenticated;
grant select on table public.wastage_costs to authenticated;

-- ---------------------------------------------------------------------------
-- 4. memberships lookup by tenant
-- ---------------------------------------------------------------------------
create index if not exists idx_memberships_tenant_user on public.memberships (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- 5. tenant_settings: the app reads these values without fallbacks, so they must be usable.
-- Red below expiry_warn_days, yellow below expiry_critical_days.
-- ---------------------------------------------------------------------------
alter table public.tenant_settings drop constraint if exists tenant_settings_expiry_order_check;
alter table public.tenant_settings
  add constraint tenant_settings_expiry_order_check check (expiry_warn_days <= expiry_critical_days);

create or replace function public.check_tenant_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_tenant_settings() from public, anon, authenticated;

drop trigger if exists trg_tenant_settings_check on public.tenant_settings;
create trigger trg_tenant_settings_check
  before insert or update of timezone on public.tenant_settings
  for each row execute function public.check_tenant_settings();

-- ---------------------------------------------------------------------------
-- 6. Final checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name in ('qty', 'quantity')
  ) then
    raise exception 'products.qty / products.quantity still exist';
  end if;
  if to_regclass('public.locations') is not null then
    raise exception 'public.locations still exists';
  end if;
  if has_column_privilege('authenticated', 'public.wastage_logs', 'cost', 'select') then
    raise exception 'wastage_logs.cost is still readable by clients';
  end if;
  if exists (
    select 1 from public.tenant_settings s
    where not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = s.timezone)
  ) then
    raise exception 'tenant_settings rows with an unknown timezone remain';
  end if;
end;
$$;

commit;
