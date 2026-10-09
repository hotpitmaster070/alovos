-- Kitchen stock: storage locations, balances, the movement log, and tasks.
-- Run in the Supabase SQL Editor after 20261006120004. Idempotent.
-- Does not change products or tenants. Default location names are data created per tenant.

-- ---------------------------------------------------------------------------
-- storage_locations
-- ---------------------------------------------------------------------------
create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  type text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, type)
);

create index if not exists idx_storage_locations_tenant_id on public.storage_locations(tenant_id);

-- ---------------------------------------------------------------------------
-- product_stocks
-- ---------------------------------------------------------------------------
create table if not exists public.product_stocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.storage_locations(id),
  quantity numeric not null default 0,
  unit text not null default 'sht',
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_id, location_id),
  constraint product_stocks_quantity_non_negative check (quantity >= 0),
  constraint product_stocks_unit_check check (unit in ('kg', 'litr', 'sht'))
);

create index if not exists idx_product_stocks_tenant_id on public.product_stocks(tenant_id);

-- ---------------------------------------------------------------------------
-- stock_movements is the log. 20261006120004 may already have created a narrower table.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  from_location_id uuid,
  to_location_id uuid,
  quantity numeric not null,
  movement_type text not null,
  reason text,
  user_id uuid,
  created_at timestamptz not null default now()
);

alter table public.stock_movements
  add column if not exists from_location_id uuid,
  add column if not exists to_location_id uuid,
  add column if not exists movement_type text,
  add column if not exists reason text,
  add column if not exists user_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'branch_id'
  ) then
    alter table public.stock_movements alter column branch_id drop not null;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'kind'
  ) then
    alter table public.stock_movements alter column kind drop not null;
  end if;
end;
$$;

update public.stock_movements
set movement_type = 'prihod'
where movement_type is null;

