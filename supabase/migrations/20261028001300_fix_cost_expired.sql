-- Stock value without expired stock, as stock_value() since 20261028001200: a lot counts from its expiry
-- day on as expired (public.stock_is_fresh) in the restaurant's day (public.stock_today: the
-- tenant_settings time zone, UTC without settings).
-- * get_stock_cost(): good stock only (still one number; owner_dashboard() reads it).
-- * stock_value_by_type(): value = good stock per storage type, expired_value apart.
-- * stock_summary(): cost, sale value and margin of good stock per kind, expired_value apart;
--   lines and quantities stay the physical stock (expired stock is on the shelf until written off).
-- Run after 20261028001200_near_expiry_management.sql. Idempotent.

do $$
begin
  if to_regprocedure('public.stock_is_fresh(date, date)') is null
     or to_regprocedure('public.stock_today(uuid)') is null then
    raise exception 'Run 20261028001200_near_expiry_management.sql first';
  end if;
end;
$$;

-- Live stock value of good lots: each lot at its own cost, else the product's catalog cost. null for
-- roles that may not see money.
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
    and public.stock_is_fresh(ps.expiry_date, public.stock_today(ps.tenant_id))
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and public.member_has_branch(auth.uid(), ps.tenant_id, sl.branch_id);
$$;
revoke execute on function public.get_stock_cost(uuid) from public, anon;
grant execute on function public.get_stock_cost(uuid) to authenticated;

-- Stock x latest purchase price (else 0) per storage type: good stock in value, expired stock in
-- expired_value. Empty for roles without costs.
drop function if exists public.stock_value_by_type(uuid);
create function public.stock_value_by_type(p_branch_id uuid default null)
returns table (type text, value numeric, expired_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select sl.type,
    sum(t.fresh_qty * coalesce(public.product_last_purchase_price(t.product_id), 0)),
    sum(t.expired_qty * coalesce(public.product_last_purchase_price(t.product_id), 0))
  from (
    select ps.location_id, ps.product_id,
      coalesce(sum(ps.quantity) filter (where public.stock_is_fresh(ps.expiry_date, public.stock_today(ps.tenant_id))), 0) as fresh_qty,
      coalesce(sum(ps.quantity) filter (where not public.stock_is_fresh(ps.expiry_date, public.stock_today(ps.tenant_id))), 0) as expired_qty
    from public.product_stocks ps
    where ps.tenant_id = (select public.current_tenant_id()) and ps.quantity > 0
    group by ps.location_id, ps.product_id
  ) t
  join public.storage_locations sl on sl.id = t.location_id
  where (select public.can_see_costs()) and (p_branch_id is null or sl.branch_id = p_branch_id)
  group by sl.type
  order by public.storage_type_rank(sl.type);
$$;
revoke execute on function public.stock_value_by_type(uuid) from public, anon;
grant execute on function public.stock_value_by_type(uuid) to authenticated;

-- Per kind: stock rows and kg / l / pieces on the shelf; for owners and chefs the cost, sale value and
-- margin of the good stock and the cost of the expired stock (expired_value). unpriced = rows without
-- a sale price.
drop function if exists public.stock_summary(uuid);
create function public.stock_summary(p_branch_id uuid default null)
returns table (
  kind text, lines integer, kg numeric, liters numeric, pieces numeric,
  cost_value numeric, sale_value numeric, margin numeric, unpriced integer, expired_value numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_money boolean := public.can_see_costs();
  v_today date := public.stock_today(v_tenant);
begin
  return query
  with s as (
    select public.stock_kind(p.product_type) as k, ps.quantity as q, public.unit_family(p.unit) as fam,
      public.unit_factor(p.unit) as fac,
      coalesce(ps.cost_per_unit, public.product_last_purchase_price(p.id), 0) as c, p.sale_price as sp,
      public.stock_is_fresh(ps.expiry_date, v_today) as fresh
    from public.product_stocks ps
    join public.products p on p.id = ps.product_id
    join public.storage_locations sl on sl.id = ps.location_id
    where ps.tenant_id = v_tenant and ps.quantity > 0 and (p_branch_id is null or sl.branch_id = p_branch_id)
  )
  select s.k, count(*)::integer,
    coalesce(sum(s.q * s.fac) filter (where s.fam = 'kg'), 0),
    coalesce(sum(s.q * s.fac) filter (where s.fam = 'l'), 0),
    coalesce(sum(s.q) filter (where s.fam is null), 0),
    case when v_money then coalesce(sum(s.q * s.c) filter (where s.fresh), 0) end,
    case when v_money then coalesce(sum(s.q * s.sp) filter (where s.fresh), 0) end,
    case when v_money then coalesce(sum(s.q * (s.sp - s.c)) filter (where s.fresh and s.sp is not null), 0) end,
    (count(*) filter (where s.sp is null))::integer,
    case when v_money then coalesce(sum(s.q * s.c) filter (where not s.fresh), 0) end
  from s
  group by s.k
  order by array_position(array['raw', 'semi', 'trim'], s.k);
end;
$$;
revoke execute on function public.stock_summary(uuid) from public, anon;
grant execute on function public.stock_summary(uuid) to authenticated;
