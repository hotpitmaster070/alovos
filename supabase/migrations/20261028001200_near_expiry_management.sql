-- Freshness control (FEFO) for the restaurant: expired stock no longer goes into sales, stock value
-- counts only good stock, near-expiry lots are listed for the chef, who decides what happens to each.
-- The system never writes anything off on its own.
-- * get_near_expiry_batches(): lots of a branch expiring within N days of the restaurant's day.
-- * handle_stock_movement(): sales / recipe deductions / moves take only good lots (FEFO among them);
--   with only expired stock left: insufficient_stock, hint only_expired_stock, the product in detail.
--   Waste and count corrections still reach expired lots. deduce_ingredients_for_dish() plans its
--   deductions on good stock too, so a sale records the shortage instead of failing.
-- * stock_value(): total_value (good stock) and expired_value.
-- * review_batch_action(): the chef's / owner's decision on one lot; write_off uses the existing waste
--   path (insert_wastage_log + a 'waste' movement on exactly that lot).
-- * notify_expiring_batches(): one 'expiring_soon' notification per branch and day at the restaurant's
--   tenant_settings.daily_job_time; it writes nothing off. Own pg_cron job where pg_cron is installed.
-- The restaurant's day comes from tenant_settings.timezone (UTC without settings), the look-ahead from
-- tenant_settings.expiry_review_days, the currency from tenant_settings.currency.
-- Run after 20261028001100_fix_zones_and_tests.sql. Idempotent.

do $$
begin
  if to_regprocedure('public.insert_wastage_log(uuid, public.storage_locations, uuid, numeric, text, text, uuid, uuid, uuid)') is null
     or to_regprocedure('public.member_has_branch(uuid, uuid, uuid)') is null
     or to_regprocedure('public.tech_card_gross(numeric, numeric, numeric)') is null
     or to_regprocedure('public.tenant_zone_language(uuid)') is null then
    raise exception 'Run 20261028001100_fix_zones_and_tests.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The restaurant's day and the freshness rule
-- ---------------------------------------------------------------------------
create or replace function public.stock_today(p_tenant_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tenant_today(p_tenant_id), (now() at time zone 'UTC')::date)
$$;
revoke execute on function public.stock_today(uuid) from public, anon, authenticated;

-- Good on its expiry day; stock without a date never expires.
create or replace function public.stock_is_fresh(p_expiry date, p_today date)
returns boolean
language sql
immutable
as $$
  select p_expiry is null or p_expiry >= p_today
$$;

alter table public.tenant_settings add column if not exists daily_job_time time not null default '08:00';
alter table public.tenant_settings add column if not exists expiry_review_days integer not null default 1;
alter table public.tenant_settings drop constraint if exists tenant_settings_expiry_review_days_check;
alter table public.tenant_settings
  add constraint tenant_settings_expiry_review_days_check check (expiry_review_days between 0 and 30);

-- ---------------------------------------------------------------------------
-- 2. Stock trigger: good lots only for consumption
-- ---------------------------------------------------------------------------
-- With stock_id (written with app.lot_move = 'on' by move_stock_lot, transfers and review_batch_action)
-- the movement takes from exactly that lot; 'waste' and 'spisanie' leave the stock, moves land in the
-- target. Without stock_id: 'spisanie', 'task' and moves take good lots, FEFO; 'waste' and 'count'
-- may take any lot, the oldest first.
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
  v_fresh_only boolean;
  v_today date;
  v_expired numeric;
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
       or new.movement_type not in ('peremeshchenie', 'transfer', 'waste', 'spisanie') then
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
    if new.movement_type in ('waste', 'spisanie') then
      return new;
    end if;
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
    v_fresh_only := new.movement_type in ('spisanie', 'task', 'peremeshchenie', 'transfer');
    v_today := public.stock_today(new.tenant_id);
    v_left := new.quantity;
    for v_lot in
      select * from public.product_stocks
      where tenant_id = new.tenant_id
        and product_id = new.product_id
        and location_id = new.from_location_id
        and (new.branch_id is null or branch_id is not distinct from new.branch_id)
        and (not v_fresh_only or public.stock_is_fresh(expiry_date, v_today))
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
      if v_fresh_only then
        select coalesce(sum(ps.quantity), 0) into v_expired
        from public.product_stocks ps
        where ps.tenant_id = new.tenant_id and ps.product_id = new.product_id
          and ps.location_id = new.from_location_id and ps.quantity > 0
          and not public.stock_is_fresh(ps.expiry_date, v_today);
        if v_expired > 0 then
          raise exception 'insufficient_stock' using errcode = '22003', hint = 'only_expired_stock',
            detail = (
              select jsonb_build_object('product_id', p.id, 'internal_code', p.internal_code,
                'missing', v_left, 'expired_quantity', v_expired)::text
              from public.products p where p.id = new.product_id
            );
        end if;
      end if;
      raise exception 'insufficient_stock' using errcode = '22003';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_stock_movement() from public, anon, authenticated;

