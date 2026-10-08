-- Phase 1: one tenant model, tenant settings and roles.
--   * organization_id disappears from every table; tenant_id (backfilled from it) is the only key.
--   * public.organizations is dropped after its rows are copied into public.tenants.
--   * current_tenant_id() is the only tenant helper; my_tenant_id() and current_org_id() are dropped.
--   * tenant_settings holds per-tenant settings (copied from tenants.settings).
--   * memberships holds the role per user and tenant; a user without a membership has no tenant.
--   * cook: cannot read cost columns and cannot delete anything.
-- Run after 20261008020000_dynamic_storage_locations.sql, in one go, in the Supabase SQL Editor.
-- Everything runs in one transaction: any failed check rolls the whole migration back.
-- Re-running after success is a no-op apart from re-applying grants and policies.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'storage_locations' and column_name = 'is_active'
  ) then
    raise exception 'Run 20261008020000_dynamic_storage_locations.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Every organization exists as a tenant with the same id
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.organizations') is not null then
    insert into public.tenants (id, name, created_at)
    select o.id, o.name, coalesce(o.created_at, now())
    from public.organizations o
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Every table with organization_id gets tenant_id, backfilled and referencing tenants
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.is_nullable
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'organization_id' and c.table_name <> 'organizations'
  loop
    execute format('alter table public.%I add column if not exists tenant_id uuid', r.table_name);
    execute format(
      'update public.%I set tenant_id = organization_id where tenant_id is null and organization_id is not null',
      r.table_name
    );

    if not exists (
      select 1
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.conrelid = format('public.%I', r.table_name)::regclass
        and con.confrelid = 'public.tenants'::regclass
        and a.attname = 'tenant_id'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id)',
        r.table_name, r.table_name || '_tenant_id_fkey'
      );
    end if;

    if r.is_nullable = 'NO' then
      execute format('alter table public.%I alter column tenant_id set not null', r.table_name);
    end if;

    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || r.table_name || '_tenant_id', r.table_name);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. One tenant helper. A user belongs to profiles.tenant_id only while a membership exists.
-- ---------------------------------------------------------------------------
create table if not exists public.memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'staff',
  -- Empty array: every branch of the tenant.
  branch_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id),
  constraint memberships_role_check check (role in ('owner', 'chef', 'cook', 'staff'))
);

create index if not exists idx_memberships_tenant_id on public.memberships (tenant_id);

-- Existing users keep the access they have today: unknown or missing roles become owner.
insert into public.memberships (user_id, tenant_id, role)
select p.id, p.tenant_id,
  case when p.role in ('owner', 'chef', 'cook', 'staff') then p.role else 'owner' end
from public.profiles p
join public.tenants t on t.id = p.tenant_id
on conflict (user_id, tenant_id) do nothing;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.tenant_id = p.tenant_id
  where p.id = auth.uid()
  limit 1
$$;

revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;

create or replace function public.current_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.tenant_id = p.tenant_id
  where p.id = auth.uid()
  limit 1
$$;

revoke execute on function public.current_member_role() from public, anon;
grant execute on function public.current_member_role() to authenticated;

create or replace function public.can_see_costs()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() in ('owner', 'chef'), false)
$$;

revoke execute on function public.can_see_costs() from public, anon;
grant execute on function public.can_see_costs() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policies: organization_id -> tenant_id, current_org_id()/my_tenant_id() -> current_tenant_id().
-- Covers public and storage (bucket policies). Policies of the dropped table go with it.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
  v_sql text;
  v_old constant text := '\m(current_org_id|my_tenant_id)\M';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and not (schemaname = 'public' and tablename = 'organizations')
      and (
        coalesce(qual, '') ~ '\m(organization_id|current_org_id|my_tenant_id)\M'
        or coalesce(with_check, '') ~ '\m(organization_id|current_org_id|my_tenant_id)\M'
      )
  loop
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      v_sql := v_sql || ' using ('
        || regexp_replace(regexp_replace(p.qual, v_old, 'current_tenant_id', 'g'), '\morganization_id\M', 'tenant_id', 'g')
        || ')';
    end if;
    if p.with_check is not null then
      v_sql := v_sql || ' with check ('
        || regexp_replace(regexp_replace(p.with_check, v_old, 'current_tenant_id', 'g'), '\morganization_id\M', 'tenant_id', 'g')
        || ')';
    end if;
    execute v_sql;
  end loop;
