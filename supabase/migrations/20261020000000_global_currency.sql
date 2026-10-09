-- Tenant currency for any country (a Moscow restaurant works in RUB, Istanbul in TRY).
--   * currencies: ISO 4217 code, symbol, number-format locale and names. Data, readable before sign-in.
--   * tenant_settings: currency (ISO code, existing column), currency_symbol, locale. Changed by the owner
--     only, through set_tenant_currency(); amounts already stored are not converted.
--   * Signup metadata {currency, timezone} sets the new restaurant's currency and time zone.
--   * suppliers.default_currency: what the supplier invoices in (null: the restaurant's currency).
--   * Receipts in another currency: receive_stock_with_lot_fx() stores the cost in the restaurant's
--     currency (price x fx_rate; maya is computed from it) and keeps the original price, currency and
--     rate in product_lot_costs, which only the owner and chef of the restaurant read (cooks see no money).
--   * The currency changes only while the warehouse is empty (stock costs stay in one currency).
-- Run after 20261019_final_world_scheme.sql. Idempotent.

begin;

do $$
begin
  if to_regclass('public.product_lot_costs') is null
     or to_regprocedure('public.receive_stock_with_lot(uuid, numeric, uuid, numeric, date, integer, boolean)') is null then
    raise exception 'Run 20261019_final_world_scheme.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Currencies
-- ---------------------------------------------------------------------------
create table if not exists public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  symbol text not null check (btrim(symbol) <> ''),
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  name_az text not null,
  name_ru text not null,
  name_en text not null,
  sort integer not null default 0,
  is_active boolean not null default true
);
-- Starting list; rows edited later are kept on re-runs.
insert into public.currencies (code, symbol, locale, name_az, name_ru, name_en, sort) values
  ('AZN', '₼', 'az-AZ', 'Azərbaycan manatı', 'Азербайджанский манат', 'Azerbaijani manat', 10),
  ('RUB', '₽', 'ru-RU', 'Rusiya rublu', 'Российский рубль', 'Russian ruble', 20),
  ('TRY', '₺', 'tr-TR', 'Türk lirəsi', 'Турецкая лира', 'Turkish lira', 30),
  ('USD', '$', 'en-US', 'ABŞ dolları', 'Доллар США', 'US dollar', 40),
  ('EUR', '€', 'de-DE', 'Avro', 'Евро', 'Euro', 50)
on conflict (code) do nothing;
alter table public.currencies enable row level security;
revoke all on table public.currencies from anon, authenticated;
grant select on table public.currencies to anon, authenticated;
drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies for select to anon, authenticated using (is_active);

-- ---------------------------------------------------------------------------
-- 2. Tenant currency and number format
-- ---------------------------------------------------------------------------
alter table public.tenant_settings add column if not exists locale text;
-- Codes typed by hand before this file (lower case, spaces) become the ISO code when it is known.
update public.tenant_settings s set currency = upper(btrim(s.currency))
where s.currency is distinct from upper(btrim(s.currency))
  and exists (select 1 from public.currencies c where c.code = upper(btrim(s.currency)));
update public.tenant_settings s
set locale = c.locale, currency_symbol = coalesce(nullif(btrim(s.currency_symbol), ''), c.symbol)
from public.currencies c
where c.code = s.currency and (s.locale is null or s.currency_symbol is null or btrim(s.currency_symbol) = '');
-- The currency changes only through set_tenant_currency() (symbol and locale follow the code).
revoke update (currency, currency_symbol, locale) on table public.tenant_settings from authenticated;

-- New restaurants (any path) get the symbol and number format of their currency.
create or replace function public.fill_currency_format()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency public.currencies;
begin
  if new.locale is null or new.currency_symbol is null or btrim(new.currency_symbol) = '' then
    select * into v_currency from public.currencies where code = new.currency;
    if found then
      new.currency_symbol := coalesce(nullif(btrim(new.currency_symbol), ''), v_currency.symbol);
      new.locale := coalesce(new.locale, v_currency.locale);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.fill_currency_format() from public, anon, authenticated;
drop trigger if exists tenant_settings_currency_format on public.tenant_settings;
create trigger tenant_settings_currency_format
  before insert or update of currency, currency_symbol, locale on public.tenant_settings
  for each row execute function public.fill_currency_format();

create or replace function public.set_tenant_currency(p_code text)
returns public.tenant_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_currency public.currencies;
  v_settings public.tenant_settings;
begin
  if public.current_member_role() is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_currency from public.currencies where code = upper(btrim(coalesce(p_code, ''))) and is_active;
  if not found then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- Stock costs are stored in the current currency: switching with stock on hand would mix currencies.
  if v_currency.code is distinct from (select s.currency from public.tenant_settings s where s.tenant_id = v_tenant)
     and exists (select 1 from public.product_stocks ps where ps.tenant_id = v_tenant and ps.quantity > 0) then
    raise exception 'stock_exists' using errcode = 'P0001';
  end if;
  update public.tenant_settings
  set currency = v_currency.code, currency_symbol = v_currency.symbol, locale = v_currency.locale
  where tenant_id = v_tenant
  returning * into v_settings;
  return v_settings;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Signup: {currency, timezone} from the form for the restaurant the user now owns