-- As in 20261028000600_tech_card_editor.sql (gross by tech_card_gross), but planned on good stock only,
-- so a sale with only expired stock left records a shortage (stock_alerts, with the expired quantity)
-- instead of failing in the trigger.
create or replace function public.deduce_ingredients_for_dish(p_recipe_id uuid, p_quantity numeric, p_branch_id uuid)
returns table (product_id uuid, deducted numeric, shortage numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date;
  r record;
  v_place record;
  v_gross numeric;
  v_remaining numeric;
  v_taken numeric;
  v_expired numeric;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tech_cards t where t.id = p_recipe_id and t.tenant_id = v_tenant) then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 10000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_today := public.stock_today(v_tenant);

  for r in
    select i.product_id as ingredient,
           sum(public.tech_card_gross(i.brutto, i.netto, i.waste_percent)) * p_quantity as gross
    from public.tech_card_ingredients i
    where i.tech_card_id = p_recipe_id and i.tenant_id = v_tenant
    group by i.product_id
  loop
    v_gross := round(r.gross, 3);
    continue when v_gross <= 0;
    v_remaining := v_gross;

    -- Lock the product's stock at the branch so concurrent sales cannot take the same stock twice.
    perform 1 from public.product_stocks l
    where l.tenant_id = v_tenant and l.branch_id = p_branch_id and l.product_id = r.ingredient and l.quantity > 0
    for update;

    -- Places of the branch holding good stock of the product, the one with the earliest expiry first.
    for v_place in
      select s.location_id, sum(s.quantity) as available
      from public.product_stocks s
      where s.tenant_id = v_tenant and s.branch_id = p_branch_id
        and s.product_id = r.ingredient and s.quantity > 0
        and public.stock_is_fresh(s.expiry_date, v_today)
      group by s.location_id
      order by min(s.expiry_date) nulls last, s.location_id
    loop
      exit when v_remaining <= 0;
      v_taken := least(v_place.available, v_remaining);
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, from_location_id, quantity, movement_type, reason, recipe_id, user_id, unit
      )
      select v_tenant, p_branch_id, r.ingredient, v_place.location_id, v_taken, 'spisanie', 'sale_deduction',
             p_recipe_id, auth.uid(), p.unit
      from public.products p where p.id = r.ingredient;
      v_remaining := v_remaining - v_taken;
    end loop;

    if v_remaining > 0 then
      select coalesce(sum(s.quantity), 0) into v_expired
      from public.product_stocks s
      where s.tenant_id = v_tenant and s.branch_id = p_branch_id and s.product_id = r.ingredient
        and s.quantity > 0 and not public.stock_is_fresh(s.expiry_date, v_today);
      insert into public.stock_alerts (tenant_id, branch_id, product_id, type, message_key, meta)
      values (
        v_tenant, p_branch_id, r.ingredient, 'insufficient_stock', 'insufficient_stock_warning',
        jsonb_build_object('shortage', v_remaining, 'required', v_gross, 'product_id', r.ingredient,
          'recipe_id', p_recipe_id, 'expired_quantity', v_expired)
      );
    end if;

    product_id := r.ingredient;
    deducted := v_gross - greatest(v_remaining, 0);
    shortage := greatest(v_remaining, 0);
    return next;
  end loop;
