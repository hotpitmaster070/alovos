-- Block 1.1: catalog with factory barcodes and our own internal codes. Idempotent.
-- public.products already exists (organization_id, tenant_id, branch_id, name, barcode,
-- expiry_date, quantity, unit, cost, created_at), so it is extended, not recreated.
-- barcode: factory EAN-13/UPC, nullable (meat, produce). internal_code: our label, e.g. ALO-1001.
-- Price per unit stays in products.cost; received stock lives in product_stocks.
-- Run after 20261007205000_enforce_tenant_trusted_callers.sql.

create sequence if not exists public.products_internal_code_seq start 1001;

alter table public.products
  add column if not exists internal_code text,
  add column if not exists photo_url text;

alter table public.products
  alter column internal_code set default ('ALO-' || nextval('public.products_internal_code_seq')::text),
  alter column unit set default 'kg';

update public.products
set internal_code = 'ALO-' || nextval('public.products_internal_code_seq')::text
where internal_code is null;

alter table public.products alter column internal_code set not null;

create unique index if not exists products_internal_code_key on public.products (internal_code);
create index if not exists idx_products_tenant_barcode on public.products (tenant_id, barcode)
  where barcode is not null;

alter table public.products enable row level security;

drop trigger if exists products_enforce_tenant on public.products;
create trigger products_enforce_tenant
  before insert or update on public.products
  for each row execute function public.enforce_tenant_id();

-- App code never updates products directly (scripts/check-org-scope.mjs); expiry goes through here.
-- SECURITY INVOKER: RLS and enforce_tenant_id() still apply to the caller.
create or replace function public.set_product_expiry(p_product_id uuid, p_expiry date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.products
  set expiry_date = p_expiry
  where id = p_product_id
    and tenant_id = public.current_tenant_id();
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_product_expiry(uuid, date) from public, anon;
grant execute on function public.set_product_expiry(uuid, date) to authenticated;
