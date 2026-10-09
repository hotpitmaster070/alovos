-- Storage rules the owner sets and moving a lot to another kind of place.
-- * The rule "how long this product keeps in this place" stays in product_shelf_life_rules
--   (product + storage place, place names and types are the client's own). set_shelf_life_rule()
--   writes it; the receipt dialog, the product sheet and the move below remember it.
-- * move_stock_lot(): one stock row (product, place, expiry) moves, whole or in part, to another
--   place of the same branch through one 'peremeshchenie' movement. Into a place of another type
--   (fresh -> freezer, freezer -> fridge) the clock restarts: expiry = today + the target's shelf
--   life. Between places of the same type the expiry stays. Expired lots do not move.
-- * stock_movements.stock_id names the moved lot and previous_expiry_date keeps the old date, so the
--   movement log is the history of storage changes. Balances still change only in the trigger.
-- Run after 20261021000000_sync_product_expiry.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.set_shelf_life_rule(uuid, uuid, integer)') is null
     or to_regprocedure('public.get_shelf_life(uuid, uuid)') is null
     or to_regprocedure('public.insert_product_lot(uuid, uuid, numeric, uuid, date, date, text, uuid, jsonb, uuid, uuid, numeric)') is null
     or to_regprocedure('public.tenant_today(uuid)') is null then
    raise exception 'Run 20261018000000_labels_and_lots.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Movement log columns
-- ---------------------------------------------------------------------------
alter table public.stock_movements add column if not exists stock_id uuid;
alter table public.stock_movements add column if not exists previous_expiry_date date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_stock_id_fkey') then
    alter table public.stock_movements
      add constraint stock_movements_stock_id_fkey
      foreign key (stock_id) references public.product_stocks(id) on delete set null;
  end if;
end;
$$;
create index if not exists idx_stock_movements_stock on public.stock_movements (stock_id) where stock_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The balance trigger: a movement with stock_id takes from exactly that lot
-- ---------------------------------------------------------------------------
-- Unchanged for every movement without stock_id. With stock_id (only written by move_stock_lot, which
-- sets app.lot_move for its transaction) the transfer takes from that one row and the target row
-- gets the movement's expiry_date.
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

  if new.stock_id is not null then
    if coalesce(current_setting('app.lot_move', true), '') <> 'on'
       or new.movement_type not in ('peremeshchenie', 'transfer') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select * into v_lot
    from public.product_stocks
    where id = new.stock_id
      and tenant_id = new.tenant_id
      and product_id = new.product_id
      and location_id = new.from_location_id
    for update;
    if v_lot.id is null then
      raise exception 'lot_not_found' using errcode = 'P0002';
    end if;
    if new.quantity <= 0 or v_lot.quantity < new.quantity then
      raise exception 'insufficient_stock' using errcode = '22003';
    end if;
    update public.product_stocks
    set quantity = quantity - new.quantity, updated_at = now()
    where id = v_lot.id;
    insert into public.product_stocks (
      tenant_id, branch_id, product_id, location_id, expiry_date, quantity, cost_per_unit, unit
    ) values (
      new.tenant_id, coalesce(new.branch_id, v_lot.branch_id), new.product_id, new.to_location_id,
      coalesce(new.expiry_date, v_lot.expiry_date), new.quantity, v_lot.cost_per_unit, v_lot.unit
    )
    on conflict (branch_id, location_id, product_id, expiry_date) do update
      set cost_per_unit = case
            when public.product_stocks.cost_per_unit is null then excluded.cost_per_unit
            when excluded.cost_per_unit is null then public.product_stocks.cost_per_unit
            else (public.product_stocks.quantity * public.product_stocks.cost_per_unit
                  + excluded.quantity * excluded.cost_per_unit)
                 / nullif(public.product_stocks.quantity + excluded.quantity, 0)
          end,
          quantity = public.product_stocks.quantity + excluded.quantity,
          updated_at = now();
    return new;
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
-- 3. Moving a lot
-- ---------------------------------------------------------------------------
-- p_qty null moves the whole row. p_shelf_life_days overrides the target's norm for this move (only
-- when the clock restarts); with p_remember it becomes the rule for the product in that place.
-- Returns the label lot of the moved stock in its new place; null when the stock has no expiry
-- and keeps none (same kind of place), since a label needs a date.
create or replace function public.move_stock_lot(
  p_stock_id uuid,
  p_to_location_id uuid,
  p_qty numeric default null,
  p_shelf_life_days integer default null,
  p_remember boolean default false,
  p_reason text default null
)
returns public.product_lots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := public.tenant_today(v_tenant);
  v_stock public.product_stocks;
  v_from public.storage_locations;
  v_to public.storage_locations;
  v_label public.product_lots;
  v_qty numeric;
  v_restart boolean;
  v_expiry date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_movement uuid;
