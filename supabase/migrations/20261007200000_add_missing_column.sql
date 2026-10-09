-- products.tenant_id is read by /app/anbar but was never created on the hosted database.
-- Same column, backfill, FK and index as 20261006120004_anbar_catalog.sql. Idempotent.

insert into public.tenants (id, name)
select id, name from public.organizations
on conflict (id) do nothing;

alter table public.products
  add column if not exists tenant_id uuid;

-- Older products tables may have no organization_id: nothing to backfill from then.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'organization_id'
  ) then
    update public.products
    set tenant_id = organization_id
    where tenant_id is null
      and organization_id is not null;
  else
    raise notice 'products.organization_id missing: tenant_id backfill skipped';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_tenant_id_fkey' and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

create index if not exists idx_products_tenant_id on public.products(tenant_id);
