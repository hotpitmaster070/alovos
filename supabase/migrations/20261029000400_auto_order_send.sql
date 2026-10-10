-- Auto-order, hybrid: the system drafts, the chef may step in, the deadline sends.
-- * auto_order_draft_time (15:00): drafts per supplier (run_due_auto_orders(), as before but at this time).
-- * The chef reviews and adds extras; "send" delivers at once (log trigger 'chef').
-- * auto_order_time (18:00) is the deadline: with auto_send_if_not_confirmed, today's drafts still open are
--   sent by the system (claim_due_auto_order_sends() + finish_auto_order_send(), trigger 'auto'). Nobody is
--   notified at the deadline; the owner reads auto_order_send_log() on the dashboard the next morning.
-- * Delivery (WhatsApp Cloud API / Resend) happens in the app (/api/cron/auto-order); the database only
--   claims, logs and reverts what could not be delivered back to draft.
-- * Amounts in two phases: estimated_amount at sending (latest purchase prices), actual_amount once the
--   goods are received (the receipt movements' invoice prices, matched by trigger to the sent request).
-- * The alovos-auto-order job (20261029000300) now runs auto_order_tick(): drafts in the database, then a
--   call to the app's cron route through pg_net when the Vault holds alovos_app_url and alovos_cron_secret.
--   Without them it only drafts, as before. No other job is touched.
-- Run after 20261029000300_auto_order_cron_only.sql. Idempotent.

do $$
begin
  if to_regprocedure('public.run_due_auto_orders()') is null
     or to_regprocedure('public.auto_order_drafts_for(uuid, uuid, uuid, timestamptz)') is null
     or to_regprocedure('public.product_last_purchase_price(uuid)') is null
     or to_regprocedure('public.can_see_costs()') is null then
    raise exception 'Run the migrations up to 20261029000300_auto_order_cron_only.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists auto_order_draft_time time not null default '15:00';
alter table public.tenant_settings add column if not exists auto_send_if_not_confirmed boolean not null default true;
alter table public.tenant_settings add column if not exists auto_order_last_send date;
alter table public.tenant_settings alter column auto_order_time set default '18:00';
-- Nobody had auto-order on with the old meaning (morning drafts); off restaurants take the new deadline.
update public.tenant_settings set auto_order_time = '18:00' where not auto_order_enabled and auto_order_time = '06:00';
update public.tenant_settings
set auto_order_draft_time = case when auto_order_time >= '03:00' then auto_order_time - interval '3 hours' else '00:00' end
where auto_order_draft_time > auto_order_time;
alter table public.tenant_settings drop constraint if exists tenant_settings_auto_order_times_check;
alter table public.tenant_settings
  add constraint tenant_settings_auto_order_times_check check (auto_order_draft_time <= auto_order_time);
grant update (auto_order_draft_time, auto_send_if_not_confirmed) on public.tenant_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Delivery log
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_request_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  trigger text not null,
  channel text not null,
  status text not null,
  provider_message_id text,
  error text,
  -- Phase 1, at sending: the request at the latest purchase prices, in the restaurant's currency.
  estimated_amount numeric(14,2) not null default 0,
  -- Phase 2, after receiving: what the receipts linked to the request cost (invoice prices); null until then.
  actual_amount numeric(14,2),
  created_at timestamptz not null default now(),
  constraint purchase_request_deliveries_trigger_check check (trigger in ('chef', 'auto')),
  constraint purchase_request_deliveries_channel_check check (channel in ('whatsapp', 'email', 'none')),
  constraint purchase_request_deliveries_status_check check (status in ('sent', 'failed', 'skipped')),
  constraint purchase_request_deliveries_error_check check (error is null or length(error) <= 500)
);
alter table public.purchase_request_deliveries add column if not exists estimated_amount numeric(14,2) not null default 0;
alter table public.purchase_request_deliveries add column if not exists actual_amount numeric(14,2);
create index if not exists idx_purchase_request_deliveries_tenant_created on public.purchase_request_deliveries (tenant_id, created_at desc);
create index if not exists idx_purchase_request_deliveries_request on public.purchase_request_deliveries (request_id);
alter table public.purchase_request_deliveries enable row level security;
revoke all on public.purchase_request_deliveries from public, anon, authenticated;

