// 20261020000000_global_currency.sql: the restaurant's currency (AZN in Baku, RUB in Moscow), chosen at
// signup, changed by the owner only, suppliers' currency and receipts converted at a rate.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/global_currency.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261020000000_global_currency.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= FILE));
  ok(`${FILE} and later apply (run ${run})`, !failure, failure);
}
ok("five currencies seeded once", Number((await q("select count(*) n from currencies"))[0].n) === 5);

const near = (a, b) => Math.abs(Number(a) - b) < 1e-6;
const [A, C, H, M, X] = [U("3a"), U("3c"), U("3f"), U("3d"), U("3e")];
await q(`insert into auth.users(id,email) values ('${A}','owner@baku.az'),('${C}','cook@baku.az'),('${H}','chef@baku.az')`);
await q(`insert into auth.users(id,email,raw_user_meta_data) values ('${M}','owner@moscow.ru',$1)`,
  [JSON.stringify({ currency: "rub", timezone: "Europe/Moscow" })]);
await q(`insert into auth.users(id,email,raw_user_meta_data) values ('${X}','x@nowhere.io',$1)`,
  [JSON.stringify({ currency: "XYZ", timezone: "Mars/Olympus" })]);
const tenant = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const settings = async (t) => (await q(`select currency, currency_symbol, locale, timezone from tenant_settings where tenant_id='${t}'`))[0];
const [tA, tM, tX] = [await tenant(A), await tenant(M), await tenant(X)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook'),('${H}','${tA}','chef')`);
await q(`update profiles set tenant_id='${tA}' where id in ('${C}','${H}')`);

await q("set role anon");
const anon = await q("select code from currencies order by sort").catch((e) => e.message);
await q("reset role");
let r;
ok("currencies readable before sign-in", Array.isArray(anon) && anon.map((c) => c.code).join() === "AZN,RUB,TRY,USD,EUR", anon);

const sA = await settings(tA);
ok("no choice at signup: neutral defaults USD $ en-US, UTC", sA.currency === "USD" && sA.currency_symbol === "$" && sA.locale === "en-US" && sA.timezone === "UTC", sA);
const sM = await settings(tM);
ok("Moscow signup: RUB ₽ ru-RU, Europe/Moscow", sM.currency === "RUB" && sM.currency_symbol === "₽" && sM.locale === "ru-RU" && sM.timezone === "Europe/Moscow", sM);
const sX = await settings(tX);
ok("unknown currency / time zone at signup: defaults kept", sX.currency === "USD" && sX.timezone === "UTC", sX);

r = await as(C, "select * from public.set_tenant_currency('RUB')");
ok("cook cannot change the currency", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select * from public.set_tenant_currency('XYZ')");
ok("unknown currency rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, `update tenant_settings set currency = 'RUB' where tenant_id='${tA}'`);
ok("currency not writable directly", /permission denied/.test(r.err ?? ""), r);
r = await as(A, "select * from public.set_tenant_currency(' try ')");
ok("owner sets TRY: symbol and locale follow", !r.err && r.rows[0].currency === "TRY" && r.rows[0].currency_symbol === "₺" && r.rows[0].locale === "tr-TR", r);
ok("other tenant untouched", (await settings(tM)).currency === "RUB");
await as(A, "select * from public.set_tenant_currency('AZN')");

// ---- supplier currency
r = await as(A, `insert into suppliers(tenant_id, name, default_currency) values ('${tA}','Istanbul Et','TRY') returning default_currency`);
ok("supplier invoices in TRY", !r.err && r.rows[0].default_currency === "TRY", r);
r = await as(A, `insert into suppliers(tenant_id, name, default_currency) values ('${tA}','Bad','lira')`);
ok("supplier currency must be an ISO code", /suppliers_default_currency_check/.test(r.err ?? ""), r);
r = await as(A, `insert into suppliers(tenant_id, name) values ('${tA}','Bazar') returning default_currency`);
ok("supplier currency defaults to the restaurant's (null)", !r.err && r.rows[0].default_currency === null, r);

// ---- receipt: 100 TRY at 0.17 -> 17 AZN
const soy = (await q(`select id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by number limit 1`))[0].id;
const lamb = (await as(A, "insert into products(name, unit) values ('Baranina','kg') returning id")).rows[0].id;
const receive = (uid, price, currency, fx) =>
  as(uid, "select * from public.receive_stock_with_lot_fx($1, 1, $2, $3, $4, $5)", [lamb, soy, price, currency, fx]);
r = await receive(C, 100, "TRY", 0.17);
const lot = r.rows?.[0];
ok("cook receives 1 kg at 100 TRY", !r.err && lot, r);
const cost = (await q(`select * from product_lot_costs where lot_id='${lot.id}'`))[0];
ok("maya in AZN: 17, original 100 TRY at 0.17 kept", near(cost.cost_per_unit, 17) && near(cost.original_cost, 100) &&
  cost.original_currency === "TRY" && near(cost.fx_rate, 0.17), cost);
const move = (await q(`select cost_per_unit from stock_movements where id='${lot.movement_id}'`))[0];
ok("stock movement cost in AZN", move && near(move.cost_per_unit, 17), move);
// ---- who sees the lot money
r = await as(C, "select * from product_lot_costs");
ok("cook reads no lot costs (original price included)", /permission denied/.test(r.err ?? "") || (!r.err && r.rows.length === 0), r);
r = await as(A, `select cost_per_unit, original_cost, original_currency from product_lot_costs where lot_id='${lot.id}'`);
ok("owner reads the lot cost and the original price", !r.err && r.rows.length === 1 && near(r.rows[0].cost_per_unit, 17) && r.rows[0].original_currency === "TRY", r);
r = await as(H, "select count(*)::int n from product_lot_costs");
ok("chef reads the lot costs", !r.err && r.rows[0].n === 1, r);
r = await as(M, "select count(*)::int n from product_lot_costs");
ok("another restaurant's owner reads none of them", !r.err && r.rows[0].n === 0, r);
for (const [uid, who] of [[A, "owner"], [C, "cook"]]) {
  r = await as(uid, `update product_lot_costs set cost_per_unit = 1 where lot_id='${lot.id}'`);
  ok(`${who} cannot change a lot cost`, /permission denied/.test(r.err ?? ""), r);
  r = await as(uid, `insert into product_lot_costs(lot_id, tenant_id, cost_per_unit) values ('${lot.id}','${tA}',1)`);
  ok(`${who} cannot insert a lot cost`, /permission denied/.test(r.err ?? ""), r);
}

// ---- the currency changes only with an empty warehouse
r = await as(A, "select * from public.set_tenant_currency('RUB')");
ok("stock on hand: currency change refused", /stock_exists/.test(r.err ?? "") && (await settings(tA)).currency === "AZN", r);
r = await as(A, "select * from public.set_tenant_currency('AZN')");
ok("stock on hand: same currency re-saved", !r.err && r.rows[0].currency === "AZN", r);
await q(`update product_stocks set quantity = 0 where tenant_id='${tA}'`);
r = await as(A, "select * from public.set_tenant_currency('RUB')");
ok("empty warehouse: currency changes", !r.err && r.rows[0].currency === "RUB" && r.rows[0].currency_symbol === "₽", r);
await q(`update tenant_settings set currency = 'AZN', currency_symbol = '₼', locale = 'az-AZ' where tenant_id='${tA}'`);

r = await receive(C, 10, "AZN", null);
const plain = (await q(`select * from product_lot_costs where lot_id='${r.rows?.[0]?.id}'`))[0];
ok("receipt in the restaurant's currency: no conversion recorded", !r.err && near(plain.cost_per_unit, 10) && plain.original_currency === null, { r, plain });
r = await receive(C, 10, null, null);
ok("no currency = restaurant's", !r.err, r);
for (const [label, args] of [
  ["restaurant currency with a rate other than 1", [10, "AZN", 2]],
  ["foreign currency without a rate", [10, "TRY", null]],
  ["foreign currency without a price", [null, "TRY", 0.17]],
  ["zero rate", [10, "TRY", 0]],
  ["unknown currency", [10, "XYZ", 1]],
]) {
  r = await receive(C, ...args);
  ok(`rejected: ${label}`, /invalid_input/.test(r.err ?? ""), r);
}

done();
