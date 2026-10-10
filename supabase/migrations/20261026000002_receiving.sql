-- Goods receipt against a supplier order (or without one) with photo proofs from the
-- inventory-proofs bucket. Stock moves only through receive_stock_with_lot (prihod movement + lot).
-- Idempotent: safe to re-run.

alter table public.purchase_orders add column if not exists branch_id uuid references public.branches(id);
create index if not exists idx_purchase_orders_tenant_status on public.purchase_orders (tenant_id, status, branch_id);

alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check
  check (status in ('requested', 'approved', 'ordered', 'sent', 'received', 'cancelled'));

create table if not exists public.receiving_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  receipt_id uuid not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  product_id uuid not null references public.products(id),
  storage_location_id uuid references public.storage_locations(id),
  lot_id uuid references public.product_lots(id) on delete set null,
  expected_qty numeric check (expected_qty is null or expected_qty >= 0),
  received_qty numeric not null check (received_qty >= 0),
  cost_per_unit numeric check (cost_per_unit is null or cost_per_unit >= 0),
  photo_invoice_url text not null,
  photo_product_url text,
  received_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_receiving_logs_tenant_branch_created
  on public.receiving_logs (tenant_id, branch_id, created_at desc);
create index if not exists idx_receiving_logs_order on public.receiving_logs (purchase_order_id);
create index if not exists idx_receiving_logs_receipt on public.receiving_logs (receipt_id);

-- Costs are in every row, so only those who see money read the log; rows are written by receive_goods only.
alter table public.receiving_logs enable row level security;
revoke all on table public.receiving_logs from anon, authenticated;
grant select on table public.receiving_logs to authenticated;
drop policy if exists receiving_logs_select on public.receiving_logs;
create policy receiving_logs_select on public.receiving_logs
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.can_see_costs()));

-- ---------------------------------------------------------------------------
-- Internal checks
-- ---------------------------------------------------------------------------

