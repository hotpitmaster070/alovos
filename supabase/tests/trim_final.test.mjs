// 20261019_final_world_scheme.sql: usable trim back to stock, gross / net input, evaporation, density,
// cost (maya) of preparations from the lots consumed, sale value, stock by kind, and the migration order.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/trim_final.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FINAL = "20261019_final_world_scheme.sql";
const { ok, done } = reporter();
const { q, as, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FINAL));
ok(`migrations before ${FINAL} apply`, !failure, failure);
failure = await applyTwice(migrationFiles.filter((f) => f >= FINAL));
ok(`${FINAL} and later apply, each twice`, !failure, failure);

const [A, C, B] = [U("2a"), U("2c"), U("2b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
const soy = (await q(`select id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by number limit 1`))[0].id;
const product = async (name, unit) => (await as(A, `insert into products(name, unit) values ('${name}','${unit}') returning id`)).rows[0].id;
const economics = (uid, id, type, sale = null, density = null, trimValue = null) =>
  as(uid, "select public.set_product_economics($1, $2, $3, $4, $5)", [id, type, sale, density, trimValue]);
const near = (a, b) => Math.abs(Number(a) - b) < 1e-6;

const lamb = await product("Baranina", "kg");
const shashlik = await product("Shashlik", "kg");
const farsh = await product("Farsh", "kg");
const bone = await product("Sümük Baranina", "kg");
let r = await economics(C, bone, "trim");
ok("a cook cannot set product type or prices", /forbidden/.test(r.err ?? ""), r);
r = await economics(A, bone, "bone");
ok("unknown product type rejected", /invalid_input/.test(r.err ?? ""), r);
await economics(A, bone, "trim");
await economics(A, shashlik, "semi", 18);
await economics(A, farsh, "semi", 14);
r = await as(C, `select product_type from products where id='${bone}'`);
ok("cook reads the product type", !r.err && r.rows[0].product_type === "trim", r);
r = await as(C, "select sale_price from products");
ok("cook cannot read sale prices", /permission denied/.test(r.err ?? ""), r);
r = await as(C, `update products set sale_price = 1 where id='${shashlik}'`);
ok("cook cannot set a sale price directly", !!r.err, r);
r = await as(A, `select sale_price from product_sale_prices where id='${shashlik}'`);
ok("owner reads sale prices through the view", !r.err && Number(r.rows[0].sale_price) === 18, r);

// ---- recipe: usable trim items and waste items
const items = [{ name: "sümük", norm_percent: 20, usable: true, product_id: bone }, { name: "yağ", norm_percent: 10 }];
r = await as(A, "select * from public.save_preparation(null, 'Shashlik', $1, $2, null, $3)", [
  JSON.stringify([{ product_id: lamb, qty: 10 }]),
  JSON.stringify([{ product_id: shashlik, qty: 5 }, { product_id: farsh, qty: 2 }]),
  JSON.stringify(items),
]);
const prep = r.rows?.[0];
ok("usable items are trim norm, the others waste norm", !r.err && Number(prep.trim_norm_percent) === 20 && Number(prep.wastage_norm_percent) === 10 &&
  prep.wastage_items[0].usable === true && prep.wastage_items[0].product_id === bone, r);
r = await as(A, "select * from public.save_preparation(null, 'Bad', $1, $2, null, $3)", [
  JSON.stringify([{ product_id: lamb, qty: 10 }]), JSON.stringify([{ product_id: shashlik, qty: 5 }]),
  JSON.stringify([{ name: "sümük", norm_percent: 5, usable: true, product_id: lamb }]),
]);
ok("usable item must point at a trim product", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select * from public.save_preparation(null, 'Bad', $1, $2, null, $3, null, 75)", [
  JSON.stringify([{ product_id: lamb, qty: 10 }]), JSON.stringify([{ product_id: shashlik, qty: 5 }]), JSON.stringify(items),
]);
ok("norms + evaporation above 100% rejected", /invalid_input/.test(r.err ?? ""), r);

// ---- 10 kg lamb at 10 AZN: 2 kg bone back, 5 + 2 kg out, 1 kg fat thrown away
const receive = (id, qty, price) => as(C, `select * from public.receive_stock_with_lot('${id}', ${qty}, '${soy}', ${price})`);
const lambLot = (await receive(lamb, 10, 10)).rows[0];
const cook = (prepId, outputs, waste, trims, confirm = false, source = 10) =>
  as(C, `select * from public.create_lots_from_preparation('${prepId}', ${source}, '${soy}', '${soy}', $1::jsonb, $2::jsonb, $3, $4::jsonb)`,
    [JSON.stringify(outputs), JSON.stringify(waste), confirm, trims === null ? null : JSON.stringify(trims)]);
const yields = (s, f) => [{ product_id: shashlik, qty: s }, { product_id: farsh, qty: f }];
const boneBack = (qty) => [{ product_id: bone, qty, note: "bulyon üçün" }];

r = await cook(prep.id, yields(5, 2), { qty: 0, reason: "cutting" }, boneBack(2));
ok("trim not counted as output: 8 kg net vs 7 kg out -> balance_mismatch", /balance_mismatch/.test(r.err ?? ""), r);
r = await cook(prep.id, yields(5, 2), { qty: 1, reason: "cutting", note: "fatty" }, boneBack(2));
ok("10 - 2 trim = 8 net = 5 + 2 + 1 waste: saved", !r.err && r.rows.length === 3, r);
const lots = r.rows ?? [];
const trimLot = lots.find((l) => l.lot_type === "trim");
ok("output lots first, then the trim lot", lots[0]?.lot_type === "semi" && lots[1]?.lot_type === "semi" && lots[2] === trimLot);
ok("trim lot: 2 kg bone traced to the lamb lot", trimLot && trimLot.product_id === bone && Number(trimLot.quantity) === 2 && trimLot.parent_lot_id === lambLot.id, trimLot);
ok("trim lot numbered after its source: <lamb lot>-R", trimLot?.lot_number === `${lambLot.lot_number}-R`, { trim: trimLot?.lot_number, lamb: lambLot.lot_number });
const run = (await q(`select * from preparation_runs where id='${lots[0]?.preparation_run_id}'`))[0];
ok("run: gross 10, trim 2, net 8, out 7, waste 1", run && Number(run.input_base) === 10 && Number(run.trim_base) === 2 && Number(run.net_base) === 8 &&
  Number(run.output_base) === 7 && Number(run.waste_base) === 1 && Number(run.difference_base) === 0, run);
ok("run lists its lots and the trim note", run.outputs.length === 2 && run.trims[0].lot_id === trimLot.id && run.trims[0].note === "bulyon üçün", run);
const costs = (await q(`select * from preparation_run_costs where run_id='${run.id}'`))[0];
ok("cost: 100 gross - 20 trim = 80 net", costs && near(costs.input_cost, 100) && near(costs.trim_cost, 20) && near(costs.net_cost, 80), costs);
const lotCost = async (lot) => (await q(`select cost_per_unit c, sale_per_unit s from product_lot_costs where lot_id='${lot.id}'`))[0];
const shashlikCost = await lotCost(lots[0]);
ok("Shashlik maya 80 / 7 kg = 11.43 AZN/kg, satış 18", near(shashlikCost.c, 80 / 7) && Number(shashlikCost.s) === 18, shashlikCost);
ok("Farsh maya the same per kg, satış 14", near((await lotCost(lots[1])).c, 80 / 7) && Number((await lotCost(lots[1])).s) === 14);
ok("bone maya 10 AZN/kg (100% of the lamb)", near((await lotCost(trimLot)).c, 10));
ok("raw lot maya from its receipt", near((await lotCost(lambLot)).c, 10));
const stock = async (id) => Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where product_id='${id}'`))[0].s);
ok("stock: lamb -10 gross, bone +2, shashlik +5", (await stock(lamb)) === 0 && (await stock(bone)) === 2 && (await stock(shashlik)) === 5);
const waste = await q(`select reason, reason_note, quantity, cost from wastage_logs where preparation_run_id='${run.id}'`);
ok("1 kg fat logged as waste worth 10", waste.length === 1 && waste[0].reason_note === "fatty" && Number(waste[0].quantity) === 1 && near(waste[0].cost, 10), waste);
r = await as(C, "select * from product_lot_costs");
ok("cook cannot read lot costs", /permission denied/.test(r.err ?? "") || (!r.err && r.rows.length === 0), r);
r = await as(C, "select * from preparation_run_costs");
ok("cook cannot read run costs", /permission denied/.test(r.err ?? ""), r);

// ---- cheaper trim: 50% of the lamb, from the product, then from the tenant default
await receive(lamb, 10, 10);
await economics(A, bone, "trim", null, null, 50);
r = await cook(prep.id, yields(5, 2), { qty: 1 }, boneBack(2));
let c2 = (await q(`select * from preparation_run_costs where run_id='${r.rows?.[0]?.preparation_run_id}'`))[0];
ok("bone at 50%: trim 10, net 90", !r.err && near(c2.trim_cost, 10) && near(c2.net_cost, 90), { r, c2 });
await economics(A, bone, "trim");
await q(`update tenant_settings set default_trim_value_percent = 50 where tenant_id='${tA}'`);
await receive(lamb, 10, 10);
r = await cook(prep.id, yields(5, 2), { qty: 1 }, boneBack(2));
c2 = (await q(`select * from preparation_run_costs where run_id='${r.rows?.[0]?.preparation_run_id}'`))[0];
ok("…or from tenant_settings.default_trim_value_percent", !r.err && near(c2.trim_cost, 10), c2);
const trimNumbers = (await q("select t.lot_number n, p.lot_number parent from product_lots t join product_lots p on p.id = t.parent_lot_id where t.lot_type = 'trim'"));
ok("every trim lot: <source>-R or -R2.., all distinct", trimNumbers.length === 3 && new Set(trimNumbers.map((t) => t.n)).size === 3 &&
  trimNumbers.every((t) => new RegExp(`^${t.parent}-R\\d*$`).test(t.n)), trimNumbers);
await q(`update tenant_settings set default_trim_value_percent = 100 where tenant_id='${tA}'`);

// ---- no trim: net = gross, as before
await receive(lamb, 10, 10);
r = await cook(prep.id, yields(5, 2), { qty: 3 }, null);
const plain = (await q(`select r.net_base, r.trim_base, c.net_cost from preparation_runs r join preparation_run_costs c on c.run_id = r.id where r.id='${r.rows?.[0]?.preparation_run_id}'`))[0];
ok("without trim: net = gross 10, all 100 AZN on the outputs", !r.err && Number(plain.net_base) === 10 && Number(plain.trim_base) === 0 && near(plain.net_cost, 100), { r, plain });

// ---- bad trim
await receive(lamb, 10, 10);
r = await cook(prep.id, yields(5, 2), { qty: 1 }, [{ product_id: farsh, qty: 2 }]);
ok("trim must be a trim product", /invalid_input/.test(r.err ?? ""), r);
r = await cook(prep.id, yields(5, 2), { qty: 0 }, boneBack(10));
ok("trim cannot take the whole input", /invalid_input/.test(r.err ?? ""), r);
r = await cook(prep.id, yields(5, 2), { qty: 1 }, [...boneBack(1), ...boneBack(1)]);
ok("one line per trim product", /invalid_input/.test(r.err ?? ""), r);

// ---- evaporation: 10 kg in, 7 kg out of the oven, recipe evaporation 30%
r = await as(A, "select * from public.save_preparation(null, 'Qızartma', $1, $2, 0, '[]'::jsonb, null, 30)",
  [JSON.stringify([{ product_id: lamb, qty: 10 }]), JSON.stringify([{ product_id: shashlik, qty: 7 }])]);
ok("recipe keeps its evaporation", !r.err && Number(r.rows[0].evaporation_percent) === 30, r);
r = await cook(r.rows[0].id, [{ product_id: shashlik, qty: 7 }], { qty: 0 }, null);
const roast = (await q(`select r.evaporation_base, r.difference_base, c.net_cost from preparation_runs r join preparation_run_costs c on c.run_id = r.id where r.id='${r.rows?.[0]?.preparation_run_id}'`))[0];
ok("evaporation 3 kg balances; the cost stays on the 7 kg", !r.err && Number(roast.evaporation_base) === 3 && Number(roast.difference_base) === 0 && near(roast.net_cost, 100), { r, roast });

// ---- density: litres counted in kg
const milk = await product("Süd", "l");
const yogurt = await product("Qatıq", "kg");
r = await as(A, "select * from public.save_preparation(null, 'Qatıq', $1, $2, 0)",
  [JSON.stringify([{ product_id: milk, qty: 10 }]), JSON.stringify([{ product_id: yogurt, qty: 10 }])]);
const yogurtPrep = r.rows[0].id;
await economics(A, milk, "raw", null, 1.03);
await receive(milk, 10, 2);
r = await cook(yogurtPrep, [{ product_id: yogurt, qty: 10.3 }], { qty: 0 }, null);
const dense = (await q(`select base_unit, input_base from preparation_runs where id='${r.rows?.[0]?.preparation_run_id}'`))[0];
ok("10 l milk x density 1.03 = 10.3 kg in, balanced against kg", !r.err && dense.base_unit === "kg" && Number(dense.input_base) === 10.3, { r, dense });

// ---- stock by kind
r = await as(A, "select * from public.stock_summary()");
const kinds = Object.fromEntries((r.rows ?? []).map((x) => [x.kind, x]));
const value = async (kind) => Number((await q(`select coalesce(sum(ps.quantity * ps.cost_per_unit),0) v from product_stocks ps join products p on p.id = ps.product_id
  where ps.tenant_id='${tA}' and ps.quantity > 0 and public.stock_kind(p.product_type) = '${kind}'`))[0].v);
ok("owner: raw, semi and trim apart, valued from the lots", !r.err && kinds.trim && near(kinds.trim.cost_value, await value("trim")) &&
  near(kinds.semi.cost_value, await value("semi")) && Number(kinds.trim.kg) === 6, kinds);
const shashlikKg = await stock(shashlik);
const farshKg = await stock(farsh);
ok("semi sale value at the products' sale prices", near(kinds.semi.sale_value, shashlikKg * 18 + farshKg * 14) && Number(kinds.semi.margin) > 0, kinds.semi);
r = await as(C, "select * from public.stock_summary()");
ok("cook: the same quantities, no money", !r.err && r.rows.length === Object.keys(kinds).length && r.rows.every((x) => x.cost_value === null && x.sale_value === null), r);
r = await as(C, "select * from public.stock_items(null, 'semi')");
ok("cook: semi lots FIFO with lot numbers, no prices", !r.err && r.rows.length > 0 && r.rows.every((x) => x.kind === "semi" && x.lot_number && x.cost_per_unit === null && x.sale_price === null), r);
r = await as(A, "select * from public.stock_items(null, 'trim')");
ok("owner: trim lots with cost", !r.err && r.rows.length > 0 && r.rows.every((x) => x.kind === "trim" && x.cost_per_unit !== null), r);
r = await as(A, "select * from public.stock_items(null, 'bones')");
ok("unknown kind rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(B, "select count(*)::int n from public.stock_items()");
ok("other tenant sees none of it", r.rows[0].n === 0, r);

// ---- migration order: any re-run keeps the final function
const prepFunctions = async () =>
  (await q("select pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.proname in ('create_lots_from_preparation', 'save_preparation') order by 1")).map((x) => x.args);
failure = await apply(["20261018000000_labels_and_lots.sql", "20261018000001_wastage_in_prep.sql"]);
let fns = await prepFunctions();
ok("labels and wastage re-applied after the final scheme: still one function each, with trim and evaporation",
  !failure && fns.length === 2 && fns.some((a) => /p_trims jsonb/.test(a)) && fns.some((a) => /p_evaporation_percent numeric/.test(a)), { failure, fns });
await receive(lamb, 10, 10);
r = await cook(prep.id, yields(5, 2), { qty: 1 }, boneBack(2));
ok("…and trim still works", !r.err && r.rows.length === 3, r);
// 20261028001300 changed stock_summary's result; Postgres re-creates a function with another result
// only after a drop, and the later migration restores its version.
await q("drop function public.stock_summary(uuid)");
failure = await apply([FINAL, "20261018000001_wastage_in_prep.sql", FINAL, "20261028001300_fix_cost_expired.sql"]);
fns = await prepFunctions();
ok("final -> wastage -> final: same result", !failure && fns.length === 2, { failure, fns });

done();
