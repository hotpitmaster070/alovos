-- Core tables (simple, non-org-scoped shape). Idempotent.
-- NOTE: supabase/schema.sql defines tables with the same names but an org-scoped shape.
-- Apply only one of the two to a given database.

create extension if not exists pgcrypto;

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  barcode text,
  expiry_date date,
  qty float default 0,
  location_id uuid references locations(id),
  cost numeric,
  unit text default 'kg',
  created_at timestamp default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id),
  parsed_json jsonb,
  total numeric,
  created_at timestamp default now()
);

alter table locations enable row level security;
alter table products enable row level security;
alter table suppliers enable row level security;
alter table invoices enable row level security;

drop policy if exists "open_all" on locations;
create policy "open_all" on locations for all using (true) with check (true);

drop policy if exists "open_all" on products;
create policy "open_all" on products for all using (true) with check (true);

drop policy if exists "open_all" on suppliers;
create policy "open_all" on suppliers for all using (true) with check (true);

drop policy if exists "open_all" on invoices;
create policy "open_all" on invoices for all using (true) with check (true);
