-- Theoretical vs actual usage per product for a period (roadmap 8.1: where the stock goes).
-- * theoretical: what the sales needed by their tech cards. A sale writes its ingredients off itself
--   (deduce_sale -> deduce_ingredients_for_dish: 'spisanie' movements with reason 'sale_deduction'); the
--   part sold without stock on the books is in stock_alerts ('insufficient_stock' of a recipe).
-- * actual: everything that left the branch for good: the sales above, write-offs ('waste' and any other
--   'spisanie') and count shortages net of count surpluses ('count' out / in). Moves inside a branch and
--   transfers to other branches are not usage; prep ('task') turns raw stock into a semi-finished product
--   that has its own stock and its own sales.
-- * loss = actual - theoretical: written_off (recorded, with a reason) + count_loss (gone, found at the
--   count). Value at the average cost of the stock on hand (product_stocks.cost_per_unit weighted by
--   quantity), else the last purchase price.
-- Days are the restaurant's (tenant_settings.timezone, UTC without settings), the red line is
-- tenant_settings.loss_alert_percent, the currency tenant_settings.currency. Owners and chefs only.
-- Run after 20261028001300_fix_cost_expired.sql. Idempotent.

do $$
begin
  if to_regclass('public.stock_movements') is null or to_regclass('public.stock_alerts') is null
     or to_regclass('public.product_stocks') is null or to_regclass('public.tenant_settings') is null
     or to_regprocedure('public.require_tenant_member()') is null
     or to_regprocedure('public.can_see_costs()') is null
     or to_regprocedure('public.member_has_branch(uuid, uuid, uuid)') is null
     or to_regprocedure('public.product_last_purchase_price(uuid)') is null
     or to_regprocedure('public.deduce_sale(uuid, jsonb)') is null then
    raise exception 'Run the migrations up to 20261028001300_fix_cost_expired.sql first';
  end if;
end;
$$;

alter table public.tenant_settings add column if not exists loss_alert_percent numeric not null default 10;
alter table public.tenant_settings drop constraint if exists tenant_settings_loss_alert_percent_check;
alter table public.tenant_settings
  add constraint tenant_settings_loss_alert_percent_check check (loss_alert_percent between 0 and 100);

create index if not exists idx_stock_movements_tenant_created on public.stock_movements (tenant_id, created_at);

-- p_branch_id null: every branch of the caller. p_start .. p_end inclusive, at most 367 days.
create or replace function public.get_theoretical_vs_actual(p_branch_id uuid, p_start date, p_end date)
returns table (
  product_id uuid,
  product_name text,
  unit text,
  theoretical_qty numeric,
  actual_qty numeric,
  loss_qty numeric,
  loss_pct numeric,
  written_off_qty numeric,
  count_loss_qty numeric,
  unit_cost numeric,
  loss_value numeric,
  currency text,
  over_limit boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  v_tz text;
  v_currency text;
  v_limit numeric;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_branch_id is not null
     and (not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
          or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id)) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  select s.timezone, s.currency, s.loss_alert_percent into v_tz, v_currency, v_limit
  from public.tenant_settings s where s.tenant_id = v_tenant;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_currency := coalesce(nullif(btrim(v_currency), ''), 'USD');
  v_limit := coalesce(v_limit, 10);
  v_from := p_start::timestamp at time zone v_tz;
  v_to := (p_end + 1)::timestamp at time zone v_tz;

  return query
  with scope as (
    select b.id from public.branches b
    where b.tenant_id = v_tenant
      and (p_branch_id is null or b.id = p_branch_id)
      and public.member_has_branch(auth.uid(), v_tenant, b.id)
  ),
  moves as (
    select m.product_id,
      case when m.movement_type = 'spisanie' and m.reason = 'sale_deduction' then m.quantity else 0 end as sold,
      case when m.movement_type = 'waste' or (m.movement_type = 'spisanie' and m.reason is distinct from 'sale_deduction')
           then m.quantity else 0 end as written_off,
      case when m.movement_type = 'count' and m.from_location_id is not null then m.quantity
           when m.movement_type = 'count' then -m.quantity else 0 end as count_loss,
      0::numeric as unbooked
    from public.stock_movements m
    left join public.storage_locations sl on sl.id = coalesce(m.from_location_id, m.to_location_id)
    where m.tenant_id = v_tenant
      and m.created_at >= v_from and m.created_at < v_to
      and m.movement_type in ('spisanie', 'waste', 'count')
      and coalesce(sl.branch_id, m.branch_id) in (select id from scope)
    union all
    select a.product_id, 0, 0, 0, (a.meta ->> 'shortage')::numeric
    from public.stock_alerts a
    where a.tenant_id = v_tenant
      and a.type = 'insufficient_stock' and a.meta ? 'recipe_id'
      and coalesce(a.meta ->> 'shortage', '') ~ '^[0-9]+(\.[0-9]+)?$'
      and a.created_at >= v_from and a.created_at < v_to
      and a.branch_id in (select id from scope)
  ),
  totals as (
    select mv.product_id,
      sum(mv.sold) + sum(mv.unbooked) as theoretical,
      sum(mv.written_off) as written_off,
      sum(mv.count_loss) as count_loss
    from moves mv
    where mv.product_id is not null
    group by mv.product_id
  ),
  costs as (
    select ps.product_id, sum(ps.quantity * ps.cost_per_unit) / nullif(sum(ps.quantity), 0) as avg_cost
    from public.product_stocks ps
    where ps.tenant_id = v_tenant and ps.quantity > 0 and ps.cost_per_unit is not null
      and ps.branch_id in (select id from scope)
    group by ps.product_id
  ),
  lines as (
    select t.product_id, p.name, p.unit,
      round(t.theoretical, 3) as theoretical,
      round(t.theoretical + t.written_off + t.count_loss, 3) as actual,
      round(t.written_off, 3) as written_off,
      round(t.count_loss, 3) as count_loss,
      coalesce(c.avg_cost, public.product_last_purchase_price(t.product_id)) as cost
    from totals t
    join public.products p on p.id = t.product_id and p.tenant_id = v_tenant
    left join costs c on c.product_id = t.product_id
  )
  select l.product_id, l.name, l.unit,
    l.theoretical, l.actual, l.actual - l.theoretical,
    case when l.theoretical > 0 then round((l.actual - l.theoretical) / l.theoretical * 100, 1) end,
    l.written_off, l.count_loss,
    round(l.cost, 4), round((l.actual - l.theoretical) * l.cost, 2),
    v_currency,
    l.actual > l.theoretical and (l.theoretical = 0 or (l.actual - l.theoretical) / l.theoretical * 100 > v_limit)
  from lines l
  where l.theoretical <> 0 or l.actual <> 0
  order by round((l.actual - l.theoretical) * l.cost, 2) desc nulls last, l.actual - l.theoretical desc, l.name;
end;
$$;
revoke execute on function public.get_theoretical_vs_actual(uuid, date, date) from public, anon;
grant execute on function public.get_theoretical_vs_actual(uuid, date, date) to authenticated;