-- Caller is an owner/chef of the tenant with access to the branch; returns the tenant.
create or replace function public.receiving_scope(p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return v_tenant;
end;
$$;

revoke execute on function public.receiving_scope(uuid) from public, anon, authenticated;

-- A proof photo uploaded under {tenant}/{branch}/ in the inventory-proofs bucket.
create or replace function public.receiving_proof_ok(p_tenant_id uuid, p_branch_id uuid, p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_path is null or length(p_path) > 512 or position('..' in p_path) > 0
     or left(p_path, 74) <> p_tenant_id::text || '/' || p_branch_id::text || '/' then
    return false;
  end if;
  return exists (select 1 from storage.objects o where o.bucket_id = 'inventory-proofs' and o.name = p_path);
end;
$$;

revoke execute on function public.receiving_proof_ok(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads for the receiving screen
-- ---------------------------------------------------------------------------

-- Orders waiting for delivery to the branch (orders without a branch are offered to every branch).
create or replace function public.receiving_orders(p_branch_id uuid)
returns table (order_id uuid, supplier_name text, order_status text, ordered_at timestamptz, item_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
begin
  return query
  select o.id, s.name, o.status, o.created_at,
         (select count(*) from public.purchase_order_items i where i.purchase_order_id = o.id)
  from public.purchase_orders o
  left join public.suppliers s on s.id = o.supplier_id
  where o.tenant_id = v_tenant
    and o.status in ('sent', 'ordered')
    and (o.branch_id = p_branch_id or o.branch_id is null)
  order by o.created_at desc, o.id
  limit 200;
end;
$$;

revoke execute on function public.receiving_orders(uuid) from public, anon;
grant execute on function public.receiving_orders(uuid) to authenticated;

-- Order lines per product: ordered quantity and price (order price, else products.cost, else last purchase).
create or replace function public.receiving_order_lines(p_branch_id uuid, p_order_id uuid)
returns table (product_id uuid, product_name text, unit text, expected_qty numeric, unit_cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
begin
  if not exists (
    select 1 from public.purchase_orders o
    where o.id = p_order_id and o.tenant_id = v_tenant
      and o.status in ('sent', 'ordered')
      and (o.branch_id = p_branch_id or o.branch_id is null)
  ) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.name, p.unit, sum(i.quantity),
         coalesce(max(i.unit_price), p.cost, public.product_last_purchase_price(p.id))
  from public.purchase_order_items i
  join public.products p on p.id = i.product_id and p.tenant_id = v_tenant
  where i.purchase_order_id = p_order_id and i.tenant_id = v_tenant
  group by p.id, p.name, p.unit, p.cost
  order by p.name, p.id;
end;
$$;

revoke execute on function public.receiving_order_lines(uuid, uuid) from public, anon;
grant execute on function public.receiving_order_lines(uuid, uuid) to authenticated;

-- Products that can be received at the branch without an order (the branch's and shared ones).
create or replace function public.receiving_products(p_branch_id uuid)
returns table (product_id uuid, product_name text, unit text, unit_cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
begin
  return query
  select p.id, p.name, p.unit, coalesce(p.cost, public.product_last_purchase_price(p.id))
  from public.products p
  where p.tenant_id = v_tenant and (p.branch_id is null or p.branch_id = p_branch_id)
  order by p.name, p.id
  limit 2000;
end;
$$;

revoke execute on function public.receiving_products(uuid) from public, anon;
grant execute on function public.receiving_products(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The receipt
-- ---------------------------------------------------------------------------

-- p_lines: [{product_id, received_qty, expected_qty?, photo_path?}]. With an order, expected
-- quantities and prices come from the order (expected_qty from the client is ignored) and the
-- order becomes 'received'. Each line with a quantity goes to the product's default place in the
-- branch, else to p_location_id. Returns {receipt_id, lines, total}.
create or replace function public.receive_goods(
  p_branch_id uuid,
  p_order_id uuid,
  p_location_id uuid,
  p_invoice_path text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
  v_order public.purchase_orders;
  v_location public.storage_locations;
  v_receipt uuid := gen_random_uuid();
  v_line jsonb;
  v_product uuid;
  v_qty numeric;
  v_expected numeric;
  v_order_price numeric;
  v_cost numeric;
  v_photo text;
  v_default uuid;
  v_target uuid;
  v_lot public.product_lots;
  v_seen uuid[] := '{}';
  v_lines integer := 0;
  v_received integer := 0;
  v_total numeric := 0;
begin
  select * into v_location from public.storage_locations
  where id = p_location_id and tenant_id = v_tenant and branch_id = p_branch_id and is_active;
  if v_location.id is null then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if not public.receiving_proof_ok(v_tenant, p_branch_id, p_invoice_path) then
    raise exception 'invoice_photo_required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_order_id is not null then
    select * into v_order from public.purchase_orders
    where id = p_order_id and tenant_id = v_tenant
    for update;
    if v_order.id is null or (v_order.branch_id is not null and v_order.branch_id <> p_branch_id) then
      raise exception 'order_not_found' using errcode = 'P0002';
    end if;
    if v_order.status not in ('sent', 'ordered') then
      raise exception 'order_closed' using errcode = '22023';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(v_line ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_line -> 'received_qty') is distinct from 'number' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_product := (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'received_qty')::numeric;
    if v_qty < 0 or v_qty > 1000000 or v_product = any (v_seen) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_seen := v_seen || v_product;

    v_photo := nullif(btrim(coalesce(v_line ->> 'photo_path', '')), '');
    if v_photo is not null and not public.receiving_proof_ok(v_tenant, p_branch_id, v_photo) then
      raise exception 'invalid_photo' using errcode = '22023';
    end if;

    v_order_price := null;
    if p_order_id is not null then
      select sum(i.quantity), max(i.unit_price) into v_expected, v_order_price
      from public.purchase_order_items i
      where i.purchase_order_id = p_order_id and i.tenant_id = v_tenant and i.product_id = v_product;
      if v_expected is null then
        raise exception 'product_not_in_order' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_line -> 'expected_qty') = 'number' then
      v_expected := (v_line ->> 'expected_qty')::numeric;
      if v_expected < 0 or v_expected > 1000000 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
    else
      v_expected := null;
    end if;

    select coalesce(v_order_price, p.cost, public.product_last_purchase_price(p.id)), p.storage_location_id
    into v_cost, v_default
    from public.products p
    where p.id = v_product and p.tenant_id = v_tenant and (p.branch_id is null or p.branch_id = p_branch_id);
    if not found then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;

    select l.id into v_target from public.storage_locations l
    where l.id = v_default and l.tenant_id = v_tenant and l.branch_id = p_branch_id and l.is_active;
    v_target := coalesce(v_target, v_location.id);

    v_lot := null;
    if v_qty > 0 then
      v_lot := public.receive_stock_with_lot(v_product, v_qty, v_target, v_cost);
      v_received := v_received + 1;
      v_total := v_total + v_qty * coalesce(v_cost, 0);
    end if;

    insert into public.receiving_logs (
      tenant_id, branch_id, receipt_id, purchase_order_id, product_id, storage_location_id, lot_id,
      expected_qty, received_qty, cost_per_unit, photo_invoice_url, photo_product_url, received_by
    ) values (
      v_tenant, p_branch_id, v_receipt, p_order_id, v_product, case when v_qty > 0 then v_target end, v_lot.id,
      v_expected, v_qty, v_cost, p_invoice_path, v_photo, auth.uid()
    );
    v_lines := v_lines + 1;
  end loop;

  if v_received = 0 then
    raise exception 'nothing_received' using errcode = '22023';
  end if;

  if p_order_id is not null then
    update public.purchase_orders set status = 'received' where id = p_order_id;
  end if;

  return jsonb_build_object('receipt_id', v_receipt, 'lines', v_lines, 'total', round(v_total, 2));
end;
$$;

revoke execute on function public.receive_goods(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.receive_goods(uuid, uuid, uuid, text, jsonb) to authenticated;
