// Freshness control (20261028001200_near_expiry_management.sql): expired stock stays out of sales,
// stock_value splits good and expired stock, the near-expiry list, the chef's decisions and the daily
// notification that never writes anything off.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/near_expiry.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const MIGRATION = "20261028001200_near_expiry_management.sql";
const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
ok("the migration only covers the restaurant's freshness control",
  !/cleanup_empty_tenants|empty_tenants|daily_orchestrator|auto_purchase/i.test(readMigration(MIGRATION)));

// ---- tenant A: owner, chef, cook; tenant B: owner
const [A, H, C, B] = [U("0a"), U("0d"), U("0c"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','alice@acme.az'),('${H}','chef@acme.az'),('${C}','cook@acme.az'),('${B}','bob@other.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB] = [await tenantOf(A), await tenantOf(B)];
for (const [uid, role] of [[H, "chef"], [C, "cook"]]) {
  const r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  ok(`owner adds a ${role}`, !r.err, r);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const zone = async (tenant, type) =>
  (await q(`select id from storage_locations where tenant_id='${tenant}' and type='${type}' order by created_at limit 1`))[0]?.id;
const [fridge, dry] = [await zone(tA, "soyuducu"), await zone(tA, "quru")];
ok("default zones found by type (soyuducu, quru)", !!fridge && !!dry);
const today = (await q(`select public.stock_today('${tA}')::text d`))[0].d;
const currency = (await q(`select currency from tenant_settings where tenant_id='${tA}'`))[0].currency;

let r = await sys(`insert into products(tenant_id, name, cost, unit, internal_code) values
  ('${tA}','Milk',2,'l','MLK-1'),('${tA}','Rice',1,'kg','RIC-1') returning id, name`);
const milk = r.rows.find((row) => row.name === "Milk").id;
const rice = r.rows.find((row) => row.name === "Rice").id;
// Milk in the fridge: 5 l expired yesterday, 3 l expiring tomorrow, 4 l in ten days. Rice: 2 kg expired.
const receive = (product, location, qty, cost, days) =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
    values ('${tA}','${product}','${branchA}','${location}',${qty},'prihod',${cost},'l', public.stock_today('${tA}') + ${days})`);
for (const args of [[milk, fridge, 5, 2, -1], [milk, fridge, 3, 3, 1], [milk, fridge, 4, 1, 10], [rice, dry, 2, 1, -2]]) {
  r = await receive(...args);
  ok(`receive ${args[2]} with ${args[4]} day(s) to expiry`, !r.err, r);
}
const lotOf = async (product, days) =>
  (await q(`select id from product_stocks where product_id='${product}' and expiry_date = '${today}'::date + ${days}`))[0].id;
const qty = async (id) => Number((await q(`select quantity q from product_stocks where id='${id}'`))[0].q);
const [milkOld, milkSoon, milkLater, riceOld] = [await lotOf(milk, -1), await lotOf(milk, 1), await lotOf(milk, 10), await lotOf(rice, -2)];

// ---- the near-expiry list
r = await as(H, "select * from public.get_near_expiry_batches($1)", [branchA]);
ok("chef: tomorrow's lot only (today .. today + 1)", !r.err && r.rows.length === 1 && r.rows[0].lot_id === milkSoon, r);
const soon = r.rows?.[0] ?? {};
ok("with days left, place type and value in the restaurant's currency",
  soon.days_left === 1 && soon.location_type === "soyuducu" && Number(soon.cost) === 9 && soon.currency === currency && soon.internal_code === "MLK-1", soon);
r = await as(H, "select lot_id from public.get_near_expiry_batches($1, 10)", [branchA]);
ok("ten days ahead: both good milk lots, never the expired ones", !r.err && r.rows.length === 2 && !r.rows.some((x) => x.lot_id === milkOld), r);
r = await as(C, "select cost from public.get_near_expiry_batches($1)", [branchA]);
ok("cook sees the list without costs", !r.err && r.rows.length === 1 && r.rows[0].cost === null, r);
r = await as(B, "select * from public.get_near_expiry_batches($1)", [branchA]);
ok("other tenant's branch -> branch_not_found", /branch_not_found/.test(r.err ?? ""), r);

// ---- stock value: good and expired apart
r = await as(A, "select total_value::float t, expired_value::float x from public.stock_value()");
ok("owner: total_value is the good stock only (3*3 + 4*1), expired apart (5*2 + 2*1)", !r.err && r.rows[0].t === 13 && r.rows[0].x === 12, r);
r = await as(C, "select total_value t, expired_value x from public.stock_value()");
ok("cook: no money", !r.err && r.rows[0].t === null && r.rows[0].x === null, r);

// ---- sales never take expired stock
const card = (await sys(`insert into tech_cards(tenant_id, name) values ('${tA}','Latte') returning id`)).rows[0].id;
await sys(`insert into tech_card_ingredients(tenant_id, tech_card_id, product_id, netto) values ('${tA}','${card}','${milk}',1)`);
r = await as(C, "select deducted::float d, shortage::float s from public.deduce_sale($1, $2)", [branchA, JSON.stringify([{ recipe_id: card, quantity: 4 }])]);
ok("sale of 4 lattes is written off", !r.err && r.rows[0].d === 4 && r.rows[0].s === 0, r);
ok("FEFO among good lots: tomorrow's 3 l, then 1 l of the later lot; the expired 5 l untouched",
  (await qty(milkSoon)) === 0 && (await qty(milkLater)) === 3 && (await qty(milkOld)) === 5);
r = await as(C, "select deducted::float d, shortage::float s from public.deduce_sale($1, $2)", [branchA, JSON.stringify([{ recipe_id: card, quantity: 10 }])]);
ok("sale beyond the good stock: 3 l taken, 7 l short, the sale itself goes through", !r.err && r.rows[0].d === 3 && r.rows[0].s === 7, r);
ok("expired milk still not sold", (await qty(milkOld)) === 5);
const alert = (await q(`select meta from stock_alerts where product_id='${milk}' order by created_at desc limit 1`))[0]?.meta;
ok("the shortage alert names the expired quantity", Number(alert?.shortage) === 7 && Number(alert?.expired_quantity) === 5, alert);

await sys(`create or replace function pg_temp.error_of(p_sql text) returns jsonb language plpgsql as $$
  declare m text; h text; d text;
  begin execute p_sql; return null;
  exception when others then get stacked diagnostics m = message_text, h = pg_exception_hint, d = pg_exception_detail;
    return jsonb_build_object('message', m, 'hint', h, 'detail', d);
  end $$`);
const errorOf = async (sql) => (await q("select pg_temp.error_of($1) e", [sql]))[0].e;
let e = await errorOf(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, reason, unit)
  values ('${tA}','${rice}','${branchA}','${dry}',1,'spisanie','sale','kg')`);
const detail = e?.detail ? JSON.parse(e.detail) : {};
ok("only expired stock left: insufficient_stock, hint only_expired_stock, product code in detail",
  e?.message === "insufficient_stock" && e?.hint === "only_expired_stock" && detail.internal_code === "RIC-1" && Number(detail.expired_quantity) === 2, e);
e = await errorOf(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type, unit)
  values ('${tA}','${rice}','${branchA}','${dry}','${fridge}',1,'peremeshchenie','kg')`);
ok("expired stock is not moved around either", e?.hint === "only_expired_stock", e);
ok("rice untouched", (await qty(riceOld)) === 2);

// ---- the chef decides, the cook cannot
r = await receive(milk, fridge, 3, 1, 10);
ok("the later milk lot is restocked", !r.err && (await qty(milkLater)) === 3, r);
const review = (uid, lot, action, note = null, newExpiry = null) =>
  as(uid, "select public.review_batch_action($1, $2, $3, $4::date) id", [lot, action, note, newExpiry]);
r = await review(C, milkLater, "extend", "smells fine", "2099-01-01");
ok("cook -> forbidden (403)", /forbidden/.test(r.err ?? ""), r);
r = await review(B, milkLater, "discount");
ok("other tenant -> lot_not_found", /lot_not_found|forbidden/.test(r.err ?? ""), r);
r = await review(H, milkLater, "freeze");
ok("unknown action -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await review(H, milkLater, "extend", null, "2099-01-01");
ok("extend without a note -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await review(H, milkLater, "extend", "checked", today);
ok("extend to today -> invalid_input (must be after today)", /invalid_input/.test(r.err ?? ""), r);
const newExpiry = (await q(`select ('${today}'::date + 3)::text d`))[0].d;
r = await review(H, milkLater, "extend", "checked, sealed", newExpiry);
ok("chef extends the lot", !r.err && r.rows[0].id, r);
ok("extend moves expiry_date", (await q(`select expiry_date::text d from product_stocks where id='${milkLater}'`))[0].d === newExpiry);
r = await review(H, milkOld, "staff");
ok("expired lot to staff -> lot_expired", /lot_expired/.test(r.err ?? ""), r);
r = await review(H, milkOld, "use_in_production");
ok("expired lot into production -> lot_expired", /lot_expired/.test(r.err ?? ""), r);
r = await review(A, milkLater, "discount", "happy hour");
ok("owner marks a lot for discount: recorded, stock unchanged", !r.err && (await qty(milkLater)) === 3, r);

const wasteRows = async () => Number((await q("select count(*) c from wastage_logs"))[0].c);
const before = await wasteRows();
r = await review(H, milkOld, "write_off", "sour");
ok("chef writes the expired lot off", !r.err && r.rows[0].id, r);
ok("through the waste log (reason expired, chef's note)",
  (await wasteRows()) === before + 1 &&
    (await q(`select reason, reason_note, quantity::float qty from wastage_logs order by created_at desc limit 1`))[0].reason === "expired");
ok("exactly that lot is emptied", (await qty(milkOld)) === 0 && (await qty(milkLater)) === 3);
const reviewRow = (await q(`select action::text a, movement_id, wastage_log_id, reviewed_by from batch_reviews where stock_id='${milkOld}'`))[0];
ok("the decision is kept with its movement and waste log", reviewRow?.a === "write_off" && reviewRow.movement_id && reviewRow.wastage_log_id && reviewRow.reviewed_by === H, reviewRow);
r = await as(C, "select count(*)::int c from batch_reviews");
ok("cook cannot read the decisions", !r.err && r.rows[0].c === 0, r);

// ---- the daily notification writes nothing off
await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
  values ('${tA}','${rice}','${branchA}','${dry}',6,'prihod',2,'kg', public.stock_today('${tA}'))`);
