// 20261028001300_fix_cost_expired.sql: get_stock_cost, stock_value_by_type and stock_summary leave
// expired stock out of the value (expired_value apart), in the restaurant's own day, and agree with
// stock_value() of 20261028001200.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/cost_expired_fix.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const MIGRATION = "20261028001300_fix_cost_expired.sql";
const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
ok("the migration only touches the three value functions",
  !/cleanup_empty_tenants|handle_stock_movement|get_near_expiry_batches|review_batch_action|notify_expiring_batches/i.test(readMigration(MIGRATION)));

const [A, C] = [U("1a"), U("1c")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const zone = async (type) => (await q(`select id from storage_locations where tenant_id='${tA}' and type='${type}' order by created_at limit 1`))[0].id;
const [freezer, fridge] = [await zone("dondurucu"), await zone("soyuducu")];

const products = (await sys(`insert into products(tenant_id, name, unit) values ('${tA}','Ət','kg'),('${tA}','Süd','l') returning id, name`)).rows;
const [meat, milk] = ["Ət", "Süd"].map((name) => products.find((p) => p.name === name).id);
const receive = (product, location, qty, cost, days) =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
    values ('${tA}','${product}','${branch}','${location}',${qty},'prihod',${cost},'kg', public.stock_today('${tA}') + ${days})`);

const values = async (uid = A) => {
  const [cost, byType, summary, value, dashboard] = await Promise.all([
    as(uid, "select public.get_stock_cost()::float8 v"),
    as(uid, "select type, value::float8 v, expired_value::float8 x from public.stock_value_by_type()"),
    as(uid, "select kind, lines, kg::float8 kg, cost_value::float8 v, expired_value::float8 x from public.stock_summary()"),
    as(uid, "select total_value::float8 v, expired_value::float8 x from public.stock_value()"),
    as(uid, "select stock_cost::float8 v from public.owner_dashboard()"),
  ]);
  const sum = (rows, key) => (rows ?? []).reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    cost: cost.rows?.[0]?.v,
    byType: byType.rows ?? [],
    byTypeValue: sum(byType.rows, "v"),
    byTypeExpired: sum(byType.rows, "x"),
    summary: summary.rows ?? [],
    summaryValue: sum(summary.rows, "v"),
    summaryExpired: sum(summary.rows, "x"),
    stockValue: value.rows?.[0],
    dashboard: dashboard.rows?.[0]?.v,
    err: cost.err ?? byType.err ?? summary.err ?? value.err ?? dashboard.err,
  };
};

// ---- 10 kg meat in the freezer at 10, expired yesterday
let r = await receive(meat, freezer, 10, 10, -1);
ok("expired lot received: 10 kg at 10 AZN, yesterday", !r.err, r);
let v = await values();
ok("get_stock_cost: 0, not 100", !v.err && v.cost === 0, v);
const freezerRow = v.byType.find((row) => row.type === "dondurucu");
ok("stock_value_by_type: dondurucu value 0, expired_value 100", freezerRow?.v === 0 && freezerRow?.x === 100, v.byType);
const raw = v.summary.find((row) => row.kind === "raw");
ok("stock_summary: cost_value 0, expired_value 100, the 10 kg still on the shelf", raw?.v === 0 && raw?.x === 100 && raw?.lines === 1 && raw?.kg === 10, v.summary);
ok("owner_dashboard reads the same 0", v.dashboard === 0, v);

// ---- milk at 100: 41 l good, 1 l expiring today (still good), 7 l expired two days ago
for (const [qty, days] of [[41, 3], [1, 0], [7, -2]]) {
  r = await receive(milk, fridge, qty, 100, days);
  ok(`milk received: ${qty} l, ${days} day(s) to expiry`, !r.err, r);
}
v = await values();
ok("every value function agrees: 4200 AZN of good stock, not 5000",
  !v.err && [v.cost, v.byTypeValue, v.summaryValue, v.stockValue?.v, v.dashboard].every((x) => x === 4200), v);
ok("and on the expired 800 AZN apart", v.byTypeExpired === 800 && v.summaryExpired === 800 && v.stockValue?.x === 800, v);
r = await as(A, "select stock_value::float8 v from public.owner_summary()");
ok("owner_summary (sum of stock_value_by_type) shows 4200 too", !r.err && r.rows[0].v === 4200, r);

// ---- the restaurant's day, not UTC. Restaurant B holds one lot expiring on Pago Pago's today; Pago Pago
// (UTC-11) is always a calendar day behind Kiritimati (UTC+14).
const B = U("1b");
await q(`insert into auth.users(id,email) values ('${B}','owner@beta.az')`);
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
const branchB = (await q(`select id from branches where tenant_id='${tB}'`))[0].id;
const freezerB = (await q(`select id from storage_locations where tenant_id='${tB}' and type='dondurucu' order by created_at limit 1`))[0].id;
const fish = (await sys(`insert into products(tenant_id, name, unit) values ('${tB}','Balıq','kg') returning id`)).rows[0].id;
r = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
  values ('${tB}','${fish}','${branchB}','${freezerB}',5,'prihod',10,'kg', (now() at time zone 'Pacific/Pago_Pago')::date)`);
ok("restaurant B: 5 kg at 10 expiring on Pago Pago's today", !r.err, r);
await q(`update tenant_settings set timezone = 'Pacific/Pago_Pago' where tenant_id='${tB}'`);
v = await values(B);
ok("in Pago Pago the lot is still good (50 in value, 0 expired)", v.cost === 50 && v.byTypeValue === 50 && v.summaryValue === 50 && v.summaryExpired === 0, v);
await q(`update tenant_settings set timezone = 'Pacific/Kiritimati' where tenant_id='${tB}'`);
v = await values(B);
ok("in Kiritimati the same lot is already expired (0 in value, 50 expired)",
  v.cost === 0 && v.byTypeValue === 0 && v.byTypeExpired === 50 && v.summaryExpired === 50 && v.stockValue?.x === 50, v);
v = await values();
ok("restaurant A still sees only its own 4200", v.cost === 4200 && v.byTypeValue === 4200, v);

// ---- roles without money
v = await values(C);
ok("cook: no cost, no value by type, no money in the summary",
  v.cost === null && v.byType.length === 0 && v.summary.every((row) => row.v === null && row.x === null), v);

done();
