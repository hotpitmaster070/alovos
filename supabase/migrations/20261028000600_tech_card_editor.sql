-- Recipe card editor and live cost (blocks 4.1-4.3).
-- * tech_cards: category, sale_price, yield_qty / yield_unit (output of one portion), updated_at/by.
--   sale_price is money: hidden from clients like products.sale_price, read through tech_card_economics().
-- * Ingredients are per portion: brutto (taken from stock), netto, waste_percent = (brutto - netto) / brutto,
--   computed on save; price_lot_id optionally pins the lot whose cost prices the ingredient.
-- * One gross rule for cost and sale write-off: tech_card_gross() (brutto; else netto grossed up by the waste).
--   deduce_ingredients_for_dish() now uses it (it took netto x (1 + waste), short of brutto).
-- * Live cost: price lot when set, else the product's latest lot with a cost, else products.cost.
--   calculate_tech_card_cost() / tech_card_cost_lines() / tech_card_economics() / ingredient_prices():
--   owners and chefs only (cooks see no money).
-- * Writes only through save_tech_card() (owner, chef, cook) and delete_tech_card() (owner, chef).
-- Run after 20261028000200_recipe_deductions.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.deduce_ingredients_for_dish(uuid, numeric, uuid)') is null
     or to_regclass('public.product_lot_costs') is null then
    raise exception 'Run 20261028000200_recipe_deductions.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.tech_cards add column if not exists category text;
alter table public.tech_cards add column if not exists sale_price numeric;
alter table public.tech_cards add column if not exists yield_qty numeric;
alter table public.tech_cards add column if not exists yield_unit text;
alter table public.tech_cards add column if not exists updated_at timestamptz not null default now();
alter table public.tech_cards add column if not exists updated_by uuid references public.profiles(id) on delete set null;
alter table public.tech_cards drop constraint if exists tech_cards_sale_price_check;
alter table public.tech_cards add constraint tech_cards_sale_price_check check (sale_price is null or sale_price >= 0);
alter table public.tech_cards drop constraint if exists tech_cards_yield_qty_check;
alter table public.tech_cards add constraint tech_cards_yield_qty_check check (yield_qty is null or yield_qty > 0);

alter table public.tech_card_ingredients add column if not exists price_lot_id uuid references public.product_lots(id) on delete set null;
alter table public.tech_card_ingredients add column if not exists sort integer;

create index if not exists idx_product_lots_tenant_product_created
  on public.product_lots (tenant_id, product_id, created_at desc);
create index if not exists idx_tech_cards_tenant_name on public.tech_cards (tenant_id, name);

-- ---------------------------------------------------------------------------
-- 2. Privileges: no direct writes; sale_price unreadable by clients
-- ---------------------------------------------------------------------------
revoke all on table public.tech_cards, public.tech_card_ingredients from anon;
revoke insert, update, delete on table public.tech_cards, public.tech_card_ingredients from authenticated;
grant select on table public.tech_card_ingredients to authenticated;

do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tech_cards' and column_name <> 'sale_price';
  execute 'revoke select on table public.tech_cards from authenticated';
  execute 'revoke select (sale_price) on table public.tech_cards from authenticated';
  execute format('grant select (%s) on table public.tech_cards to authenticated', v_cols);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Gross per portion (cost and write-off)
-- ---------------------------------------------------------------------------
create or replace function public.tech_card_gross(p_brutto numeric, p_netto numeric, p_waste_percent numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_brutto, 0) > 0 then p_brutto
    when coalesce(p_netto, 0) > 0 and coalesce(p_waste_percent, 0) > 0 and p_waste_percent < 100
      then p_netto / (1 - p_waste_percent / 100.0)
    when coalesce(p_netto, 0) > 0 then p_netto
    else 0
  end
$$;
revoke execute on function public.tech_card_gross(numeric, numeric, numeric) from public, anon;
grant execute on function public.tech_card_gross(numeric, numeric, numeric) to authenticated;

