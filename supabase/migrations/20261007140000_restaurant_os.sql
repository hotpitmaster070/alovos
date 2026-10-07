-- Restaurant OS. Idempotent. Run twice safely.
-- Order: tables and indexes, then functions, then triggers, then RLS.
-- products and tenants already exist and are not recreated.
-- tenants only gains settings. No branch, room, or currency rows are inserted.
-- Branches exist before any policy. Policies are written out, not built in a loop.
-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists settings jsonb not null default '{}'::jsonb;
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  address text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.branches add column if not exists address text;
alter table public.branches add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.branches add column if not exists created_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_tenant_id_name_key' and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches
      add constraint branches_tenant_id_name_key unique (tenant_id, name);
  end if;
end;
$$;
create index if not exists idx_branches_tenant_id on public.branches (tenant_id);
create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  name text not null,
  type text not null,
  created_at timestamptz not null default now()
);
alter table public.storage_locations
  add column if not exists branch_id uuid references public.branches(id);
alter table public.storage_locations
  drop constraint if exists storage_locations_tenant_id_type_key;
create index if not exists idx_storage_locations_tenant_id on public.storage_locations (tenant_id);
create index if not exists idx_storage_locations_branch_id on public.storage_locations (branch_id);
create table if not exists public.product_stocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.storage_locations(id),
  quantity numeric not null default 0,
  unit text not null default 'unit',
  expiry_date date,
  cost_per_unit numeric,
  updated_at timestamptz not null default now(),
  constraint product_stocks_quantity_non_negative check (quantity >= 0)
);
alter table public.product_stocks add column if not exists branch_id uuid references public.branches(id);
alter table public.product_stocks add column if not exists expiry_date date;
alter table public.product_stocks add column if not exists cost_per_unit numeric;
alter table public.product_stocks add column if not exists updated_at timestamptz not null default now();
alter table public.product_stocks drop constraint if exists product_stocks_unit_check;
alter table public.product_stocks drop constraint if exists product_stocks_tenant_id_product_id_location_id_key;
create unique index if not exists product_stocks_lot_unique
  on public.product_stocks (branch_id, location_id, product_id, expiry_date) nulls not distinct;
create index if not exists idx_product_stocks_tenant_id on public.product_stocks (tenant_id);
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  branch_id uuid references public.branches(id),
  from_location_id uuid references public.storage_locations(id),
  to_location_id uuid references public.storage_locations(id),
  quantity numeric not null,
  movement_type text not null,
  reason text,
  user_id uuid references public.profiles(id),
  expiry_date date,
  cost_per_unit numeric,
  unit text,
  created_at timestamptz not null default now()
);
alter table public.stock_movements add column if not exists from_location_id uuid;
alter table public.stock_movements add column if not exists to_location_id uuid;
alter table public.stock_movements add column if not exists movement_type text;
alter table public.stock_movements add column if not exists reason text;
alter table public.stock_movements add column if not exists user_id uuid;
alter table public.stock_movements add column if not exists branch_id uuid;
alter table public.stock_movements add column if not exists expiry_date date;
alter table public.stock_movements add column if not exists cost_per_unit numeric;
alter table public.stock_movements add column if not exists unit text;
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
update public.stock_movements set movement_type = 'prihod' where movement_type is null;
alter table public.stock_movements alter column movement_type set not null;
alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check
  check (movement_type in ('prihod', 'spisanie', 'peremeshchenie', 'transfer', 'waste', 'task', 'count'));
create index if not exists idx_stock_movements_tenant_created on public.stock_movements (tenant_id, created_at desc);
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  location_id uuid references public.storage_locations(id),
  group_key text,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stock_count_id uuid not null references public.stock_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  counted_quantity numeric not null check (counted_quantity >= 0)
);
create index if not exists idx_stock_counts_tenant_id on public.stock_counts (tenant_id);
create index if not exists idx_stock_count_items_count_id on public.stock_count_items (stock_count_id);
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  name text not null,
  contact text,
  price_list_url text,
  rating numeric,
  delivery_days integer
);
alter table public.suppliers add column if not exists tenant_id uuid references public.tenants(id);
alter table public.suppliers add column if not exists price_list_url text;
alter table public.suppliers add column if not exists rating numeric;
alter table public.suppliers add column if not exists delivery_days integer;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'suppliers' and column_name = 'organization_id'
  ) then
    update public.suppliers
    set tenant_id = organization_id
    where tenant_id is null and organization_id is not null;
  end if;
