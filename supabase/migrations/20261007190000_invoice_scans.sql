-- Invoice photo scans and the goods-receipt rows they create.

create table if not exists public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  location_id uuid references public.storage_locations(id),
  photo_url text,
  parsed_json jsonb,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_transaction (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  location_id uuid references public.storage_locations(id),
  product_id uuid references public.products(id),
  invoice_scan_id uuid references public.invoice_scans(id),
  quantity numeric not null check (quantity > 0),
  unit text,
  price numeric,
  type text not null check (type in ('IN')),
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_scans_tenant_created
  on public.invoice_scans (tenant_id, created_at desc);
create index if not exists idx_inventory_transaction_tenant_created
  on public.inventory_transaction (tenant_id, created_at desc);

alter table public.invoice_scans enable row level security;
alter table public.inventory_transaction enable row level security;

revoke all on public.invoice_scans, public.inventory_transaction from anon;
grant select, insert on public.invoice_scans, public.inventory_transaction to authenticated;

drop policy if exists invoice_scans_select on public.invoice_scans;
drop policy if exists invoice_scans_insert on public.invoice_scans;
create policy invoice_scans_select on public.invoice_scans
  for select to authenticated
  using (tenant_id = (select public.my_tenant_id()));
create policy invoice_scans_insert on public.invoice_scans
  for insert to authenticated
  with check (tenant_id = (select public.my_tenant_id()));

drop policy if exists inventory_transaction_select on public.inventory_transaction;
drop policy if exists inventory_transaction_insert on public.inventory_transaction;
create policy inventory_transaction_select on public.inventory_transaction
  for select to authenticated
  using (tenant_id = (select public.my_tenant_id()));
create policy inventory_transaction_insert on public.inventory_transaction
  for insert to authenticated
  with check (tenant_id = (select public.my_tenant_id()));

insert into storage.buckets (id, name, public)
values ('invoice-scans', 'invoice-scans', false)
on conflict (id) do nothing;

drop policy if exists invoice_scans_objects_select on storage.objects;
drop policy if exists invoice_scans_objects_insert on storage.objects;
drop policy if exists invoice_scans_objects_delete on storage.objects;

create policy invoice_scans_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );

create policy invoice_scans_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );

create policy invoice_scans_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );
