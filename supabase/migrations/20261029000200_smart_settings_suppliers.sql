-- Smart settings and the auto-order grouped by supplier.
-- * Limits are inherited: the branch's par_levels.min_qty, else products.min_stock, else
--   tenant_settings.low_stock_default; 0 at any level = not tracked. effective_stock_limits() is the only
--   place that resolves it (settings table, grouped preview, drafts). Order up to par_levels.max_qty, else
--   products.par_level, never below the minimum.
-- * tenant_settings: auto_order_enabled / auto_order_time (the restaurant's local time) / auto_order_notify,
--   loss_alert_enabled (red rows of get_theoretical_vs_actual()); owners change them (RLS of 20261009).
-- * suppliers: phone and email for the order message.
-- * Drafts are the existing purchase_requests: one draft per supplier and day (auto_created), scheduled_for
--   = the run that made it. An extra line is an item with "extra": true inside items, so receiving and
--   "on order" keep reading one list.
-- * run_due_auto_orders(): once per restaurant and local day, at or after auto_order_time, drafts for
--   every branch and an 'auto_order_ready' notification. Called by /api/cron/auto-order (service role)
--   and by its own pg_cron job where pg_cron is installed. Existing cron jobs and their functions are
--   not changed.
-- Run after 20261029000100_theoretical_vs_actual.sql. Idempotent.

do $$
begin
  if to_regclass('public.par_levels') is null or to_regclass('public.purchase_requests') is null
     or to_regclass('public.suppliers') is null or to_regclass('public.notifications') is null
     or to_regprocedure('public.require_kitchen_lead()') is null
     or to_regprocedure('public.member_has_branch(uuid, uuid, uuid)') is null
     or to_regprocedure('public.stock_today(uuid)') is null
     or to_regprocedure('public.get_theoretical_vs_actual(uuid, date, date)') is null then
    raise exception 'Run the migrations up to 20261029000100_theoretical_vs_actual.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Suppliers: phone and email
-- ---------------------------------------------------------------------------
alter table public.suppliers add column if not exists phone text;
alter table public.suppliers add column if not exists email text;
update public.suppliers
set phone = regexp_replace(contact, '[\s().-]', '', 'g')
where phone is null and contact is not null and regexp_replace(contact, '[\s().-]', '', 'g') ~ '^\+?[0-9]{7,15}$';
alter table public.suppliers drop constraint if exists suppliers_phone_check;
alter table public.suppliers add constraint suppliers_phone_check check (phone is null or phone ~ '^\+?[0-9]{7,15}$');
alter table public.suppliers drop constraint if exists suppliers_email_check;
alter table public.suppliers add constraint suppliers_email_check check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant select (phone, email), insert (phone, email), update (phone, email) on public.suppliers to authenticated;

alter table public.products add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists auto_order_enabled boolean not null default false;
alter table public.tenant_settings add column if not exists auto_order_time time not null default '06:00';
alter table public.tenant_settings add column if not exists auto_order_notify text not null default 'system';
alter table public.tenant_settings add column if not exists auto_order_last_run date;
alter table public.tenant_settings add column if not exists loss_alert_enabled boolean not null default true;
alter table public.tenant_settings drop constraint if exists tenant_settings_auto_order_notify_check;
alter table public.tenant_settings
  add constraint tenant_settings_auto_order_notify_check check (auto_order_notify in ('system', 'whatsapp', 'email'));
grant update (low_stock_default, loss_alert_percent, loss_alert_enabled, auto_order_enabled, auto_order_time, auto_order_notify)
  on public.tenant_settings to authenticated;

alter table public.purchase_requests add column if not exists scheduled_for timestamptz;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('expiring_soon', 'auto_order_ready'));