end;
$$;

-- The products policies required both ids; rewritten they repeat the tenant check. Recreate them clean.
drop policy if exists products_select on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;
create policy products_select on public.products
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
create policy products_insert on public.products
  for insert to authenticated with check (tenant_id = (select public.current_tenant_id()));
create policy products_update on public.products
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy products_delete on public.products
  for delete to authenticated using (tenant_id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 5. Functions that used the old model
-- ---------------------------------------------------------------------------
-- Legacy per-location copies in products.qty; the app no longer calls it.
drop function if exists public.move_stock(uuid, uuid, uuid, float);
drop function if exists public.ensure_my_organization();

create or replace function public.provision_tenant(p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_name text := coalesce(nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''), 'My Restaurant');
begin
  select p.tenant_id into v_tenant
  from public.profiles p
  join public.memberships m on m.user_id = p.id and m.tenant_id = p.tenant_id
  where p.id = p_user_id;
  if v_tenant is not null then
    return v_tenant;
  end if;

  -- No profile, no tenant, or removed from the tenant: the user gets a new tenant of their own.
  v_tenant := gen_random_uuid();
  insert into public.tenants (id, name) values (v_tenant, v_name);

  insert into public.profiles (id, tenant_id, role, email)
  values (p_user_id, v_tenant, 'owner', p_email)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        role = 'owner',
        email = coalesce(public.profiles.email, excluded.email);

  insert into public.memberships (user_id, tenant_id, role)
  values (p_user_id, v_tenant, 'owner')
  on conflict (user_id, tenant_id) do update set role = 'owner';

  insert into public.branches (tenant_id, name)
  values (v_tenant, 'Main Branch')
  on conflict (tenant_id, name) do nothing;

  return v_tenant;
end;
$$;

revoke all on function public.provision_tenant(uuid, text) from public, anon, authenticated;

-- PL/pgSQL does not short-circuit "tg_table_name = 'products' and new.branch_id ...": on branches
-- the record has no branch_id and every authenticated insert failed. Table checks are nested.
create or replace function public.enforce_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if new.tenant_id is not null and coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if new.tenant_id is not null and new.tenant_id is distinct from v_tenant then
    raise exception 'tenant_mismatch' using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;

  if tg_table_name = 'products' then
    if new.branch_id is not null and not exists (
      select 1 from public.branches where id = new.branch_id and tenant_id = v_tenant
    ) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  elsif tg_table_name = 'stock' then
    if not exists (
      select 1 from public.products where id = new.product_id and tenant_id = v_tenant
    ) then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.branches where id = new.branch_id and tenant_id = v_tenant
    ) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_tenant_id() from public, anon, authenticated;

-- Recovery for a user whose signup trigger failed or who was removed from a tenant.
create or replace function public.ensure_my_tenant()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_email text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ensure_my_tenant:' || uid::text, 0));
  select email into v_email from auth.users where id = uid;
  if not found then
    raise exception 'user % does not exist', uid using errcode = '28000';
  end if;
  return public.provision_tenant(uid, v_email);
end;
$$;

revoke execute on function public.ensure_my_tenant() from public, anon;
grant execute on function public.ensure_my_tenant() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.provision_tenant(uuid, text) to supabase_auth_admin;
  end if;
end;
$$;