end;
$$;
revoke execute on function public.deduce_ingredients_for_dish(uuid, numeric, uuid) from public, anon;
grant execute on function public.deduce_ingredients_for_dish(uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stock value: good stock and expired stock apart
-- ---------------------------------------------------------------------------
drop function if exists public.stock_value(uuid, uuid);
create function public.stock_value(p_branch_id uuid default null, p_location_id uuid default null)
returns table (total_value numeric, expired_value numeric)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select ps.quantity * coalesce(ps.cost_per_unit, 0) as value,
      public.stock_is_fresh(ps.expiry_date, public.stock_today(ps.tenant_id)) as fresh
    from public.product_stocks ps
    join public.storage_locations sl on sl.id = ps.location_id
    where ps.tenant_id = public.current_tenant_id()
      and ps.quantity > 0
      and (p_branch_id is null or sl.branch_id = p_branch_id)
      and (p_location_id is null or ps.location_id = p_location_id)
  )
  select
    case when public.can_see_costs() then coalesce(sum(v.value) filter (where v.fresh), 0) end,
    case when public.can_see_costs() then coalesce(sum(v.value) filter (where not v.fresh), 0) end
  from v
$$;
revoke execute on function public.stock_value(uuid, uuid) from public, anon;
grant execute on function public.stock_value(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Near-expiry list and the chef's decisions
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regtype('public.batch_review_action') is null then
    create type public.batch_review_action as enum ('use_in_production', 'discount', 'staff', 'extend', 'write_off');
  end if;
end;
$$;

create table if not exists public.batch_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  stock_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid references public.storage_locations(id) on delete set null,
  action public.batch_review_action not null,
  note text check (note is null or char_length(note) <= 500),
  quantity numeric not null check (quantity > 0),
  expiry_date date,
  new_expiry_date date,
  movement_id uuid,
  wastage_log_id uuid,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_batch_reviews_stock on public.batch_reviews (tenant_id, stock_id, created_at desc);
alter table public.batch_reviews enable row level security;
revoke all on table public.batch_reviews from anon, authenticated;
grant select on table public.batch_reviews to authenticated;
drop policy if exists batch_reviews_select on public.batch_reviews;
create policy batch_reviews_select on public.batch_reviews
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.can_see_costs()));

