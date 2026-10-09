-- ANBAR catalog and tenant isolation.
-- Run after 20261006120003. Idempotent.
-- tenants share the id of an existing organization so locations, invoices and move_stock
-- keep working. Anbar rows are isolated by profiles.tenant_id via current_tenant_id().
-- No branch names are inserted here. Local sample data lives in supabase/seed.sql only.

-- Guards for databases whose tables predate these migrations (session-only helpers, see
-- 20261006120003): run the statement only when the table and all listed columns exist.
create or replace function pg_temp.has_columns(p_table text, p_columns text[])
returns boolean
language sql
stable
as $$
  select to_regclass(format('public.%I', p_table)) is not null
    and not exists (
      select 1 from unnest(p_columns) as col
      where not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = p_table and column_name = col
      )
    )
$$;

create or replace function pg_temp.exec_if(p_table text, p_columns text[], p_sql text)
returns void
language plpgsql
as $$
begin
  if pg_temp.has_columns(p_table, p_columns) then
    execute p_sql;
  else
    raise notice 'skipped, public.% or its column(s) % missing: %', p_table, p_columns, left(p_sql, 120);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.tenants (id, name, created_at)
select id, name, coalesce(created_at, now())
from public.organizations
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- branches: one tenant, many branches. Names are rows, never constants in the app.
-- ---------------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists idx_branches_tenant_id on public.branches(tenant_id);

-- ---------------------------------------------------------------------------
-- profiles: auth.uid() -> profile -> tenant_id
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists tenant_id uuid,
  add column if not exists branch_id uuid;

