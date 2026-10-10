-- Par levels per branch, the owner's live dashboard and the chef's waste feed filters.
-- * par_levels: min/max of a product in one branch. Without a row the tenant-wide product limits
--   apply (products.min_stock, else tenant_settings.low_stock_default; products.par_level as max).
-- * wastage_logs already exists (reasons, photo, created_by, cost fixed at write time by
--   fill_wastage_cost, stock decreased atomically by create_wastage_with_movement / log_wastage);
--   here it only gains indexes and wastage_total() gains reason / author filters.
-- * get_stock_cost(), par_alerts(), owner_dashboard(): money only for owners and chefs.
-- Tenant scope is tenant_id = current_tenant_id() (organization_id was replaced by tenant_id in
-- 20261009_unify_tenant.sql). Idempotent.

do $$
begin
  if to_regclass('public.tenants') is null or to_regclass('public.branches') is null
     or to_regclass('public.products') is null or to_regclass('public.product_stocks') is null
     or to_regclass('public.wastage_logs') is null or to_regclass('public.storage_locations') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or to_regprocedure('public.current_member_role()') is null
     or to_regprocedure('public.can_see_costs()') is null
     or to_regprocedure('public.tenant_today(uuid)') is null
     or to_regprocedure('public.member_has_branch(uuid, uuid, uuid)') is null then
    raise exception 'Run the migrations up to 20261023000000_inventory_tasks.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. par_levels
-- ---------------------------------------------------------------------------
create table if not exists public.par_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  min_qty numeric not null,
  max_qty numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint par_levels_min_check check (min_qty >= 0 and min_qty <= 1000000),
  constraint par_levels_max_check check (max_qty is null or (max_qty >= min_qty and max_qty <= 1000000)),
  constraint par_levels_branch_product_key unique (branch_id, product_id)
);

do $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'par_levels' and column_name in ('tenant_id', 'branch_id', 'product_id')
  ) = 3 then
    create index if not exists idx_par_levels_branch_product on public.par_levels (branch_id, product_id);
    create index if not exists idx_par_levels_tenant on public.par_levels (tenant_id);
  else
    raise notice 'par_levels: columns missing, indexes skipped';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wastage_logs' and column_name in ('tenant_id', 'branch_id', 'created_at')
  ) = 3 then
    create index if not exists idx_wastage_logs_branch_day on public.wastage_logs (tenant_id, branch_id, created_at desc);
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wastage_logs' and column_name in ('tenant_id', 'reason', 'created_at')
  ) = 3 then
    create index if not exists idx_wastage_logs_reason_day on public.wastage_logs (tenant_id, reason, created_at desc);
  end if;
end;
$$;

-- The branch and the product must belong to the row's tenant.
create or replace function public.par_levels_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.branches where id = new.branch_id and tenant_id = new.tenant_id)
     or not exists (select 1 from public.products where id = new.product_id and tenant_id = new.tenant_id) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.par_levels_check() from public, anon, authenticated;
drop trigger if exists trg_par_levels_check on public.par_levels;
create trigger trg_par_levels_check
  before insert or update on public.par_levels
  for each row execute function public.par_levels_check();

alter table public.par_levels enable row level security;
revoke all on public.par_levels from anon;
grant select, insert, update, delete on public.par_levels to authenticated;

drop policy if exists par_levels_select on public.par_levels;
create policy par_levels_select on public.par_levels
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists par_levels_write on public.par_levels;
create policy par_levels_write on public.par_levels
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) in ('owner', 'chef')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) in ('owner', 'chef')
    and public.member_has_branch((select auth.uid()), tenant_id, branch_id)
  );

