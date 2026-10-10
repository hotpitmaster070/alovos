-- Goods receipt: a line may carry the unit price read from the supplier invoice (AI scan, checked by
-- a person). Lot cost = order price, else invoice price, else products.cost, else last purchase price.
-- A delegate never sees prices but the scanned price still reaches the lot. Idempotent: safe to re-run.

-- p_lines: [{product_id, received_qty, expected_qty?, photo_path?, price?}]
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
  v_costs boolean := public.can_see_costs();
  v_delegated_from uuid;
  v_order public.purchase_orders;
  v_location public.storage_locations;
  v_receipt uuid := gen_random_uuid();
  v_line jsonb;
  v_product uuid;
  v_qty numeric;
  v_expected numeric;
  v_order_price numeric;
  v_line_price numeric;
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
  if not v_costs then
    v_delegated_from := public.receiving_delegator(v_tenant, p_branch_id);
  end if;

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
    v_line_price := null;
    if v_line ? 'price' and jsonb_typeof(v_line -> 'price') <> 'null' then
      if jsonb_typeof(v_line -> 'price') <> 'number' then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_line_price := (v_line ->> 'price')::numeric;
      if v_line_price < 0 or v_line_price > 1000000000 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
    end if;
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

    select coalesce(v_order_price, v_line_price, p.cost, public.product_last_purchase_price(p.id)), p.storage_location_id
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
      expected_qty, received_qty, cost_per_unit, photo_invoice_url, photo_product_url, received_by,
      received_by_id, delegated_from_id
    ) values (
      v_tenant, p_branch_id, v_receipt, p_order_id, v_product, case when v_qty > 0 then v_target end, v_lot.id,
      v_expected, v_qty, v_cost, p_invoice_path, v_photo, auth.uid(),
      auth.uid(), v_delegated_from
    );
    v_lines := v_lines + 1;
  end loop;

  if v_received = 0 then
    raise exception 'nothing_received' using errcode = '22023';
  end if;

  if p_order_id is not null then
    update public.purchase_orders set status = 'received' where id = p_order_id;
  end if;

  return jsonb_build_object(
    'receipt_id', v_receipt,
    'lines', v_lines,
    'total', case when v_costs then round(v_total, 2) end
  );
end;
$$;

revoke execute on function public.receive_goods(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.receive_goods(uuid, uuid, uuid, text, jsonb) to authenticated;
