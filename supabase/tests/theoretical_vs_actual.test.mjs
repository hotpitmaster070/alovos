// 20261029000100_theoretical_vs_actual.sql: get_theoretical_vs_actual() - what the sales needed by their
// tech cards against what actually left the branch, the loss in the restaurant's currency, in its days.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/theoretical_vs_actual.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const MIGRATION = "20261029000100_theoretical_vs_actual.sql";
const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
ok("the migration only adds the report (no stock trigger, sale or admin function redefined)",
  [...readMigration(MIGRATION).matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).join() === "get_theoretical_vs_actual" &&
  !/cleanup_empty_tenants|review_batch_action|drop function/i.test(readMigration(MIGRATION)));

const [A, C, X] = [U("1a"), U("1c"), U("1d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${X}','owner@other.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const zone = async (type) => (await q(`select id from storage_locations where tenant_id='${tA}' and type='${type}' order by created_at limit 1`))[0].id;
const [fridge, freezer] = [await zone("soyuducu"), await zone("dondurucu")];
const tX = (await q(`select tenant_id t from profiles where id='${X}'`))[0].t;
const branchX = (await q(`select id from branches where tenant_id='${tX}'`))[0].id;

const products = (await sys(`insert into products(tenant_id, name, unit) values ('${tA}','Düyü','kg'),('${tA}','Ət','kg'),('${tA}','Soğan','kg') returning id, name`)).rows;
const [rice, meat, onion] = ["Düyü", "Ət", "Soğan"].map((name) => products.find((p) => p.name === name).id);
const receive = (product, qty, cost) =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
    values ('${tA}','${product}','${branch}','${fridge}',${qty},'prihod',${cost},'kg', public.stock_today('${tA}') + 30)`);
const out = (product, qty, type, extra = "") =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, unit${extra ? ", reason" : ""})
    values ('${tA}','${product}','${branch}','${fridge}',${qty},'${type}','kg'${extra ? `, '${extra}'` : ""}) returning id`);
const card = async (name, product, netto, waste) => {
  const id = (await sys(`insert into tech_cards(tenant_id, name) values ('${tA}','${name}') returning id`)).rows[0].id;
  await sys(`insert into tech_card_ingredients(tenant_id, tech_card_id, product_id, brutto, netto, waste_percent) values ('${tA}','${id}','${product}',0,${netto},${waste})`);
  return id;
};
const sell = (recipe, qty) => as(A, `select * from public.deduce_sale('${branch}', '[{"recipe_id":"${recipe}","quantity":${qty}}]'::jsonb)`);
const today = async () => (await q(`select public.stock_today('${tA}')::text d`))[0].d;
const report = async (uid = A, from = null, to = null, branchId = branch) => {
  const day = await today();
  const r = await as(uid, `select product_id, theoretical_qty::float8 t, actual_qty::float8 a, loss_qty::float8 l, loss_pct::float8 pct,
      written_off_qty::float8 w, count_loss_qty::float8 c, unit_cost::float8 cost, loss_value::float8 v, currency, over_limit
    from public.get_theoretical_vs_actual(${branchId ? `'${branchId}'` : "null"}, '${from ?? day}', '${to ?? day}')`);
  return { err: r.err, rows: r.rows ?? [], of: (id) => (r.rows ?? []).find((row) => row.product_id === id) };
};

// ---- 10 plov at 200 g of rice: 2 kg expected; 1 kg more is gone at the count -> 3 kg actual, 1 kg lost
await receive(rice, 10, 2);
const plov = await card("Plov", rice, 0.2, 0);
let r = await sell(plov, 10);
ok("10 plov sold: the sale wrote off 2 kg of rice by the tech card", !r.err && r.rows.length === 1 && Number(r.rows[0].deducted) === 2, r);
await out(rice, 1, "count");
let v = await report();
let row = v.of(rice);
ok("rice: expected 2 kg, actual 3 kg, lost 1 kg", !v.err && row?.t === 2 && row?.a === 3 && row?.l === 1, v);
const currency = (await q(`select currency from tenant_settings where tenant_id='${tA}'`))[0].currency;
ok("rice: 50% lost, over the line, 1 kg x average cost 2 = 2 in the restaurant's currency",
  row?.pct === 50 && row?.over_limit === true && row?.cost === 2 && row?.v === 2 && row?.currency === currency, row);
ok("rice: the loss is what the count found missing, nothing written off", row?.c === 1 && row?.w === 0, row);

// ---- kebab: 240 g net at 20% trim = 300 g gross a portion; 10 sold -> 3 kg; 0.1 kg thrown away (3.3%)
await receive(meat, 10, 10);
const kebab = await card("Kabab", meat, 0.24, 20);
r = await sell(kebab, 10);
await out(meat, 0.1, "waste");
v = await report();
row = v.of(meat);
ok("meat: tech card gross 3 kg expected, 3.1 kg actual, 0.1 kg written off, worth 1",
  !r.err && row?.t === 3 && row?.a === 3.1 && Math.abs(row?.l - 0.1) < 1e-9 && row?.w === 0.1 && row?.v === 1, row);
ok("meat: 3.3% stays under the restaurant's 10% line", row?.pct === 3.3 && row?.over_limit === false, row);
ok("biggest money loss first: rice (2) before meat (1)", v.rows[0]?.product_id === rice && v.rows[1]?.product_id === meat, v.rows);

await q(`update tenant_settings set loss_alert_percent = 3, currency = 'EUR' where tenant_id='${tA}'`);
v = await report();
ok("line and currency come from tenant_settings: 3% makes meat red, money in EUR",
  v.of(meat)?.over_limit === true && v.rows.every((x) => x.currency === "EUR"), v.rows);
await q(`update tenant_settings set loss_alert_percent = 10, currency = '${currency}' where tenant_id='${tA}'`);

// ---- moves inside the branch are not usage; a count surplus nets the shortage
await sys(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type, unit)
  values ('${tA}','${rice}','${branch}','${fridge}','${freezer}',2,'peremeshchenie','kg')`);
ok("2 kg of rice moved fridge -> freezer: the report does not change", (await report()).of(rice)?.a === 3);
await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, unit, cost_per_unit)
  values ('${tA}','${rice}','${branch}','${fridge}',0.5,'count','kg',2)`);
