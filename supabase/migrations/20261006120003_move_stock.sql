-- Atomic stock move between two locations of the caller's organization, plus the indexes the
-- ANBAR page needs at scale. Run after 20261006120000 (tables, current_org_id()) and 20261006120002.
-- Idempotent: create or replace / create index if not exists / guarded unique index.

-- ---------------------------------------------------------------------------
-- Guards for databases whose tables predate these migrations (session-only helpers, see
-- 20261006120000): run the statement only when the table and all listed columns exist.
-- ---------------------------------------------------------------------------
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
-- Indexes for the ANBAR queries (every query is filtered by organization_id first)
-- ---------------------------------------------------------------------------
select pg_temp.exec_if('products', array['organization_id', 'location_id'],
  'create index if not exists idx_products_org_location on public.products(organization_id, location_id)');
select pg_temp.exec_if('products', array['organization_id', 'expiry_date'],
  'create index if not exists idx_products_org_expiry on public.products(organization_id, expiry_date)');
select pg_temp.exec_if('products', array['organization_id', 'name'],
  'create index if not exists idx_products_org_name on public.products(organization_id, name)');
select pg_temp.exec_if('products', array['organization_id', 'qty'],
  'create index if not exists idx_products_org_qty on public.products(organization_id, qty)');
-- idx_products_barcode_org (barcode, organization_id) from 20261006120000 stays as is.

-- One row per barcode and location inside an organization. This makes the "add to the existing
-- target row, otherwise create it" step of move_stock race-free for barcoded products. If old data
-- already contains duplicates the index is skipped (with a notice) instead of failing the migration;
-- move_stock stays correct because it also serialises on an advisory lock.
do $$
begin
  if to_regclass('public.idx_products_org_location_barcode_unique') is not null then
    return;
  end if;
  if not pg_temp.has_columns('products', array['organization_id', 'location_id', 'barcode']) then
    raise notice 'idx_products_org_location_barcode_unique skipped: products lacks organization_id, location_id or barcode';
    return;
  end if;

  if exists (
    select 1 from public.products
    where barcode is not null and location_id is not null
    group by organization_id, location_id, barcode
    having count(*) > 1
  ) then
    raise notice 'idx_products_org_location_barcode_unique skipped: duplicate (organization, location, barcode) rows exist';
  else
    create unique index idx_products_org_location_barcode_unique
      on public.products (organization_id, location_id, barcode)
      where barcode is not null and location_id is not null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- move_stock
-- Error messages are stable identifiers that the app maps to translated texts:
--   not_authenticated, no_organization, invalid_argument, invalid_qty, same_location,
--   location_not_found, product_not_found, product_location_mismatch, unit_mismatch,
--   insufficient_stock, conflict
--
-- Concurrency / deadlock avoidance:
--   1. A transaction-level advisory lock on the TARGET "slot" (organization, target location,
--      barcode or name+unit) is taken first. It serialises two moves that would create or top up
--      the same target row, which covers rows without barcode where no unique index applies.
--      The lock is taken before any row lock, so a transaction waiting on it holds nothing.
--   2. The source row and the target row are then locked together with a single
--      SELECT ... ORDER BY id FOR UPDATE, i.e. always in id order. Opposite moves (A to B and
--      B to A) therefore request the same rows in the same order and cannot deadlock.
-- The source row is always kept and decremented (it may end at 0); the target row is topped up
-- or created as a copy of the source.
-- ---------------------------------------------------------------------------
create or replace function public.move_stock(
  p_product_id uuid,
  p_from_location uuid,
  p_to_location uuid,
  p_qty float
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_src public.products%rowtype;
  v_tgt public.products%rowtype;
  v_tgt_id uuid;
  v_slot text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'no_organization' using errcode = '42501';
  end if;

  if p_product_id is null or p_from_location is null or p_to_location is null then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty = 'NaN'::float or p_qty = 'Infinity'::float then
    raise exception 'invalid_qty' using errcode = '22023';
  end if;
  if p_from_location = p_to_location then
    raise exception 'same_location' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.locations where id = p_from_location and organization_id = v_org
  ) or not exists (
    select 1 from public.locations where id = p_to_location and organization_id = v_org
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;

  -- Unlocked read, only to derive the target slot and candidate target row.
  select * into v_src from public.products where id = p_product_id and organization_id = v_org;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  v_slot := v_org::text || ':' || p_to_location::text || ':' ||
    case when v_src.barcode is not null
      then 'b:' || v_src.barcode
      else 'n:' || v_src.name || ':' || coalesce(v_src.unit, '')
    end;
  perform pg_advisory_xact_lock(hashtextextended(v_slot, 0));

  select id into v_tgt_id
  from public.products
  where organization_id = v_org
    and location_id = p_to_location
    and id <> p_product_id
    and (
      (v_src.barcode is not null and barcode = v_src.barcode)
      or (v_src.barcode is null and barcode is null and name = v_src.name and unit is not distinct from v_src.unit)
    )
  order by id
  limit 1;

  -- Lock source and target together, in id order.
  perform 1
  from public.products
  where organization_id = v_org
    and id = any (array_remove(array[p_product_id, v_tgt_id], null))
  order by id
  for update;

  -- Re-read the locked source: it may have changed or moved since the unlocked read.
  select * into v_src from public.products where id = p_product_id and organization_id = v_org;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if v_src.location_id is distinct from p_from_location then
    raise exception 'product_location_mismatch' using errcode = '40001';
  end if;
  if coalesce(v_src.qty, 0) < p_qty then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  if v_tgt_id is not null then
    select * into v_tgt from public.products where id = v_tgt_id and organization_id = v_org;
    if not found or v_tgt.location_id is distinct from p_to_location then
      raise exception 'conflict' using errcode = '40001';
    end if;
    if v_tgt.unit is distinct from v_src.unit then
      raise exception 'unit_mismatch' using errcode = '22023';
    end if;
  end if;

  update public.products
  set qty = coalesce(qty, 0) - p_qty
  where id = p_product_id
    and location_id = p_from_location
    and organization_id = v_org;

  if v_tgt_id is not null then
    update public.products
    set qty = coalesce(qty, 0) + p_qty
    where id = v_tgt_id
      and location_id = p_to_location
      and organization_id = v_org;
  else
    insert into public.products
      (organization_id, name, barcode, expiry_date, cost, unit, location_id, qty)
    values
      (v_org, v_src.name, v_src.barcode, v_src.expiry_date, v_src.cost, v_src.unit, p_to_location, p_qty);
  end if;

  -- Audit trail only when an audit_logs table exists (the current migrations do not create one).
  if to_regclass('public.audit_logs') is not null then
    begin
      execute 'insert into public.audit_logs (organization_id, user_id, action, table_name, record_id, new_data) values ($1, $2, $3, $4, $5, $6)'
      using v_org, auth.uid(), 'move_stock', 'products', p_product_id,
        jsonb_build_object('from_location', p_from_location, 'to_location', p_to_location, 'qty', p_qty);
    exception when others then
      raise log 'move_stock audit insert failed: %', sqlerrm;
    end;
  end if;
end;
$$;

revoke execute on function public.move_stock(uuid, uuid, uuid, float) from public, anon;
grant execute on function public.move_stock(uuid, uuid, uuid, float) to authenticated;
