-- Close direct stock writes, step 2: clients no longer insert into stock_movements. Every movement comes
-- from a SECURITY DEFINER function (receive_stock_rpc, wastage_stock_rpc, move_stock_rpc,
-- transfer_stock_between_branches, receive_stock_with_lot, create_wastage_with_movement, counts, ...).
-- Apply only after the app version that calls those RPCs is deployed: older app code inserts directly.
-- Run after 20261028000900_close_stock_movements_hole.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.receive_stock_rpc(uuid, uuid, numeric, numeric, date, text, text)') is null
     or to_regprocedure('public.wastage_stock_rpc(uuid, uuid, numeric, text, text)') is null
     or to_regprocedure('public.move_stock_rpc(uuid, uuid, uuid, numeric, text)') is null then
    raise exception 'Run 20261028000900_close_stock_movements_hole.sql first';
  end if;
end;
$$;

revoke insert, update, delete on public.stock_movements from anon, authenticated;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists stock_movements_update on public.stock_movements;
drop policy if exists stock_movements_delete on public.stock_movements;

do $$
begin
  if has_table_privilege('authenticated', 'public.stock_movements', 'insert') then
    raise exception 'authenticated still has INSERT on stock_movements';
  end if;
  if not has_any_column_privilege('authenticated', 'public.stock_movements', 'select') then
    raise exception 'authenticated lost SELECT on stock_movements';
  end if;
end;
$$;

commit;
