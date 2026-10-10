-- "I stepped away": an owner/chef hands goods receiving of a branch to another member for a while.
-- The delegate receives goods without seeing purchase prices. Rows are written only by the
-- delegation functions below (a member must not be able to delegate rights to themselves).
-- Idempotent: safe to re-run.

create table if not exists public.delegation_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  from_user_id uuid not null,
  to_user_id uuid not null,
  reason text default 'отошел',
  start_at timestamptz default now(),
  end_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now(),
  constraint delegation_logs_other_user check (from_user_id <> to_user_id),
  constraint delegation_logs_reason_length check (reason is null or char_length(reason) <= 200)
);

create index if not exists idx_delegation_logs_to_active
  on public.delegation_logs (tenant_id, to_user_id, branch_id) where is_active;
create index if not exists idx_delegation_logs_from_active
  on public.delegation_logs (tenant_id, from_user_id, branch_id) where is_active;

alter table public.delegation_logs enable row level security;
revoke all on table public.delegation_logs from anon, authenticated;
grant select on table public.delegation_logs to authenticated;
drop policy if exists "Tenant isolation for delegation" on public.delegation_logs;
create policy "Tenant isolation for delegation" on public.delegation_logs
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (from_user_id = auth.uid() or to_user_id = auth.uid() or (select public.can_see_costs()))
  );

alter table public.receiving_logs add column if not exists received_by_id uuid;
alter table public.receiving_logs add column if not exists delegated_from_id uuid;

-- ---------------------------------------------------------------------------
-- Internal
-- ---------------------------------------------------------------------------

