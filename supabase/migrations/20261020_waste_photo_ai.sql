-- Waste photos for every plan, AI photo checks as a paid add-on, and the plans themselves.
--   * tenant_settings: waste_photo_enabled, waste_ai_* (plan, free / included checks per month, used,
--     the month they count for, tolerance). Plan and limits change only through billing functions.
--   * wastage_logs: photo_storage_path, ai_status (not_checked / pending / approved / suspicious /
--     limit_reached), confidence, analysis, owner review. Clients never write these columns.
--   * billing_plans (prices live here, readable by anyone) and billing_requests (an owner asks for a
--     plan; the platform activates it with service_role after payment).
--   * The AI check is reserved and recorded only by the server with service_role, so a member can
--     neither approve their own waste nor spend the tenant's checks.
--   * Trim lots are numbered after their source lot: <source>-R.
-- Run after 20261019_final_world_scheme.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.create_wastage_with_movement(uuid, numeric, text, uuid, text)') is null
     or to_regprocedure('public.line_factor(jsonb, text)') is null
     or to_regprocedure('public.tenant_today(uuid)') is null then
    raise exception 'Run 20261019_final_world_scheme.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Plans and plan requests
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plans (
  code text primary key check (code ~ '^[a-z0-9_]{1,40}$'),
  kind text not null check (kind in ('base', 'addon')),
  price numeric not null check (price >= 0),
  currency text not null,
  period_days integer not null check (period_days > 0),
  trial_days integer not null default 0 check (trial_days >= 0),
  -- AI photo checks a month the plan gives (0: none).
  ai_photos integer not null default 0 check (ai_photos >= 0),
  sort integer not null default 0,
  is_active boolean not null default true
);
-- Starting prices; the platform edits rows here, re-runs keep its edits.
insert into public.billing_plans (code, kind, price, currency, period_days, trial_days, ai_photos, sort) values
  ('base', 'base', 79, 'AZN', 30, 14, 0, 0),
  ('waste_ai', 'addon', 19, 'AZN', 30, 0, 500, 10)
on conflict (code) do nothing;
alter table public.billing_plans enable row level security;
revoke all on table public.billing_plans from anon, authenticated;
grant select on table public.billing_plans to anon, authenticated;
drop policy if exists billing_plans_select on public.billing_plans;
create policy billing_plans_select on public.billing_plans for select to anon, authenticated using (is_active);

