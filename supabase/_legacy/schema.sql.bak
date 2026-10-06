-- alovOS — Supabase schema for the 12 FINAL BLOCKS
-- Multi-tenant: every business table carries org_id, isolated via RLS through profiles.
--
-- KILLER 1: 3.1 AI scan invoice 99%
-- KILLER 2: 5.2 + 11.3 AI Tani bucket Vision API
-- KILLER 3: 4.4 Allergens auto 14 + KBJU
-- KILLER 4: 8.4 Stars/Horses/Dogs + "Remove dog - lose $500" + 8.5 AI 1g coffee = $200 loss
-- KILLER 5: 10.1 IoT temp Shelly + WhatsApp alert + Bazar Benchmark 2.4 average price Baku

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role as enum ('owner', 'admin', 'manager', 'chef', 'staff');
create type transfer_status as enum ('draft', 'in_transit', 'received', 'cancelled');
create type request_status as enum ('draft', 'submitted', 'approved', 'ordered', 'received', 'rejected');
create type invoice_status as enum ('uploaded', 'scanned', 'needs_review', 'approved', 'paid');
create type price_source as enum ('manual', 'invoice', 'bazar_benchmark');
create type prep_status as enum ('planned', 'in_progress', 'done', 'discarded');
create type haccp_source as enum ('manual', 'iot_shelly');
create type checklist_status as enum ('open', 'completed', 'failed');
create type franchise_status as enum ('prospect', 'active', 'suspended', 'terminated');

-- Wastage reasons (RU values are part of the product spec)
create type wastage_reason as enum ('испорчено', 'пережар', 'упал', 'просрочка', 'кража');

-- EU 14 major allergens
create type allergen as enum (
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
);

-- ---------------------------------------------------------------------------
-- 0. Tenancy: organizations, profiles, locations
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'standard',
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address text,
  city text default 'Baku',
  timezone text not null default 'Asia/Baku',
  is_central_kitchen boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  full_name text,
  role user_role not null default 'staff',
  locale text not null default 'az' check (locale in ('az', 'ru', 'en')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BLOCK 1 ANBAR: products, stock_counts, transfers
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  whatsapp text,
  email text,
  payment_terms_days int not null default 0,
  rating numeric(2,1) check (rating between 0 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sku text,
  name text not null,
  barcode text,
  category text,
  unit text not null default 'kg',
  min_stock numeric(14,3) not null default 0,
  cost_price numeric(14,4) not null default 0,
  expiry_date date,
  shelf_life_days int,
  allergens allergen[] not null default '{}',
  default_supplier_id uuid references suppliers(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, barcode)
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  counted_qty numeric(14,3) not null,
  expected_qty numeric(14,3),
  variance numeric(14,3) generated always as (counted_qty - coalesce(expected_qty, counted_qty)) stored,
  expiry_date date,
  note text,
  counted_by uuid references profiles(id) on delete set null,
  counted_at timestamptz not null default now()
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  from_location_id uuid not null references locations(id) on delete cascade,
  to_location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  status transfer_status not null default 'draft',
  requested_by uuid references profiles(id) on delete set null,
  received_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  received_at timestamptz,
  check (from_location_id <> to_location_id)
);

-- ---------------------------------------------------------------------------
-- BLOCK 2 TƏCHİZAT: suppliers (above), supplier_prices, purchase_requests
-- ---------------------------------------------------------------------------
create table supplier_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  price numeric(14,4) not null check (price >= 0),
  currency text not null default 'AZN',
  source price_source not null default 'manual',
  valid_from date not null default current_date,
  created_at timestamptz not null default now()
);

-- KILLER 5: Bazar Benchmark 2.4 average price Baku (global reference, not org-scoped)
create table market_benchmarks (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  category text,
  unit text not null default 'kg',
  avg_price_baku numeric(14,4) not null,
  sample_size int not null default 0,
  currency text not null default 'AZN',
  observed_on date not null default current_date,
  unique (product_name, unit, observed_on)
);