alter table public.stock_movements alter column movement_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_movements_from_location_id_fkey'
      and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table public.stock_movements
      add constraint stock_movements_from_location_id_fkey
      foreign key (from_location_id) references public.storage_locations(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_movements_to_location_id_fkey'
      and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table public.stock_movements
      add constraint stock_movements_to_location_id_fkey
      foreign key (to_location_id) references public.storage_locations(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_movements_user_id_fkey'
      and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table public.stock_movements
      add constraint stock_movements_user_id_fkey
      foreign key (user_id) references public.profiles(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_movements_type_check'
      and conrelid = 'public.stock_movements'::regclass
  ) then
    alter table public.stock_movements
      add constraint stock_movements_type_check
      check (movement_type in ('prihod', 'spisanie', 'peremeshchenie', 'waste', 'task'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_movements_quantity_positive'
      and conrelid = 'public.stock_movements'::regclass
  ) and not exists (
    select 1 from public.stock_movements where quantity is null or quantity <= 0
  ) then
    alter table public.stock_movements
      add constraint stock_movements_quantity_positive check (quantity > 0);
  end if;
end;
$$;

create index if not exists idx_stock_movements_tenant_created
  on public.stock_movements(tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- kitchen_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.kitchen_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title text not null,
  assigned_to uuid references public.profiles(id),
  status text not null default 'new',
  linked_product_id uuid references public.products(id),
  quantity_to_use numeric,
  from_location_id uuid references public.storage_locations(id),
  created_at timestamptz not null default now(),
  constraint kitchen_tasks_status_check check (status in ('new', 'in_progress', 'done'))
);

create index if not exists idx_kitchen_tasks_tenant_id on public.kitchen_tasks(tenant_id);

-- ---------------------------------------------------------------------------
-- Three default locations for every tenant, including ones created later.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_default_storage_locations(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_locations (tenant_id, name, type)
  select p_tenant, loc.name, loc.type
  from (
    values
      ('sklad', 'sklad'),
      ('holodilnik', 'holodilnik'),
      ('morozilka', 'morozilka')
  ) as loc(name, type)
  where not exists (
    select 1 from public.storage_locations existing
    where existing.tenant_id = p_tenant and existing.type = loc.type
  );
end;
$$;

revoke execute on function public.ensure_default_storage_locations(uuid) from public, anon, authenticated;

create or replace function public.storage_locations_for_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_default_storage_locations(new.id);
  return new;
end;
$$;

revoke execute on function public.storage_locations_for_new_tenant() from public, anon, authenticated;

drop trigger if exists tenants_default_storage_locations on public.tenants;
create trigger tenants_default_storage_locations
  after insert on public.tenants
  for each row execute function public.storage_locations_for_new_tenant();

-- Existing tenants get their defaults here. A database that already has the later schema
-- (storage_locations.branch_id with check_storage_location_branch(), 20261008020000) rejects
-- branchless rows: that tenant is skipped with a notice, 20261008020000 creates its places.
do $$
declare
  t record;
begin
  if to_regclass('public.tenants') is null or not exists (select 1 from public.tenants) then
    raise notice 'no tenants: default storage locations skipped';
    return;
  end if;
  for t in select id from public.tenants loop
    begin
      perform public.ensure_default_storage_locations(t.id);
    exception when others then
      raise notice 'default storage locations skipped for tenant %: %', t.id, sqlerrm;
    end;
  end loop;
end;
$$;

alter table public.profiles
  add column if not exists tenant_id uuid references public.tenants(id);

-- ---------------------------------------------------------------------------
-- A movement is the only write. The trigger keeps product_stocks in step.
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

create or replace function public.adjust_product_stock(
  p_tenant uuid,
  p_product uuid,
  p_location uuid,
  p_delta numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_after numeric;
begin
  insert into public.product_stocks (tenant_id, product_id, location_id, quantity, unit)
  values (p_tenant, p_product, p_location, 0, 'sht')
  on conflict (tenant_id, product_id, location_id) do nothing;

  update public.product_stocks
  set quantity = quantity + p_delta,
      updated_at = now()
  where tenant_id = p_tenant
    and product_id = p_product
    and location_id = p_location
    and quantity + p_delta >= 0
  returning quantity into v_after;

  if v_after is null then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public.stamp_stock_movement()
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
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_stock_movement() from public, anon, authenticated;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.products where id = new.product_id and tenant_id = new.tenant_id
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if new.from_location_id is not null and not exists (
    select 1 from public.storage_locations
    where id = new.from_location_id and tenant_id = new.tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  if new.to_location_id is not null and not exists (
    select 1 from public.storage_locations
    where id = new.to_location_id and tenant_id = new.tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  if new.movement_type = 'prihod' then
    if new.to_location_id is null then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    perform public.adjust_product_stock(new.tenant_id, new.product_id, new.to_location_id, new.quantity);
  elsif new.movement_type in ('spisanie', 'waste', 'task') then
    if new.from_location_id is null then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    perform public.adjust_product_stock(new.tenant_id, new.product_id, new.from_location_id, -new.quantity);
  elsif new.movement_type = 'peremeshchenie' then
    if new.from_location_id is null or new.to_location_id is null then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    if new.from_location_id = new.to_location_id then
      raise exception 'same_location' using errcode = '22023';
    end if;
    perform public.adjust_product_stock(new.tenant_id, new.product_id, new.from_location_id, -new.quantity);
    perform public.adjust_product_stock(new.tenant_id, new.product_id, new.to_location_id, new.quantity);
  else
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_stock_movement() from public, anon, authenticated;

drop trigger if exists stock_movements_ledger on public.stock_movements;
drop trigger if exists stock_movements_enforce_tenant on public.stock_movements;
drop trigger if exists stock_movements_stamp on public.stock_movements;
drop trigger if exists stock_movements_apply on public.stock_movements;

create trigger stock_movements_stamp
  before insert on public.stock_movements
  for each row execute function public.stamp_stock_movement();

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------------------------------------------------------------------------
-- RLS. auth.uid() -> profiles.tenant_id. Each restaurant sees only its rows.
-- ---------------------------------------------------------------------------
alter table public.storage_locations enable row level security;
alter table public.product_stocks enable row level security;
alter table public.stock_movements enable row level security;
alter table public.kitchen_tasks enable row level security;

revoke all on public.storage_locations, public.product_stocks, public.stock_movements, public.kitchen_tasks from anon;
revoke update, delete on public.stock_movements from authenticated;
revoke insert, update, delete on public.product_stocks from authenticated;
revoke truncate, references, trigger on public.storage_locations, public.product_stocks,
  public.stock_movements, public.kitchen_tasks from authenticated;

grant select, insert, update, delete on public.storage_locations to authenticated;
grant select on public.product_stocks to authenticated;
grant select, insert on public.stock_movements to authenticated;
grant select, insert, update, delete on public.kitchen_tasks to authenticated;

drop policy if exists storage_locations_select on public.storage_locations;
drop policy if exists storage_locations_insert on public.storage_locations;
drop policy if exists storage_locations_update on public.storage_locations;
drop policy if exists storage_locations_delete on public.storage_locations;
drop policy if exists product_stocks_select on public.product_stocks;
drop policy if exists stock_movements_select on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists kitchen_tasks_select on public.kitchen_tasks;
drop policy if exists kitchen_tasks_insert on public.kitchen_tasks;
drop policy if exists kitchen_tasks_update on public.kitchen_tasks;
drop policy if exists kitchen_tasks_delete on public.kitchen_tasks;

create policy storage_locations_select on public.storage_locations
  for select to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy storage_locations_insert on public.storage_locations
  for insert to authenticated
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy storage_locations_update on public.storage_locations
  for update to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy storage_locations_delete on public.storage_locations
  for delete to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy product_stocks_select on public.product_stocks
  for select to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy kitchen_tasks_select on public.kitchen_tasks
  for select to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy kitchen_tasks_insert on public.kitchen_tasks
  for insert to authenticated
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy kitchen_tasks_update on public.kitchen_tasks
  for update to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
create policy kitchen_tasks_delete on public.kitchen_tasks
  for delete to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));
