-- alovOS multitenant core: organizations, profiles and org-scoped data tables with RLS.
-- Source of truth for the database (together with 20261006120001_storage.sql).
-- The old org-scoped draft lives in supabase/_legacy/schema.sql.bak and is not used.
-- Safe to re-run in the Supabase SQL Editor: if not exists / create or replace / drop ... if exists.

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
-- Constraints
-- ---------------------------------------------------------------------------
-- A NULL qty passes a CHECK (the expression is unknown, not false), so only negatives are rejected.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_qty_non_negative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_qty_non_negative check (qty >= 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The two unique indexes duplicate the primary keys; they are harmless.
create unique index if not exists idx_organizations_id_unique on public.organizations(id);
create unique index if not exists idx_profiles_id_unique on public.profiles(id);

create index if not exists idx_profiles_organization_id on public.profiles(organization_id);
create index if not exists idx_locations_organization_id on public.locations(organization_id);
create index if not exists idx_products_organization_id on public.products(organization_id);
create index if not exists idx_products_location_id on public.products(location_id);
create index if not exists idx_products_barcode_org on public.products(barcode, organization_id)
  where barcode is not null;
create index if not exists idx_suppliers_organization_id on public.suppliers(organization_id);
create index if not exists idx_invoices_organization_id on public.invoices(organization_id);
create index if not exists idx_invoices_supplier_id on public.invoices(supplier_id);

-- ---------------------------------------------------------------------------
-- Org lookup helper
-- A policy on profiles that subqueries profiles directly re-triggers that same
-- policy and fails with "infinite recursion detected in policy". This helper is
-- SECURITY DEFINER, so it reads profiles as the function owner (bypassing RLS)
-- and breaks the loop. Policies call it as (select public.current_org_id()) so
-- Postgres evaluates it once per statement (initPlan) instead of once per row.
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid() limit 1
$$;

revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges (RLS is the main gate; this is defence in depth)
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.invoices enable row level security;

revoke all on public.organizations, public.profiles, public.locations,
  public.products, public.suppliers, public.invoices from anon;

-- TRUNCATE ignores RLS, so clients never get it.
revoke truncate, references, trigger on public.organizations, public.profiles,
  public.locations, public.products, public.suppliers, public.invoices
  from authenticated;

-- Organizations are created only by handle_new_user(); clients may read and rename.
revoke insert, delete on public.organizations from authenticated;

-- Profiles: users may only change their own email. organization_id and role can never be
-- set or changed by a client (a self-created profile starts without an organization).
revoke insert, update, delete on public.profiles from authenticated;
grant insert (id, email) on public.profiles to authenticated;
grant update (email) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security policies (explicit per operation, all `to authenticated`)
-- ---------------------------------------------------------------------------
-- Drop every old and new policy name first so re-runs start clean.
drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_update on public.organizations;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

drop policy if exists locations_org_isolation on public.locations;
drop policy if exists products_org_isolation on public.products;
drop policy if exists suppliers_org_isolation on public.suppliers;
drop policy if exists invoices_org_isolation on public.invoices;

do $$
declare
  t text;
begin
  foreach t in array array['locations', 'products', 'suppliers', 'invoices'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
  end loop;
end;
$$;

-- organizations: read and update own organization; no client INSERT/DELETE.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select public.current_org_id()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id()))
  with check (id = (select public.current_org_id()));

-- profiles: read own profile and profiles of the same organization; update only own row.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or organization_id = (select public.current_org_id())
  );

-- Self-created profiles must have no organization: otherwise a user whose signup trigger
-- failed could insert a profile pointing at any tenant and join it.
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and organization_id is null);

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- locations
create policy locations_select on public.locations
  for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy locations_insert on public.locations
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));
create policy locations_update on public.locations
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
create policy locations_delete on public.locations
  for delete to authenticated
  using (organization_id = (select public.current_org_id()));

-- products
create policy products_select on public.products
  for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy products_insert on public.products
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));
create policy products_update on public.products
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
create policy products_delete on public.products
  for delete to authenticated
  using (organization_id = (select public.current_org_id()));

-- suppliers
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (organization_id = (select public.current_org_id()));

-- invoices
create policy invoices_select on public.invoices
  for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));
create policy invoices_update on public.invoices
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (organization_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- Signup: every new auth user gets an organization and an owner profile.
-- Failures are logged and swallowed so that a bug here never blocks signup;
-- the inner block is a subtransaction, so a failure leaves no orphan organization.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid := gen_random_uuid();
  org_name text;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  begin
    -- NULLIF turns '' into NULL, so an empty metadata value or an empty e-mail prefix
    -- (split_part of NULL is NULL, of '@x.az' is '') falls through to the next option.
    org_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
      nullif(trim(split_part(new.email, '@', 1)), ''),
      'My Restaurant'
    );

    insert into public.organizations (id, name)
    values (new_org_id, org_name);

    insert into public.profiles (id, organization_id, role, email)
    values (new.id, new_org_id, 'owner', new.email);
  exception when others then
    raise log 'handle_new_user failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