create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  status request_status not null default 'draft',
  note text,
  requested_by uuid references profiles(id) on delete set null,
  approved_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  request_id uuid not null references purchase_requests(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  target_price numeric(14,4)
);

-- ---------------------------------------------------------------------------
-- BLOCK 3 HESABLAR: invoices (KILLER 1)
-- ---------------------------------------------------------------------------
-- KILLER 1: 3.1 AI scan invoice 99%
create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  invoice_no text,
  invoice_date date,
  total numeric(14,2),
  vat numeric(14,2),
  currency text not null default 'AZN',
  image_url text,
  ai_scan_json jsonb,
  ai_confidence numeric(5,2) check (ai_confidence between 0 and 100),
  status invoice_status not null default 'uploaded',
  scanned_by uuid references profiles(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BLOCK 4 RESEPTLƏR: recipes (KILLER 3)
-- ---------------------------------------------------------------------------
-- KILLER 3: 4.4 Allergens auto 14 + KBJU
create table recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  portions numeric(10,2) not null default 1 check (portions > 0),
  is_prep boolean not null default false,
  gross_weight_g numeric(12,2) not null default 0,
  net_weight_g numeric(12,2) not null default 0,
  waste_pct numeric(6,2) generated always as (
    case when gross_weight_g > 0
      then round((gross_weight_g - net_weight_g) / gross_weight_g * 100, 2)
      else 0 end
  ) stored,
  yield_pct numeric(6,2) generated always as (
    case when gross_weight_g > 0
      then round(net_weight_g / gross_weight_g * 100, 2)
      else 0 end
  ) stored,
  cost_live numeric(14,4) not null default 0,
  sell_price numeric(14,2),
  allergens allergen[] not null default '{}',
  kcal numeric(10,2),
  protein_g numeric(10,2),
  fat_g numeric(10,2),
  carbs_g numeric(10,2),
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  qty numeric(14,3) not null check (qty > 0),
  unit text not null default 'kg',
  kcal_per_unit numeric(10,2),
  protein_per_unit numeric(10,2),
  fat_per_unit numeric(10,2),
  carbs_per_unit numeric(10,2)
);

-- Recompute live cost, auto allergens (union of ingredient allergens) and KBJU.
create or replace function recompute_recipe() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  update recipes r set
    cost_live = coalesce((
      select sum(ri.qty * p.cost_price)
      from recipe_ingredients ri join products p on p.id = ri.product_id
      where ri.recipe_id = rid), 0),
    allergens = coalesce((
      select array_agg(distinct a order by a)
      from recipe_ingredients ri
      join products p on p.id = ri.product_id,
      lateral unnest(p.allergens) as a
      where ri.recipe_id = rid), '{}'),
    kcal = (select sum(ri.qty * ri.kcal_per_unit) from recipe_ingredients ri where ri.recipe_id = rid),
    protein_g = (select sum(ri.qty * ri.protein_per_unit) from recipe_ingredients ri where ri.recipe_id = rid),
    fat_g = (select sum(ri.qty * ri.fat_per_unit) from recipe_ingredients ri where ri.recipe_id = rid),
    carbs_g = (select sum(ri.qty * ri.carbs_per_unit) from recipe_ingredients ri where ri.recipe_id = rid)
  where r.id = rid;
  return null;
end $$;

create trigger trg_recipe_ingredients_recompute
after insert or update or delete on recipe_ingredients
for each row execute function recompute_recipe();

-- ---------------------------------------------------------------------------
-- BLOCK 5 TULLANTI: wastage (KILLER 2)
-- ---------------------------------------------------------------------------
-- KILLER 2: 5.2 + 11.3 AI Tani bucket Vision API
create table wastage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  recipe_id uuid references recipes(id) on delete set null,
  reason wastage_reason not null,
  qty numeric(14,3),
  weight numeric(12,3),
  cost_loss numeric(14,2),
  photo_url text,
  ai_tani jsonb,
  ai_tani_confidence numeric(5,2) check (ai_tani_confidence between 0 and 100),
  reported_by uuid references profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BLOCK 6 HAZIRLIQ: preps
