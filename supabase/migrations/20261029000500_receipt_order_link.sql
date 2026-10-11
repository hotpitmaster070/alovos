-- Receiving against a chosen order: the storekeeper may pick the sent request a delivery belongs to (the same
-- product ordered from two suppliers). Without a choice the receipt is matched as before (20261029000400).
-- * purchase_request_receipts.is_manual_link: true when chosen by hand. A link, manual or automatic, is
--   never rewritten; a manual one counts towards the chosen request only.
-- * receipt_order_options(product, branch): the latest 10 sent requests with the product not fully received.
-- * receive_stock_for_request(request, ...): the receipt of receive_stock_with_lot_fx() linked to that request.
-- * auto_order_manual_links(day): receipts linked by hand per request, for the owner's dashboard.
-- Run after 20261029000400_auto_order_send.sql. Idempotent.

do $$
begin
  if to_regclass('public.purchase_request_receipts') is null
     or to_regprocedure('public.receive_stock_with_lot_fx(uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean)') is null then
    raise exception 'Run 20261029000400_auto_order_send.sql first';
  end if;
end;
$$;

alter table public.purchase_request_receipts add column if not exists is_manual_link boolean not null default false;

-- Ordered and already received quantity of a product on a request.
create or replace function public.request_product_progress(p_request_id uuid, p_product_id uuid)
returns table (ordered numeric, received numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select coalesce(sum((x ->> 'qty')::numeric), 0) from public.purchase_requests pr, jsonb_array_elements(pr.items) x
     where pr.id = p_request_id and (x ->> 'product_id')::uuid = p_product_id),
    (select coalesce(sum(rc.qty), 0) from public.purchase_request_receipts rc where rc.request_id = p_request_id and rc.product_id = p_product_id)
$$;
revoke execute on function public.request_product_progress(uuid, uuid) from public, anon, authenticated;

-- The chosen request comes from receive_stock_for_request() in the same transaction (alovos.receipt_request).
create or replace function public.match_receipt_to_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request uuid;
  v_chosen uuid;
begin
  if new.movement_type is distinct from 'prihod' or new.cost_per_unit is null or new.quantity is null or new.quantity <= 0 then
    return null;
  end if;
  begin
    v_chosen := nullif(current_setting('alovos.receipt_request', true), '')::uuid;
    if v_chosen is not null then
      select pr.id into v_request
      from public.purchase_requests pr
      where pr.id = v_chosen and pr.tenant_id = new.tenant_id and pr.status in ('sent', 'received')
        and exists (select 1 from jsonb_array_elements(pr.items) x where (x ->> 'product_id')::uuid = new.product_id)
      for update of pr;
    end if;
    if v_request is null then
      select pr.id into v_request
      from public.purchase_requests pr
      where pr.tenant_id = new.tenant_id
        and pr.status in ('sent', 'received')
        and pr.sent_at is not null
        and (pr.branch_id is null or new.branch_id is null or pr.branch_id = new.branch_id)
        and exists (select 1 from public.purchase_request_deliveries d where d.request_id = pr.id)
        and (select g.ordered > g.received from public.request_product_progress(pr.id, new.product_id) g)
      order by pr.sent_at desc, pr.id
      limit 1
      for update of pr;
    end if;
    if v_request is null then
      return null;
    end if;
    insert into public.purchase_request_receipts (movement_id, tenant_id, request_id, product_id, qty, amount, is_manual_link)
    values (new.id, new.tenant_id, v_request, new.product_id, new.quantity, round(new.quantity * new.cost_per_unit, 2),
      v_chosen is not null and v_request = v_chosen)
    on conflict (movement_id) do nothing;
    update public.purchase_request_deliveries set actual_amount = public.purchase_request_actual(v_request)
    where request_id = v_request;
  exception when others then
    raise warning 'match_receipt_to_request: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.match_receipt_to_request() from public, anon, authenticated;

