// 20261018_wastage_in_prep.sql: waste norm on recipes, waste and balance check inside a preparation
// (one transaction with the lots), confirmed losses, tolerance from tenant_settings, write-offs through
// log_wastage() and write_off_expired_stock(), reports.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/wastage_in_prep.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const WASTE = "20261018_wastage_in_prep.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < WASTE));
ok(`migrations before ${WASTE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= WASTE));
  ok(`${WASTE} applies (run ${run})`, !failure, failure);
}

const [A, C, B] = [U("1a"), U("1c"), U("1b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA] = [await tenantOf(A)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);

const place = async (type) => (await q(`select id from storage_locations where tenant_id='${tA}' and type='${type}' order by number limit 1`))[0].id;
const [soy, don] = [await place("soyuducu"), await place("dondurucu")];
const today = (await q(`select public.tenant_today('${tA}') d`))[0].d;
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => iso(new Date(today.getTime() + days * 86400000));
const product = async (name, unit) => (await as(A, `insert into products(name, unit) values ('${name}','${unit}') returning id`)).rows[0].id;
const lamb = await product("Baranina", "kg");
const shashlik = await product("Shashlik", "kg");
const koreyka = await product("Koreyka", "kg");
const farsh = await product("Farsh", "kg");
const lambStock = async () => Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where product_id='${lamb}'`))[0].s);
const count = async (table) => (await q(`select count(*)::int n from ${table}`))[0].n;

// ---- recipe norm
const recipe = (extra = {}) => ({
  name: "Shashlik",
  inputs: [{ product_id: lamb, qty: 10 }],
  outputs: [{ product_id: shashlik, qty: 5 }, { product_id: koreyka, qty: 2.5, portions: 8 }, { product_id: farsh, qty: 2 }],
  ...extra,
});
const insertRecipe = (uid, r) =>
  as(uid, "insert into preparations(name, inputs, outputs, wastage_norm_percent, wastage_items) values ($1,$2,$3,$4,$5) returning id, wastage_norm_percent, wastage_items",
    [r.name, JSON.stringify(r.inputs), JSON.stringify(r.outputs), r.norm ?? 5, JSON.stringify(r.items ?? [])]);
let r = await insertRecipe(A, recipe());
ok("recipe gets the default norm of 5%", !r.err && Number(r.rows[0].wastage_norm_percent) === 5, r);
r = await insertRecipe(A, recipe({ name: "Kebab", items: [{ name: " sümük ", norm_percent: 4 }, { name: "yağ", norm_percent: 2.5 }] }));
ok("norm is the sum of the waste items", !r.err && Number(r.rows[0].wastage_norm_percent) === 6.5 && r.rows[0].wastage_items[0].name === "sümük", r);
r = await insertRecipe(A, recipe({ name: "X", items: [{ name: "a", norm_percent: 60 }, { name: "b", norm_percent: 50 }] }));
ok("items above 100% rejected", /invalid_input/.test(r.err ?? ""), r);
r = await insertRecipe(A, recipe({ name: "X", items: [{ name: "a", norm_percent: 1 }, { name: "A", norm_percent: 1 }] }));
ok("duplicate item names rejected", /invalid_input/.test(r.err ?? ""), r);
r = await insertRecipe(A, recipe({ name: "X", norm: 101 }));
ok("norm above 100% rejected", !!r.err, r);
const prep = (await as(A, "select id from preparations where name = 'Shashlik'")).rows[0].id;