row = (await report()).of(rice);
ok("count surplus 0.5 kg nets the shortage: lost 0.5 kg", row?.c === 0.5 && row?.l === 0.5 && row?.a === 2.5, row);

// ---- sold without stock on the books: expected and used alike, not a loss
const dolma = await card("Dolma", onion, 0.1, 0);
r = await sell(dolma, 5);
row = (await report()).of(onion);
ok("onion with no stock: 0.5 kg sold anyway (stock_alerts) counts on both sides, no loss",
  !r.err && row?.t === 0.5 && row?.a === 0.5 && row?.l === 0, row);

// ---- the period and the restaurant's day
const day = await today();
const old = (await out(rice, 4, "waste")).rows[0].id;
await q(`update stock_movements set created_at = now() - interval '40 days' where id = '${old}'`);
v = await report(A, (await q(`select ('${day}'::date - 6)::text d`))[0].d, day);
ok("week: the 4 kg thrown away 40 days ago are not in it", v.of(rice)?.w === 0, v.of(rice));
v = await report(A, (await q(`select ('${day}'::date - 45)::text d`))[0].d, day);
ok("a longer period takes them in", v.of(rice)?.w === 4, v.of(rice));

const late = (await out(meat, 0.4, "waste")).rows[0].id;
await q(`update stock_movements set created_at = '2026-09-01 22:30:00+00' where id = '${late}'`);
await q(`update tenant_settings set timezone = 'Asia/Baku' where tenant_id='${tA}'`);
const baku = (await report(A, "2026-09-02", "2026-09-02")).of(meat)?.w;
await q(`update tenant_settings set timezone = 'UTC' where tenant_id='${tA}'`);
const utc1 = (await report(A, "2026-09-01", "2026-09-01")).of(meat)?.w;
const utc2 = (await report(A, "2026-09-02", "2026-09-02")).of(meat);
ok("22:30 UTC is the next day in Baku: counted on 2 Sep there, on 1 Sep in UTC", baku === 0.4 && utc1 === 0.4 && utc2 === undefined, { baku, utc1, utc2 });
await q(`update tenant_settings set timezone = 'Asia/Baku' where tenant_id='${tA}'`);

// ---- all branches, access and input
v = await report(A, null, null, null);
ok("all branches of the owner: same rows", !v.err && v.of(rice)?.l === 0.5 && v.of(meat)?.w === 0.1, v);
ok("cook: forbidden", /forbidden/.test((await report(C)).err ?? ""));
ok("another restaurant's branch: branch_not_found", /branch_not_found/.test((await report(A, null, null, branchX)).err ?? ""));
ok("end before start: invalid_input", /invalid_input/.test((await report(A, "2026-10-10", "2026-10-01")).err ?? ""));
ok("the other restaurant sees none of it", (await report(X, null, null, null)).rows.length === 0);

done();