const stockBefore = (await q("select coalesce(sum(quantity), 0)::float s from product_stocks"))[0].s;
const wasteBefore = await wasteRows();
await q(`update tenant_settings set daily_job_time = '23:59:59.999' where tenant_id='${tB}'`);
await q(`update tenant_settings set daily_job_time = '00:00' where tenant_id='${tA}'`);
r = await sys("select public.notify_expiring_batches() n");
ok("one notification for the branch with lots due", !r.err && r.rows[0].n === 1, r);
const note = (await q(`select type, payload from notifications where tenant_id='${tA}'`))[0];
ok("type expiring_soon, payload with count, value and currency",
  note?.type === "expiring_soon" && note.payload.count === 1 && Number(note.payload.total_value) === 12 && note.payload.currency === currency && note.payload.lots.length === 1, note);
r = await sys("select public.notify_expiring_batches() n");
ok("once per day", !r.err && r.rows[0].n === 0, r);
ok("nothing written off, stock unchanged",
  (await wasteRows()) === wasteBefore && (await q("select coalesce(sum(quantity), 0)::float s from product_stocks"))[0].s === stockBefore);
r = await as(C, "select count(*)::int c from notifications");
ok("cook does not see the notification", !r.err && r.rows[0].c === 0, r);
r = await as(H, "select count(*)::int c from notifications where read_at is null");
ok("chef sees it unread", !r.err && r.rows[0].c === 1, r);
r = await as(C, "select public.mark_notifications_read('expiring_soon') n");
ok("cook cannot mark it read", /forbidden/.test(r.err ?? ""), r);
r = await as(H, "select public.mark_notifications_read('expiring_soon') n");
ok("chef marks it read", !r.err && r.rows[0].n === 1, r);
r = await as(C, "select public.notify_expiring_batches()");
ok("clients cannot run the job", /permission denied/.test(r.err ?? ""), r);

done();