-- The owner/chef who handed receiving of the branch to the caller and is still owner/chef; null when none.
create or replace function public.receiving_delegator(p_tenant_id uuid, p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.from_user_id
  from public.delegation_logs d
  join public.memberships m
    on m.user_id = d.from_user_id and m.tenant_id = d.tenant_id and m.role in ('owner', 'chef')
  where d.tenant_id = p_tenant_id
    and d.branch_id = p_branch_id
    and d.to_user_id = auth.uid()
    and d.is_active
    and (d.end_at is null or d.end_at > now())
  order by d.start_at desc
  limit 1
$$;

revoke execute on function public.receiving_delegator(uuid, uuid) from public, anon, authenticated;

-- Receiving access: owners/chefs with access to the branch, or the delegate of one of them.
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
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if public.can_see_costs() then
    if not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  elsif public.receiving_delegator(v_tenant, p_branch_id) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

revoke execute on function public.receiving_scope(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Receiving reads: prices only for those who see costs
-- ---------------------------------------------------------------------------

create or replace function public.receiving_order_lines(p_branch_id uuid, p_order_id uuid)
returns table (product_id uuid, product_name text, unit text, expected_qty numeric, unit_cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
  v_costs boolean := public.can_see_costs();
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
         case when v_costs then coalesce(max(i.unit_price), p.cost, public.product_last_purchase_price(p.id)) end
  from public.purchase_order_items i
  join public.products p on p.id = i.product_id and p.tenant_id = v_tenant
  where i.purchase_order_id = p_order_id and i.tenant_id = v_tenant
  group by p.id, p.name, p.unit, p.cost
  order by p.name, p.id;
end;
$$;

revoke execute on function public.receiving_order_lines(uuid, uuid) from public, anon;
grant execute on function public.receiving_order_lines(uuid, uuid) to authenticated;

create or replace function public.receiving_products(p_branch_id uuid)
returns table (product_id uuid, product_name text, unit text, unit_cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
  v_costs boolean := public.can_see_costs();
begin
  return query
  select p.id, p.name, p.unit,
         case when v_costs then coalesce(p.cost, public.product_last_purchase_price(p.id)) end
  from public.products p
  where p.tenant_id = v_tenant and (p.branch_id is null or p.branch_id = p_branch_id)
  order by p.name, p.id
  limit 2000;
end;
$$;

revoke execute on function public.receiving_products(uuid) from public, anon;
grant execute on function public.receiving_products(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The receipt: records who received and on whose behalf; the total only for those who see costs
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Delegation
-- ---------------------------------------------------------------------------

-- Who an owner/chef can hand the branch's receiving to: owners, chefs and cooks of the branch but themselves.
create or replace function public.delegation_candidates(p_branch_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
begin
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.email, m.role
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.tenant_id = v_tenant
      and m.user_id <> auth.uid()
      and m.role in ('owner', 'chef', 'cook')
      and (cardinality(m.branch_ids) = 0 or p_branch_id = any (m.branch_ids))
    order by case m.role when 'cook' then 0 when 'chef' then 1 else 2 end, p.email, m.user_id;
end;
$$;

revoke execute on function public.delegation_candidates(uuid) from public, anon;
grant execute on function public.delegation_candidates(uuid) to authenticated;

-- Starts a hand-over from the caller; p_minutes null = until the caller comes back. A previous
-- active hand-over of the caller for the branch ends. Returns the new row id.
create or replace function public.start_delegation(p_branch_id uuid, p_to_user_id uuid, p_minutes integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.receiving_scope(p_branch_id);
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
  v_id uuid;
begin
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 43200) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_to_user_id is null or not exists (
    select 1 from public.delegation_candidates(p_branch_id) c where c.user_id = p_to_user_id
  ) then
    raise exception 'delegate_not_found' using errcode = 'P0002';
  end if;

  update public.delegation_logs
  set is_active = false, end_at = case when end_at is null or end_at > now() then now() else end_at end
  where tenant_id = v_tenant and branch_id = p_branch_id and from_user_id = auth.uid() and is_active;

  insert into public.delegation_logs (tenant_id, branch_id, from_user_id, to_user_id, reason, start_at, end_at)
  values (
    v_tenant, p_branch_id, auth.uid(), p_to_user_id, coalesce(v_reason, 'отошел'), now(),
    case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.start_delegation(uuid, uuid, integer, text) from public, anon;
grant execute on function public.start_delegation(uuid, uuid, integer, text) to authenticated;

-- Ends a hand-over early; either side may end it.
create or replace function public.end_delegation(p_delegation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  update public.delegation_logs
  set is_active = false, end_at = case when end_at is null or end_at > now() then now() else end_at end
  where id = p_delegation_id and tenant_id = v_tenant and is_active
    and (from_user_id = auth.uid() or to_user_id = auth.uid());
  if not found then
    raise exception 'delegation_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.end_delegation(uuid) from public, anon;
grant execute on function public.end_delegation(uuid) to authenticated;

-- The caller's live hand-overs, both directions; a hand-over counts only while its giver is still owner/chef.
create or replace function public.my_delegations()
returns table (
  delegation_id uuid,
  branch_id uuid,
  direction text,
  from_user_id uuid,
  from_email text,
  to_user_id uuid,
  to_email text,
  reason text,
  start_at timestamptz,
  end_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.branch_id,
         case when d.to_user_id = auth.uid() then 'incoming' else 'outgoing' end,
         d.from_user_id, pf.email, d.to_user_id, pt.email, d.reason, d.start_at, d.end_at
  from public.delegation_logs d
  join public.memberships m
    on m.user_id = d.from_user_id and m.tenant_id = d.tenant_id and m.role in ('owner', 'chef')
  left join public.profiles pf on pf.id = d.from_user_id
  left join public.profiles pt on pt.id = d.to_user_id
  where d.tenant_id = public.current_tenant_id()
    and (d.from_user_id = auth.uid() or d.to_user_id = auth.uid())
    and d.is_active
    and (d.end_at is null or d.end_at > now())
  order by d.start_at desc
  limit 50
$$;

revoke execute on function public.my_delegations() from public, anon;
grant execute on function public.my_delegations() to authenticated;