-- For the receiving form: sent requests of the restaurant (of the branch when given) with the product
-- still to come, newest first. estimated_amount (the request's ~amount) only for roles that see costs.
create or replace function public.receipt_order_options(p_product_id uuid, p_branch_id uuid default null)
returns table (
  request_id uuid,
  sent_at timestamptz,
  supplier_name text,
  ordered numeric,
  received numeric,
  unit text,
  estimated_amount numeric,
  currency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  v_costs boolean := public.can_see_costs();
begin
  return query
  select pr.id, pr.sent_at, sp.name, g.ordered, g.received, p.unit,
    case when v_costs then (select d.estimated_amount from public.purchase_request_deliveries d
      where d.request_id = pr.id order by d.created_at desc, d.id limit 1) end,
    (select ts.currency from public.tenant_settings ts where ts.tenant_id = v_tenant)
  from public.purchase_requests pr
  join public.products p on p.id = p_product_id and p.tenant_id = v_tenant
  left join public.suppliers sp on sp.id = pr.supplier_id
  cross join lateral public.request_product_progress(pr.id, p_product_id) g
  where pr.tenant_id = v_tenant
    and pr.status in ('sent', 'received')
    and pr.sent_at is not null
    and (p_branch_id is null or pr.branch_id is null or pr.branch_id = p_branch_id)
    and g.ordered > g.received
  order by pr.sent_at desc, pr.id
  limit 10;
end;
$$;
revoke execute on function public.receipt_order_options(uuid, uuid) from public, anon;
grant execute on function public.receipt_order_options(uuid, uuid) to authenticated;

-- Goods receipt with its lot (receive_stock_with_lot_fx) counted towards the chosen request. The request
-- must be the restaurant's, sent, have the product and match the place's branch; a price is required.
create or replace function public.receive_stock_for_request(
  p_request_id uuid,
  p_product_id uuid,
  p_qty numeric,
  p_storage_id uuid,
  p_price numeric,
  p_currency text,
  p_fx_rate numeric,
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
  v_lot public.product_lots;
begin
  if p_price is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.purchase_requests pr
    where pr.id = p_request_id and pr.tenant_id = v_tenant and pr.status in ('sent', 'received')
      and exists (select 1 from jsonb_array_elements(pr.items) x where (x ->> 'product_id')::uuid = p_product_id)
      and (pr.branch_id is null or pr.branch_id = (select sl.branch_id from public.storage_locations sl where sl.id = p_storage_id))
  ) then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform set_config('alovos.receipt_request', p_request_id::text, true);
  v_lot := public.receive_stock_with_lot_fx(
    p_product_id, p_qty, p_storage_id, p_price, p_currency, p_fx_rate, p_production_date, p_shelf_life_days, p_remember
  );
  perform set_config('alovos.receipt_request', '', true);
  return v_lot;
end;
$$;
revoke execute on function public.receive_stock_for_request(uuid, uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean) from public, anon;
grant execute on function public.receive_stock_for_request(uuid, uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean) to authenticated;

-- Requests sent on a day (the restaurant's day, default yesterday) with receipts linked by hand; read next to
-- auto_order_send_log(), whose result is left as it is.
create or replace function public.auto_order_manual_links(p_day date default null)
returns table (request_id uuid, manual_links integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_day date := coalesce(p_day, public.stock_today(v_tenant) - 1);
  v_tz text;
begin
  select coalesce(nullif(btrim(ts.timezone), ''), 'UTC') into v_tz from public.tenant_settings ts where ts.tenant_id = v_tenant;
  return query
  select rc.request_id, count(*)::integer
  from public.purchase_request_receipts rc
  where rc.tenant_id = v_tenant and rc.is_manual_link
    and exists (select 1 from public.purchase_request_deliveries d
      where d.request_id = rc.request_id and (d.created_at at time zone coalesce(v_tz, 'UTC'))::date = v_day)
  group by rc.request_id;
end;
$$;
revoke execute on function public.auto_order_manual_links(date) from public, anon;
grant execute on function public.auto_order_manual_links(date) to authenticated;
