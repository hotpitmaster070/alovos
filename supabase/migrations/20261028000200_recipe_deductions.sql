-- Auto write-off of ingredients for cooked/sold dishes (blocks 4 + 7.2).
-- Recipes are tech_cards / tech_card_ingredients; stock lives in product_stocks and moves only through
-- stock_movements ('spisanie' rows, FIFO by expiry inside the movement trigger). A shortage does not
-- fail the sale: what is there is written off and a stock_alerts row records the rest.
-- Idempotent: safe to re-run.

create table if not exists public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  product_id uuid references public.products(id),
  type text,
  message_key text,
  meta jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_stock_alerts_tenant_created on public.stock_alerts (tenant_id, created_at desc);

alter table public.stock_alerts enable row level security;
revoke all on table public.stock_alerts from anon, authenticated;
grant select on table public.stock_alerts to authenticated;
drop policy if exists stock_alerts_select on public.stock_alerts;
create policy stock_alerts_select on public.stock_alerts
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

alter table public.stock_movements add column if not exists recipe_id uuid references public.tech_cards(id) on delete set null;

-- Writes off p_quantity portions of a recipe at a branch. Per ingredient: gross = netto x portions x
-- (1 + waste_percent / 100) (brutto when netto is not set), taken from the branch's places holding the
-- product, earliest expiry first. Returns one row per ingredient.
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
           sum(
             case when coalesce(i.netto, 0) > 0
                  then i.netto * (1 + greatest(coalesce(i.waste_percent, 0), 0) / 100.0)
                  else coalesce(i.brutto, 0)
             end
           ) * p_quantity as gross
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

-- A whole sale in one transaction: p_items [{recipe_id, quantity}], at most 100 lines. Either every
-- line is written off (shortages become alerts) or, on an error, nothing is.
create or replace function public.deduce_sale(p_branch_id uuid, p_items jsonb)
returns table (recipe_id uuid, product_id uuid, deducted numeric, shortage numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_item jsonb;
  v_recipe uuid;
  v_quantity numeric;
  d record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'recipe_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'quantity') is distinct from 'number' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_recipe := (v_item ->> 'recipe_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    for d in select * from public.deduce_ingredients_for_dish(v_recipe, v_quantity, p_branch_id)
    loop
      recipe_id := v_recipe;
      product_id := d.product_id;
      deducted := d.deducted;
      shortage := d.shortage;
      return next;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.deduce_sale(uuid, jsonb) from public, anon;
grant execute on function public.deduce_sale(uuid, jsonb) to authenticated;