-- ---------------------------------------------------------------------------
-- Fires after on_auth_user_created (same event, name sorts later), which created the tenant.
create or replace function public.apply_signup_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_code text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'currency', '')));
  v_zone text := btrim(coalesce(new.raw_user_meta_data ->> 'timezone', ''));
  v_currency public.currencies;
begin
  select m.tenant_id into v_tenant from public.memberships m where m.user_id = new.id and m.role = 'owner' limit 1;
  if v_tenant is null then
    return new;
  end if;
  select * into v_currency from public.currencies where code = v_code and is_active;
  if found then
    update public.tenant_settings
    set currency = v_currency.code, currency_symbol = v_currency.symbol, locale = v_currency.locale
    where tenant_id = v_tenant;
  end if;
  if v_zone <> '' and exists (select 1 from pg_timezone_names where name = v_zone) then
    update public.tenant_settings set timezone = v_zone where tenant_id = v_tenant;
  end if;
  return new;
end;
$$;
revoke execute on function public.apply_signup_settings() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_settings on auth.users;
create trigger on_auth_user_created_settings
  after insert on auth.users
  for each row execute function public.apply_signup_settings();

-- ---------------------------------------------------------------------------
-- 4. Suppliers invoice in their currency
-- ---------------------------------------------------------------------------
alter table public.suppliers add column if not exists default_currency text;
alter table public.suppliers drop constraint if exists suppliers_default_currency_check;
alter table public.suppliers add constraint suppliers_default_currency_check check (default_currency is null or default_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- 5. Receipt in another currency (cost converted, original kept with the hidden lot cost)
-- ---------------------------------------------------------------------------
alter table public.product_lot_costs add column if not exists original_cost numeric(14,4);
alter table public.product_lot_costs add column if not exists original_currency text;
alter table public.product_lot_costs add column if not exists fx_rate numeric(14,6);
alter table public.product_lot_costs drop constraint if exists product_lot_costs_fx_check;
alter table public.product_lot_costs add constraint product_lot_costs_fx_check check (
  (original_currency is null and fx_rate is null and original_cost is null)
  or (original_currency ~ '^[A-Z]{3}$' and fx_rate > 0 and original_cost >= 0)
);

-- p_price is per unit in p_currency (null: the restaurant's currency, rate 1). The movement and the lot
-- cost get p_price * p_fx_rate in the restaurant's currency.
create or replace function public.receive_stock_with_lot_fx(
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
  v_base text;
  v_code text := upper(btrim(coalesce(p_currency, '')));
  v_rate numeric;
  v_lot public.product_lots;
begin
  select currency into v_base from public.tenant_settings where tenant_id = v_tenant;
  if v_code = '' or v_code = v_base then
    if p_fx_rate is not null and p_fx_rate <> 1 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    return public.receive_stock_with_lot(p_product_id, p_qty, p_storage_id, p_price, p_production_date, p_shelf_life_days, p_remember);
  end if;
  if not exists (select 1 from public.currencies where code = v_code and is_active)
     or p_price is null or p_price < 0 or p_fx_rate is null or p_fx_rate <= 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_rate := p_fx_rate;
  v_lot := public.receive_stock_with_lot(
    p_product_id, p_qty, p_storage_id, round(p_price * v_rate, 4), p_production_date, p_shelf_life_days, p_remember
  );
  update public.product_lot_costs
  set original_cost = p_price, original_currency = v_code, fx_rate = v_rate
  where lot_id = v_lot.id;
  return v_lot;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.set_tenant_currency(text) from public, anon;
grant execute on function public.set_tenant_currency(text) to authenticated;
revoke execute on function public.receive_stock_with_lot_fx(uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean) from public, anon;
grant execute on function public.receive_stock_with_lot_fx(uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Lot costs: read by those who see money (owner, chef) in their restaurant; cooks and staff get no
--    rows. Written only by the lot functions and triggers (security definer), never by clients.
-- ---------------------------------------------------------------------------
alter table public.product_lot_costs enable row level security;
revoke all on table public.product_lot_costs from anon, authenticated;
grant select on table public.product_lot_costs to authenticated;
drop policy if exists product_lot_costs_select on public.product_lot_costs;
create policy product_lot_costs_select on public.product_lot_costs
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.can_see_costs()));

do $$
begin
  if has_column_privilege('authenticated', 'public.tenant_settings', 'currency', 'update')
     or has_table_privilege('anon', 'public.product_lot_costs', 'select')
     or has_table_privilege('authenticated', 'public.product_lot_costs', 'insert, update, delete')
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.product_lot_costs'::regclass) then
    raise exception 'currency writable, or lot costs writable by clients or readable without RLS';
  end if;
end;
$$;

commit;