-- ---------------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  full_name text not null,
  position text,
  qr text not null unique default encode(gen_random_bytes(12), 'hex'),
  photo text,
  hourly_rate numeric(10,2),
  hired_at date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table preps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  assigned_to uuid references employees(id) on delete set null,
  station text,
  planned_qty numeric(14,3) not null,
  produced_qty numeric(14,3),
  prep_date date not null default current_date,
  shelf_life_hours int,
  expires_at timestamptz,
  label_code text,
  status prep_status not null default 'planned',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BLOCK 7 POS: pos_sales
-- ---------------------------------------------------------------------------
create table pos_sales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  pos_system text not null,
  external_id text not null,
  recipe_id uuid references recipes(id) on delete set null,
  item_name text not null,
  qty numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  raw jsonb,
  sold_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (org_id, pos_system, external_id)
);

-- ---------------------------------------------------------------------------
-- BLOCK 8 ANALITIKA: analytics_reports (KILLER 4)
-- ---------------------------------------------------------------------------
-- KILLER 4: 8.4 Stars/Horses/Dogs + "Remove dog - lose $500" + 8.5 AI 1g coffee = $200 loss
create table analytics_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  kind text not null default 'menu_engineering',
  period_start date not null,
  period_end date not null,
  payload jsonb not null default '{}',   -- items classified stars / horses / dogs
  auto_advice jsonb,                     -- e.g. "Remove dog - lose $500", "1g coffee = $200 loss"
  estimated_impact numeric(14,2),
  generated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

-- ---------------------------------------------------------------------------
-- BLOCK 9 KOMANDA: employees (above, with qr + photo)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- BLOCK 10 HACCP: haccp_temps, haccp_checklists (KILLER 5)
-- ---------------------------------------------------------------------------
-- KILLER 5: 10.1 IoT temp Shelly + WhatsApp alert + Bazar Benchmark 2.4 average price Baku
create table haccp_temps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  equipment text not null,
  source haccp_source not null default 'manual',
  device_id text,
  value_c numeric(5,2) not null,
  min_c numeric(5,2),
  max_c numeric(5,2),
  out_of_range boolean generated always as (
    (min_c is not null and value_c < min_c) or (max_c is not null and value_c > max_c)
  ) stored,
  alert_sent_at timestamptz,
  alert_channel text check (alert_channel in ('whatsapp', 'sms', 'email')),
  recorded_by uuid references profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create table haccp_checklists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  kind text not null,
  items jsonb not null default '[]',
  status checklist_status not null default 'open',
  completed_by uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BLOCK 11 AI SKANER: uses invoices.ai_scan_json and wastage.ai_tani