-- Receipts (stock_movements 'prihod' with the invoice price) counted towards a sent request.
create table if not exists public.purchase_request_receipts (
  movement_id uuid primary key references public.stock_movements(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_request_receipts_request on public.purchase_request_receipts (request_id, product_id);
alter table public.purchase_request_receipts enable row level security;
revoke all on public.purchase_request_receipts from public, anon, authenticated;

-- The request at the latest purchase prices (else catalog cost) in the restaurant's currency.
create or replace function public.purchase_request_estimate(p_items jsonb)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum((x ->> 'qty')::numeric * coalesce(public.product_last_purchase_price((x ->> 'product_id')::uuid), 0)), 2), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
$$;
revoke execute on function public.purchase_request_estimate(jsonb) from public, anon, authenticated;

-- What the request's receipts cost; null while nothing has been received against it.
create or replace function public.purchase_request_actual(p_request_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(sum(amount), 2) from public.purchase_request_receipts where request_id = p_request_id
$$;
revoke execute on function public.purchase_request_actual(uuid) from public, anon, authenticated;

create or replace function public.log_delivery(
  p_request public.purchase_requests, p_trigger text, p_channel text, p_status text, p_provider_id text, p_error text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.purchase_request_deliveries (
    tenant_id, request_id, supplier_id, trigger, channel, status, provider_message_id, error, estimated_amount, actual_amount
  )
  values (p_request.tenant_id, p_request.id, p_request.supplier_id, p_trigger, coalesce(p_channel, 'none'), p_status,
    left(nullif(btrim(p_provider_id), ''), 200), left(nullif(btrim(p_error), ''), 500),
    public.purchase_request_estimate(p_request.items), public.purchase_request_actual(p_request.id));
$$;
revoke execute on function public.log_delivery(public.purchase_requests, text, text, text, text, text) from public, anon, authenticated;

-- A receipt with a price (receiving screen, invoice scan, manual receipt: all write a 'prihod' movement)
-- counts towards the latest sent request of the restaurant that ordered the product and has not had all
-- of it yet (branch matched when both are set); its deliveries get the new actual_amount. Receiving
-- never fails because of this: any error is only reported.
create or replace function public.match_receipt_to_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request uuid;
begin
  if new.movement_type is distinct from 'prihod' or new.cost_per_unit is null or new.quantity is null or new.quantity <= 0 then
    return null;
  end if;
  begin
    select pr.id into v_request
    from public.purchase_requests pr
    where pr.tenant_id = new.tenant_id
      and pr.status in ('sent', 'received')
      and pr.sent_at is not null
      and (pr.branch_id is null or new.branch_id is null or pr.branch_id = new.branch_id)
      and exists (select 1 from public.purchase_request_deliveries d where d.request_id = pr.id)
      and (select coalesce(sum((x ->> 'qty')::numeric), 0) from jsonb_array_elements(pr.items) x
           where (x ->> 'product_id')::uuid = new.product_id)
        > (select coalesce(sum(rc.qty), 0) from public.purchase_request_receipts rc
           where rc.request_id = pr.id and rc.product_id = new.product_id)
    order by pr.sent_at desc, pr.id
    limit 1
    for update of pr;
    if v_request is null then
      return null;
    end if;
    insert into public.purchase_request_receipts (movement_id, tenant_id, request_id, product_id, qty, amount)
    values (new.id, new.tenant_id, v_request, new.product_id, new.quantity, round(new.quantity * new.cost_per_unit, 2))
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
drop trigger if exists trg_match_receipt_to_request on public.stock_movements;
create trigger trg_match_receipt_to_request
  after insert on public.stock_movements
  for each row execute function public.match_receipt_to_request();

-- The chef sent a request (send_purchase_request) and the app tried to deliver it.
create or replace function public.log_purchase_request_delivery(p_request_id uuid, p_channel text, p_status text, p_provider_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_request public.purchase_requests;
begin
  select * into v_request from public.purchase_requests where id = p_request_id and tenant_id = v_tenant;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'sent' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform public.log_delivery(v_request, 'chef', p_channel, p_status, p_provider_id, p_error);
end;
$$;
revoke execute on function public.log_purchase_request_delivery(uuid, text, text, text, text) from public, anon;
grant execute on function public.log_purchase_request_delivery(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Drafting at auto_order_draft_time
-- ---------------------------------------------------------------------------
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
    select ts.tenant_id as tid, ts.auto_order_draft_time, ts.auto_order_notify,
      now() at time zone coalesce(nullif(btrim(ts.timezone), ''), 'UTC') as local_now
    from public.tenant_settings ts
    where ts.auto_order_enabled
  loop
    v_today := s.local_now::date;
    continue when s.local_now::time < s.auto_order_draft_time;
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

-- ---------------------------------------------------------------------------
-- 4. Sending at the deadline
-- ---------------------------------------------------------------------------
-- Restaurants with auto-send and a message channel (auto_order_notify 'whatsapp' or 'email'; 'system' means
-- the chef sends) whose local time reached auto_order_time and that have not sent today: their
-- drafts of today still open are marked sent (the chef can no longer send them twice) and returned with
-- what the app needs to deliver them. finish_auto_order_send() logs each and puts undelivered ones back.
create or replace function public.claim_due_auto_order_sends()
returns table (
  tenant_id uuid,
  request_id uuid,
  restaurant text,
  language text,
  channel text,
  supplier_name text,
  supplier_phone text,
  supplier_email text,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  s record;
  r record;
  v_today date;
begin
  for s in
    select ts.tenant_id as tid, ts.auto_order_time, ts.auto_order_notify, ts.language as lang, t.name as tname,
      now() at time zone coalesce(nullif(btrim(ts.timezone), ''), 'UTC') as local_now
    from public.tenant_settings ts
    join public.tenants t on t.id = ts.tenant_id
    where ts.auto_order_enabled and ts.auto_send_if_not_confirmed and ts.auto_order_notify <> 'system'
  loop
    v_today := s.local_now::date;
    continue when s.local_now::time < s.auto_order_time;
    update public.tenant_settings ts set auto_order_last_send = v_today
    where ts.tenant_id = s.tid and (ts.auto_order_last_send is null or ts.auto_order_last_send < v_today);
    continue when not found;

    for r in
      update public.purchase_requests pr
      set status = 'sent', sent_at = now(), sent_by = null
      where pr.tenant_id = s.tid and pr.status = 'draft' and pr.request_date = v_today
        and jsonb_array_length(pr.items) > 0
      returning pr.id, pr.supplier_id, pr.items
    loop
      tenant_id := s.tid;
      request_id := r.id;
      restaurant := s.tname;
      language := s.lang;
      channel := s.auto_order_notify;
      select sp.name, sp.phone, sp.email into supplier_name, supplier_phone, supplier_email
      from public.suppliers sp where sp.id = r.supplier_id;
      select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', p.id, 'name', p.name, 'qty', (x.e ->> 'qty')::numeric, 'unit', coalesce(x.e ->> 'unit', p.unit),
          'extra', coalesce((x.e ->> 'extra')::boolean, false))
          order by x.ord), '[]'::jsonb)
      into items
      from jsonb_array_elements(r.items) with ordinality as x(e, ord)
      join public.products p on p.id = (x.e ->> 'product_id')::uuid;
      return next;
    end loop;
  end loop;
end;
$$;
revoke execute on function public.claim_due_auto_order_sends() from public, anon, authenticated;
grant execute on function public.claim_due_auto_order_sends() to service_role;

-- Logs the outcome of a claimed request; anything not delivered goes back to draft for the chef.
create or replace function public.finish_auto_order_send(p_request_id uuid, p_channel text, p_status text, p_provider_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.purchase_requests;
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_request from public.purchase_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  perform public.log_delivery(v_request, 'auto', p_channel, p_status, p_provider_id, p_error);
  if p_status <> 'sent' and v_request.status = 'sent' and v_request.sent_by is null then
    begin
      update public.purchase_requests set status = 'draft', sent_at = null where id = p_request_id;
    exception when unique_violation then
      null;
    end;
  end if;
end;
$$;
revoke execute on function public.finish_auto_order_send(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_auto_order_send(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. What went out on a day (the restaurant's day): for the owner's morning look
-- ---------------------------------------------------------------------------
-- estimated_amount: at the latest purchase prices when it was sent; actual_amount: its receipts at invoice
-- prices (null until received), lines_received of lines; amounts null for roles that do not see costs.
-- Currency and day boundaries are the restaurant's (tenant_settings).
create or replace function public.auto_order_send_log(p_day date default null)
returns table (
  request_id uuid,
  supplier_id uuid,
  supplier_name text,
  trigger text,
  channel text,
  status text,
  error text,
  sent_at timestamptz,
  lines integer,
  lines_received integer,
  estimated_amount numeric,
  actual_amount numeric,
  currency text
)
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
  v_costs boolean := public.can_see_costs();
begin
  select coalesce(nullif(btrim(ts.timezone), ''), 'UTC') into v_tz from public.tenant_settings ts where ts.tenant_id = v_tenant;
  return query
  select d.request_id, d.supplier_id, sp.name, d.trigger, d.channel, d.status, d.error, d.created_at,
    jsonb_array_length(pr.items),
    (select count(distinct rc.product_id)::integer from public.purchase_request_receipts rc where rc.request_id = d.request_id),
    case when v_costs then d.estimated_amount end,
    case when v_costs then d.actual_amount end,
    (select ts.currency from public.tenant_settings ts where ts.tenant_id = v_tenant)
  from public.purchase_request_deliveries d
  join public.purchase_requests pr on pr.id = d.request_id
  left join public.suppliers sp on sp.id = d.supplier_id
  where d.tenant_id = v_tenant and (d.created_at at time zone coalesce(v_tz, 'UTC'))::date = v_day
  order by d.created_at, d.id;
end;
$$;
revoke execute on function public.auto_order_send_log(date) from public, anon;
grant execute on function public.auto_order_send_log(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. One job: draft in the database, then let the app send
-- ---------------------------------------------------------------------------
-- The app's /api/cron/auto-order is called through pg_net only when the Vault holds alovos_app_url and
-- alovos_cron_secret (Supabase: Project Settings -> Vault). Without them, or without pg_net, it only drafts.
create or replace function public.auto_order_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  perform public.run_due_auto_orders();
  if to_regclass('vault.decrypted_secrets') is null or to_regprocedure('net.http_get(text, jsonb, jsonb, integer)') is null then
    return;
  end if;
  execute $q$select max(decrypted_secret) filter (where name = 'alovos_app_url'),
      max(decrypted_secret) filter (where name = 'alovos_cron_secret')
    from vault.decrypted_secrets where name in ('alovos_app_url', 'alovos_cron_secret')$q$
  into v_url, v_secret;
  if nullif(btrim(v_url), '') is null or nullif(btrim(v_secret), '') is null then
    return;
  end if;
  execute 'select net.http_get(url := $1, params := ''{}''::jsonb, headers := $2, timeout_milliseconds := 60000)'
  using rtrim(btrim(v_url), '/') || '/api/cron/auto-order', jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secret));
end;
$$;
revoke execute on function public.auto_order_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('alovos-auto-order', '*/15 * * * *', 'select public.auto_order_tick()')$cron$;
  end if;
end;
$$;