-- Lots of a branch expiring from the restaurant's today to today + p_days_ahead (default: the
-- restaurant's expiry_review_days). Cost only for owners and chefs; the latest decision per lot.
create or replace function public.get_near_expiry_batches(p_branch_id uuid, p_days_ahead integer default null)
returns table (
  lot_id uuid, product_id uuid, product_name text, internal_code text, unit text, lot_number text,
  expiry_date date, days_left integer, quantity numeric, location_id uuid, location_name text,
  location_type text, cost numeric, currency text, last_action text, last_action_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  v_today date := public.stock_today(v_tenant);
  v_days integer;
  v_currency text;
  v_costs boolean := public.can_see_costs();
begin
  if p_branch_id is null
     or not exists (select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  select s.expiry_review_days, s.currency into v_days, v_currency from public.tenant_settings s where s.tenant_id = v_tenant;
  v_days := coalesce(p_days_ahead, v_days, 1);
  v_currency := coalesce(nullif(btrim(v_currency), ''), 'USD');
  if v_days < 0 or v_days > 30 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  return query
  select ps.id, ps.product_id, p.name, p.internal_code, coalesce(ps.unit, p.unit),
    (select l.lot_number from public.product_lots l
     where l.tenant_id = v_tenant and l.product_id = ps.product_id and l.storage_location_id = ps.location_id
       and l.expiry_date = ps.expiry_date
     order by l.created_at desc, l.id limit 1),
    ps.expiry_date, (ps.expiry_date - v_today)::integer, ps.quantity, ps.location_id, sl.name, sl.type,
    case when v_costs then ps.quantity * coalesce(ps.cost_per_unit, p.cost, 0) end,
    v_currency,
    rv.action::text, rv.created_at
  from public.product_stocks ps
  join public.products p on p.id = ps.product_id
  join public.storage_locations sl on sl.id = ps.location_id
  left join lateral (
    select r.action, r.created_at from public.batch_reviews r
    where r.tenant_id = v_tenant and r.stock_id = ps.id and r.expiry_date is not distinct from ps.expiry_date
    order by r.created_at desc limit 1
  ) rv on true
  where ps.tenant_id = v_tenant and sl.branch_id = p_branch_id and ps.quantity > 0
    and ps.expiry_date between v_today and v_today + v_days
  order by ps.expiry_date, p.name, ps.id;
end;
$$;
revoke execute on function public.get_near_expiry_batches(uuid, integer) from public, anon;
grant execute on function public.get_near_expiry_batches(uuid, integer) to authenticated;

-- The chef's (or owner's) decision on one lot; returns the batch_reviews id.
--   use_in_production, discount: recorded, stock unchanged (it leaves through production or sales).
--   staff: the lot goes out as a staff meal ('spisanie', reason staff_meal).
--   extend: a new expiry after today; a note is required.
--   write_off: the lot goes out as waste (reason expired) through insert_wastage_log.
-- Expired lots can only be written off.
create or replace function public.review_batch_action(
  p_lot_id uuid,
  p_action text,
  p_note text default null,
  p_new_expiry date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_action public.batch_review_action;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stock public.product_stocks;
  v_location public.storage_locations;
  v_today date;
  v_parent uuid;
  v_log uuid;
  v_movement uuid;
  v_review uuid;
  v_target uuid;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  begin
    v_action := p_action::public.batch_review_action;
  exception when invalid_text_representation then
    raise exception 'invalid_input' using errcode = '22023';
  end;
  if v_action is null or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_stock from public.product_stocks where id = p_lot_id and tenant_id = v_tenant for update;
  if v_stock.id is null or v_stock.quantity <= 0
     or not public.member_has_branch(auth.uid(), v_tenant, v_stock.branch_id) then
    raise exception 'lot_not_found' using errcode = 'P0002';
  end if;
  v_today := public.stock_today(v_tenant);
  if v_action <> 'write_off' and not public.stock_is_fresh(v_stock.expiry_date, v_today) then
    raise exception 'lot_expired' using errcode = '55000';
  end if;
  select * into v_location from public.storage_locations where id = v_stock.location_id;

  if v_action = 'extend' then
    if v_stock.expiry_date is null or p_new_expiry is null or p_new_expiry <= v_today
       or p_new_expiry = v_stock.expiry_date or v_note is null then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select ps.id into v_target from public.product_stocks ps
    where ps.branch_id = v_stock.branch_id and ps.location_id = v_stock.location_id
      and ps.product_id = v_stock.product_id and ps.expiry_date = p_new_expiry
    for update;
    if v_target is null then
      update public.product_stocks set expiry_date = p_new_expiry, updated_at = now() where id = v_stock.id;
    else
      update public.product_stocks t
      set cost_per_unit = case
            when t.cost_per_unit is null then v_stock.cost_per_unit
            when v_stock.cost_per_unit is null then t.cost_per_unit
            else (t.quantity * t.cost_per_unit + v_stock.quantity * v_stock.cost_per_unit) / nullif(t.quantity + v_stock.quantity, 0)
          end,
          quantity = t.quantity + v_stock.quantity,
          updated_at = now()
      where t.id = v_target;
      update public.product_stocks set quantity = 0, updated_at = now() where id = v_stock.id;
    end if;
  elsif v_action in ('write_off', 'staff') then
    perform set_config('app.lot_move', 'on', true);
    if v_action = 'write_off' then
      select l.id into v_parent from public.product_lots l
      where l.tenant_id = v_tenant and l.product_id = v_stock.product_id
        and l.storage_location_id = v_stock.location_id and l.expiry_date is not distinct from v_stock.expiry_date
      order by l.created_at desc, l.id
      limit 1;
      v_log := public.insert_wastage_log(v_tenant, v_location, v_stock.product_id, v_stock.quantity, 'expired', v_note, v_parent, null, null);
    end if;
    insert into public.stock_movements (
      tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, unit, user_id,
      stock_id, expiry_date
    )
    select v_tenant, p.id, v_stock.branch_id, v_stock.location_id, v_stock.quantity,
      case when v_action = 'write_off' then 'waste' else 'spisanie' end,
      case when v_action = 'write_off' then 'expired' else 'staff_meal' end,
      coalesce(v_stock.unit, p.unit), auth.uid(), v_stock.id, v_stock.expiry_date
    from public.products p where p.id = v_stock.product_id
    returning id into v_movement;
    perform set_config('app.lot_move', 'off', true);
  end if;

  insert into public.batch_reviews (
    tenant_id, branch_id, stock_id, product_id, location_id, action, note, quantity, expiry_date,
    new_expiry_date, movement_id, wastage_log_id, reviewed_by
  ) values (
    v_tenant, v_stock.branch_id, v_stock.id, v_stock.product_id, v_stock.location_id, v_action, v_note,
    v_stock.quantity, case when v_action = 'extend' then p_new_expiry else v_stock.expiry_date end,
    case when v_action = 'extend' then p_new_expiry end, v_movement, v_log, auth.uid()
  )
  returning id into v_review;
  return v_review;
end;
$$;
revoke execute on function public.review_batch_action(uuid, text, text, date) from public, anon;
grant execute on function public.review_batch_action(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Daily notification (no write-off)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  type text not null check (type in ('expiring_soon')),
  notify_date date not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  read_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, branch_id, type, notify_date)
);
create index if not exists idx_notifications_unread on public.notifications (tenant_id, type) where read_at is null;
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.can_see_costs()));