-- ---------------------------------------------------------------------------
-- 2. Stock value and par alerts
-- ---------------------------------------------------------------------------
-- Live stock value: each lot at its own cost, else the product's catalog cost. null for roles
-- that may not see money.
create or replace function public.get_stock_cost(p_branch_id uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_see_costs() then
    coalesce(sum(ps.quantity * coalesce(ps.cost_per_unit, p.cost, 0)), 0)
  end
  from public.product_stocks ps
  join public.storage_locations sl on sl.id = ps.location_id
  join public.products p on p.id = ps.product_id
  where ps.tenant_id = public.current_tenant_id()
    and ps.quantity > 0
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and public.member_has_branch(auth.uid(), ps.tenant_id, sl.branch_id);
$$;
revoke execute on function public.get_stock_cost(uuid) from public, anon;
grant execute on function public.get_stock_cost(uuid) to authenticated;

-- Products below their minimum, per branch: the branch's par_levels row, else the product's own
-- limits for branches that keep it (stock rows there). 0 means not tracked. order_qty brings the
-- balance back to max (else min).
create or replace function public.par_alerts(p_branch_id uuid default null)
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  min_qty numeric,
  max_qty numeric,
  order_qty numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  return query
  with pairs as (
    select pl.branch_id, pl.product_id from public.par_levels pl where pl.tenant_id = v_tenant
    union
    select distinct sl.branch_id, ps.product_id
    from public.product_stocks ps
    join public.storage_locations sl on sl.id = ps.location_id
    where ps.tenant_id = v_tenant and sl.branch_id is not null
  ),
  limits as (
    select pr.branch_id, pr.product_id,
      coalesce(pl.min_qty, p.min_stock, s.low_stock_default, 0) as min_qty,
      coalesce(pl.max_qty, p.par_level) as max_qty
    from pairs pr
    join public.products p on p.id = pr.product_id and p.tenant_id = v_tenant
    left join public.par_levels pl on pl.branch_id = pr.branch_id and pl.product_id = pr.product_id
    left join public.tenant_settings s on s.tenant_id = v_tenant
    where (p_branch_id is null or pr.branch_id = p_branch_id)
      and public.member_has_branch(auth.uid(), v_tenant, pr.branch_id)
  ),
  balances as (
    select l.*,
      coalesce((
        select sum(ps.quantity) from public.product_stocks ps
        join public.storage_locations sl on sl.id = ps.location_id
        where ps.tenant_id = v_tenant and ps.product_id = l.product_id and sl.branch_id = l.branch_id
      ), 0) as quantity
    from limits l
    where l.min_qty > 0
  )
  select b.branch_id, br.name, b.product_id, p.name, p.unit, round(b.quantity, 3), b.min_qty, b.max_qty,
    round(greatest(coalesce(greatest(b.max_qty, b.min_qty), b.min_qty) - greatest(b.quantity, 0), 0), 3)
  from balances b
  join public.products p on p.id = b.product_id
  join public.branches br on br.id = b.branch_id
  where b.quantity < b.min_qty
  order by (b.quantity <= 0) desc, b.quantity / nullif(b.min_qty, 0), p.name, br.name
  limit 500;
end;
$$;
revoke execute on function public.par_alerts(uuid) from public, anon;
grant execute on function public.par_alerts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Waste totals with the feed's filters
-- ---------------------------------------------------------------------------
drop function if exists public.wastage_total(timestamptz, timestamptz, uuid, uuid);
create or replace function public.wastage_total(
  p_start timestamptz,
  p_end timestamptz,
  p_branch_id uuid default null,
  p_location_id uuid default null,
  p_reason text default null,
  p_user_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_see_costs() then coalesce(sum(w.cost), 0) end
  from public.wastage_logs w
  where w.tenant_id = public.current_tenant_id()
    and w.created_at >= p_start and w.created_at < p_end
    and (p_branch_id is null or w.branch_id = p_branch_id)
    and (p_location_id is null or w.location_id = p_location_id)
    and (p_reason is null or w.reason = p_reason)
    and (p_user_id is null or coalesce(w.user_id, w.created_by) = p_user_id);
$$;
revoke execute on function public.wastage_total(timestamptz, timestamptz, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.wastage_total(timestamptz, timestamptz, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Owner dashboard: one round trip for the cards (tenant-local today).
-- ---------------------------------------------------------------------------
create or replace function public.owner_dashboard(p_branch_id uuid default null)
returns table (stock_cost numeric, below_par integer, out_of_stock integer, wasted_today numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_zone text;
  v_start timestamptz;
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(s.timezone, 'UTC') into v_zone from public.tenant_settings s where s.tenant_id = v_tenant;
  v_start := (public.tenant_today(v_tenant)::timestamp) at time zone coalesce(v_zone, 'UTC');
  return query
  select public.get_stock_cost(p_branch_id),
    (select count(*)::integer from public.par_alerts(p_branch_id)),
    (select count(*)::integer from public.par_alerts(p_branch_id) a where a.quantity <= 0),
    coalesce((
      select sum(w.cost) from public.wastage_logs w
      where w.tenant_id = v_tenant and w.created_at >= v_start
        and (p_branch_id is null or w.branch_id = p_branch_id)
        and (w.branch_id is null or public.member_has_branch(auth.uid(), v_tenant, w.branch_id))
    ), 0);
end;
$$;
revoke execute on function public.owner_dashboard(uuid) from public, anon;
grant execute on function public.owner_dashboard(uuid) to authenticated;