-- (KILLER 2 / KILLER 1 — no extra tables)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- BLOCK 12 ŞƏBƏKƏ: network_franchise
-- ---------------------------------------------------------------------------
create table network_franchise (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  franchisee_name text not null,
  contact_phone text,
  royalty_pct numeric(5,2) not null default 0 check (royalty_pct between 0 and 100),
  status franchise_status not null default 'prospect',
  standards jsonb not null default '{}',
  contract_start date,
  contract_end date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index idx_profiles_org on profiles(org_id);
create index idx_locations_org on locations(org_id);
create index idx_suppliers_org on suppliers(org_id);
create index idx_products_org on products(org_id);
create index idx_products_barcode on products(barcode);
create index idx_products_expiry on products(org_id, expiry_date) where expiry_date is not null;
create index idx_stock_counts_loc_prod on stock_counts(location_id, product_id, counted_at desc);
create index idx_stock_counts_org on stock_counts(org_id);
create index idx_transfers_org_status on transfers(org_id, status);
create index idx_transfers_to on transfers(to_location_id);
create index idx_supplier_prices_lookup on supplier_prices(product_id, supplier_id, valid_from desc);
create index idx_supplier_prices_org on supplier_prices(org_id);
create index idx_benchmarks_name on market_benchmarks(product_name, observed_on desc);
create index idx_purchase_requests_org_status on purchase_requests(org_id, status);
create index idx_purchase_request_items_req on purchase_request_items(request_id);
create index idx_invoices_org_date on invoices(org_id, invoice_date desc);
create index idx_invoices_supplier on invoices(supplier_id);
create index idx_invoices_ai_scan on invoices using gin (ai_scan_json);
create index idx_recipes_org on recipes(org_id);
create index idx_recipes_allergens on recipes using gin (allergens);
create index idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index idx_recipe_ingredients_product on recipe_ingredients(product_id);
create index idx_wastage_org_time on wastage(org_id, occurred_at desc);
create index idx_wastage_loc on wastage(location_id, occurred_at desc);
create index idx_wastage_reason on wastage(org_id, reason);
create index idx_preps_loc_date on preps(location_id, prep_date);
create index idx_preps_org on preps(org_id);
create index idx_pos_sales_loc_time on pos_sales(location_id, sold_at desc);
create index idx_pos_sales_org on pos_sales(org_id);
create index idx_analytics_org_period on analytics_reports(org_id, period_start desc);
create index idx_employees_org on employees(org_id);
create index idx_employees_loc on employees(location_id);
create index idx_haccp_temps_loc_time on haccp_temps(location_id, recorded_at desc);
create index idx_haccp_temps_out_of_range on haccp_temps(org_id, recorded_at desc) where out_of_range;
create index idx_haccp_temps_org on haccp_temps(org_id);
create index idx_haccp_checklists_loc on haccp_checklists(location_id, created_at desc);
create index idx_haccp_checklists_org on haccp_checklists(org_id);
create index idx_franchise_org on network_franchise(org_id);
create index idx_audit_org_time on audit_logs(org_id, created_at desc);
create index idx_audit_record on audit_logs(table_name, record_id);

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------
create or replace function log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_logs (org_id, user_id, action, table_name, record_id, old_data, new_data)
  values (
    (rec ->> 'org_id')::uuid,
    auth.uid(),
    tg_op,
    tg_table_name,
    (rec ->> 'id')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'products', 'stock_counts', 'transfers', 'suppliers', 'supplier_prices',
    'purchase_requests', 'invoices', 'recipes', 'wastage', 'preps',
    'employees', 'haccp_temps', 'haccp_checklists', 'network_franchise'
  ] loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on %1$I
         for each row execute function log_audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security (org-scoped via profiles)
-- ---------------------------------------------------------------------------
create or replace function current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

create or replace function current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table market_benchmarks enable row level security;
alter table audit_logs enable row level security;

create policy org_select on organizations for select
  using (id = current_org_id());
create policy org_update on organizations for update
  using (id = current_org_id() and current_user_role() in ('owner', 'admin'));

create policy profiles_select on profiles for select
  using (org_id = current_org_id());
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and org_id = current_org_id());
create policy profiles_admin_manage on profiles for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'admin'))
  with check (org_id = current_org_id());

create policy benchmarks_read on market_benchmarks for select
  using (auth.role() = 'authenticated');

create policy audit_select on audit_logs for select
  using (org_id = current_org_id() and current_user_role() in ('owner', 'admin'));

do $$
declare t text;
begin
  foreach t in array array[
    'locations', 'suppliers', 'products', 'stock_counts', 'transfers',
    'supplier_prices', 'purchase_requests', 'purchase_request_items',
    'invoices', 'recipes', 'recipe_ingredients', 'wastage', 'employees',
    'preps', 'pos_sales', 'analytics_reports', 'haccp_temps',
    'haccp_checklists', 'network_franchise'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy org_isolation on %I for all
         using (org_id = current_org_id())
         with check (org_id = current_org_id())', t);
  end loop;
end $$;
