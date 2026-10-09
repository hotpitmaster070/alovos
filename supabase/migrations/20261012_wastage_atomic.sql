-- Waste write-off as one statement: the log, the stock movement and the lot decrease commit together
-- or not at all. Clients no longer insert wastage_logs directly, so a log without its movement cannot
-- appear. A user may delete a wastage photo they uploaded while no log references it (the cleanup
-- when the write-off fails after the upload). Run after 20261010_cleanup_and_hardcode.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.current_member_role()') is null or to_regclass('public.wastage_costs') is null then
    raise exception 'Run 20261010_cleanup_and_hardcode.sql first';
  end if;
end;
$$;

-- The movement is 'waste' like every write-off made from the waste board; the stock_movements trigger
-- takes the quantity from the lots FEFO (expiry_date, nulls last) and fails with insufficient_stock.
-- trg_wastage_cost values the log from the same lots before they are reduced.
create or replace function public.create_wastage_with_movement(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_storage_location_id uuid,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_member_role();
  v_location_branch uuid;
  v_lot_branches uuid[];
  v_branchless boolean;
  v_movement_branch uuid;
  v_available numeric;
  v_log uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'chef', 'cook') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_product_id is null or p_storage_location_id is null
     or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or p_reason is null or p_reason not in ('spoiled', 'overcooked', 'dropped', 'expired', 'theft', 'other') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_photo_path is not null and (
    split_part(p_photo_path, '/', 1) <> v_tenant::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'wastage-photos' and o.name = p_photo_path)
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_reason = 'theft' and p_photo_path is null then
    raise exception 'photo_required' using errcode = '22023';
  end if;

  select branch_id into v_location_branch
  from public.storage_locations
  where id = p_storage_location_id and tenant_id = v_tenant;
  if not found then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = v_tenant) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  -- Concurrent write-offs of the same lots wait here and then see the reduced balance.
  perform 1
  from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = p_storage_location_id and quantity > 0
  for update;

  -- The trigger matches lots by branch only when the movement has one; lots of several branches
  -- (or without a branch) are taken with a null movement branch.
  select coalesce(array_agg(distinct branch_id) filter (where branch_id is not null), '{}'),
         coalesce(bool_or(branch_id is null), false)
  into v_lot_branches, v_branchless
  from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = p_storage_location_id and quantity > 0;
  v_movement_branch := case when not v_branchless and cardinality(v_lot_branches) = 1 then v_lot_branches[1] end;

  select coalesce(sum(quantity), 0) into v_available
  from public.product_stocks
  where tenant_id = v_tenant and product_id = p_product_id and location_id = p_storage_location_id and quantity > 0
    and (v_movement_branch is null or branch_id = v_movement_branch);
  if v_available < p_quantity then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  insert into public.wastage_logs (tenant_id, branch_id, location_id, product_id, quantity, reason, photo_url, user_id)
  values (v_tenant, v_location_branch, p_storage_location_id, p_product_id, p_quantity, p_reason, p_photo_path, v_user)
  returning id into v_log;

  insert into public.stock_movements (
    tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type, reason, user_id
  ) values (
    v_tenant, p_product_id, v_movement_branch, p_storage_location_id, null, p_quantity, 'waste', p_reason, v_user
  );

  return v_log;
end;
$$;

revoke execute on function public.create_wastage_with_movement(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.create_wastage_with_movement(uuid, numeric, text, uuid, text) to authenticated;

-- Only the function writes logs.
revoke insert, update on table public.wastage_logs from authenticated;

-- Cleanup of a photo whose write-off failed: own upload, own tenant folder, not referenced by any log.
do $$
declare
  v_owner text;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  select case
    when exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id')
      then 'owner_id = (select auth.uid())::text'
    when exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner')
      then 'owner = (select auth.uid())'
  end into v_owner;
  if v_owner is null then
    raise exception 'storage.objects has no owner column';
  end if;

  execute 'drop policy if exists wastage_photos_delete_unused on storage.objects';
  execute format($p$
    create policy wastage_photos_delete_unused on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'wastage-photos'
        and %s
        and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
        and not exists (select 1 from public.wastage_logs w where w.photo_url = storage.objects.name)
      )
  $p$, v_owner);
end;
$$;

commit;