-- Same body as 20261028000200 apart from the gross rule.
create or replace function public.deduce_ingredients_for_dish(p_recipe_id uuid, p_quantity numeric, p_branch_id uuid)
returns table (product_id uuid, deducted numeric, shortage numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_tenant_member();
  r record;
  v_place record;
  v_gross numeric;
  v_remaining numeric;
  v_taken numeric;
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

    -- Places of the branch holding the product, the one with the earliest expiry first.
    for v_place in
      select s.location_id, sum(s.quantity) as available
      from public.product_stocks s
      where s.tenant_id = v_tenant and s.branch_id = p_branch_id
        and s.product_id = r.ingredient and s.quantity > 0
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
      insert into public.stock_alerts (tenant_id, branch_id, product_id, type, message_key, meta)
      values (
        v_tenant, p_branch_id, r.ingredient, 'insufficient_stock', 'insufficient_stock_warning',
        jsonb_build_object('shortage', v_remaining, 'required', v_gross, 'product_id', r.ingredient, 'recipe_id', p_recipe_id)
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
-- 4. Unit price of a product (internal: callers check the tenant and the role)
-- ---------------------------------------------------------------------------
create or replace function public.tech_card_unit_cost(p_tenant_id uuid, p_product_id uuid, p_price_lot_id uuid)
returns table (unit_cost numeric, price_source text, lot_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select x.cost, x.source, x.lot
  from (
    select lc.cost_per_unit as cost, 'price_lot'::text as source, l.id as lot, 0 as pri
    from public.product_lots l
    join public.product_lot_costs lc on lc.lot_id = l.id
    where p_price_lot_id is not null and l.id = p_price_lot_id
      and l.tenant_id = p_tenant_id and l.product_id = p_product_id and lc.cost_per_unit is not null
    union all
    (
      select lc.cost_per_unit, 'latest_lot'::text, l.id, 1
      from public.product_lots l
      join public.product_lot_costs lc on lc.lot_id = l.id
      where l.tenant_id = p_tenant_id and l.product_id = p_product_id and lc.cost_per_unit is not null
      order by l.created_at desc, l.id desc
      limit 1
    )
    union all
    select p.cost, 'product'::text, null::uuid, 2
    from public.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id and p.cost is not null
  ) x
  order by x.pri
  limit 1
$$;
revoke execute on function public.tech_card_unit_cost(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.require_cost_reader()
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
  return v_tenant;
end;
$$;
revoke execute on function public.require_cost_reader() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Live cost
-- ---------------------------------------------------------------------------
-- One row per ingredient of a card: gross per portion, unit price and where it came from.
create or replace function public.tech_card_cost_lines(p_tech_card_id uuid)
returns table (product_id uuid, gross_qty numeric, unit_cost numeric, line_cost numeric, price_source text, lot_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_cost_reader();
begin
  if not exists (select 1 from public.tech_cards t where t.id = p_tech_card_id and t.tenant_id = v_tenant) then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  return query
    select i.product_id, g.gross, c.unit_cost, round(g.gross * c.unit_cost, 4), c.price_source, c.lot_id
    from public.tech_card_ingredients i
    cross join lateral (select public.tech_card_gross(i.brutto, i.netto, i.waste_percent) as gross) g
    left join lateral public.tech_card_unit_cost(v_tenant, i.product_id, i.price_lot_id) c on true
    where i.tech_card_id = p_tech_card_id and i.tenant_id = v_tenant
    order by i.sort nulls last, i.id;
end;
$$;

-- Cost of one portion from the priced ingredients; null for a card without ingredients.
create or replace function public.calculate_tech_card_cost(p_tech_card_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(sum(l.line_cost), 4) from public.tech_card_cost_lines(p_tech_card_id) l
$$;

-- Per card (one card or all of the restaurant): cost, sale price, food cost % and margin.
create or replace function public.tech_card_economics(p_tech_card_id uuid default null)
returns table (
  tech_card_id uuid,
  cost numeric,
  sale_price numeric,
  food_cost_percent numeric,
  margin numeric,
  ingredient_count integer,
  priced_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_cost_reader();
begin
  return query
    select t.id, s.cost, t.sale_price,
           case when t.sale_price > 0 and s.cost is not null then round(s.cost / t.sale_price * 100, 2) end,
           case when t.sale_price is not null and s.cost is not null then round(t.sale_price - s.cost, 4) end,
           s.n, s.priced
    from public.tech_cards t
    cross join lateral (
      select round(sum(g.gross * c.unit_cost), 4) as cost,
             count(*)::integer as n,
             count(c.unit_cost)::integer as priced
      from public.tech_card_ingredients i
      cross join lateral (select public.tech_card_gross(i.brutto, i.netto, i.waste_percent) as gross) g
      left join lateral public.tech_card_unit_cost(v_tenant, i.product_id, i.price_lot_id) c on true
      where i.tech_card_id = t.id and i.tenant_id = v_tenant
    ) s
    where t.tenant_id = v_tenant and (p_tech_card_id is null or t.id = p_tech_card_id)
    order by t.name, t.id;
end;
$$;

-- Current unit price of every product that has one (the editor's live preview before saving).
create or replace function public.ingredient_prices()
returns table (product_id uuid, unit_cost numeric, price_source text, lot_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.require_cost_reader();
begin
  return query
    select p.id, c.unit_cost, c.price_source, c.lot_id
    from public.products p
    cross join lateral public.tech_card_unit_cost(v_tenant, p.id, null) c
    where p.tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Writes
-- ---------------------------------------------------------------------------
-- p_id null creates a card. p_ingredients: [{product_id, brutto, netto, price_lot_id?}] per portion,
-- netto <= brutto. Cooks may edit cards but not money: their sale price and price lots are kept.
create or replace function public.save_tech_card(
  p_id uuid,
  p_name text,
  p_category text,
  p_sale_price numeric,
  p_yield_qty numeric,
  p_yield_unit text,
  p_ingredients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
  v_costs boolean := public.can_see_costs();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_category text := nullif(btrim(regexp_replace(coalesce(p_category, ''), '\s+', ' ', 'g')), '');
  v_unit text := nullif(btrim(coalesce(p_yield_unit, '')), '');
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_id uuid;
  v_old_lots jsonb := '{}'::jsonb;
  v_item jsonb;
  v_product uuid;
  v_brutto numeric;
  v_netto numeric;
  v_lot uuid;
  v_sort integer := 0;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120
     or char_length(coalesce(v_category, '')) > 60
     or char_length(coalesce(v_unit, '')) > 10
     or (p_yield_qty is not null and (p_yield_qty <= 0 or p_yield_qty > 100000))
     or (v_costs and p_sale_price is not null and (p_sale_price < 0 or p_sale_price > 10000000))
     or p_ingredients is null or jsonb_typeof(p_ingredients) <> 'array' or jsonb_array_length(p_ingredients) > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.tech_cards (tenant_id, name, category, sale_price, yield_qty, yield_unit, updated_at, updated_by)
    values (v_tenant, v_name, v_category, case when v_costs then p_sale_price end, p_yield_qty, v_unit, now(), auth.uid())
    returning id into v_id;
  else
    update public.tech_cards
    set name = v_name,
        category = v_category,
        sale_price = case when v_costs then p_sale_price else sale_price end,
        yield_qty = p_yield_qty,
        yield_unit = v_unit,
        updated_at = now(),
        updated_by = auth.uid()
    where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then
      raise exception 'recipe_not_found' using errcode = 'P0002';
    end if;
    select coalesce(jsonb_object_agg(i.product_id::text, i.price_lot_id), '{}'::jsonb) into v_old_lots
    from public.tech_card_ingredients i
    where i.tech_card_id = v_id and i.price_lot_id is not null;
    delete from public.tech_card_ingredients where tech_card_id = v_id and tenant_id = v_tenant;
  end if;

  for v_item in select * from jsonb_array_elements(p_ingredients)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'product_id', '') !~* v_uuid
       or jsonb_typeof(v_item -> 'brutto') is distinct from 'number'
       or jsonb_typeof(v_item -> 'netto') is distinct from 'number' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_product := (v_item ->> 'product_id')::uuid;
    v_brutto := (v_item ->> 'brutto')::numeric;
    v_netto := (v_item ->> 'netto')::numeric;
    if v_brutto <= 0 or v_netto <= 0 or v_netto > v_brutto or v_brutto > 1000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products p where p.id = v_product and p.tenant_id = v_tenant) then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.tech_card_ingredients i where i.tech_card_id = v_id and i.product_id = v_product) then
      raise exception 'duplicate_product' using errcode = 'P0001';
    end if;
    if v_costs then
      v_lot := case when coalesce(v_item ->> 'price_lot_id', '') ~* v_uuid then (v_item ->> 'price_lot_id')::uuid end;
      if v_lot is not null and not exists (
        select 1 from public.product_lots l where l.id = v_lot and l.tenant_id = v_tenant and l.product_id = v_product
      ) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
    else
      v_lot := (v_old_lots ->> v_product::text)::uuid;
    end if;
    v_sort := v_sort + 1;
    insert into public.tech_card_ingredients (tenant_id, tech_card_id, product_id, brutto, netto, waste_percent, price_lot_id, sort)
    values (
      v_tenant, v_id, v_product, round(v_brutto, 4), round(v_netto, 4),
      round((v_brutto - v_netto) / v_brutto * 100, 2), v_lot, v_sort
    );
  end loop;

  return v_id;
end;
$$;

create or replace function public.delete_tech_card(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.require_tenant_member();
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.tech_cards where id = p_id and tenant_id = v_tenant;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants and checks
-- ---------------------------------------------------------------------------
revoke execute on function public.tech_card_cost_lines(uuid) from public, anon;
grant execute on function public.tech_card_cost_lines(uuid) to authenticated;
revoke execute on function public.calculate_tech_card_cost(uuid) from public, anon;
grant execute on function public.calculate_tech_card_cost(uuid) to authenticated;
revoke execute on function public.tech_card_economics(uuid) from public, anon;
grant execute on function public.tech_card_economics(uuid) to authenticated;
revoke execute on function public.ingredient_prices() from public, anon;
grant execute on function public.ingredient_prices() to authenticated;
revoke execute on function public.save_tech_card(uuid, text, text, numeric, numeric, text, jsonb) from public, anon;
grant execute on function public.save_tech_card(uuid, text, text, numeric, numeric, text, jsonb) to authenticated;
revoke execute on function public.delete_tech_card(uuid) from public, anon;
grant execute on function public.delete_tech_card(uuid) to authenticated;

do $$
begin
  if has_column_privilege('authenticated', 'public.tech_cards', 'sale_price', 'select')
     or has_table_privilege('authenticated', 'public.tech_cards', 'insert')
     or has_table_privilege('authenticated', 'public.tech_card_ingredients', 'update')
     or has_function_privilege('authenticated', 'public.tech_card_unit_cost(uuid, uuid, uuid)', 'execute')
     or not has_column_privilege('authenticated', 'public.tech_cards', 'name', 'select') then
    raise exception 'tech card privileges incomplete';
  end if;
end;
$$;

commit;