-- Function bodies are not dependency-tracked: stop if any other function still uses the old model.
do $$
declare
  v_list text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_list
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in ('current_org_id', 'my_tenant_id')
    and p.prosrc ~ '\m(organization_id|organizations|current_org_id|my_tenant_id)\M';
  if v_list is not null then
    raise exception 'Functions still use the old organization model: %', v_list;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Drop organization_id, the old helpers and organizations.
-- No CASCADE: a remaining view, policy or foreign key aborts the migration instead of being dropped.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'organization_id' and c.table_name <> 'organizations'
  loop
    execute format('alter table public.%I drop column organization_id', r.table_name);
  end loop;
end;
$$;

drop table if exists public.organizations;
drop function if exists public.current_org_id();
drop function if exists public.my_tenant_id();

create index if not exists idx_products_tenant_name on public.products (tenant_id, name);

-- ---------------------------------------------------------------------------
-- 7. memberships: the tenant's owners manage the team; nobody changes their own row.
-- ---------------------------------------------------------------------------
create or replace function public.check_membership_branches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(new.branch_ids) as b(id)
    where not exists (select 1 from public.branches br where br.id = b.id and br.tenant_id = new.tenant_id)
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_membership_branches() from public, anon, authenticated;

drop trigger if exists trg_membership_branches on public.memberships;
create trigger trg_membership_branches
  before insert or update of branch_ids, tenant_id on public.memberships
  for each row execute function public.check_membership_branches();

alter table public.memberships enable row level security;
revoke all on table public.memberships from anon;
revoke truncate, references, trigger on table public.memberships from authenticated;
grant select, insert, update, delete on table public.memberships to authenticated;

drop policy if exists memberships_select on public.memberships;
drop policy if exists memberships_insert on public.memberships;
drop policy if exists memberships_update on public.memberships;
drop policy if exists memberships_delete on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) = 'owner'
    and user_id <> (select auth.uid())
  );
create policy memberships_update on public.memberships
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) = 'owner'
    and user_id <> (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id <> (select auth.uid())
  );
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_member_role()) = 'owner'
    and user_id <> (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 8. tenant_settings: one row per tenant, created with the tenant. Only owners change it.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  currency text not null default 'AZN',
  currency_symbol text,
  language text,
  timezone text not null default 'Asia/Baku',
  expiry_warn_days integer not null default 7,
  expiry_critical_days integer not null default 30,
  low_stock_default integer not null default 5,
  constraint tenant_settings_expiry_warn_days_check check (expiry_warn_days between 0 and 3650),
  constraint tenant_settings_expiry_critical_days_check check (expiry_critical_days between 0 and 3650),
  constraint tenant_settings_low_stock_default_check check (low_stock_default >= 0)
);

-- tenants.settings (jsonb) carried currency, currency_symbol and language.
insert into public.tenant_settings (tenant_id, currency, currency_symbol, language)
select t.id,
  coalesce(nullif(btrim(to_jsonb(t) -> 'settings' ->> 'currency'), ''), 'AZN'),
  nullif(btrim(to_jsonb(t) -> 'settings' ->> 'currency_symbol'), ''),
  nullif(btrim(to_jsonb(t) -> 'settings' ->> 'language'), '')
from public.tenants t
on conflict (tenant_id) do nothing;