create table if not exists public.billing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null references public.billing_plans(code),
  status text not null default 'requested' check (status in ('requested', 'active', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
create unique index if not exists uniq_billing_request_open on public.billing_requests (tenant_id, plan_code) where status = 'requested';
alter table public.billing_requests enable row level security;
revoke all on table public.billing_requests from anon, authenticated;
grant select on table public.billing_requests to authenticated;
drop policy if exists billing_requests_select on public.billing_requests;
create policy billing_requests_select on public.billing_requests
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 2. Tenant settings: photos and the AI add-on
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists waste_photo_enabled boolean not null default true;
alter table public.tenant_settings add column if not exists waste_ai_enabled boolean not null default false;
alter table public.tenant_settings add column if not exists waste_ai_plan text not null default 'free';
alter table public.tenant_settings add column if not exists waste_ai_free_photos integer not null default 50;
alter table public.tenant_settings add column if not exists waste_ai_included_photos integer not null default 500;
alter table public.tenant_settings add column if not exists waste_ai_used_photos integer not null default 0;
alter table public.tenant_settings add column if not exists waste_ai_period_start date;
alter table public.tenant_settings add column if not exists waste_ai_tolerance_percent numeric not null default 50;
alter table public.tenant_settings drop constraint if exists tenant_settings_waste_ai_check;
alter table public.tenant_settings add constraint tenant_settings_waste_ai_check check (
  waste_ai_free_photos >= 0 and waste_ai_included_photos >= 0 and waste_ai_used_photos >= 0
  and waste_ai_tolerance_percent > 0 and waste_ai_tolerance_percent <= 1000
);
-- Billing columns: no client grants; owners change photos / AI on-off / tolerance through set_waste_photo_settings().
revoke update (waste_photo_enabled, waste_ai_enabled, waste_ai_plan, waste_ai_free_photos, waste_ai_included_photos,
  waste_ai_used_photos, waste_ai_period_start, waste_ai_tolerance_percent) on table public.tenant_settings from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Waste logs: photo and AI verdict
-- ---------------------------------------------------------------------------
alter table public.wastage_logs add column if not exists photo_storage_path text
  generated always as (case when photo_url is null or photo_url ~ '^https?://' then null else photo_url end) stored;
alter table public.wastage_logs add column if not exists ai_status text;
alter table public.wastage_logs add column if not exists ai_confidence numeric;
alter table public.wastage_logs add column if not exists ai_analysis jsonb;
alter table public.wastage_logs add column if not exists requires_owner_review boolean not null default false;
alter table public.wastage_logs add column if not exists ai_checked_at timestamptz;
alter table public.wastage_logs add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.wastage_logs add column if not exists reviewed_at timestamptz;
alter table public.wastage_logs drop constraint if exists wastage_logs_ai_status_check;
alter table public.wastage_logs add constraint wastage_logs_ai_status_check check (
  ai_status is null or ai_status in ('pending', 'approved', 'suspicious', 'not_checked', 'limit_reached')
);
alter table public.wastage_logs drop constraint if exists wastage_logs_ai_confidence_check;
alter table public.wastage_logs add constraint wastage_logs_ai_confidence_check check (ai_confidence is null or ai_confidence between 0 and 100);
update public.wastage_logs set ai_status = 'not_checked' where photo_url is not null and ai_status is null;
create index if not exists idx_wastage_logs_review on public.wastage_logs (tenant_id) where requires_owner_review;

-- A log with a photo starts unchecked; whatever a caller passes, the verdict is not theirs to set.
create or replace function public.wastage_ai_defaults()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.ai_status := case when new.photo_url is not null then 'not_checked' end;
  new.ai_confidence := null;
  new.ai_analysis := null;
  new.ai_checked_at := null;
  new.requires_owner_review := false;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;
revoke execute on function public.wastage_ai_defaults() from public, anon, authenticated;
drop trigger if exists trg_wastage_ai_defaults on public.wastage_logs;
create trigger trg_wastage_ai_defaults before insert on public.wastage_logs
  for each row execute function public.wastage_ai_defaults();

grant select (photo_storage_path, ai_status, ai_confidence, ai_analysis, requires_owner_review, ai_checked_at, reviewed_by, reviewed_at)
  on table public.wastage_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 4. AI state, owner switches, plan requests
-- ---------------------------------------------------------------------------
-- Checks a month: the paid plan's included checks, else the free ones.
create or replace function public.waste_ai_limit(p_settings public.tenant_settings)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when p_settings.waste_ai_plan = 'free' then p_settings.waste_ai_free_photos else p_settings.waste_ai_included_photos end
$$;

-- Checks used this month (a new month starts at zero).
create or replace function public.waste_ai_used(p_settings public.tenant_settings)
returns integer
language sql
stable
set search_path = public
as $$
  select case
    when p_settings.waste_ai_period_start is not distinct from date_trunc('month', public.tenant_today(p_settings.tenant_id))::date
      then p_settings.waste_ai_used_photos
    else 0
  end
$$;

create or replace function public.waste_ai_state()
returns table (
  photo_enabled boolean, ai_enabled boolean, plan text, used integer, ai_limit integer,
  free_photos integer, included_photos integer, tolerance_percent numeric, photos_this_month integer,
  requested_plan text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_settings public.tenant_settings;
  v_month date;
begin
  select * into v_settings from public.tenant_settings where tenant_id = v_tenant;
  v_month := date_trunc('month', public.tenant_today(v_tenant))::date;
  return query select
    v_settings.waste_photo_enabled, v_settings.waste_ai_enabled, v_settings.waste_ai_plan,
    public.waste_ai_used(v_settings), public.waste_ai_limit(v_settings),
    v_settings.waste_ai_free_photos, v_settings.waste_ai_included_photos, v_settings.waste_ai_tolerance_percent,
    (select count(*)::integer from public.wastage_logs w
     where w.tenant_id = v_tenant and w.photo_url is not null
       and (w.created_at at time zone v_settings.timezone)::date >= v_month),
    (select r.plan_code from public.billing_requests r where r.tenant_id = v_tenant and r.status = 'requested'
     order by r.created_at desc limit 1);
end;
$$;

-- Owner: photos on/off, AI checks on/off (within the plan's limit), suspicious threshold. Null keeps a value.
create or replace function public.set_waste_photo_settings(p_photo_enabled boolean, p_ai_enabled boolean, p_tolerance_percent numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  if public.current_member_role() is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tolerance_percent is not null and (p_tolerance_percent <= 0 or p_tolerance_percent > 1000) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.tenant_settings
  set waste_photo_enabled = coalesce(p_photo_enabled, waste_photo_enabled),
      waste_ai_enabled = coalesce(p_ai_enabled, waste_ai_enabled),
      waste_ai_tolerance_percent = coalesce(p_tolerance_percent, waste_ai_tolerance_percent)
  where tenant_id = v_tenant;
end;
$$;

-- Owner asks for a plan; one open request per plan (the open one is returned again).
create or replace function public.request_billing_plan(p_plan_code text)
returns public.billing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_request public.billing_requests;
begin
  if public.current_member_role() is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.billing_plans where code = p_plan_code and is_active) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_request from public.billing_requests
  where tenant_id = v_tenant and plan_code = p_plan_code and status = 'requested';
  if found then
    return v_request;
  end if;
  insert into public.billing_requests (tenant_id, plan_code) values (v_tenant, p_plan_code) returning * into v_request;
  return v_request;
end;
$$;

-- Platform (service_role) after payment: an AI plan switches the checks on with its monthly amount.
create or replace function public.activate_billing_request(p_request_id uuid)
returns public.billing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.billing_requests;
  v_plan public.billing_plans;
begin
  update public.billing_requests set status = 'active', activated_at = now()
  where id = p_request_id and status = 'requested'
  returning * into v_request;
  if not found then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_plan from public.billing_plans where code = v_request.plan_code;
  if v_plan.ai_photos > 0 then
    update public.tenant_settings
    set waste_ai_enabled = true, waste_ai_plan = v_plan.code, waste_ai_included_photos = v_plan.ai_photos
    where tenant_id = v_request.tenant_id;
  end if;
  return v_request;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The AI check (server with service_role only)
-- ---------------------------------------------------------------------------
-- Takes one check of the month for a photo log: pending (counted), not_checked (AI off) or limit_reached.
-- Returns what the prompt needs; logged_kg null when the amount does not convert to kg.
create or replace function public.waste_ai_reserve(p_tenant_id uuid, p_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.wastage_logs;
  v_settings public.tenant_settings;
  v_month date;
  v_used integer;
  v_status text;
  v_factor numeric;
begin
  select * into v_log from public.wastage_logs where id = p_log_id and tenant_id = p_tenant_id for update;
  if not found or v_log.photo_url is null or v_log.ai_status is distinct from 'not_checked' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_settings from public.tenant_settings where tenant_id = p_tenant_id for update;
  v_month := date_trunc('month', public.tenant_today(p_tenant_id))::date;
  v_used := public.waste_ai_used(v_settings);
  if not v_settings.waste_ai_enabled then
    v_status := 'not_checked';
  elsif v_used >= public.waste_ai_limit(v_settings) then
    v_status := 'limit_reached';
  else
    v_status := 'pending';
    v_used := v_used + 1;
  end if;
  update public.tenant_settings set waste_ai_used_photos = v_used, waste_ai_period_start = v_month where tenant_id = p_tenant_id;
  update public.wastage_logs set ai_status = v_status where id = p_log_id;
  v_factor := public.line_factor(jsonb_build_object('product_id', v_log.product_id), 'kg');
  return jsonb_build_object(
    'status', v_status,
    'photo_path', v_log.photo_storage_path,
    'product_name', (select name from public.products where id = v_log.product_id),
    'quantity', v_log.quantity,
    'unit', (select unit from public.products where id = v_log.product_id),
    'logged_kg', case when v_factor is not null then v_log.quantity * v_factor end,
    'reason', v_log.reason,
    'tolerance_percent', v_settings.waste_ai_tolerance_percent
  );
end;
$$;

-- The verdict of a pending check. not_checked (the AI failed) gives the check back.
create or replace function public.waste_ai_record(
  p_tenant_id uuid, p_log_id uuid, p_status text, p_confidence numeric, p_analysis jsonb
)
returns public.wastage_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.wastage_logs;
begin
  if p_status is null or p_status not in ('approved', 'suspicious', 'not_checked')
     or (p_confidence is not null and (p_confidence < 0 or p_confidence > 100)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.wastage_logs
  set ai_status = p_status,
      ai_confidence = case when p_status = 'not_checked' then null else p_confidence end,
      ai_analysis = p_analysis,
      ai_checked_at = case when p_status = 'not_checked' then null else now() end,
      requires_owner_review = p_status = 'suspicious'
  where id = p_log_id and tenant_id = p_tenant_id and ai_status = 'pending'
  returning * into v_log;
  if not found then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_status = 'not_checked' then
    update public.tenant_settings set waste_ai_used_photos = greatest(waste_ai_used_photos - 1, 0) where tenant_id = p_tenant_id;
  end if;
  return v_log;
end;
$$;

-- Owner or chef looked at a suspicious log.
create or replace function public.review_waste_photo(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  update public.wastage_logs set requires_owner_review = false, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_log_id and tenant_id = v_tenant and requires_owner_review;
  if not found then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
end;
$$;

-- Today's waste logs: with a photo, approved, suspicious, waiting for review (owners and chefs).
create or replace function public.waste_photo_summary()
returns table (logs integer, with_photo integer, approved integer, suspicious integer, needs_review integer, limit_reached integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_today date := public.tenant_today(v_tenant);
  v_zone text;
begin
  select s.timezone into v_zone from public.tenant_settings s where s.tenant_id = v_tenant;
  return query
  select count(*)::integer,
    (count(*) filter (where w.photo_url is not null))::integer,
    (count(*) filter (where w.ai_status = 'approved'))::integer,
    (count(*) filter (where w.ai_status = 'suspicious'))::integer,
    (count(*) filter (where w.requires_owner_review))::integer,
    (count(*) filter (where w.ai_status = 'limit_reached'))::integer
  from public.wastage_logs w
  where w.tenant_id = v_tenant and (w.created_at at time zone v_zone)::date = v_today;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Trim lots carry their source lot's number: NIZ-SOY1-0910-001 -> NIZ-SOY1-0910-001-R (-R2 when taken)
-- ---------------------------------------------------------------------------
create or replace function public.trim_lot_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent text;
  v_number text;
  v_n integer := 1;
begin
  if new.lot_type is distinct from 'trim' or new.parent_lot_id is null then
    return new;
  end if;
  select lot_number into v_parent from public.product_lots where id = new.parent_lot_id and tenant_id = new.tenant_id;
  if v_parent is null then
    return new;
  end if;
  -- insert_product_lot() holds the branch/day lock, so the free suffix cannot be taken meanwhile.
  v_number := v_parent || '-R';
  while exists (
    select 1 from public.product_lots
    where tenant_id = new.tenant_id and numbered_on = new.numbered_on and lot_number = v_number
  ) loop
    v_n := v_n + 1;
    v_number := v_parent || '-R' || v_n;
  end loop;
  new.lot_number := v_number;
  return new;
end;
$$;
revoke execute on function public.trim_lot_number() from public, anon, authenticated;
drop trigger if exists trg_trim_lot_number on public.product_lots;
create trigger trg_trim_lot_number before insert on public.product_lots
  for each row execute function public.trim_lot_number();

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.waste_ai_limit(public.tenant_settings) from public, anon, authenticated;
revoke execute on function public.waste_ai_used(public.tenant_settings) from public, anon, authenticated;
revoke execute on function public.waste_ai_state() from public, anon;
grant execute on function public.waste_ai_state() to authenticated;
revoke execute on function public.set_waste_photo_settings(boolean, boolean, numeric) from public, anon;
grant execute on function public.set_waste_photo_settings(boolean, boolean, numeric) to authenticated;
revoke execute on function public.request_billing_plan(text) from public, anon;
grant execute on function public.request_billing_plan(text) to authenticated;
revoke execute on function public.review_waste_photo(uuid) from public, anon;
grant execute on function public.review_waste_photo(uuid) to authenticated;
revoke execute on function public.waste_photo_summary() from public, anon;
grant execute on function public.waste_photo_summary() to authenticated;
revoke execute on function public.activate_billing_request(uuid) from public, anon, authenticated;
revoke execute on function public.waste_ai_reserve(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.waste_ai_record(uuid, uuid, text, numeric, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.activate_billing_request(uuid) to service_role;
    grant execute on function public.waste_ai_reserve(uuid, uuid) to service_role;
    grant execute on function public.waste_ai_record(uuid, uuid, text, numeric, jsonb) to service_role;
    grant select on table public.billing_plans to service_role;
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('authenticated', 'public.waste_ai_record(uuid, uuid, text, numeric, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.waste_ai_reserve(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.activate_billing_request(uuid)', 'execute')
     or has_column_privilege('authenticated', 'public.tenant_settings', 'waste_ai_used_photos', 'update')
     or has_table_privilege('authenticated', 'public.wastage_logs', 'update') then
    raise exception 'AI verdicts or billing writable by clients';
  end if;
end;
$$;

commit;