select pg_temp.exec_if('profiles', array['organization_id'],
  'update public.profiles set tenant_id = organization_id where tenant_id is null and organization_id is not null');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_tenant_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_branch_id_fkey' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_branch_id_fkey
      foreign key (branch_id) references public.branches(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_profiles_tenant_id on public.profiles(tenant_id);
create index if not exists idx_profiles_branch_id on public.profiles(branch_id);

-- ---------------------------------------------------------------------------
-- products.quantity is a real balance, not a generated column.
-- A previous draft may have added a generated quantity or a text branch name.
-- ---------------------------------------------------------------------------
do $$
declare
  generated text;
begin
  select is_generated into generated
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'quantity';

  if generated = 'ALWAYS' then
    alter table public.products drop column quantity;
  end if;
end;
$$;

alter table public.products drop column if exists branch;

alter table public.products
  add column if not exists tenant_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists quantity numeric not null default 0;

select pg_temp.exec_if('products', array['organization_id'],
  'update public.products set tenant_id = organization_id where tenant_id is null and organization_id is not null');

select pg_temp.exec_if('products', array['qty'],
  'update public.products set quantity = qty::numeric where quantity = 0 and qty is not null and qty <> 0');

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

  if not exists (
    select 1 from pg_constraint
    where conname = 'products_branch_id_fkey' and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_branch_id_fkey
      foreign key (branch_id) references public.branches(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'products_quantity_non_negative' and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_quantity_non_negative check (quantity >= 0);
  end if;
end;
$$;

create index if not exists idx_products_tenant_id on public.products(tenant_id);
create index if not exists idx_products_branch_id on public.products(branch_id);

-- ---------------------------------------------------------------------------
-- stock, stock_movements, stock_ledger
-- ---------------------------------------------------------------------------
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  branch_id uuid not null references public.branches(id),
  quantity numeric not null default 0,
  unique (tenant_id, product_id, branch_id),
  constraint stock_quantity_non_negative check (quantity >= 0)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  branch_id uuid not null references public.branches(id),
  quantity numeric not null,
  kind text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  branch_id uuid not null references public.branches(id),
  movement_id uuid not null references public.stock_movements(id),
  delta numeric not null,
  quantity_after numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_tenant_id on public.stock(tenant_id);
create index if not exists idx_stock_movements_tenant_id on public.stock_movements(tenant_id);
create index if not exists idx_stock_ledger_tenant_id on public.stock_ledger(tenant_id);
create index if not exists idx_stock_ledger_movement_id on public.stock_ledger(movement_id);

-- ---------------------------------------------------------------------------
-- current_tenant_id(): auth.uid() -> profiles.tenant_id
-- SECURITY DEFINER so policies on profiles do not recurse.
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid() limit 1
$$;

revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;

-- Stamp the caller's tenant on write. A supplied tenant_id that does not match is rejected.
create or replace function public.enforce_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if new.tenant_id is not null and new.tenant_id is distinct from v_tenant then
    raise exception 'tenant_mismatch' using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;

  if tg_table_name = 'products' and new.branch_id is not null then
    if not exists (
      select 1 from public.branches where id = new.branch_id and tenant_id = v_tenant
    ) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  end if;

  if tg_table_name = 'stock' then
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

drop trigger if exists branches_enforce_tenant on public.branches;
create trigger branches_enforce_tenant
  before insert or update on public.branches
  for each row execute function public.enforce_tenant_id();

drop trigger if exists products_enforce_tenant on public.products;
create trigger products_enforce_tenant
  before insert or update on public.products
  for each row execute function public.enforce_tenant_id();

drop trigger if exists stock_enforce_tenant on public.stock;
create trigger stock_enforce_tenant
  before insert or update on public.stock
  for each row execute function public.enforce_tenant_id();

drop trigger if exists stock_movements_enforce_tenant on public.stock_movements;
create trigger stock_movements_enforce_tenant
  before insert or update on public.stock_movements
  for each row execute function public.enforce_tenant_id();

-- Append-only ledger. A movement updates stock and the product balance, then writes the ledger.
create or replace function public.record_stock_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after numeric;
begin
  insert into public.stock (tenant_id, product_id, branch_id, quantity)
  values (new.tenant_id, new.product_id, new.branch_id, 0)
  on conflict (tenant_id, product_id, branch_id) do nothing;

  update public.stock
  set quantity = quantity + new.quantity
  where tenant_id = new.tenant_id
    and product_id = new.product_id
    and branch_id = new.branch_id
  returning quantity into v_after;

  if v_after is null or v_after < 0 then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  insert into public.stock_ledger (
    tenant_id, product_id, branch_id, movement_id, delta, quantity_after
  ) values (
    new.tenant_id, new.product_id, new.branch_id, new.id, new.quantity, v_after
  );

  update public.products
  set quantity = (
    select coalesce(sum(quantity), 0)
    from public.stock
    where tenant_id = new.tenant_id
      and product_id = new.product_id
  )
  where id = new.product_id
    and tenant_id = new.tenant_id;

  return new;
end;
$$;

revoke execute on function public.record_stock_ledger() from public, anon, authenticated;

-- Kitchen stock (20261007120000) owns stock_movements. Do not attach the branch ledger here.
drop trigger if exists stock_movements_ledger on public.stock_movements;

-- ---------------------------------------------------------------------------
-- Signup and recovery also create the tenant and stamp profiles.tenant_id.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid := gen_random_uuid();
  tenant_name text;
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  begin
    tenant_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'organization_name'), ''),
      nullif(trim(split_part(new.email, '@', 1)), ''),
      'My Restaurant'
    );

    insert into public.tenants (id, name) values (new_tenant_id, tenant_name);
    insert into public.organizations (id, name) values (new_tenant_id, tenant_name);

    insert into public.profiles (id, organization_id, tenant_id, role, email)
    values (new.id, new_tenant_id, new_tenant_id, 'owner', new.email);
  exception when others then
    raise log 'handle_new_user failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.ensure_my_organization()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  user_meta jsonb;
  org_id uuid;
  existing_tenant uuid;
  new_tenant_id uuid := gen_random_uuid();
  tenant_name text;
  affected integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ensure_my_organization:' || uid::text, 0));

  select organization_id, tenant_id into org_id, existing_tenant
  from public.profiles where id = uid;

  if org_id is not null then
    insert into public.tenants (id, name, created_at)
    select id, name, coalesce(created_at, now())
    from public.organizations
    where id = org_id
    on conflict (id) do nothing;

    if existing_tenant is null then
      update public.profiles set tenant_id = org_id where id = uid and tenant_id is null;
    end if;
    return org_id;
  end if;

  if existing_tenant is not null then
    return existing_tenant;
  end if;

  select email, raw_user_meta_data into user_email, user_meta
  from auth.users where id = uid;
  if not found then
    raise exception 'user % does not exist', uid using errcode = '28000';
  end if;

  tenant_name := coalesce(
    nullif(trim(user_meta ->> 'organization_name'), ''),
    nullif(trim(split_part(user_email, '@', 1)), ''),
    'My Restaurant'
  );

  insert into public.tenants (id, name) values (new_tenant_id, tenant_name);
  insert into public.organizations (id, name) values (new_tenant_id, tenant_name);

  insert into public.profiles (id, organization_id, tenant_id, role, email)
  values (uid, new_tenant_id, new_tenant_id, 'owner', user_email)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        tenant_id = excluded.tenant_id,
        role = coalesce(public.profiles.role, 'owner'),
        email = coalesce(public.profiles.email, excluded.email)
    where public.profiles.organization_id is null
      and public.profiles.tenant_id is null;

  get diagnostics affected = row_count;
  if affected = 0 then
    delete from public.organizations where id = new_tenant_id;
    delete from public.tenants where id = new_tenant_id;
    select coalesce(tenant_id, organization_id) into org_id from public.profiles where id = uid;
    return org_id;
  end if;

  return new_tenant_id;