-- Owners and chefs mark notifications of their restaurant read (all unread of p_type when p_ids is null).
create or replace function public.mark_notifications_read(p_type text, p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_count integer;
begin
  if not public.can_see_costs() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.notifications n
  set read_at = now(), read_by = auth.uid()
  where n.tenant_id = v_tenant and n.type = p_type and n.read_at is null
    and (p_ids is null or n.id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.mark_notifications_read(text, uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(text, uuid[]) to authenticated;

-- For every restaurant whose local time has passed tenant_settings.daily_job_time: one notification per
-- branch with lots expiring within expiry_review_days (count, value, currency, the first lots). Once per
-- branch and local day; nothing is written off. Returns the number of notifications created.
create or replace function public.notify_expiring_batches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  b record;
  v_today date;
  v_payload jsonb;
  v_created integer := 0;
begin
  for s in
    select ts.tenant_id, ts.currency, ts.daily_job_time, ts.expiry_review_days,
      now() at time zone coalesce(nullif(ts.timezone, ''), 'UTC') as local_now
    from public.tenant_settings ts
  loop
    continue when s.local_now::time < s.daily_job_time;
    v_today := s.local_now::date;
    for b in select br.id from public.branches br where br.tenant_id = s.tenant_id loop
      continue when exists (
        select 1 from public.notifications n
        where n.tenant_id = s.tenant_id and n.branch_id = b.id and n.type = 'expiring_soon' and n.notify_date = v_today
      );
      select jsonb_build_object(
          'count', count(*),
          'total_value', coalesce(sum(x.value), 0),
          'currency', s.currency,
          'days', s.expiry_review_days,
          'lots', coalesce(jsonb_agg(jsonb_build_object('lot_id', x.id, 'product_id', x.product_id, 'product_name', x.name,
            'expiry_date', x.expiry_date, 'quantity', x.quantity, 'unit', x.unit) order by x.expiry_date, x.name)
            filter (where x.rn <= 20), '[]'::jsonb))
        into v_payload
      from (
        select ps.id, ps.product_id, p.name, ps.expiry_date, ps.quantity, coalesce(ps.unit, p.unit) as unit,
          ps.quantity * coalesce(ps.cost_per_unit, p.cost, 0) as value,
          row_number() over (order by ps.expiry_date, p.name, ps.id) as rn
        from public.product_stocks ps
        join public.products p on p.id = ps.product_id
        where ps.tenant_id = s.tenant_id and ps.branch_id = b.id and ps.quantity > 0
          and ps.expiry_date between v_today and v_today + s.expiry_review_days
      ) x;
      continue when (v_payload ->> 'count')::integer = 0;
      insert into public.notifications (tenant_id, branch_id, type, notify_date, payload)
      values (s.tenant_id, b.id, 'expiring_soon', v_today, v_payload)
      on conflict (tenant_id, branch_id, type, notify_date) do nothing;
      if found then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;
  return v_created;
end;
$$;
revoke execute on function public.notify_expiring_batches() from public, anon, authenticated;

-- Its own job; the other cron jobs are left as they are. Every 15 minutes, so each restaurant gets its
-- digest at its own daily_job_time in its own time zone.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.unschedule(jobid) from cron.job where jobname = 'notify-expiring'$cron$;
    execute $cron$select cron.schedule('notify-expiring', '*/15 * * * *', 'select public.notify_expiring_batches()')$cron$;
  end if;
end;
$$;