end;
$$;
create index if not exists idx_suppliers_tenant_id on public.suppliers (tenant_id);
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  supplier_id uuid references public.suppliers(id),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'ordered', 'received', 'cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid references public.products(id),
  quantity numeric not null check (quantity > 0),
  unit_price numeric
);
create index if not exists idx_purchase_orders_tenant_id on public.purchase_orders (tenant_id);
create index if not exists idx_purchase_order_items_order_id on public.purchase_order_items (purchase_order_id);
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  supplier_id uuid references public.suppliers(id),
  parsed_json jsonb,
  total numeric,
  created_at timestamptz default now()
);
alter table public.invoices add column if not exists tenant_id uuid references public.tenants(id);
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'organization_id'
  ) then
    update public.invoices
    set tenant_id = organization_id
    where tenant_id is null and organization_id is not null;
  end if;
end;
$$;
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id),
  description text,
  quantity numeric not null default 0,
  unit_price numeric
);
create index if not exists idx_invoices_tenant_id on public.invoices (tenant_id);
create index if not exists idx_invoice_items_invoice_id on public.invoice_items (invoice_id);
create table if not exists public.tech_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  allergens text,
  calories numeric,
  created_at timestamptz not null default now()
);
create table if not exists public.tech_card_ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  tech_card_id uuid not null references public.tech_cards(id) on delete cascade,
  product_id uuid not null references public.products(id),
  brutto numeric not null default 0,
  netto numeric not null default 0,
  waste_percent numeric not null default 0,
  yield_quantity numeric not null default 0
);
create index if not exists idx_tech_cards_tenant_id on public.tech_cards (tenant_id);
create index if not exists idx_tech_card_ingredients_card_id on public.tech_card_ingredients (tech_card_id);
create table if not exists public.wastage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid references public.products(id),
  reason text not null check (reason in ('spoiled', 'overcooked', 'dropped', 'expired', 'theft', 'other')),
  photo_path text,
  weight numeric,
  cost numeric,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_wastage_logs_tenant_id on public.wastage_logs (tenant_id);
create table if not exists public.prep_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title text not null,
  product_id uuid references public.products(id),
  quantity numeric,
  for_date date,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_prep_tasks_tenant_id on public.prep_tasks (tenant_id);
create table if not exists public.kitchen_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  title text not null,
  assigned_to uuid references public.profiles(id),
  status text not null default 'new' check (status in ('new', 'in_progress', 'done')),
  linked_product_id uuid references public.products(id),
  quantity_to_use numeric,
  from_location_id uuid references public.storage_locations(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_kitchen_tasks_tenant_id on public.kitchen_tasks (tenant_id);
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid references public.profiles(id),
  pin text,
  role text not null default 'staff',
  hourly_rate numeric,
  unique (tenant_id, user_id)
);
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  staff_id uuid references public.staff(id),
  started_at timestamptz,
  ended_at timestamptz,
  photo_path text
);
create index if not exists idx_staff_tenant_id on public.staff (tenant_id);
create index if not exists idx_shifts_tenant_id on public.shifts (tenant_id);
create table if not exists public.haccp_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  location_id uuid references public.storage_locations(id),
  kind text not null,
  reading numeric,
  note text,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_haccp_logs_tenant_id on public.haccp_logs (tenant_id);
create table if not exists public.pos_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  type text not null,
  api_key text,
  webhook_secret text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pos_integrations_tenant_id on public.pos_integrations (tenant_id);
-- ---------------------------------------------------------------------------

-- 2. Functions. Every table above already exists.
-- ---------------------------------------------------------------------------
create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid() limit 1
$$;
revoke execute on function public.my_tenant_id() from public, anon;
grant execute on function public.my_tenant_id() to authenticated;
create or replace function public.create_default_storage_for_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.storage_locations
    where tenant_id = new.tenant_id and branch_id = new.id
  ) then
    return new;
  end if;
  if new.name is null or length(trim(new.name)) = 0 then
    return new;
  end if;
  insert into public.storage_locations (tenant_id, branch_id, name, type)
  values (new.tenant_id, new.id, trim(new.name), 'general');
  return new;
