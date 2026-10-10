// 20261022000000_product_storage_rules.sql: the owner's shelf-life rule per place and moving one lot to
// another place. Into another kind of place the clock restarts (today + the target's rule); between
// places of the same kind the expiry stays; expired lots, other tenants and open counts are refused.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/storage_rules.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const RULES = "20261022000000_product_storage_rules.sql";
const { ok, done } = reporter();
const { q, as, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < RULES));
ok(`migrations before ${RULES} apply`, !failure, failure);
failure = await applyTwice(migrationFiles.filter((f) => f >= RULES));
ok(`${RULES} and later apply, each twice`, !failure, failure);

const [A, C, B] = [U("0a"), U("0c"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const tA = await tenantOf(A);
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);

const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const place = async (type) => (await q(`select id from storage_locations where tenant_id='${tA}' and type='${type}' order by number limit 1`))[0].id;
const [soy, don, quru] = [await place("soyuducu"), await place("dondurucu"), await place("quru")];
let r = await as(A, `select id from public.create_storage_locations_bulk('${branch}', 'soyuducu', 1, null, 'Soyuducu 2')`);
const soy2 = r.rows?.[0]?.id;
ok("a second fridge", !!soy2, r);

const today = (await q(`select public.tenant_today('${tA}') d`))[0].d;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const plus = (days) => iso(new Date(today.getTime() + days * 86400000));

const toyuq = (await as(A, `insert into products(name, unit, shelf_life_days) values ('Toyuq','kg',5) returning id`)).rows[0].id;
r = await as(A, `select public.set_shelf_life_rule('${toyuq}','${soy}', 3), public.set_shelf_life_rule('${toyuq}','${don}', 90)`);
ok("owner sets fresh 3 days and freezer 90 days", !r.err, r);

r = await as(C, `select * from public.receive_stock_with_lot('${toyuq}', 10, '${soy}', 4)`);
const received = r.rows?.[0];
ok("10 kg received into the fridge for 3 days", !r.err && iso(received.expiry_date) === plus(3), r);
const stockAt = async (location) =>
  q(`select id, quantity::float8 qty, expiry_date, cost_per_unit::float8 cost from product_stocks where product_id='${toyuq}' and location_id='${location}' and quantity > 0 order by expiry_date`);
const fresh = (await stockAt(soy))[0];

// ---- fresh -> freezer: the clock restarts on the freezer rule
r = await as(C, `select * from public.move_stock_lot('${fresh.id}', '${don}', 4, null, false, 'not used today')`);
const frozenLabel = r.rows?.[0];
ok("a cook moves 4 kg to the freezer", !r.err && Number(frozenLabel?.quantity) === 4, r);
ok("freezer expiry = today + 90", iso(frozenLabel?.expiry_date) === plus(90), frozenLabel);
ok("the new label keeps production date and points at the fresh label",
  iso(frozenLabel?.production_date) === iso(received.production_date) && frozenLabel?.parent_lot_id === received.id, frozenLabel);
let rows = await stockAt(soy);
ok("6 kg stay fresh with the old date", rows.length === 1 && rows[0].qty === 6 && iso(rows[0].expiry_date) === plus(3), rows);
rows = await stockAt(don);
ok("4 kg in the freezer with the new date and the lot cost", rows.length === 1 && rows[0].qty === 4 && iso(rows[0].expiry_date) === plus(90) && rows[0].cost === 4, rows);
r = await q(`select movement_type, stock_id, previous_expiry_date, expiry_date, reason, user_id, quantity::float8 qty from stock_movements where to_location_id='${don}'`);
ok("one peremeshchenie movement records the lot, both dates, reason and who",
  r.length === 1 && r[0].movement_type === "peremeshchenie" && r[0].stock_id === fresh.id && iso(r[0].previous_expiry_date) === plus(3) &&
  iso(r[0].expiry_date) === plus(90) && r[0].reason === "not used today" && r[0].user_id === C && r[0].qty === 4, r);

// ---- override with remember becomes the rule
r = await as(A, `select * from public.move_stock_lot('${fresh.id}', '${don}', 1, 60, true)`);
ok("override 60 days for this move", !r.err && iso(r.rows[0].expiry_date) === plus(60), r);
r = await as(A, `select public.get_shelf_life('${toyuq}','${don}') d`);
ok("remember stores 60 as the freezer rule", r.rows[0].d === 60, r);

// ---- same kind of place: the date stays
r = await as(C, `select * from public.move_stock_lot('${fresh.id}', '${soy2}', 2)`);
ok("fridge -> fridge keeps the expiry", !r.err && iso(r.rows[0].expiry_date) === plus(3), r);
r = await as(C, `select * from public.move_stock_lot('${fresh.id}', '${soy2}', 1, 30)`);
ok("no override when the date stays", /invalid_input/.test(r.err ?? ""), r);

// ---- refusals
const remaining = (await stockAt(soy))[0];
r = await as(C, `select * from public.move_stock_lot('${remaining.id}', '${don}', 99)`);
ok("more than the lot holds", /insufficient_stock/.test(r.err ?? ""), r);
r = await as(C, `select * from public.move_stock_lot('${remaining.id}', '${soy}')`);
ok("to the same place", /location_not_found/.test(r.err ?? ""), r);
r = await as(B, `select * from public.move_stock_lot('${remaining.id}', '${don}')`);
ok("another tenant cannot move our lot", /lot_not_found|forbidden/.test(r.err ?? ""), r);
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type, expiry_date, stock_id)
  values ('${tA}','${toyuq}','${branch}','${soy}','${quru}',1,'peremeshchenie','${plus(900)}','${remaining.id}')`);
ok("a client cannot extend a date with a direct movement", /invalid_input|permission denied/.test(r.err ?? ""), r);

r = await as(C, `select * from public.receive_stock_with_lot('${toyuq}', 2, '${soy}', null, '${plus(-10)}')`);
ok("an old delivery, already expired", !r.err && iso(r.rows[0].expiry_date) === plus(-7), r);
const expired = (await stockAt(soy)).find((row) => iso(row.expiry_date) === plus(-7));
r = await as(C, `select * from public.move_stock_lot('${expired.id}', '${don}')`);
ok("an expired lot does not go to the freezer", /lot_expired/.test(r.err ?? ""), r);

r = await as(A, `select public.start_stock_count('${don}')`);
ok("a count opens in the freezer", !r.err, r);
r = await as(C, `select * from public.move_stock_lot('${remaining.id}', '${don}', 1)`);
ok("no moves into a place being counted", /open_count/.test(r.err ?? ""), r);
await as(A, `select public.cancel_stock_count(id) from stock_counts where location_id='${don}' and status='counting'`);

// ---- plain transfers: FEFO among good lots (20261028001200), the lot's own date
r = await as(A, `select public.move_stock_rpc('${toyuq}','${soy}','${quru}',1)`);
rows = await stockAt(quru);
ok("a transfer without a lot takes the earliest good lot and keeps its date", !r.err && rows.length === 1 && iso(rows[0].expiry_date) === plus(3), { r, rows });
ok("the expired lot stays where it is", (await stockAt(soy)).some((row) => iso(row.expiry_date) === plus(-7) && row.qty === 2));

done();