-- ---------------------------------------------------------------------------
-- 3. Limits: branch -> product -> restaurant -> 0
-- ---------------------------------------------------------------------------
-- source: where the minimum comes from ('off' when nothing is set and the default is 0).
create or replace function public.effective_stock_limits(p_tenant_id uuid, p_branch_id uuid)
returns table (
  product_id uuid,
  branch_min numeric,
  product_min numeric,
  tenant_default numeric,
  min_qty numeric,
  target_qty numeric,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, pl.min_qty, p.min_stock, s.low_stock_default::numeric,
    coalesce(pl.min_qty, p.min_stock, s.low_stock_default, 0),
    greatest(coalesce(pl.max_qty, p.par_level, 0), coalesce(pl.min_qty, p.min_stock, s.low_stock_default, 0)),
    case
      when pl.min_qty is not null then 'branch'
      when p.min_stock is not null then 'product'
      when coalesce(s.low_stock_default, 0) > 0 then 'tenant'
      else 'off'
    end
  from public.products p
  left join public.tenant_settings s on s.tenant_id = p.tenant_id
  left join public.par_levels pl on pl.product_id = p.id and pl.branch_id = p_branch_id
  where p.tenant_id = p_tenant_id
$$;
revoke execute on function public.effective_stock_limits(uuid, uuid) from public, anon, authenticated;

-- Every product of the restaurant with its limits at a branch (null: no branch level) and its stock there.
create or replace function public.stock_limits(p_branch_id uuid default null)
returns table (
  product_id uuid,
  product_name text,
  unit text,
  category text,
  supplier_id uuid,
  quantity numeric,
  branch_min numeric,
  product_min numeric,
  tenant_default numeric,
  min_qty numeric,
  target_qty numeric,
  source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  if p_branch_id is not null
     and (not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
          or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id)) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.name, p.unit, p.category, p.supplier_id,
    coalesce((
      select round(sum(ps.quantity), 3) from public.product_stocks ps
      where ps.tenant_id = v_tenant and ps.product_id = p.id and (p_branch_id is null or ps.branch_id = p_branch_id)
    ), 0),
    l.branch_min, l.product_min, l.tenant_default, l.min_qty, l.target_qty, l.source
  from public.effective_stock_limits(v_tenant, p_branch_id) l
  join public.products p on p.id = l.product_id
  order by p.name, p.id;
end;
$$;
revoke execute on function public.stock_limits(uuid) from public, anon;
grant execute on function public.stock_limits(uuid) to authenticated;

-- p_items: [{product_id, min_stock?: number|null, branch_min?: number|null}], at most 1000. min_stock null
-- = use the restaurant default, branch_min null = no branch override; 0 = not tracked. One transaction.
create or replace function public.save_stock_limits(p_branch_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_item jsonb;
  v_product uuid;
  v_par numeric;
  v_max numeric;
  v_value numeric;
  v_count integer := 0;
begin
  if p_branch_id is not null
     and (not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
          or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id)) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 1000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_product := (v_item ->> 'product_id')::uuid;
    select p.par_level into v_par from public.products p where p.id = v_product and p.tenant_id = v_tenant;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;

    if v_item ? 'min_stock' then
      if jsonb_typeof(v_item -> 'min_stock') = 'null' then
        v_value := null;
      elsif jsonb_typeof(v_item -> 'min_stock') = 'number' and (v_item ->> 'min_stock')::numeric between 0 and 1000000 then
        v_value := (v_item ->> 'min_stock')::numeric;
      else
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      if v_value is not null and v_par is not null and v_value > v_par then
        raise exception 'min_above_par' using errcode = '22023';
      end if;
      update public.products set min_stock = v_value where id = v_product;
    end if;

    if v_item ? 'branch_min' then
      if p_branch_id is null then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      if jsonb_typeof(v_item -> 'branch_min') = 'null' then
        delete from public.par_levels where branch_id = p_branch_id and product_id = v_product;
      elsif jsonb_typeof(v_item -> 'branch_min') = 'number' and (v_item ->> 'branch_min')::numeric between 0 and 1000000 then
        v_value := (v_item ->> 'branch_min')::numeric;
        select pl.max_qty into v_max from public.par_levels pl where pl.branch_id = p_branch_id and pl.product_id = v_product;
        if v_max is not null and v_value > v_max then
          raise exception 'min_above_par' using errcode = '22023';
        end if;
        insert into public.par_levels (tenant_id, branch_id, product_id, min_qty)
        values (v_tenant, p_branch_id, v_product, v_value)
        on conflict (branch_id, product_id) do update set min_qty = excluded.min_qty;
      else
        raise exception 'invalid_input' using errcode = '22023';
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.save_stock_limits(uuid, jsonb) from public, anon;
grant execute on function public.save_stock_limits(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What to order at a branch, by supplier
-- ---------------------------------------------------------------------------
-- Products of the branch (a par_levels row, stock there or the branch as home) below their minimum;
-- need = order-up-to - stock - already ordered (sent requests of the branch). An inactive supplier
-- counts as none.
create or replace function public.auto_order_lines(p_tenant_id uuid, p_branch_id uuid)
returns table (
  supplier_id uuid,
  supplier_name text,
  supplier_phone text,
  supplier_email text,
  product_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  min_qty numeric,
  target_qty numeric,
  on_order numeric,
  need numeric,
  source text
)
language sql
stable
security definer
set search_path = public
as $$
  with here as (
    select pl.product_id from public.par_levels pl where pl.tenant_id = p_tenant_id and pl.branch_id = p_branch_id
    union
    select ps.product_id from public.product_stocks ps where ps.tenant_id = p_tenant_id and ps.branch_id = p_branch_id
    union
    select p.id from public.products p where p.tenant_id = p_tenant_id and p.branch_id = p_branch_id
  ),
  stock as (
    select ps.product_id, sum(ps.quantity) as qty
    from public.product_stocks ps
    where ps.tenant_id = p_tenant_id and ps.branch_id = p_branch_id
    group by ps.product_id
  ),
  ordered as (
    select (x ->> 'product_id')::uuid as product_id, sum((x ->> 'qty')::numeric) as qty
    from public.purchase_requests pr
    cross join lateral jsonb_array_elements(pr.items) x
    where pr.tenant_id = p_tenant_id and pr.status = 'sent' and coalesce(pr.branch_id, p_branch_id) = p_branch_id
    group by 1
  ),
  lines as (
    select l.product_id, l.min_qty, l.target_qty, l.source, p.name, p.unit, p.supplier_id as sup,
      coalesce(st.qty, 0) as qty, coalesce(o.qty, 0) as oo
    from here h
    join public.effective_stock_limits(p_tenant_id, p_branch_id) l on l.product_id = h.product_id
    join public.products p on p.id = h.product_id
    left join stock st on st.product_id = h.product_id
    left join ordered o on o.product_id = h.product_id
  )
  select s.id, s.name, s.phone, s.email, x.product_id, x.name, x.unit, round(x.qty, 3), x.min_qty, x.target_qty,
    round(x.oo, 3), round(x.target_qty - greatest(x.qty, 0) - x.oo, 3), x.source
  from lines x
  left join public.suppliers s on s.id = x.sup and s.is_active
  where x.min_qty > 0 and x.qty < x.min_qty and x.target_qty - greatest(x.qty, 0) - x.oo > 0
$$;
revoke execute on function public.auto_order_lines(uuid, uuid) from public, anon, authenticated;

-- [{supplier_id, name, phone, email, items: [{product_id, name, unit, quantity, min_qty, target_qty,
-- on_order, need, source}]}]: suppliers by name, products without a supplier last (supplier_id null).
create or replace function public.get_auto_order_items_grouped(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_result jsonb;
begin
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', g.supplier_id, 'name', g.supplier_name, 'phone', g.supplier_phone, 'email', g.supplier_email, 'items', g.items)
      order by g.supplier_id is null, g.supplier_name, g.supplier_id), '[]'::jsonb)
  into v_result
  from (
    select a.supplier_id, a.supplier_name, a.supplier_phone, a.supplier_email,
      jsonb_agg(jsonb_build_object(
        'product_id', a.product_id, 'name', a.product_name, 'unit', a.unit, 'quantity', a.quantity, 'min_qty', a.min_qty,
        'target_qty', a.target_qty, 'on_order', a.on_order, 'need', a.need, 'source', a.source)
        order by a.product_name, a.product_id) as items
    from public.auto_order_lines(v_tenant, p_branch_id) a
    group by a.supplier_id, a.supplier_name, a.supplier_phone, a.supplier_email
  ) g;
  return v_result;
end;
$$;
revoke execute on function public.get_auto_order_items_grouped(uuid) from public, anon;
grant execute on function public.get_auto_order_items_grouped(uuid) to authenticated;

-- Today's draft per supplier (the restaurant's day): new products are added, lines already there (and
-- extras) stay. Products without a supplier get no draft. Returns the suppliers with a draft for these lines.
create or replace function public.auto_order_drafts_for(p_tenant_id uuid, p_branch_id uuid, p_user_id uuid, p_scheduled_for timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.stock_today(p_tenant_id);
  v_total integer := 0;
  r record;
begin
  for r in
    select a.supplier_id,
      jsonb_agg(jsonb_build_object('product_id', a.product_id, 'qty', a.need, 'unit', a.unit) order by a.product_name, a.product_id) as items
    from public.auto_order_lines(p_tenant_id, p_branch_id) a
    where a.supplier_id is not null
    group by a.supplier_id
  loop
    insert into public.purchase_requests as pr (tenant_id, branch_id, supplier_id, status, items, auto_created, created_by, request_date, scheduled_for)
    values (p_tenant_id, p_branch_id, r.supplier_id, 'draft', r.items, true, p_user_id, v_today, p_scheduled_for)
    on conflict (supplier_id, request_date) where status = 'draft'
    do update set
      items = pr.items || coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements(excluded.items) e
        where not exists (select 1 from jsonb_array_elements(pr.items) x where x ->> 'product_id' = e ->> 'product_id')
      ), '[]'::jsonb),
      scheduled_for = coalesce(excluded.scheduled_for, pr.scheduled_for);
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;
revoke execute on function public.auto_order_drafts_for(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.create_auto_order_drafts(p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return public.auto_order_drafts_for(v_tenant, p_branch_id, auth.uid(), now());
end;
$$;
revoke execute on function public.create_auto_order_drafts(uuid) from public, anon;
grant execute on function public.create_auto_order_drafts(uuid) to authenticated;

-- An extra line on a draft: a product already there gets the quantity added, a new one is marked extra.
create or replace function public.add_purchase_request_extra(p_request_id uuid, p_product_id uuid, p_qty numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_request public.purchase_requests;
  v_unit text;
  v_items jsonb;
begin
  select * into v_request from public.purchase_requests where id = p_request_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select p.unit into v_unit from public.products p where p.id = p_product_id and p.tenant_id = v_tenant;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from jsonb_array_elements(v_request.items) x where x ->> 'product_id' = p_product_id::text) then
    select jsonb_agg(
      case when t.x ->> 'product_id' = p_product_id::text
        then jsonb_set(t.x, '{qty}', to_jsonb(round((t.x ->> 'qty')::numeric + p_qty, 3)))
        else t.x end
      order by t.ord)
    into v_items
    from jsonb_array_elements(v_request.items) with ordinality as t(x, ord);
  else
    v_items := v_request.items || jsonb_build_array(
      jsonb_build_object('product_id', p_product_id, 'qty', round(p_qty, 3), 'unit', v_unit, 'extra', true));
  end if;
  update public.purchase_requests set items = v_items where id = p_request_id;
  return v_items;
end;
$$;
revoke execute on function public.add_purchase_request_extra(uuid, uuid, numeric) from public, anon;
grant execute on function public.add_purchase_request_extra(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The scheduled run
-- ---------------------------------------------------------------------------
-- Restaurants with auto_order_enabled whose local time has reached auto_order_time and that have not run
-- today (their day): drafts per branch and one notification per branch with drafts. One row per branch
-- with drafts (notify = the restaurant's channel, for the caller to deliver).
create or replace function public.run_due_auto_orders()
returns table (tenant_id uuid, branch_id uuid, drafts integer, notify text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s record;
  b record;
  v_today date;
  v_drafts integer;
begin
  for s in
    select ts.tenant_id as tid, ts.auto_order_time, ts.auto_order_notify,
      now() at time zone coalesce(nullif(btrim(ts.timezone), ''), 'UTC') as local_now
    from public.tenant_settings ts
    where ts.auto_order_enabled
  loop
    v_today := s.local_now::date;
    continue when s.local_now::time < s.auto_order_time;
    update public.tenant_settings ts set auto_order_last_run = v_today
    where ts.tenant_id = s.tid and (ts.auto_order_last_run is null or ts.auto_order_last_run < v_today);
    continue when not found;

    for b in select br.id from public.branches br where br.tenant_id = s.tid order by br.id
    loop
      v_drafts := public.auto_order_drafts_for(s.tid, b.id, null, now());
      continue when v_drafts = 0;
      insert into public.notifications (tenant_id, branch_id, type, notify_date, payload)
      values (s.tid, b.id, 'auto_order_ready', v_today, jsonb_build_object('suppliers', v_drafts, 'notify', s.auto_order_notify))
      on conflict (tenant_id, branch_id, type, notify_date) do update set payload = excluded.payload, read_at = null, read_by = null;
      tenant_id := s.tid;
      branch_id := b.id;
      drafts := v_drafts;
      notify := s.auto_order_notify;
      return next;
    end loop;
  end loop;
end;
$$;
revoke execute on function public.run_due_auto_orders() from public, anon, authenticated;
grant execute on function public.run_due_auto_orders() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('alovos-auto-order', '*/15 * * * *', 'select public.run_due_auto_orders()')$cron$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Loss report: red rows only while loss_alert_enabled
-- ---------------------------------------------------------------------------
-- As in 20261029000100_theoretical_vs_actual.sql; over_limit is false when the restaurant switched the alert off.
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
  v_enabled boolean;
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

  select s.timezone, s.currency, s.loss_alert_percent, s.loss_alert_enabled into v_tz, v_currency, v_limit, v_enabled
  from public.tenant_settings s where s.tenant_id = v_tenant;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_currency := coalesce(nullif(btrim(v_currency), ''), 'USD');
  v_limit := coalesce(v_limit, 10);
  v_enabled := coalesce(v_enabled, true);
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
    v_enabled and l.actual > l.theoretical and (l.theoretical = 0 or (l.actual - l.theoretical) / l.theoretical * 100 > v_limit)
  from lines l
  where l.theoretical <> 0 or l.actual <> 0
  order by round((l.actual - l.theoretical) * l.cost, 2) desc nulls last, l.actual - l.theoretical desc, l.name;
end;
$$;
revoke execute on function public.get_theoretical_vs_actual(uuid, date, date) from public, anon;
grant execute on function public.get_theoretical_vs_actual(uuid, date, date) to authenticated;
