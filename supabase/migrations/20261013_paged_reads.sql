-- Read-only functions for paginated screens. Filters, grouping and totals run in the database, so a
-- page of 50 is a page of the full result and the totals cover every row, not only the loaded page.
-- No data changes. Run after 20261012_wastage_atomic.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.can_see_costs()') is null or to_regclass('public.tenant_settings') is null then
    raise exception 'Run 20261009_unify_tenant.sql and 20261010_cleanup_and_hardcode.sql first';
  end if;
end;
$$;

-- ILIKE pattern for a user search: wildcards in the text match literally.
create or replace function public.search_pattern(p_search text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(p_search), '') is null then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;

-- Catalog page: products of the branch (shared ones included) with stock and nearest lot expiry.
-- Low stock: below min_stock, else below tenant_settings.low_stock_default; 0 means not tracked.
-- Runs with the caller's rights (RLS and column privileges apply).
create or replace function public.catalog_page(
  p_branch_id uuid default null,
  p_search text default null,
  p_category text default null,
  p_low_only boolean default false,
  p_product_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (id uuid, stock numeric, nearest_expiry date, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with lines as (
    select p.id, p.name,
      coalesce(t.stock, 0) as stock,
      coalesce(t.nearest_expiry, p.expiry_date) as nearest_expiry,
      coalesce(p.min_stock, s.low_stock_default) as threshold
    from public.products p
    join public.tenant_settings s on s.tenant_id = p.tenant_id
    left join lateral (
      select sum(ps.quantity) as stock, min(ps.expiry_date) as nearest_expiry
      from public.product_stocks ps
      where ps.product_id = p.id and ps.quantity > 0
        and (p_branch_id is null or ps.branch_id = p_branch_id)
    ) t on true
    where p.tenant_id = (select public.current_tenant_id())
      and (p_product_id is null or p.id = p_product_id)
      and (p_branch_id is null or p.branch_id is null or p.branch_id = p_branch_id)
      and (p_category is null or p.category = p_category)
      and (
        public.search_pattern(p_search) is null
        or p.name ilike public.search_pattern(p_search)
        or p.barcode ilike public.search_pattern(p_search)
        or p.internal_code ilike public.search_pattern(p_search)
        or p.category ilike public.search_pattern(p_search)
      )
  )
  select l.id, l.stock, l.nearest_expiry, count(*) over () as total_count
  from lines l
  where not coalesce(p_low_only, false) or (l.threshold > 0 and l.stock < l.threshold)
  order by l.name, l.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 0), 0);
$$;

create or replace function public.catalog_categories(p_branch_id uuid default null)
returns table (category text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct p.category
  from public.products p
  where p.tenant_id = (select public.current_tenant_id())
    and p.category is not null
    and (p_branch_id is null or p.branch_id is null or p.branch_id = p_branch_id)
  order by 1;
$$;

-- Stock lines: lots summed per product and storage location (non-zero balances only).
create or replace function public.stock_lines_page(
  p_branch_id uuid default null,
  p_location_id uuid default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  product_id uuid,
  product_name text,
  location_id uuid,
  location_name text,
  quantity numeric,
  unit text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select ps.product_id, p.name, ps.location_id, sl.name, sum(ps.quantity), max(ps.unit), count(*) over ()
  from public.product_stocks ps
  join public.products p on p.id = ps.product_id
  join public.storage_locations sl on sl.id = ps.location_id
  where ps.tenant_id = (select public.current_tenant_id())
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and (p_location_id is null or ps.location_id = p_location_id)
    and (public.search_pattern(p_search) is null or p.name ilike public.search_pattern(p_search))
  group by ps.product_id, p.name, ps.location_id, sl.name
  having sum(ps.quantity) <> 0
  order by p.name, sl.name, ps.product_id, ps.location_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit greatest(coalesce(p_limit, 0), 0);
$$;

-- Money totals: null for roles that may not see costs.
create or replace function public.stock_value(p_branch_id uuid default null, p_location_id uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_see_costs() then coalesce(sum(ps.quantity * coalesce(ps.cost_per_unit, 0)), 0) end
  from public.product_stocks ps
  join public.storage_locations sl on sl.id = ps.location_id
  where ps.tenant_id = public.current_tenant_id()
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and (p_location_id is null or ps.location_id = p_location_id);
$$;

create or replace function public.wastage_total(
  p_start timestamptz,
  p_end timestamptz,
  p_branch_id uuid default null,
  p_location_id uuid default null
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
    and (p_location_id is null or w.location_id = p_location_id);
$$;

revoke execute on function public.search_pattern(text) from public, anon;
revoke execute on function public.catalog_page(uuid, text, text, boolean, uuid, integer, integer) from public, anon;
revoke execute on function public.catalog_categories(uuid) from public, anon;
revoke execute on function public.stock_lines_page(uuid, uuid, text, integer, integer) from public, anon;
revoke execute on function public.stock_value(uuid, uuid) from public, anon;
revoke execute on function public.wastage_total(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.search_pattern(text) to authenticated;
grant execute on function public.catalog_page(uuid, text, text, boolean, uuid, integer, integer) to authenticated;
grant execute on function public.catalog_categories(uuid) to authenticated;
grant execute on function public.stock_lines_page(uuid, uuid, text, integer, integer) to authenticated;
grant execute on function public.stock_value(uuid, uuid) to authenticated;
grant execute on function public.wastage_total(timestamptz, timestamptz, uuid, uuid) to authenticated;

create index if not exists idx_product_stocks_product_branch on public.product_stocks (product_id, branch_id) where quantity > 0;

commit;
