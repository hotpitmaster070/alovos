-- alovOS multitenant core: organizations, profiles and org-scoped data tables with RLS.
-- Source of truth for the database (together with 20261006120001_storage.sql).
-- The old org-scoped draft lives in supabase/_legacy/schema.sql.bak and is not used.
-- Safe to re-run in the Supabase SQL Editor: if not exists / create or replace / drop ... if exists.
--
-- The tables may predate this migration with other columns (create table if not exists then
-- skips them, e.g. products without qty or organization_id). Every index, constraint, grant and
-- policy below first checks that its table and columns exist and is skipped (with a notice)
-- otherwise, so the migration applies on such a database too.

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
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'qty'
  ) then
    raise notice 'products.qty missing: products_qty_non_negative skipped';
  elsif not exists (
    select 1 from pg_constraint
    where conname = 'products_qty_non_negative' and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_qty_non_negative check (qty >= 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes (each only when all of its columns exist)
-- ---------------------------------------------------------------------------
-- The two unique indexes duplicate the primary keys; they are harmless.
do $$
declare
  spec record;
  present integer;
begin
  for spec in
    select * from (values
      ('idx_organizations_id_unique',   'organizations', array['id'],                       true,  null),
      ('idx_profiles_id_unique',        'profiles',      array['id'],                       true,  null),
      ('idx_profiles_organization_id',  'profiles',      array['organization_id'],          false, null),
      ('idx_locations_organization_id', 'locations',     array['organization_id'],          false, null),
      ('idx_products_organization_id',  'products',      array['organization_id'],          false, null),
      ('idx_products_location_id',      'products',      array['location_id'],              false, null),
      ('idx_products_barcode_org',      'products',      array['barcode', 'organization_id'], false, 'barcode is not null'),
      ('idx_suppliers_organization_id', 'suppliers',     array['organization_id'],          false, null),
      ('idx_invoices_organization_id',  'invoices',      array['organization_id'],          false, null),
      ('idx_invoices_supplier_id',      'invoices',      array['supplier_id'],              false, null)
    ) as s(name, tbl, cols, is_unique, predicate)
  loop
    select count(*) into present
    from information_schema.columns
    where table_schema = 'public' and table_name = spec.tbl and column_name = any(spec.cols);
    if present < cardinality(spec.cols) then
      raise notice '%: column(s) % of public.% missing, skipped', spec.name, spec.cols, spec.tbl;
      continue;
    end if;
    execute format(
      'create %s index if not exists %I on public.%I (%s)%s',
      case when spec.is_unique then 'unique' else '' end,
      spec.name,
      spec.tbl,
      (select string_agg(quote_ident(col), ', ') from unnest(spec.cols) as col),
      coalesce(' where ' || spec.predicate, '')
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Org lookup helper
-- A policy on profiles that subqueries profiles directly re-triggers that same
-- policy and fails with "infinite recursion detected in policy". This helper is
-- SECURITY DEFINER, so it reads profiles as the function owner (bypassing RLS)
-- and breaks the loop. Policies call it as (select public.current_org_id()) so
-- Postgres evaluates it once per statement (initPlan) instead of once per row.
-- plpgsql: its body is checked when called, not when created, so the function exists
-- (later migrations use it) even while profiles has no organization_id.
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select organization_id from public.profiles where id = auth.uid() limit 1);
end;
$$;

revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges (RLS is the main gate; this is defence in depth)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['organizations', 'profiles', 'locations', 'products', 'suppliers', 'invoices'] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'public.% missing: RLS and privileges skipped', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- TRUNCATE ignores RLS, so clients never get it.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;

  -- Organizations are created only by handle_new_user(); clients may read and rename.
  if to_regclass('public.organizations') is not null then
    revoke insert, delete on public.organizations from authenticated;
  end if;

  -- Profiles: users may only change their own email. organization_id and role can never be
  -- set or changed by a client (a self-created profile starts without an organization).
  if to_regclass('public.profiles') is not null then
    revoke insert, update, delete on public.profiles from authenticated;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
    ) then
      grant insert (id, email) on public.profiles to authenticated;
      grant update (email) on public.profiles to authenticated;
    else
      raise notice 'profiles.email missing: profile insert/update grants skipped';
      grant insert (id) on public.profiles to authenticated;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security policies (explicit per operation, all `to authenticated`)
-- Each table gets its policies only when it exists and has the columns they use.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p text;
  org_expr constant text := '(select public.current_org_id())';
  has_col constant text :=
    'select exists (select 1 from information_schema.columns where table_schema = ''public'' and table_name = $1 and column_name = $2)';
  ok boolean;
  profiles_org boolean;
begin
  -- Drop every old and new policy name first so re-runs start clean.
  foreach t in array array['organizations', 'profiles', 'locations', 'products', 'suppliers', 'invoices'] loop
    continue when to_regclass(format('public.%I', t)) is null;
    foreach p in array array[
      t || '_select', t || '_insert', t || '_insert_own', t || '_update', t || '_update_own', t || '_delete',
      t || '_org_isolation'
    ] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
  end loop;

  -- organizations: read and update own organization; no client INSERT/DELETE.
  execute has_col into ok using 'organizations', 'id';
  if ok then
    execute format('create policy organizations_select on public.organizations for select to authenticated using (id = %s)', org_expr);
    execute format(
      'create policy organizations_update on public.organizations for update to authenticated using (id = %1$s) with check (id = %1$s)',
      org_expr
    );
  else
    raise notice 'organizations.id missing: organizations policies skipped';
  end if;

  -- profiles: read own profile and profiles of the same organization; update only own row.
  execute has_col into ok using 'profiles', 'id';
  execute has_col into profiles_org using 'profiles', 'organization_id';
  if ok then
    if profiles_org then
      execute format(
        'create policy profiles_select on public.profiles for select to authenticated
           using (id = (select auth.uid()) or organization_id = %s)',
        org_expr
      );
      -- Self-created profiles must have no organization: otherwise a user whose signup trigger
      -- failed could insert a profile pointing at any tenant and join it.
      execute 'create policy profiles_insert on public.profiles for insert to authenticated
                 with check (id = (select auth.uid()) and organization_id is null)';
    else
      raise notice 'profiles.organization_id missing: profiles policies limited to the own row';
      execute 'create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()))';
      execute 'create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()))';
    end if;
    execute 'create policy profiles_update on public.profiles for update to authenticated
               using (id = (select auth.uid())) with check (id = (select auth.uid()))';
  else
    raise notice 'profiles.id missing: profiles policies skipped';
  end if;

  -- Org-scoped data: every operation limited to the caller's organization.
  foreach t in array array['locations', 'products', 'suppliers', 'invoices'] loop
    execute has_col into ok using t, 'organization_id';
    if not ok then
      raise notice '%.organization_id missing: % policies skipped', t, t;
      continue;
    end if;
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = %s)', t || '_select', t, org_expr);
    execute format('create policy %I on public.%I for insert to authenticated with check (organization_id = %s)', t || '_insert', t, org_expr);
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id = %3$s) with check (organization_id = %3$s)',
      t || '_update', t, org_expr
    );
    execute format('create policy %I on public.%I for delete to authenticated using (organization_id = %s)', t || '_delete', t, org_expr);
  end loop;
end;
$$;

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