create or replace function public.create_tenant_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_settings (tenant_id) values (new.id) on conflict (tenant_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_tenant_settings() from public, anon, authenticated;

drop trigger if exists trg_tenant_settings on public.tenants;
create trigger trg_tenant_settings
  after insert on public.tenants
  for each row execute function public.create_tenant_settings();

alter table public.tenant_settings enable row level security;
revoke all on table public.tenant_settings from anon, authenticated;
grant select on table public.tenant_settings to authenticated;
grant update (currency, currency_symbol, language, timezone, expiry_warn_days, expiry_critical_days, low_stock_default)
  on table public.tenant_settings to authenticated;

drop policy if exists tenant_settings_select on public.tenant_settings;
drop policy if exists tenant_settings_update on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy tenant_settings_update on public.tenant_settings
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'owner')
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'owner')
  with check (id = (select public.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- 9. Costs. Column privileges hide them from every client; owners and chefs read them through
-- the *_costs views. The views run with the owner's rights, so they filter by tenant themselves.
-- New columns on these tables must be added to the client grant explicitly.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_cols text;
begin
  for r in
    select * from (values
      ('product_stocks', 'cost_per_unit'),
      ('stock_movements', 'cost_per_unit'),
      ('products', 'cost')
    ) as v(tbl, hidden)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.hidden
    ) then
      continue;
    end if;

    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = r.tbl and column_name <> r.hidden;

    execute format('revoke select on table public.%I from authenticated', r.tbl);
    execute format('revoke select (%I) on table public.%I from authenticated', r.hidden, r.tbl);
    execute format('grant select (%s) on table public.%I to authenticated', v_cols, r.tbl);
  end loop;
end;
$$;

create or replace view public.product_stock_costs
with (security_barrier = true) as
select ps.id, ps.tenant_id, ps.product_id, ps.branch_id, ps.location_id, ps.quantity, ps.cost_per_unit
from public.product_stocks ps
where ps.tenant_id = (select public.current_tenant_id())
  and (select public.can_see_costs());

create or replace view public.product_costs
with (security_barrier = true) as
select p.id, p.tenant_id, p.branch_id, p.cost
from public.products p
where p.tenant_id = (select public.current_tenant_id())
  and (select public.can_see_costs());

revoke all on table public.product_stock_costs, public.product_costs from anon, authenticated;
grant select on table public.product_stock_costs, public.product_costs to authenticated;

-- Waste value is computed here from the FEFO lots, so it no longer depends on what the caller can read.
create or replace function public.fill_wastage_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot record;
  v_left numeric := new.quantity;
  v_take numeric;
  v_cost numeric := 0;
begin
  if new.product_id is null or new.location_id is null or new.quantity is null then
    return new;
  end if;
  for v_lot in
    select quantity, cost_per_unit
    from public.product_stocks
    where tenant_id = new.tenant_id
      and product_id = new.product_id
      and location_id = new.location_id
      and quantity > 0
    order by expiry_date nulls last, id
  loop
    exit when v_left <= 0;
    v_take := least(v_lot.quantity, v_left);
    v_cost := v_cost + v_take * coalesce(v_lot.cost_per_unit, 0);
    v_left := v_left - v_take;
  end loop;
  new.cost := v_cost;
  return new;
end;
$$;

revoke execute on function public.fill_wastage_cost() from public, anon, authenticated;

drop trigger if exists trg_wastage_cost on public.wastage_logs;
create trigger trg_wastage_cost
  before insert on public.wastage_logs
  for each row execute function public.fill_wastage_cost();

-- ---------------------------------------------------------------------------
-- 10. A cook never deletes: every tenant delete policy (tables and buckets) excludes the role.
-- ---------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname in ('public', 'storage')
      and cmd = 'DELETE'
      and qual ~ '\mcurrent_tenant_id\M'
      and qual !~ '\mcurrent_member_role\M'
  loop
    execute format(
      'alter policy %I on %I.%I using ((%s) and (select public.current_member_role()) is distinct from %L)',
      p.policyname, p.schemaname, p.tablename, p.qual, 'cook'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Final checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id'
  ) then
    raise exception 'organization_id still exists';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.tenant_id is not null
      and not exists (select 1 from public.memberships m where m.user_id = p.id and m.tenant_id = p.tenant_id)
  ) then
    raise exception 'profiles without a membership remain';
  end if;
  if exists (
    select 1 from public.tenants t
    where not exists (select 1 from public.tenant_settings s where s.tenant_id = t.id)
  ) then
    raise exception 'tenants without settings remain';
  end if;
end;
$$;

commit;