begin
  if public.current_member_role() is null or public.current_member_role() not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_qty is not null and p_qty <= 0)
     or (p_shelf_life_days is not null and (p_shelf_life_days < 0 or p_shelf_life_days > 3650))
     or (coalesce(p_remember, false) and p_shelf_life_days is null)
     or char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_stock
  from public.product_stocks
  where id = p_stock_id and tenant_id = v_tenant
  for update;
  if v_stock.id is null or v_stock.quantity <= 0 then
    raise exception 'lot_not_found' using errcode = 'P0002';
  end if;
  if v_stock.expiry_date is not null and v_stock.expiry_date < v_today then
    raise exception 'lot_expired' using errcode = '55000';
  end if;
  v_qty := coalesce(p_qty, v_stock.quantity);
  if v_qty > v_stock.quantity then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  select * into v_from from public.storage_locations where id = v_stock.location_id and tenant_id = v_tenant;
  v_to := public.lot_target(v_tenant, v_stock.product_id, p_to_location_id);
  if v_to.id = v_from.id or v_to.branch_id is distinct from v_from.branch_id then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.stock_counts
    where tenant_id = v_tenant
      and location_id in (v_from.id, v_to.id)
      and status in ('draft', 'counting', 'merging')
  ) then
    raise exception 'open_count' using errcode = '55000';
  end if;

  v_restart := v_from.type is distinct from v_to.type or v_to.type = 'custom';
  if not v_restart and p_shelf_life_days is not null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_shelf_life_days is not null and coalesce(p_remember, false) then
    perform public.set_shelf_life_rule(v_stock.product_id, v_to.id, p_shelf_life_days);
  end if;
  v_expiry := case
    when v_restart then v_today + coalesce(p_shelf_life_days, public.get_shelf_life(v_stock.product_id, v_to.id))
    else v_stock.expiry_date
  end;

  select * into v_label
  from public.product_lots
  where tenant_id = v_tenant
    and product_id = v_stock.product_id
    and storage_location_id = v_from.id
    and expiry_date is not distinct from v_stock.expiry_date
  order by created_at desc, id
  limit 1;

  perform set_config('app.lot_move', 'on', true);
  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type,
    expiry_date, previous_expiry_date, stock_id, cost_per_unit, reason, unit, user_id
  )
  values (
    v_tenant, v_stock.product_id, v_from.branch_id, v_from.id, v_to.id, v_qty, 'peremeshchenie',
    v_expiry, v_stock.expiry_date, v_stock.id, v_stock.cost_per_unit, v_reason, v_stock.unit, auth.uid()
  )
  returning id into v_movement;
  perform set_config('app.lot_move', 'off', true);

  if v_expiry is null then
    return null;
  end if;
  return public.insert_product_lot(
    v_tenant, v_stock.product_id, v_qty, v_to.id,
    least(coalesce(v_label.production_date, v_today), v_expiry),
    v_expiry,
    coalesce(v_label.lot_type, 'raw'),
    v_label.id,
    coalesce(v_label.composition_json, '[]'::jsonb),
    v_label.preparation_id,
    v_movement,
    case when v_label.portions is not null and v_label.quantity > 0
      then round(v_label.portions * v_qty / v_label.quantity, 2) end
  );
end;
$$;

revoke execute on function public.move_stock_lot(uuid, uuid, numeric, integer, boolean, text) from public, anon;
grant execute on function public.move_stock_lot(uuid, uuid, numeric, integer, boolean, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'previous_expiry_date'
  ) then
    raise exception 'stock_movements.previous_expiry_date missing';
  end if;
end;
$$;

commit;