// ---- preparation with waste, balance within tolerance
r = await as(C, `select * from public.receive_stock_with_lot('${lamb}', 12, '${soy}', 9)`);
const lambLot = r.rows[0];
const outputs = (s, k, f) => JSON.stringify([{ product_id: shashlik, qty: s }, { product_id: koreyka, qty: k }, { product_id: farsh, qty: f, storage_location_id: don }]);
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 10, '${soy}', '${soy}', $1::jsonb, $2::jsonb)`,
  [outputs(5, 2.4, 2), JSON.stringify({ qty: 0.5, reason: "cutting" })]);
ok("balanced preparation saves 3 lots", !r.err && r.rows.length === 3, r);
const runId = r.rows?.[0]?.preparation_run_id;
let logs = await q(`select reason, quantity, unit, parent_lot_id, preparation_id, preparation_run_id, location_id, cost from wastage_logs where preparation_id='${prep}'`);
ok("one waste log: cutting 0.5 kg from the lamb lot", logs.length === 1 && logs[0].reason === "cutting" && Number(logs[0].quantity) === 0.5 &&
  logs[0].unit === "kg" && logs[0].parent_lot_id === lambLot.id && logs[0].preparation_run_id === runId && logs[0].location_id === soy, logs);
ok("waste valued from the lot it came from (0.5 x 9)", Number(logs[0].cost) === 4.5, logs[0].cost);
let run = (await q(`select * from preparation_runs where id='${runId}'`))[0];
ok("run records input, yield, waste and the norm", run && Number(run.input_base) === 10 && Number(run.output_base) === 9.4 &&
  Number(run.waste_base) === 0.5 && Number(run.norm_percent) === 5 && run.base_unit === "kg" && !run.confirmed_loss && Math.abs(Number(run.difference_base) - 0.1) < 1e-9, run);
ok("raw written off in full (12 - 10)", (await lambStock()) === 2);

// ---- balance mismatch: needs confirmation, then the shortfall is logged
await as(C, `select * from public.receive_stock_with_lot('${lamb}', 10, '${soy}', 9)`);
const [lotsBefore, logsBefore, runsBefore] = [await count("product_lots"), await count("wastage_logs"), await count("preparation_runs")];
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 10, '${soy}', '${soy}', $1::jsonb, $2::jsonb)`,
  [outputs(5, 2, 1), JSON.stringify({ qty: 0.5, reason: "cutting", note: "sümüklü idi" })]);
ok("difference 1.5 kg without confirmation -> balance_mismatch", /balance_mismatch/.test(r.err ?? ""), r);
ok("…and nothing was saved", (await count("product_lots")) === lotsBefore && (await count("wastage_logs")) === logsBefore &&
  (await count("preparation_runs")) === runsBefore && (await lambStock()) === 12);
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 10, '${soy}', '${soy}', $1::jsonb, $2::jsonb, true)`,
  [outputs(5, 2, 1), JSON.stringify({ qty: 0.5, reason: "cutting", note: "sümüklü idi" })]);
ok("confirmed (\"Bəli, itki var\") -> saved", !r.err && r.rows.length === 3, r);
logs = await q(`select reason, reason_note, quantity from wastage_logs where preparation_run_id='${r.rows?.[0]?.preparation_run_id}' order by quantity`);
ok("waste and the confirmed loss are logged", logs.length === 2 && logs[0].reason === "cutting" && logs[0].reason_note === "sümüklü idi" &&
  logs[1].reason === "other" && logs[1].reason_note === "balance" && Number(logs[1].quantity) === 1.5, logs);
run = (await q(`select * from preparation_runs where id='${r.rows[0].preparation_run_id}'`))[0];
ok("run marked as a confirmed loss", run.confirmed_loss && Number(run.loss_base) === 1.5, run);

// ---- tolerance comes from tenant_settings
await q(`update tenant_settings set prep_balance_tolerance = 2, prep_balance_tolerance_percent = 20 where tenant_id='${tA}'`);
await as(C, `select * from public.receive_stock_with_lot('${lamb}', 10, '${soy}', 9)`);
const logsNow = await count("wastage_logs");
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 10, '${soy}', '${soy}', $1::jsonb, $2::jsonb)`,
  [outputs(5, 2, 1), JSON.stringify({ qty: 0.5 })]);
ok("wider tenant tolerance: same difference passes, no loss logged", !r.err && (await count("wastage_logs")) === logsNow + 1, r);
await q(`update tenant_settings set prep_balance_tolerance = 0.3, prep_balance_tolerance_percent = 5 where tenant_id='${tA}'`);