end;
$$;

revoke execute on function public.ensure_my_organization() from public, anon;
grant execute on function public.ensure_my_organization() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS on every public table. Anbar policies require tenant_id = current_tenant_id().
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

revoke all on public.tenants, public.branches, public.stock, public.stock_movements, public.stock_ledger
  from anon;

revoke insert, delete on public.tenants from authenticated;
revoke update, delete on public.stock_movements from authenticated;
revoke insert, update, delete on public.stock, public.stock_ledger from authenticated;
revoke truncate, references, trigger on public.tenants, public.branches, public.stock,
  public.stock_movements, public.stock_ledger from authenticated;

drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_update on public.tenants;
drop policy if exists branches_select on public.branches;
drop policy if exists branches_insert on public.branches;
drop policy if exists branches_update on public.branches;
drop policy if exists branches_delete on public.branches;
drop policy if exists stock_select on public.stock;
drop policy if exists stock_movements_select on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists stock_ledger_select on public.stock_ledger;

drop policy if exists products_select on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;

create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select public.current_tenant_id()));

create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select public.current_tenant_id()))
  with check (id = (select public.current_tenant_id()));

create policy branches_select on public.branches
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy branches_insert on public.branches
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));
create policy branches_update on public.branches
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy branches_delete on public.branches
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- Products without organization_id (older databases) are isolated by tenant_id alone.
do $$
declare
  v_check constant text := case
    when pg_temp.has_columns('products', array['organization_id'])
      then 'tenant_id = (select public.current_tenant_id()) and organization_id = (select public.current_org_id())'
    else 'tenant_id = (select public.current_tenant_id())'
  end;
begin
  execute format('create policy products_select on public.products for select to authenticated using (%s)', v_check);
  execute format('create policy products_insert on public.products for insert to authenticated with check (%s)', v_check);
  execute format('create policy products_update on public.products for update to authenticated using (%1$s) with check (%1$s)', v_check);
  execute format('create policy products_delete on public.products for delete to authenticated using (%s)', v_check);
end;
$$;

create policy stock_select on public.stock
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));

create policy stock_ledger_select on public.stock_ledger
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
