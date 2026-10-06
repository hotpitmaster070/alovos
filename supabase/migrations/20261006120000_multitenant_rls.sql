-- alovOS multitenant core: organizations, profiles and org-scoped data tables with RLS.
-- Source of truth for the database. supabase/schema.sql is legacy and ignored.
-- Safe to re-run: uses if not exists / create or replace / drop ... if exists.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id),
  role text default 'owner',
  email text
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  barcode text,
  expiry_date date,
  qty float default 0,
  location_id uuid references public.locations(id),
  cost numeric,
  unit text default 'kg',
  created_at timestamptz default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  contact text
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  supplier_id uuid references public.suppliers(id),
  parsed_json jsonb,
  total numeric,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_profiles_organization_id on public.profiles(organization_id);
create index if not exists idx_locations_organization_id on public.locations(organization_id);
create index if not exists idx_products_organization_id on public.products(organization_id);
create index if not exists idx_products_location_id on public.products(location_id);
create index if not exists idx_suppliers_organization_id on public.suppliers(organization_id);
create index if not exists idx_invoices_organization_id on public.invoices(organization_id);
create index if not exists idx_invoices_supplier_id on public.invoices(supplier_id);

-- ---------------------------------------------------------------------------
-- Org lookup helper
-- A policy on profiles that subqueries profiles directly re-triggers that same
-- policy and fails with "infinite recursion detected in policy". This helper is
-- SECURITY DEFINER, so it reads profiles as the function owner (bypassing RLS)
-- and breaks the loop. It is equivalent to
--   (select organization_id from profiles where id = auth.uid())
-- and every policy below uses it.
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;

revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.invoices enable row level security;

-- organizations: members can read and update their own organization.
-- Creation happens only through handle_new_user(); no insert/delete from the API.
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id()))
  with check (id = (select public.current_org_id()));

-- profiles: read own profile and all profiles of the same organization; update only own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or organization_id = (select public.current_org_id())
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Users must not be able to move themselves to another organization or change their role,
-- so only the email column is updatable from the API.
revoke update on public.profiles from anon, authenticated;
grant update (email) on public.profiles to authenticated;

-- data tables: everything is scoped to the caller's organization.
drop policy if exists locations_org_isolation on public.locations;
create policy locations_org_isolation on public.locations
  for all to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));

drop policy if exists products_org_isolation on public.products;
create policy products_org_isolation on public.products
  for all to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));

drop policy if exists suppliers_org_isolation on public.suppliers;
create policy suppliers_org_isolation on public.suppliers
  for all to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));

drop policy if exists invoices_org_isolation on public.invoices;
create policy invoices_org_isolation on public.invoices
  for all to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));

-- Anonymous users get no direct table access.
revoke all on public.organizations, public.profiles, public.locations,
  public.products, public.suppliers, public.invoices from anon;

-- ---------------------------------------------------------------------------
-- Signup: every new auth user gets an organization and an owner profile.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
begin
  org_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'My organization'
  );

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.profiles (id, organization_id, role, email)
  values (new.id, new_org_id, 'owner', new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
