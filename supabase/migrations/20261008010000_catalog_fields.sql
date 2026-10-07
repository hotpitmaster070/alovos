-- Block 1.1 catalog: category, shelf life and reorder threshold; one catalog product per barcode
-- inside a tenant. Idempotent. Run after 20261008000000_anbar_barcode.sql.
--
-- The barcode is unique only among catalog products (location_id is null). Legacy rows with a
-- location_id are per-location copies made by move_stock() and legitimately share a barcode;
-- they keep idx_products_org_location_barcode_unique from 20261006120003.

alter table public.products
  add column if not exists category text,
  add column if not exists shelf_life_days integer,
  add column if not exists min_stock numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_shelf_life_days_check') then
    alter table public.products
      add constraint products_shelf_life_days_check check (shelf_life_days is null or shelf_life_days between 0 and 3650);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_min_stock_check') then
    alter table public.products
      add constraint products_min_stock_check check (min_stock is null or min_stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_category_length_check') then
    alter table public.products
      add constraint products_category_length_check check (category is null or char_length(category) <= 60);
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.products_tenant_catalog_barcode_key') is not null then
    return;
  end if;
  if exists (
    select 1
    from public.products
    where barcode is not null and location_id is null
    group by tenant_id, barcode
    having count(*) > 1
  ) then
    raise notice 'products_tenant_catalog_barcode_key skipped: duplicate (tenant, barcode) catalog rows exist';
    return;
  end if;
  create unique index products_tenant_catalog_barcode_key
    on public.products (tenant_id, barcode)
    where barcode is not null and location_id is null;
end;
$$;

create index if not exists idx_products_tenant_category on public.products (tenant_id, category)
  where category is not null;