end;
$$;
revoke execute on function public.create_default_storage_for_branch() from public, anon, authenticated;
create or replace function public.ensure_default_storage_locations(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;
revoke execute on function public.ensure_default_storage_locations(uuid) from public, anon, authenticated;
create or replace function public.handle_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.product_stocks%rowtype;
  v_left numeric;
  v_take numeric;
  v_target uuid;
begin
  if not exists (
    select 1 from public.products where id = new.product_id and tenant_id = new.tenant_id
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if new.movement_type in ('peremeshchenie', 'transfer') then
    if new.from_location_id is null or new.to_location_id is null or new.from_location_id = new.to_location_id then
      raise exception 'same_location' using errcode = '22023';
    end if;
  end if;
  if new.movement_type = 'prihod'
     or (new.movement_type = 'count' and new.to_location_id is not null and new.from_location_id is null) then
    v_target := new.to_location_id;
    if v_target is null then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    insert into public.product_stocks (
      tenant_id, branch_id, product_id, location_id, expiry_date, quantity, cost_per_unit, unit
    ) values (
      new.tenant_id, new.branch_id, new.product_id, v_target, new.expiry_date, new.quantity, new.cost_per_unit,
      coalesce(new.unit, 'unit')
    )
    on conflict (branch_id, location_id, product_id, expiry_date) do update
      set quantity = public.product_stocks.quantity + excluded.quantity,
          cost_per_unit = coalesce(excluded.cost_per_unit, public.product_stocks.cost_per_unit),
          updated_at = now();
    return new;
  end if;
  if new.movement_type in ('spisanie', 'waste', 'task', 'count', 'peremeshchenie', 'transfer') then
    if new.from_location_id is null then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    v_left := new.quantity;
    for v_lot in
      select * from public.product_stocks
      where tenant_id = new.tenant_id
        and product_id = new.product_id
        and location_id = new.from_location_id
        and (new.branch_id is null or branch_id is not distinct from new.branch_id)
      order by expiry_date nulls last, id
      for update
    loop
      exit when v_left <= 0;
      v_take := least(v_lot.quantity, v_left);
      update public.product_stocks
      set quantity = quantity - v_take, updated_at = now()
      where id = v_lot.id;
      v_left := v_left - v_take;
      if new.movement_type in ('peremeshchenie', 'transfer') then
        insert into public.product_stocks (
          tenant_id, branch_id, product_id, location_id, expiry_date, quantity, cost_per_unit, unit
        ) values (
          new.tenant_id, coalesce(new.branch_id, v_lot.branch_id), new.product_id, new.to_location_id,
          v_lot.expiry_date, v_take, v_lot.cost_per_unit, v_lot.unit
        )
        on conflict (branch_id, location_id, product_id, expiry_date) do update
          set quantity = public.product_stocks.quantity + excluded.quantity,
              updated_at = now();
      end if;
    end loop;
    if v_left > 0 then
      raise exception 'insufficient_stock' using errcode = '22003';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_stock_movement() from public, anon, authenticated;
-- ---------------------------------------------------------------------------

-- 3. Triggers. Attached only after the functions and tables exist.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_branch_default_storage on public.branches;
create trigger trg_branch_default_storage
  after insert on public.branches
  for each row execute function public.create_default_storage_for_branch();
drop trigger if exists stock_movements_apply on public.stock_movements;
drop trigger if exists trg_stock_movement_handle on public.stock_movements;
create trigger trg_stock_movement_handle
  after insert on public.stock_movements
  for each row execute function public.handle_stock_movement();
-- ---------------------------------------------------------------------------

-- 4. RLS. branches and every other table already exist. Each policy is dropped first.
-- ---------------------------------------------------------------------------
alter table public.branches enable row level security;

revoke all on table public.branches, public.storage_locations, public.product_stocks,
  public.stock_movements, public.stock_counts, public.stock_count_items, public.suppliers,
  public.purchase_orders, public.purchase_order_items, public.invoices, public.invoice_items,
  public.tech_cards, public.tech_card_ingredients, public.wastage_logs, public.prep_tasks,
  public.kitchen_tasks, public.staff, public.shifts, public.haccp_logs, public.pos_integrations
  from anon;
grant select, insert, update, delete on table public.branches, public.storage_locations,
  public.stock_counts, public.stock_count_items, public.suppliers, public.purchase_orders,
  public.purchase_order_items, public.invoices, public.invoice_items, public.tech_cards,
  public.tech_card_ingredients, public.wastage_logs, public.prep_tasks, public.kitchen_tasks,
  public.staff, public.shifts, public.haccp_logs, public.pos_integrations to authenticated;
grant select on table public.product_stocks to authenticated;
grant select, insert on table public.stock_movements to authenticated;
revoke insert, update, delete on table public.product_stocks from authenticated;
revoke update, delete on table public.stock_movements from authenticated;

-- Balances move only through handle_stock_movement, so product_stocks is not writable here.
-- Movement history can be inserted and read. It cannot be edited.
-- Each policy is dropped first, so this script can run again.
-- The branch table above is the one these branch policies attach to.
drop policy if exists branches_select on public.branches;
drop policy if exists branches_insert on public.branches;
drop policy if exists branches_update on public.branches;
drop policy if exists branches_delete on public.branches;
create policy branches_select on public.branches for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy branches_insert on public.branches for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy branches_update on public.branches for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy branches_delete on public.branches for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.storage_locations enable row level security;
drop policy if exists storage_locations_select on public.storage_locations;
drop policy if exists storage_locations_insert on public.storage_locations;
drop policy if exists storage_locations_update on public.storage_locations;
drop policy if exists storage_locations_delete on public.storage_locations;
create policy storage_locations_select on public.storage_locations for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy storage_locations_insert on public.storage_locations for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy storage_locations_update on public.storage_locations for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy storage_locations_delete on public.storage_locations for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.product_stocks enable row level security;
drop policy if exists product_stocks_select on public.product_stocks;
drop policy if exists product_stocks_insert on public.product_stocks;
drop policy if exists product_stocks_update on public.product_stocks;
drop policy if exists product_stocks_delete on public.product_stocks;
create policy product_stocks_select on public.product_stocks for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy product_stocks_insert on public.product_stocks for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy product_stocks_update on public.product_stocks for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy product_stocks_delete on public.product_stocks for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.stock_movements enable row level security;
drop policy if exists stock_movements_select on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists stock_movements_update on public.stock_movements;
drop policy if exists stock_movements_delete on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy stock_movements_insert on public.stock_movements for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy stock_movements_update on public.stock_movements for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy stock_movements_delete on public.stock_movements for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.stock_counts enable row level security;
drop policy if exists stock_counts_select on public.stock_counts;
drop policy if exists stock_counts_insert on public.stock_counts;
drop policy if exists stock_counts_update on public.stock_counts;
drop policy if exists stock_counts_delete on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy stock_counts_insert on public.stock_counts for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy stock_counts_update on public.stock_counts for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy stock_counts_delete on public.stock_counts for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.stock_count_items enable row level security;
drop policy if exists stock_count_items_select on public.stock_count_items;
drop policy if exists stock_count_items_insert on public.stock_count_items;
drop policy if exists stock_count_items_update on public.stock_count_items;
drop policy if exists stock_count_items_delete on public.stock_count_items;
create policy stock_count_items_select on public.stock_count_items for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy stock_count_items_insert on public.stock_count_items for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy stock_count_items_update on public.stock_count_items for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy stock_count_items_delete on public.stock_count_items for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.suppliers enable row level security;
drop policy if exists suppliers_select on public.suppliers;
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy suppliers_update on public.suppliers for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy suppliers_delete on public.suppliers for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy purchase_orders_update on public.purchase_orders for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy purchase_orders_delete on public.purchase_orders for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.purchase_order_items enable row level security;
drop policy if exists purchase_order_items_select on public.purchase_order_items;
drop policy if exists purchase_order_items_insert on public.purchase_order_items;
drop policy if exists purchase_order_items_update on public.purchase_order_items;
drop policy if exists purchase_order_items_delete on public.purchase_order_items;
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy purchase_order_items_insert on public.purchase_order_items for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy purchase_order_items_update on public.purchase_order_items for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy purchase_order_items_delete on public.purchase_order_items for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.invoices enable row level security;
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;
create policy invoices_select on public.invoices for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy invoices_insert on public.invoices for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy invoices_update on public.invoices for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy invoices_delete on public.invoices for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.invoice_items enable row level security;
drop policy if exists invoice_items_select on public.invoice_items;
drop policy if exists invoice_items_insert on public.invoice_items;
drop policy if exists invoice_items_update on public.invoice_items;
drop policy if exists invoice_items_delete on public.invoice_items;
create policy invoice_items_select on public.invoice_items for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy invoice_items_insert on public.invoice_items for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy invoice_items_update on public.invoice_items for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy invoice_items_delete on public.invoice_items for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.tech_cards enable row level security;
drop policy if exists tech_cards_select on public.tech_cards;
drop policy if exists tech_cards_insert on public.tech_cards;
drop policy if exists tech_cards_update on public.tech_cards;
drop policy if exists tech_cards_delete on public.tech_cards;
create policy tech_cards_select on public.tech_cards for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy tech_cards_insert on public.tech_cards for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy tech_cards_update on public.tech_cards for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy tech_cards_delete on public.tech_cards for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.tech_card_ingredients enable row level security;
drop policy if exists tech_card_ingredients_select on public.tech_card_ingredients;
drop policy if exists tech_card_ingredients_insert on public.tech_card_ingredients;
drop policy if exists tech_card_ingredients_update on public.tech_card_ingredients;
drop policy if exists tech_card_ingredients_delete on public.tech_card_ingredients;
create policy tech_card_ingredients_select on public.tech_card_ingredients for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy tech_card_ingredients_insert on public.tech_card_ingredients for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy tech_card_ingredients_update on public.tech_card_ingredients for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy tech_card_ingredients_delete on public.tech_card_ingredients for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.wastage_logs enable row level security;
drop policy if exists wastage_logs_select on public.wastage_logs;
drop policy if exists wastage_logs_insert on public.wastage_logs;
drop policy if exists wastage_logs_update on public.wastage_logs;
drop policy if exists wastage_logs_delete on public.wastage_logs;
create policy wastage_logs_select on public.wastage_logs for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy wastage_logs_insert on public.wastage_logs for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy wastage_logs_update on public.wastage_logs for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy wastage_logs_delete on public.wastage_logs for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.prep_tasks enable row level security;
drop policy if exists prep_tasks_select on public.prep_tasks;
drop policy if exists prep_tasks_insert on public.prep_tasks;
drop policy if exists prep_tasks_update on public.prep_tasks;
drop policy if exists prep_tasks_delete on public.prep_tasks;
create policy prep_tasks_select on public.prep_tasks for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy prep_tasks_insert on public.prep_tasks for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy prep_tasks_update on public.prep_tasks for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy prep_tasks_delete on public.prep_tasks for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.kitchen_tasks enable row level security;
drop policy if exists kitchen_tasks_select on public.kitchen_tasks;
drop policy if exists kitchen_tasks_insert on public.kitchen_tasks;
drop policy if exists kitchen_tasks_update on public.kitchen_tasks;
drop policy if exists kitchen_tasks_delete on public.kitchen_tasks;
create policy kitchen_tasks_select on public.kitchen_tasks for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy kitchen_tasks_insert on public.kitchen_tasks for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy kitchen_tasks_update on public.kitchen_tasks for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy kitchen_tasks_delete on public.kitchen_tasks for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.staff enable row level security;
drop policy if exists staff_select on public.staff;
drop policy if exists staff_insert on public.staff;
drop policy if exists staff_update on public.staff;
drop policy if exists staff_delete on public.staff;
create policy staff_select on public.staff for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy staff_insert on public.staff for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy staff_update on public.staff for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy staff_delete on public.staff for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.shifts enable row level security;
drop policy if exists shifts_select on public.shifts;
drop policy if exists shifts_insert on public.shifts;
drop policy if exists shifts_update on public.shifts;
drop policy if exists shifts_delete on public.shifts;
create policy shifts_select on public.shifts for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy shifts_insert on public.shifts for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy shifts_update on public.shifts for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy shifts_delete on public.shifts for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.haccp_logs enable row level security;
drop policy if exists haccp_logs_select on public.haccp_logs;
drop policy if exists haccp_logs_insert on public.haccp_logs;
drop policy if exists haccp_logs_update on public.haccp_logs;
drop policy if exists haccp_logs_delete on public.haccp_logs;
create policy haccp_logs_select on public.haccp_logs for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy haccp_logs_insert on public.haccp_logs for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy haccp_logs_update on public.haccp_logs for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy haccp_logs_delete on public.haccp_logs for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
alter table public.pos_integrations enable row level security;
drop policy if exists pos_integrations_select on public.pos_integrations;
drop policy if exists pos_integrations_insert on public.pos_integrations;
drop policy if exists pos_integrations_update on public.pos_integrations;
drop policy if exists pos_integrations_delete on public.pos_integrations;
create policy pos_integrations_select on public.pos_integrations for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy pos_integrations_insert on public.pos_integrations for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy pos_integrations_update on public.pos_integrations for update to authenticated using (tenant_id = (select public.my_tenant_id())) with check (tenant_id = (select public.my_tenant_id()));
create policy pos_integrations_delete on public.pos_integrations for delete to authenticated using (tenant_id = (select public.my_tenant_id()));