r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 1, '${soy}', '${soy}', null, $1::jsonb)`, [JSON.stringify({ qty: -1 })]);
ok("negative waste rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 1, '${soy}', '${soy}', null, $1::jsonb)`, [JSON.stringify({ qty: 2 })]);
ok("waste above the input rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, `select * from public.create_lots_from_preparation('${prep}', 1, '${soy}', '${soy}', null, $1::jsonb)`, [JSON.stringify({ qty: 0.1, reason: "theft" })]);
ok("unknown prep waste reason rejected", /invalid_input/.test(r.err ?? ""), r);

// ---- log_wastage (POST /api/wastage)
const shashlikLot = (await q(`select id from product_lots where product_id='${shashlik}' order by created_at limit 1`))[0].id;
const shashlikStock = async () => Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where product_id='${shashlik}'`))[0].s);
const before = await shashlikStock();
r = await as(C, `select public.log_wastage('${shashlik}', 1, 'cooking', 'yandı', '${shashlikLot}', '${prep}') id`);
ok("cook logs waste from a lot", !r.err && !!r.rows[0].id, r);
ok("…stock goes down by a 'waste' movement", (await shashlikStock()) === before - 1 &&
  (await q(`select count(*)::int n from stock_movements where product_id='${shashlik}' and movement_type='waste'`))[0].n === 1);
const logged = (await q(`select reason, reason_note, parent_lot_id, preparation_id, location_id, created_by from wastage_logs where id='${r.rows[0].id}'`))[0];
ok("…with lot, recipe, place and author", logged.reason === "cooking" && logged.reason_note === "yandı" && logged.parent_lot_id === shashlikLot &&
  logged.preparation_id === prep && logged.location_id === soy && logged.created_by === C, logged);
r = await as(C, `select public.log_wastage('${shashlik}', 1, 'cooking')`);
ok("no place and no lot -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, `select public.log_wastage('${shashlik}', 1000, 'other', null, null, null, '${soy}')`);
ok("more than in stock -> insufficient_stock", /insufficient_stock/.test(r.err ?? ""), r);
r = await as(C, `select public.log_wastage('${shashlik}', 1, 'theft', null, null, null, '${soy}')`);
ok("board-only reason refused here", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, `select public.log_wastage('${farsh}', 1, 'other', null, '${shashlikLot}')`);
ok("lot of another product refused", /invalid_input/.test(r.err ?? ""), r);
r = await as(B, `select public.log_wastage('${shashlik}', 1, 'other', null, '${shashlikLot}')`);
ok("another tenant cannot use our product or lot", /product_not_found|lot_not_found/.test(r.err ?? ""), r);
r = await as(A, `insert into wastage_logs(tenant_id, product_id, quantity, reason) values ('${tA}','${shashlik}',1,'other')`);
ok("logs are not inserted directly", !!r.err, r);

// ---- expired stock
r = await as(C, `select * from public.receive_stock_with_lot('${farsh}', 3, '${soy}', 4, '${plus(-5)}', 2)`);
const oldLot = r.rows[0];
r = await as(C, "select * from public.expired_stock()");
const row = r.rows?.find((x) => x.product_id === farsh && x.location_id === soy);
ok("expired stock listed with its lot number", row && row.days_left === -3 && row.lot_number === oldLot.lot_number && Number(row.quantity) === 3, r.rows);
r = await as(C, `select public.write_off_expired_stock('${row.stock_id}') id`);
ok("\"Sil - xarab oldu\" writes the row off", !r.err && Number((await q(`select quantity from product_stocks where id='${row.stock_id}'`))[0].quantity) === 0, r);
const expiredLog = (await q(`select reason, quantity, parent_lot_id, cost from wastage_logs where id='${r.rows[0].id}'`))[0];
ok("…logged as expired with its lot and value", expiredLog.reason === "expired" && Number(expiredLog.quantity) === 3 && expiredLog.parent_lot_id === oldLot.id && Number(expiredLog.cost) === 12, expiredLog);
r = await as(C, `select public.write_off_expired_stock('${row.stock_id}')`);
ok("empty row cannot be written off again", /invalid_input/.test(r.err ?? ""), r);
r = await as(B, `select public.write_off_expired_stock('${row.stock_id}')`);
ok("another tenant cannot write it off", /lot_not_found/.test(r.err ?? ""), r);

// ---- reports
r = await as(C, "select reason, cost from public.wastage_list(7)");
ok("cook sees the list without costs", !r.err && r.rows.length === (await count("wastage_logs")) && r.rows.every((x) => x.cost === null), r);
r = await as(A, "select reason, cost, lot_number, preparation_name from public.wastage_list(7)");
ok("owner sees costs, lots and recipes", r.rows.some((x) => Number(x.cost) > 0) && r.rows.some((x) => x.preparation_name === "Shashlik" && x.lot_number), r.rows);
r = await as(A, "select * from public.wastage_list(0)");
ok("days outside 1..366 rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select * from public.wastage_summary()");
const s = r.rows?.[0];
ok("summary: today's waste in kg and value", s && Math.abs(Number(s.waste_kg) - (0.5 + 0.5 + 1.5 + 0.5 + 1 + 3)) < 1e-9 && Number(s.waste_cost) > 0, s);
ok("summary: runs, input, norm and prep waste", s.runs === 3 && Number(s.input_kg) === 30 && Number(s.norm_kg) === 1.5 && Number(s.prep_waste_kg) === 3, s);
r = await as(C, "select * from public.wastage_summary()");
ok("cook cannot read the owner summary", /forbidden/.test(r.err ?? ""), r);
r = await as(B, "select count(*)::int n from public.wastage_list(30)");
ok("other tenant sees none of it", r.rows[0].n === 0, r);

// ---- the waste board keeps working
await as(C, `select * from public.receive_stock_with_lot('${koreyka}', 2, '${don}', 5)`);
r = await as(C, `select public.create_wastage_with_movement('${koreyka}', 1, 'dropped', '${don}') id`);
ok("waste board write-off still works", !r.err && !!r.rows[0].id, r);
r = await as(A, "select count(*)::int n from preparation_runs");
ok("runs readable by the tenant, not writable", r.rows[0].n === 3 && !!(await as(A, `insert into preparation_runs(tenant_id, source_qty, norm_percent) values ('${tA}', 1, 5)`)).err);

// ---- kg + pieces: Koreyka counted in portions
const koreykaPor = await product("Koreyka por", "pcs");
const mixed = recipe({ name: "Mixed", outputs: [{ product_id: shashlik, qty: 5 }, { product_id: koreykaPor, qty: 8, portions: 8 }, { product_id: farsh, qty: 2 }] });
const mixedPrep = (await insertRecipe(A, mixed)).rows[0].id;
const mixedRun = (k, waste, confirm = false) =>
  as(C, `select * from public.create_lots_from_preparation('${mixedPrep}', 10, '${soy}', '${soy}', $1::jsonb, $2::jsonb, $3)`, [
    JSON.stringify([{ product_id: shashlik, qty: 5 }, { product_id: koreykaPor, qty: k }, { product_id: farsh, qty: 2 }]),
    JSON.stringify({ qty: waste }),
    confirm,
  ]);
const lastRun = async () => (await q("select * from preparation_runs order by created_at desc, id desc limit 1"))[0];
await as(C, `select * from public.receive_stock_with_lot('${lamb}', 60, '${soy}', 9)`);

r = await mixedRun(8, 0.5);
run = await lastRun();
ok("no portion weight: balance still checked, koreyka at its recipe weight (10 - 5 - 2 - 0.5 = 2.5 kg)",
  !r.err && run.base_unit === "kg" && Number(run.estimated_base) === 2.5 && Number(run.output_base) === 9.5 && Number(run.difference_base) === 0, { r, run });
r = await mixedRun(6, 0.5);
ok("no portion weight: two portions missing -> balance_mismatch", /balance_mismatch/.test(r.err ?? ""), r);

r = await as(C, "select * from public.save_preparation($1, 'Mixed', $2, $3, null, null, $4)",
  [mixedPrep, JSON.stringify(mixed.inputs), JSON.stringify(mixed.outputs), JSON.stringify([{ product_id: koreykaPor, portion_weight_kg: 0.25 }])]);
ok("a cook cannot save recipes or portion weights", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select * from public.save_preparation($1, 'Mixed', $2, $3, null, null, $4)",
  [mixedPrep, JSON.stringify(mixed.inputs), JSON.stringify(mixed.outputs), JSON.stringify([{ product_id: lamb, portion_weight_kg: 0 }])]);
ok("portion weight must be positive", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select * from public.save_preparation($1, 'Mixed', $2, $3, null, null, $4)",
  [mixedPrep, JSON.stringify(mixed.inputs), JSON.stringify(mixed.outputs), JSON.stringify([{ product_id: koreyka, portion_weight_kg: 0.25 }])]);
ok("portion weight only for products of the recipe", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select * from public.save_preparation($1, 'Mixed', $2, $3, null, null, $4)",
  [mixedPrep, JSON.stringify(mixed.inputs), JSON.stringify(mixed.outputs), JSON.stringify([{ product_id: koreykaPor, portion_weight_kg: 0.25 }])]);
ok("owner saves the recipe and the portion weight together", !r.err && r.rows[0].id === mixedPrep && Number(r.rows[0].wastage_norm_percent) === 5, r);
r = await as(C, `select portion_weight_kg from products where id='${koreykaPor}'`);
ok("cook reads the portion weight", !r.err && Number(r.rows[0].portion_weight_kg) === 0.25, r);

r = await mixedRun(8, 0.5);
ok("with 0.25 kg per portion: 8 por = 2 kg, 0.5 kg missing -> balance_mismatch", /balance_mismatch/.test(r.err ?? ""), r);
r = await mixedRun(8, 1);
run = await lastRun();
ok("8 por x 0.25 + 5 + 2 + 1 waste = 10 kg: balanced, nothing estimated",
  !r.err && Number(run.output_base) === 9 && Number(run.estimated_base) === 0 && Number(run.difference_base) === 0, { r, run });

await q(`update products set portion_weight_kg = null where id='${koreykaPor}'`);
await q(`update tenant_settings set default_portion_weight_kg = 0.25 where tenant_id='${tA}'`);
r = await mixedRun(8, 1);
run = await lastRun();
ok("tenant default portion weight used when the product has none", !r.err && Number(run.output_base) === 9 && Number(run.estimated_base) === 0, { r, run });
await q(`update tenant_settings set default_portion_weight_kg = null where tenant_id='${tA}'`);

r = await as(A, "select * from public.save_preparation(null, 'New one', $1, $2, null, $3, null)",
  [JSON.stringify(mixed.inputs), JSON.stringify(mixed.outputs), JSON.stringify([{ name: "sümük", norm_percent: 3 }])]);
ok("new recipe through save_preparation: norm from its items", !r.err && Number(r.rows[0].wastage_norm_percent) === 3 && r.rows[0].tenant_id === tA, r);

// ---- notes for /app/tullanti: readable with their lot and preparation run
r = await as(C, `select w.reason, w.reason_note, w.parent_lot_id, w.preparation_run_id from wastage_logs w where w.reason_note is not null`);
ok("cook reads reasons, notes, lots and runs of waste logs", !r.err && r.rows.some((x) => x.reason_note === "sümüklü idi" && x.parent_lot_id && x.preparation_run_id), r);
r = await as(C, `select r.id, r.created_at, p.name from preparation_runs r join preparations p on p.id = r.preparation_id limit 1`);
ok("…and the preparation behind a run", !r.err && r.rows.length === 1 && !!r.rows[0].name, r);

// ---- migration order: labels after waste keeps the waste version
const LABELS = "20261018_labels_and_lots.sql";
failure = await apply([LABELS]);
ok(`${LABELS} re-applies after ${WASTE}`, !failure, failure);
const prepFunctions = async () =>
  (await q("select pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.proname = 'create_lots_from_preparation'")).map((x) => x.args);
let fns = await prepFunctions();
ok("one preparation function, the one with waste", fns.length === 1 && /p_wastage jsonb, p_confirm_loss boolean/.test(fns[0]), fns);
r = await insertRecipe(A, recipe({ name: "After labels", items: [{ name: "Yağ", norm_percent: 2 }, { name: "yağ", norm_percent: 1 }] }));
ok("validator with waste items still in place", /invalid_input/.test(r.err ?? ""), r);
r = await mixedRun(6, 0.5);
ok("balance with portions still enforced", /balance_mismatch/.test(r.err ?? ""), r);
failure = await apply([WASTE, LABELS, WASTE]);
fns = await prepFunctions();
ok("waste -> labels -> waste again: same single function", !failure && fns.length === 1 && /p_wastage/.test(fns[0]), { failure, fns });

done();
