-- Par level, supplier delivery days, stock forecast, automatic purchase requests, live stock value and
-- chef invitations.
-- * Limits are in the product's own unit (products.unit): par_level is new, min_stock is the existing
--   threshold (null -> tenant_settings.low_stock_default, 0 -> not tracked). Only owners and chefs set
--   par_level and supplier_id.
-- * suppliers (from restaurant_os) keeps its rows: the old integer delivery_days becomes lead_time_days,
--   delivery_days is now the weekdays the supplier delivers (0 = Sunday .. 6 = Saturday).
-- * Average daily usage is computed from stock_movements over tenant_settings.usage_window_days: stock
--   leaving through write-off, waste (every wastage log has its 'waste' movement, so waste is counted
--   once), tasks and count shortages, minus count surpluses. products.avg_daily_usage keeps the last
--   value the automatic check computed; the forecast always computes it live.
-- * Next delivery is the first delivery weekday after today (tenant time zone): an order placed today
--   arrives then. projected_stock = current - avg_daily_usage * days until that delivery.
-- * check_and_create_auto_requests(): one draft purchase request per supplier and day; a second run adds
--   only products that are not in that day's draft yet.
-- * Invitations: owners create a single-use link that expires after tenant_settings.invite_ttl_days.
-- Run after 20261015_storage_numbering.sql. Idempotent.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'storage_locations' and column_name = 'code'
  ) or to_regprocedure('public.product_last_purchase_price(uuid)') is null then
    raise exception 'Run 20261014_count_polish.sql and 20261015_storage_numbering.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists usage_window_days integer not null default 7,
  add column if not exists invite_ttl_days integer not null default 7;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_settings_usage_window_days_check') then
    alter table public.tenant_settings
      add constraint tenant_settings_usage_window_days_check check (usage_window_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_settings_invite_ttl_days_check') then
    alter table public.tenant_settings
      add constraint tenant_settings_invite_ttl_days_check check (invite_ttl_days between 1 and 365);
  end if;
end;
$$;
grant update (usage_window_days, invite_ttl_days) on table public.tenant_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Codes from names (shared by branches and suppliers)
-- ---------------------------------------------------------------------------
-- First p_length Latin letters/digits of the name, Azerbaijani and Russian letters transliterated.
create or replace function public.name_to_code(p_name text, p_length integer, p_fallback text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(left(regexp_replace(upper(translate(
      coalesce(p_name, ''),
      'əƏşŞçÇğĞıİöÖüÜабвгдеёжзийклмнопрстуфхцчшщыэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЫЭЮЯ',
      'EESSCCGGIIOOUUABVGDEEJZIYKLMNOPRSTUFXCCSSYEUYABVGDEEJZIYKLMNOPRSTUFXCCSSYEUY'
    )), '[^A-Z0-9]', '', 'g'), p_length), ''),
    p_fallback
  );
$$;

create or replace function public.suggest_branch_code(p_tenant_id uuid, p_name text, p_branch_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := public.name_to_code(p_name, 3, 'BR');
  v_code text := v_base;
  v_n integer := 1;
begin
  while exists (
    select 1 from public.branches
    where tenant_id = p_tenant_id and code = v_code and id is distinct from p_branch_id
  ) loop
    v_n := v_n + 1;
    v_code := v_base || v_n;
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.suggest_branch_code(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Suppliers
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'suppliers' and column_name = 'delivery_days' and data_type <> 'ARRAY'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'suppliers' and column_name = 'lead_time_days'
    ) then
      update public.suppliers set lead_time_days = coalesce(lead_time_days, delivery_days);
      alter table public.suppliers drop column delivery_days;
    else
      alter table public.suppliers rename column delivery_days to lead_time_days;
    end if;
  end if;
end;
$$;

alter table public.suppliers
  add column if not exists lead_time_days integer,
  add column if not exists contact text,
  add column if not exists delivery_days integer[] not null default '{}',
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists is_active boolean not null default true,
  add column if not exists code text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_delivery_days_check') then
    alter table public.suppliers
      add constraint suppliers_delivery_days_check check (delivery_days <@ array[0, 1, 2, 3, 4, 5, 6]);
  end if;
end;
$$;

create or replace function public.suggest_supplier_code(p_tenant_id uuid, p_name text, p_supplier_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := public.name_to_code(p_name, 3, 'SUP');
  v_code text := v_base;
  v_n integer := 1;
begin
  while exists (
    select 1 from public.suppliers
    where tenant_id = p_tenant_id and code = v_code and id is distinct from p_supplier_id
  ) loop
    v_n := v_n + 1;
    v_code := v_base || v_n;
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.suggest_supplier_code(uuid, text, uuid) from public, anon, authenticated;

-- Trimmed name, delivery days sorted without repeats, upper-case code (suggested when empty), branch of
-- the same tenant.
create or replace function public.supplier_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  new.delivery_days := coalesce(array(select distinct d from unnest(coalesce(new.delivery_days, '{}')) d order by d), '{}');
  new.code := nullif(upper(btrim(coalesce(new.code, ''))), '');
  if new.code is null then
    new.code := public.suggest_supplier_code(new.tenant_id, new.name, new.id);
  end if;
  if new.branch_id is not null
     and not exists (select 1 from public.branches where id = new.branch_id and tenant_id = new.tenant_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke execute on function public.supplier_defaults() from public, anon, authenticated;

do $$
declare
  s record;
begin
  for s in select id, tenant_id, name from public.suppliers where code is null order by created_at, id
  loop
    update public.suppliers set code = public.suggest_supplier_code(s.tenant_id, s.name, s.id) where id = s.id;
  end loop;
end;
$$;

drop trigger if exists trg_supplier_defaults on public.suppliers;
create trigger trg_supplier_defaults
  before insert or update of name, code, delivery_days, branch_id, tenant_id on public.suppliers
  for each row execute function public.supplier_defaults();

alter table public.suppliers alter column code set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_code_check') then
    alter table public.suppliers add constraint suppliers_code_check check (code ~ '^[A-Z0-9]{1,10}$');
  end if;
end;
$$;
create unique index if not exists uniq_supplier_code_per_tenant on public.suppliers (tenant_id, code);

-- Owners and chefs manage suppliers; every member reads them.
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'))
  with check (tenant_id = (select public.current_tenant_id()));
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('owner', 'chef'));

-- ---------------------------------------------------------------------------
-- 4. Product limits
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists par_level numeric,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists avg_daily_usage numeric not null default 0,
  add column if not exists avg_daily_usage_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_par_level_check') then
    alter table public.products add constraint products_par_level_check check (par_level is null or par_level > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_limits_order_check') then
    alter table public.products
      add constraint products_limits_order_check check (min_stock is null or par_level is null or min_stock <= par_level);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_avg_daily_usage_check') then
    alter table public.products add constraint products_avg_daily_usage_check check (avg_daily_usage >= 0);
  end if;
end;
$$;

-- products.cost is hidden by column grants, so new columns are granted one by one.
grant select (par_level, supplier_id, avg_daily_usage, avg_daily_usage_at) on table public.products to authenticated;
create index if not exists idx_products_supplier on public.products (supplier_id) where supplier_id is not null;

-- Clients: only owners and chefs change par_level / supplier_id; the usage snapshot is written by the
-- database only. Security definer functions run as their owner and pass. The trigger must stay
-- security invoker: current_user is the caller's role only then.
create or replace function public.product_limits_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.supplier_id is not null
     and not exists (select 1 from public.suppliers where id = new.supplier_id and tenant_id = new.tenant_id) then
    raise exception 'supplier_not_found' using errcode = 'P0002';
  end if;
  if current_user = 'authenticated' then
    if (tg_op = 'INSERT' and (new.par_level is not null or new.supplier_id is not null))
       or (tg_op = 'UPDATE' and (new.par_level is distinct from old.par_level or new.supplier_id is distinct from old.supplier_id)) then
      if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
    end if;
    if (tg_op = 'INSERT' and (new.avg_daily_usage <> 0 or new.avg_daily_usage_at is not null))
       or (tg_op = 'UPDATE' and (new.avg_daily_usage is distinct from old.avg_daily_usage
                                 or new.avg_daily_usage_at is distinct from old.avg_daily_usage_at)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.product_limits_guard() from public, anon, authenticated;

drop trigger if exists trg_product_limits_guard on public.products;
create trigger trg_product_limits_guard
  before insert or update of par_level, supplier_id, avg_daily_usage, avg_daily_usage_at, tenant_id on public.products
  for each row execute function public.product_limits_guard();

-- ---------------------------------------------------------------------------
-- 5. Purchase requests
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  supplier_id uuid not null references public.suppliers(id),
  status text not null default 'draft',
  items jsonb not null default '[]'::jsonb,
  auto_created boolean not null default false,
  request_date date not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  received_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  constraint purchase_requests_status_check check (status in ('draft', 'sent', 'received')),
  constraint purchase_requests_items_check check (jsonb_typeof(items) = 'array')
);
create unique index if not exists uniq_purchase_request_draft_per_supplier_day
  on public.purchase_requests (supplier_id, request_date) where status = 'draft';
create index if not exists idx_purchase_requests_tenant_status on public.purchase_requests (tenant_id, status, created_at desc);

alter table public.purchase_requests enable row level security;
revoke all on table public.purchase_requests from anon, authenticated;
grant select on table public.purchase_requests to authenticated;
drop policy if exists purchase_requests_select on public.purchase_requests;
create policy purchase_requests_select on public.purchase_requests
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 6. Invitations
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  role text not null,
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invitations_role_check check (role in ('chef', 'owner')),
  constraint invitations_phone_check check (phone ~ '^\+?[0-9]{7,15}$')
);
create unique index if not exists uniq_invitation_token on public.invitations (token);
create index if not exists idx_invitations_tenant on public.invitations (tenant_id, created_at desc);

alter table public.invitations enable row level security;
revoke all on table public.invitations from anon, authenticated;
grant select on table public.invitations to authenticated;
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'owner');

-- ---------------------------------------------------------------------------
-- 7. Forecast
-- ---------------------------------------------------------------------------
create index if not exists idx_stock_movements_product_created on public.stock_movements (product_id, created_at desc);

-- First delivery weekday strictly after p_from_date; null without delivery days.
create or replace function public.get_next_delivery_date(p_delivery_days integer[], p_from_date date)
returns date
language sql
immutable
set search_path = public
as $$
  select min(p_from_date + d)
  from generate_series(1, 7) as d
  where extract(dow from p_from_date + d)::integer = any (p_delivery_days);
$$;

-- Net stock that left over the tenant's usage window, per day; 0 without movements.
create or replace function public.calculate_avg_daily_usage(p_product_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((
    select greatest(coalesce(sum(
      case
        when m.from_location_id is not null and m.to_location_id is null then m.quantity
        when m.movement_type = 'count' and m.from_location_id is null and m.to_location_id is not null then -m.quantity
        else 0
      end), 0), 0) / s.usage_window_days
    from public.products p
    join public.tenant_settings s on s.tenant_id = p.tenant_id
    left join public.stock_movements m
      on m.product_id = p.id
      and m.movement_type in ('spisanie', 'waste', 'task', 'count')
      and m.created_at >= now() - make_interval(days => s.usage_window_days)
    where p.id = p_product_id
    group by s.usage_window_days
  ), 0);
$$;

-- One row per product of the tenant; a signed-in caller gets rows of their own tenant only (the
-- scheduler has no user and may read any). min_stock is the effective threshold (own, else the tenant
-- default; 0 = not tracked -> null). Status: critical (below min), order (below par or will run out
-- before the next delivery), ok, no_limits.
create or replace function public.product_forecast(p_tenant_id uuid)
returns table (
  product_id uuid,
  tenant_id uuid,
  branch_id uuid,
  name text,
  unit text,
  current_stock numeric,
  par_level numeric,
  min_stock numeric,
  supplier_id uuid,
  supplier_name text,
  delivery_days integer[],
  next_delivery_date date,
  days_until_delivery integer,
  avg_daily_usage numeric,
  projected_stock numeric,
  need_to_order numeric,
  on_order numeric,
  will_run_out boolean,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select ts.low_stock_default, (now() at time zone ts.timezone)::date as today
    from public.tenant_settings ts
    where ts.tenant_id = p_tenant_id
      and (auth.uid() is null or p_tenant_id = public.current_tenant_id())
  ),
  stock as (
    select ps.product_id, sum(ps.quantity) as qty
    from public.product_stocks ps
    where ps.tenant_id = p_tenant_id and ps.quantity > 0
    group by ps.product_id
  ),
  ordered as (
    select (x ->> 'product_id')::uuid as product_id, sum((x ->> 'qty')::numeric) as qty
    from public.purchase_requests pr
    cross join lateral jsonb_array_elements(pr.items) x
    where pr.tenant_id = p_tenant_id and pr.status = 'sent'
    group by 1
  ),
  base as (
    select p.id, p.tenant_id, p.branch_id, p.name, p.unit,
      coalesce(st.qty, 0) as cur,
      p.par_level as par,
      nullif(coalesce(p.min_stock, s.low_stock_default), 0) as min_level,
      sup.id as sup_id, sup.name as sup_name, sup.delivery_days as days_list,
      public.get_next_delivery_date(sup.delivery_days, s.today) as next_date,
      s.today,
      public.calculate_avg_daily_usage(p.id) as avg_usage,
      coalesce(o.qty, 0) as on_order
    from public.products p
    cross join settings s
    left join stock st on st.product_id = p.id
    left join ordered o on o.product_id = p.id
    left join public.suppliers sup on sup.id = p.supplier_id and sup.is_active
    where p.tenant_id = p_tenant_id
  ),
  projected as (
    select b.*,
      (b.next_date - b.today) as days_left,
      case when b.next_date is null then null else b.cur - b.avg_usage * (b.next_date - b.today) end as proj
    from base b
  )
  select id, tenant_id, branch_id, name, unit, cur, par, min_level, sup_id, sup_name, days_list, next_date,
    days_left, avg_usage, proj,
    case when par is null then null else greatest(par - greatest(coalesce(proj, cur), 0), 0) end,
    on_order,
    coalesce(proj < coalesce(min_level, 0), false),
    case
      when par is null and min_level is null then 'no_limits'
      when min_level is not null and cur < min_level then 'critical'
      when (par is not null and cur < par) or coalesce(proj < coalesce(min_level, 0), false) then 'order'
      else 'ok'
    end
  from projected;
$$;

create or replace view public.low_stock_with_forecast
with (security_barrier = true) as
select f.*
from public.product_forecast((select public.current_tenant_id())) f;
revoke all on table public.low_stock_with_forecast from anon, authenticated;
grant select on table public.low_stock_with_forecast to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Automatic purchase requests
-- ---------------------------------------------------------------------------
-- Products of an active supplier with a par level that will fall below min_stock (0 when not tracked)
-- before the next delivery and are not on order (in a sent request); quantity brings them back to par.
-- Returns drafts created or extended.
create or replace function public.auto_purchase_requests_for_tenant(p_tenant_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_rows integer;
  v_total integer := 0;
  r record;
begin
  select (now() at time zone timezone)::date into v_today from public.tenant_settings where tenant_id = p_tenant_id;
  if v_today is null then
    return 0;
  end if;

  update public.products p
  set avg_daily_usage = f.avg_daily_usage, avg_daily_usage_at = now()
  from public.product_forecast(p_tenant_id) f
  where p.id = f.product_id and p.avg_daily_usage is distinct from f.avg_daily_usage;

  for r in
    select f.supplier_id, s.branch_id,
      jsonb_agg(
        jsonb_build_object('product_id', f.product_id, 'qty', round(f.par_level - greatest(f.projected_stock, 0), 3), 'unit', f.unit)
        order by f.name, f.product_id
      ) as items
    from public.product_forecast(p_tenant_id) f
    join public.suppliers s on s.id = f.supplier_id
    where f.par_level is not null and f.will_run_out and f.on_order = 0
      and f.par_level - greatest(f.projected_stock, 0) > 0
    group by f.supplier_id, s.branch_id
  loop
    insert into public.purchase_requests as pr (tenant_id, branch_id, supplier_id, status, items, auto_created, created_by, request_date)
    values (p_tenant_id, r.branch_id, r.supplier_id, 'draft', r.items, true, p_user_id, v_today)
    on conflict (supplier_id, request_date) where status = 'draft'
    do update set items = pr.items || coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements(excluded.items) e
        where not exists (select 1 from jsonb_array_elements(pr.items) x where x ->> 'product_id' = e ->> 'product_id')
      ), '[]'::jsonb)
    where exists (
      select 1
      from jsonb_array_elements(excluded.items) e
      where not exists (select 1 from jsonb_array_elements(pr.items) x where x ->> 'product_id' = e ->> 'product_id')
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;
  return v_total;
end;
$$;
revoke execute on function public.auto_purchase_requests_for_tenant(uuid, uuid) from public, anon, authenticated;

create or replace function public.require_kitchen_lead()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;
revoke execute on function public.require_kitchen_lead() from public, anon, authenticated;

create or replace function public.check_and_create_auto_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.auto_purchase_requests_for_tenant(public.require_kitchen_lead(), auth.uid());
end;
$$;

-- Every tenant; for the scheduler (service role / pg_cron), not for clients.
create or replace function public.check_and_create_auto_requests_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  t record;
begin
  for t in select id from public.tenants order by id
  loop
    v_total := v_total + public.auto_purchase_requests_for_tenant(t.id, null);
  end loop;
  return v_total;
end;
$$;
revoke execute on function public.check_and_create_auto_requests_all() from public, anon, authenticated;
grant execute on function public.check_and_create_auto_requests_all() to service_role;

-- Hourly run where pg_cron is installed (Supabase: Database -> Extensions -> pg_cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('alovos-auto-purchase-requests', '0 * * * *', 'select public.check_and_create_auto_requests_all()')$cron$;
  end if;
end;
$$;

-- Chef/owner approves a draft (optionally with edited quantities) and marks it sent.
create or replace function public.send_purchase_request(p_request_id uuid, p_items jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_request public.purchase_requests;
  v_items jsonb;
  v_given integer;
  v_valid integer;
begin
  select * into v_request from public.purchase_requests where id = p_request_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  v_items := v_request.items;
  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    begin
      select count(*), count(distinct p.id) filter (where (e ->> 'qty')::numeric > 0),
        jsonb_agg(jsonb_build_object('product_id', p.id, 'qty', (e ->> 'qty')::numeric, 'unit', p.unit) order by t.ord)
      into v_given, v_valid, v_items
      from jsonb_array_elements(p_items) with ordinality as t(e, ord)
      left join public.products p on p.id = (t.e ->> 'product_id')::uuid and p.tenant_id = v_tenant;
    exception when invalid_text_representation then
      raise exception 'invalid_input' using errcode = '22023';
    end;
    if v_valid <> v_given then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.purchase_requests
  set items = v_items, status = 'sent', sent_at = now(), sent_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function public.discard_purchase_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_status text;
begin
  select status into v_status from public.purchase_requests where id = p_request_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  delete from public.purchase_requests where id = p_request_id;
end;
$$;

-- The goods of a sent request arrived (they are received into stock separately): it no longer counts
-- as on order.
create or replace function public.receive_purchase_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
  v_status text;
begin
  select status into v_status from public.purchase_requests where id = p_request_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'sent' then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.purchase_requests
  set status = 'received', received_at = now(), received_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function public.set_product_limits(
  p_product_id uuid,
  p_par_level numeric,
  p_min_stock numeric,
  p_supplier_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  if (p_par_level is not null and p_par_level <= 0)
     or (p_min_stock is not null and p_min_stock < 0)
     or (p_par_level is not null and p_min_stock is not null and p_min_stock > p_par_level) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id and tenant_id = v_tenant and is_active) then
    raise exception 'supplier_not_found' using errcode = 'P0002';
  end if;
  update public.products
  set par_level = p_par_level, min_stock = p_min_stock, supplier_id = p_supplier_id
  where id = p_product_id and tenant_id = v_tenant;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Live stock value (latest purchase price) and the owner's figures
-- ---------------------------------------------------------------------------
-- Stock x latest purchase price (else catalog cost) per storage type; empty for roles without costs.
create or replace function public.stock_value_by_type(p_branch_id uuid default null)
returns table (type text, value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select sl.type, sum(t.qty * coalesce(public.product_last_purchase_price(t.product_id), 0))
  from (
    select ps.location_id, ps.product_id, sum(ps.quantity) as qty
    from public.product_stocks ps
    where ps.tenant_id = (select public.current_tenant_id()) and ps.quantity > 0
    group by ps.location_id, ps.product_id
  ) t
  join public.storage_locations sl on sl.id = t.location_id
  where (select public.can_see_costs()) and (p_branch_id is null or sl.branch_id = p_branch_id)
  group by sl.type
  order by public.storage_type_rank(sl.type);
$$;

create or replace function public.owner_summary()
returns table (stock_value numeric, low_stock_count integer, critical_count integer, auto_request_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_kitchen_lead();
begin
  return query
  select
    coalesce((select sum(v.value) from public.stock_value_by_type(null) v), 0),
    (select count(*)::integer from public.product_forecast(v_tenant) f where f.status in ('critical', 'order')),
    (select count(*)::integer from public.product_forecast(v_tenant) f where f.status = 'critical'),
    (select count(*)::integer from public.purchase_requests r where r.tenant_id = v_tenant and r.status = 'draft' and r.auto_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Invitations
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(p_phone text, p_role text)
returns public.invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
  v_row public.invitations;
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if coalesce(public.current_member_role(), '') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone !~ '^\+?[0-9]{7,15}$' or coalesce(p_role, '') not in ('chef', 'owner') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into public.invitations (tenant_id, phone, role, expires_at, created_by)
  select v_tenant, v_phone, p_role, now() + make_interval(days => s.invite_ttl_days), auth.uid()
  from public.tenant_settings s
  where s.tenant_id = v_tenant
  returning * into v_row;
  if v_row.id is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- What the invite page shows before accepting: restaurant, role and whether the link still works.
create or replace function public.invitation_preview(p_token text)
returns table (tenant_name text, role text, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where token = p_token;
  if not found then
    return query select null::text, null::text, 'not_found'::text;
    return;
  end if;
  return query
  select t.name, v_inv.role,
    case when v_inv.used_at is not null then 'used' when v_inv.expires_at <= now() then 'expired' else 'valid' end
  from public.tenants t
  where t.id = v_inv.tenant_id;
end;
$$;

-- The signed-in user joins the inviting restaurant with the invited role and works in it from now on.
-- An existing membership keeps its role.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.invitations;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.used_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;

  insert into public.profiles (id, tenant_id, role, email)
  select u.id, v_inv.tenant_id, v_inv.role, u.email from auth.users u where u.id = v_user
  on conflict (id) do update set tenant_id = excluded.tenant_id;

  insert into public.memberships (user_id, tenant_id, role)
  values (v_user, v_inv.tenant_id, v_inv.role)
  on conflict (user_id, tenant_id) do nothing;

  update public.invitations set used_at = now(), used_by = v_user where id = v_inv.id;
  return v_inv.tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.name_to_code(text, integer, text)',
    'public.get_next_delivery_date(integer[], date)',
    'public.calculate_avg_daily_usage(uuid)',
    'public.product_forecast(uuid)',
    'public.check_and_create_auto_requests()',
    'public.send_purchase_request(uuid, jsonb)',
    'public.discard_purchase_request(uuid)',
    'public.receive_purchase_request(uuid)',
    'public.set_product_limits(uuid, numeric, numeric, uuid)',
    'public.stock_value_by_type(uuid)',
    'public.owner_summary()',
    'public.create_invitation(text, text)',
    'public.invitation_preview(text)',
    'public.accept_invitation(text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.suppliers where code is null) then
    raise exception 'supplier codes incomplete';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'suppliers' and column_name = 'delivery_days') <> 'ARRAY' then
    raise exception 'suppliers.delivery_days is not an array';
  end if;
  if public.get_next_delivery_date(array[1, 4], date '2026-10-05') <> date '2026-10-08'
     or public.get_next_delivery_date(array[1, 4], date '2026-10-08') <> date '2026-10-12'
     or public.get_next_delivery_date('{}', date '2026-10-08') is not null then
    raise exception 'get_next_delivery_date is wrong';
  end if;
  if has_function_privilege('authenticated', 'public.check_and_create_auto_requests_all()', 'execute')
     or has_function_privilege('authenticated', 'public.auto_purchase_requests_for_tenant(uuid, uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.purchase_requests', 'insert')
     or has_table_privilege('authenticated', 'public.invitations', 'insert') then
    raise exception 'privileges too wide';
  end if;
end;
$$;

commit;
