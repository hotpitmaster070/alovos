-- tenant_settings defaults no longer point at one country: timezone UTC, currency USD.
-- * Signup still sets the restaurant's own zone (browser) and currency (form) through apply_signup_settings();
--   the defaults only apply to restaurants created without them.
-- * Existing rows keep their values. storage_locations and product_lots are not touched.
-- Run after 20261020000000_global_currency.sql. Idempotent.

begin;

do $$
begin
  if not exists (select 1 from public.currencies where code = 'USD') then
    raise exception 'Run 20261020000000_global_currency.sql first';
  end if;
end;
$$;

alter table public.tenant_settings alter column timezone set default 'UTC';
alter table public.tenant_settings alter column currency set default 'USD';

do $$
begin
  if (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'timezone') is distinct from '''UTC''::text'
     or (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'currency') is distinct from '''USD''::text' then
    raise exception 'tenant_settings defaults not applied';
  end if;
end;
$$;

commit;
