-- Product expiry and the lots that are still in date move together.
-- products.expiry_date is the catalog date. product_stocks rows are the lots the catalog
-- calls "nearest expiry". Authenticated cannot update product_stocks (balances change only
-- through stock_movements); this correction does not change the quantity on hand, so it
-- lives in one security-definer transaction instead of a stock movement.
-- Lots already past the tenant's today are left as they are. Two lots at the same place
-- that would land on the same date are merged so product_stocks_lot_unique holds.
-- Run after 20261018000000_labels_and_lots.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.tenant_today(uuid)') is null
     or to_regprocedure('public.set_product_expiry(uuid, date)') is null
     or to_regclass('public.product_stocks') is null
     or to_regclass('public.product_lots') is null then
    raise exception 'Run 20261008000000_anbar_barcode.sql and 20261018000000_labels_and_lots.sql first';
  end if;
end;
$$;

-- Returns how many in-date stock lots changed expiry (merged rows included).
create or replace function public.update_product_and_lots_expiry(p_product_id uuid, p_expiry date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_today date;
  v_max date;
  v_updated integer := 0;
  v_group record;
  v_keep uuid;
  v_qty numeric;
  v_cost numeric;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'no_organization' using errcode = '42501';
  end if;

  v_today := public.tenant_today(v_tenant);
  if v_today is null then
    raise exception 'no_organization' using errcode = '42501';
  end if;
  if p_expiry is not null then
    v_max := (v_today + interval '5 years')::date;
    if p_expiry < v_today or p_expiry > v_max then
      raise exception 'expiry_out_of_range' using errcode = '22023';
    end if;
  end if;

  update public.products
  set expiry_date = p_expiry
  where id = p_product_id
    and tenant_id = v_tenant;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  -- Clearing the catalog date does not wipe lot dates.
  if p_expiry is null then
    return 0;
  end if;

  perform 1
  from public.product_stocks
  where tenant_id = v_tenant
    and product_id = p_product_id
  order by id
  for update;

  select count(*)::integer into v_updated
  from public.product_stocks
  where tenant_id = v_tenant
    and product_id = p_product_id
    and quantity > 0
    and (expiry_date is null or expiry_date >= v_today)
    and expiry_date is distinct from p_expiry;

  for v_group in
    select branch_id, location_id
    from public.product_stocks
    where tenant_id = v_tenant
      and product_id = p_product_id
      and quantity > 0
      and (expiry_date is null or expiry_date >= v_today)
      and expiry_date is distinct from p_expiry
    group by branch_id, location_id
  loop
    select id into v_keep
    from public.product_stocks
    where tenant_id = v_tenant
      and product_id = p_product_id
      and branch_id is not distinct from v_group.branch_id
      and location_id = v_group.location_id
      and expiry_date is not distinct from p_expiry
    order by id
    limit 1;

    if v_keep is null then
      select id into v_keep
      from public.product_stocks
      where tenant_id = v_tenant
        and product_id = p_product_id
        and branch_id is not distinct from v_group.branch_id
        and location_id = v_group.location_id
        and quantity > 0
        and (expiry_date is null or expiry_date >= v_today)
      order by expiry_date nulls last, id
      limit 1;

      if v_keep is null then
        raise exception 'save_failed' using errcode = '55000';
      end if;

      update public.product_stocks
      set expiry_date = p_expiry,
          updated_at = now()
      where id = v_keep;
    end if;

    select coalesce(sum(quantity), 0),
      case
        when coalesce(sum(quantity) filter (where cost_per_unit is not null), 0) > 0
          then sum(quantity * cost_per_unit) filter (where cost_per_unit is not null)
               / sum(quantity) filter (where cost_per_unit is not null)
        else null
      end
    into v_qty, v_cost
    from public.product_stocks
    where tenant_id = v_tenant
      and product_id = p_product_id
      and branch_id is not distinct from v_group.branch_id
      and location_id = v_group.location_id
      and (
        id = v_keep
        or (
          quantity > 0
          and (expiry_date is null or expiry_date >= v_today)
        )
      );

    update public.product_stocks
    set quantity = v_qty,
        cost_per_unit = coalesce(v_cost, cost_per_unit),
        updated_at = now()
    where id = v_keep;

    delete from public.product_stocks
    where tenant_id = v_tenant
      and product_id = p_product_id
      and branch_id is not distinct from v_group.branch_id
      and location_id = v_group.location_id
      and id <> v_keep
      and quantity > 0
      and (expiry_date is null or expiry_date >= v_today);
  end loop;

  -- Label lots follow when the new date is still on or after production.
  update public.product_lots
  set expiry_date = p_expiry
  where tenant_id = v_tenant
    and product_id = p_product_id
    and expiry_date >= v_today
    and expiry_date is distinct from p_expiry
    and p_expiry >= production_date;

  return v_updated;
end;
$$;

revoke execute on function public.update_product_and_lots_expiry(uuid, date) from public, anon;
grant execute on function public.update_product_and_lots_expiry(uuid, date) to authenticated;

commit;
