// 20261018000000_labels_and_lots.sql: shelf-life rules (place -> product -> tenant default), lot numbers
// LOT-YYYYMMDD-NNNN per restaurant and day (20261028000400), expiry = production + shelf life, receipt with lot in one transaction,
// preparations writing inputs off and creating one lot per output, label print logs, expiring lots.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/labels_and_lots.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const LOTS = "20261018000000_labels_and_lots.sql";
const { ok, done } = reporter();
const { q, as, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < LOTS));
ok(`migrations before ${LOTS} apply`, !failure, failure);
failure = await applyTwice(migrationFiles.filter((f) => f >= LOTS));
ok(`${LOTS} and later apply, each twice`, !failure, failure);

const [A, C, B] = [U("0a"), U("0c"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB] = [await tenantOf(A), await tenantOf(B)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);

const branch = (await q(`select id, code from branches where tenant_id='${tA}'`))[0];
const place = async (type) => (await q(`select id, number from storage_locations where tenant_id='${tA}' and type='${type}' order by number limit 1`))[0];
const [soy, don, quru] = [await place("soyuducu"), await place("dondurucu"), await place("quru")];
const today = (await q(`select public.tenant_today('${tA}') d`))[0].d;
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => iso(new Date(today.getTime() + days * 86400000));
const ddmm = iso(today).slice(8, 10) + iso(today).slice(5, 7);

const product = async (name, unit, extra = "") =>
  (await as(A, `insert into products(name, unit${extra ? ", shelf_life_days" : ""}) values ('${name}','${unit}'${extra ? ", " + extra : ""}) returning id`)).rows[0].id;
const toyuq = await product("Toyuq", "kg", "5");
const baranina = await product("Baranina", "kg");
const shashlik = await product("Shashlik", "kg");
const koreyka = await product("Koreyka", "sht");
const farsh = await product("Farsh", "kg");

// ---- shelf-life rules
let r = await as(C, `select public.set_shelf_life_rule('${toyuq}','${soy.id}', 3), public.set_shelf_life_rule('${toyuq}','${don.id}', 90)`);
ok("a cook sets shelf-life rules", !r.err, r);
await q(`update tenant_settings set default_shelf_life_days = 4 where tenant_id='${tA}'`);
r = await as(A, `select public.get_shelf_life('${toyuq}','${soy.id}') s, public.get_shelf_life('${toyuq}','${don.id}') d,
  public.get_shelf_life('${toyuq}','${quru.id}') q, public.get_shelf_life('${baranina}','${soy.id}') t`);
ok("shelf life: rule per place, else product, else tenant default", r.rows[0].s === 3 && r.rows[0].d === 90 && r.rows[0].q === 5 && r.rows[0].t === 4, r.rows[0]);
r = await as(B, `select public.get_shelf_life('${toyuq}','${soy.id}') s`);
ok("another tenant gets nothing", r.rows[0].s === null, r);
r = await as(B, `select public.set_shelf_life_rule('${toyuq}','${soy.id}', 1)`);
ok("another tenant cannot set a rule", /product_not_found/.test(r.err ?? ""), r);
r = await as(A, `insert into product_shelf_life_rules(tenant_id, product_id, storage_location_id, shelf_life_days) values ('${tA}','${toyuq}','${quru.id}',1)`);
ok("rules are not written directly", !!r.err, r);

// ---- receipt with lot
// Since 20261028000400: LOT-YYYYMMDD-NNNN, one counter per restaurant and tenant-local day.
const ymd = iso(today).replaceAll("-", "");
const lotNo = (seq) => `LOT-${ymd}-${String(seq).padStart(4, "0")}`;
r = await as(C, `select * from public.receive_stock_with_lot('${toyuq}', 10, '${soy.id}', 4.5)`);
const lot1 = r.rows?.[0];
ok("receipt creates a raw lot", !r.err && lot1.lot_type === "raw" && Number(lot1.quantity) === 10 && lot1.unit === "kg", r);
ok("lot number LOT-YYYYMMDD-0001", lot1.lot_number === lotNo(1), lot1.lot_number);
ok("expiry = production + rule (soyuducu 3)", iso(lot1.production_date) === iso(today) && iso(lot1.expiry_date) === plus(3), lot1);
r = await q(`select quantity, expiry_date from product_stocks where product_id='${toyuq}' and location_id='${soy.id}'`);
ok("the stock row carries the same expiry", r.length === 1 && Number(r[0].quantity) === 10 && iso(r[0].expiry_date) === plus(3), r);
r = await q(`select movement_type, cost_per_unit from stock_movements where id='${lot1.movement_id}'`);
ok("lot points at its prihod movement", r[0]?.movement_type === "prihod" && Number(r[0].cost_per_unit) === 4.5, r);

r = await as(C, `select * from public.receive_stock_with_lot('${toyuq}', 4, '${don.id}')`);
const lot2 = r.rows[0];
ok("dondurucu: 90 days, next number of the restaurant", iso(lot2.expiry_date) === plus(90) && lot2.lot_number === lotNo(2), lot2);
r = await as(C, `select * from public.receive_stock_with_lot('${toyuq}', 2, '${soy.id}', null, '${plus(-1)}')`);
ok("expiry follows the given production date", iso(r.rows[0].production_date) === plus(-1) && iso(r.rows[0].expiry_date) === plus(2), r.rows[0]);
r = await as(C, `select * from public.receive_stock_with_lot('${baranina}', 12, '${soy.id}', 9, null, 2, true)`);
const baraninaLot = r.rows[0];
ok("override with remember becomes the rule", iso(baraninaLot.expiry_date) === plus(2) &&
  (await as(A, `select public.get_shelf_life('${baranina}','${soy.id}') s`)).rows[0].s === 2, r);
r = await as(C, `select public.receive_stock_with_lot('${toyuq}', 0, '${soy.id}')`);
ok("zero quantity rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(B, `select public.receive_stock_with_lot('${toyuq}', 1, '${soy.id}')`);
ok("another tenant cannot receive into it", /product_not_found/.test(r.err ?? ""), r);

// ---- lot number uniqueness
r = await q(`select count(*)::int n, count(distinct lot_number)::int u, max(seq) m from product_lots where tenant_id='${tA}'`);
ok("lot numbers are unique and sequential within the day", r[0].n === 4 && r[0].u === 4 && r[0].m === 4, r);
r = await as(A, `select public.generate_lot_number('${branch.id}','${soy.id}') n`);
ok("generate_lot_number previews the next one", r.rows?.[0]?.n === lotNo(5), r);
const before = (await q("select count(*)::int n from stock_movements"))[0].n;
r = await as(C, `select * from public.create_lot('${toyuq}', 3, '${soy.id}')`);
ok("create_lot labels existing stock without a movement", !r.err && r.rows[0].movement_id === null &&
  (await q("select count(*)::int n from stock_movements"))[0].n === before && r.rows[0].lot_number === lotNo(5), r);
// Everything numbered so far moves to yesterday: today counts from 0001 again.
const yesterday = plus(-1).replaceAll("-", "");
await q(`update batch_daily_counters set date = date - 1 where tenant_id='${tA}'`);
await q(`update product_lots set numbered_on = numbered_on - 1, lot_number = replace(lot_number, '${ymd}', '${yesterday}') where tenant_id='${tA}'`);
r = await as(C, `select * from public.create_lot('${toyuq}', 1, '${soy.id}')`);
ok("a new day starts again at 0001", r.rows?.[0]?.lot_number === lotNo(1), r.rows?.[0]?.lot_number);
const b2 = (await as(A, "insert into branches(name) values ('Gənclik') returning id, code")).rows[0];
const b2soy = (await q(`select id, number from storage_locations where branch_id='${b2.id}' and type='soyuducu' limit 1`))[0];
r = await as(C, `select * from public.create_lot('${toyuq}', 1, '${b2soy.id}')`);
ok("the counter is shared by all branches of the restaurant", r.rows?.[0]?.lot_number === lotNo(2), r.rows?.[0]);
r = await as(A, `insert into product_lots(tenant_id, branch_id, product_id, lot_number, numbered_on, seq, expiry_date, quantity, unit, storage_location_id, lot_type)
  values ('${tA}','${branch.id}','${toyuq}','X','${iso(today)}',99,'${plus(1)}',1,'kg','${soy.id}','raw')`);
ok("lots are not inserted directly", !!r.err, r);
r = await q(`insert into product_lots(tenant_id, branch_id, product_id, lot_number, numbered_on, seq, expiry_date, quantity, unit, storage_location_id, lot_type)
  values ('${tA}','${branch.id}','${toyuq}','${lot1.lot_number}','${iso(today)}',98,'${plus(1)}',1,'kg','${soy.id}','raw')`).catch((e) => ({ err: e.message }));
ok("a lot number cannot repeat in the restaurant", /uq_product_lots_tenant_batch_number|uniq_product_lot_number_day/.test(r.err ?? ""), r);

// ---- preparation: 10 kg lamb -> 5 kg shashlik + 8 portions koreyka + 2 kg farsh
await as(A, `select public.set_shelf_life_rule('${shashlik}','${soy.id}', 3), public.set_shelf_life_rule('${koreyka}','${soy.id}', 2), public.set_shelf_life_rule('${farsh}','${don.id}', 60)`);
const recipe = {
  name: "  Shashlik   Baranina ",
  inputs: [{ product_id: baranina, qty: 10 }],
  outputs: [
    { product_id: shashlik, qty: 5 },
    { product_id: koreyka, qty: 8, portions: 8, name: "Koreyka" },
    { product_id: farsh, qty: 2 },
  ],
};
r = await as(C, "insert into preparations(name, inputs, outputs) values ($1, $2, $3) returning id", [recipe.name, JSON.stringify(recipe.inputs), JSON.stringify(recipe.outputs)]);
ok("a cook cannot create recipes", !!r.err, r);
r = await as(A, "insert into preparations(name, inputs, outputs) values ($1, $2, $3) returning id, name, tenant_id", [recipe.name, JSON.stringify(recipe.inputs), JSON.stringify(recipe.outputs)]);
const prep = r.rows?.[0];
ok("owner creates a recipe (name normalised, tenant stamped)", !r.err && prep.name === "Shashlik Baranina" && prep.tenant_id === tA, r);
r = await as(A, "insert into preparations(name, inputs, outputs) values ('X', $1, $2)", [JSON.stringify([{ product_id: baranina, qty: 0 }]), JSON.stringify(recipe.outputs)]);
ok("recipe with zero quantity rejected", /invalid_input/.test(r.err ?? ""), r);
const otherProduct = (await as(B, "insert into products(name, unit) values ('Alien','kg') returning id")).rows[0].id;
r = await as(A, "insert into preparations(name, inputs, outputs) values ('X', $1, $2)", [JSON.stringify([{ product_id: otherProduct, qty: 1 }]), JSON.stringify(recipe.outputs)]);
ok("recipe with another tenant's product rejected", /product_not_found/.test(r.err ?? ""), r);

// The norm waste (5% of 10 kg) is entered: koreyka in pieces counts at its recipe weight in the balance.
r = await as(C, `select * from public.create_lots_from_preparation('${prep.id}', 10, '${soy.id}', null,
  $1::jsonb, $2::jsonb)`, [JSON.stringify([{ product_id: shashlik, qty: 5 }, { product_id: koreyka, qty: 8 }, { product_id: farsh, qty: 2, storage_location_id: don.id }]), JSON.stringify({ qty: 0.5 })]);
const lots = r.rows ?? [];
ok("preparation creates 3 semi lots", !r.err && lots.length === 3 && lots.every((l) => l.lot_type === "semi"), r);
const byProduct = Object.fromEntries(lots.map((l) => [l.product_id, l]));
ok("each output has its own expiry by its rule", iso(byProduct[shashlik]?.expiry_date) === plus(3) && iso(byProduct[koreyka]?.expiry_date) === plus(2) && iso(byProduct[farsh]?.expiry_date) === plus(60), lots.map((l) => iso(l.expiry_date)));
ok("farsh went to the freezer", byProduct[farsh]?.storage_location_id === don.id && /^LOT-\d{8}-\d{4,}$/.test(byProduct[farsh].lot_number), byProduct[farsh]);
ok("portions kept for koreyka", Number(byProduct[koreyka]?.portions) === 8, byProduct[koreyka]);
ok("parent lot is the lamb lot", lots.every((l) => l.parent_lot_id === baraninaLot.id), lots.map((l) => l.parent_lot_id));
const comp = byProduct[shashlik]?.composition_json ?? [];
ok("composition lists the input with its lot", comp.length === 1 && comp[0].name === "Baranina" && Number(comp[0].qty) === 10 && comp[0].lot_number === (await q(`select lot_number from product_lots where id='${baraninaLot.id}'`))[0].lot_number, comp);
r = await q(`select (select coalesce(sum(quantity),0) from product_stocks where product_id='${baranina}') b,
  (select coalesce(sum(quantity),0) from product_stocks where product_id='${shashlik}' and location_id='${soy.id}') s,
  (select coalesce(sum(quantity),0) from product_stocks where product_id='${farsh}' and location_id='${don.id}') f`);
ok("lamb written off, outputs in stock", Number(r[0].b) === 2 && Number(r[0].s) === 5 && Number(r[0].f) === 2, r);
r = await q(`select movement_type, reason from stock_movements where product_id='${baranina}' and movement_type='task'`);
ok("write-off is a 'task' movement named after the recipe", r.length === 1 && r[0].reason === "Shashlik Baranina", r);

const lotsBefore = (await q("select count(*)::int n from product_lots"))[0].n;
r = await as(C, `select * from public.create_lots_from_preparation('${prep.id}', 5, '${soy.id}', '${soy.id}')`);
ok("not enough lamb -> error", /insufficient_stock/.test(r.err ?? ""), r);
ok("…and nothing was saved", (await q("select count(*)::int n from product_lots"))[0].n === lotsBefore &&
  Number((await q(`select sum(quantity) s from product_stocks where product_id='${baranina}'`))[0].s) === 2);
r = await as(C, `select * from public.create_lots_from_preparation('${prep.id}', 2, '${soy.id}')`);
ok("recipe scales with the source quantity", !r.err && r.rows.length === 3 &&
  Number(r.rows.find((l) => l.product_id === shashlik).quantity) === 1 && Number(r.rows.find((l) => l.product_id === koreyka).portions) === 2, r);
r = await as(C, `select * from public.create_lots_from_preparation('${prep.id}', 1, '${soy.id}', null, $1::jsonb)`, [JSON.stringify([{ product_id: toyuq, qty: 1 }])]);
ok("an output that is not in the recipe is rejected", !!r.err, r);

// ---- labels and expiring lots
r = await as(C, "select public.print_labels($1::uuid[], 2) n", [`{${lots.map((l) => l.id).join(",")}}`]);
ok("print logged per lot", r.rows?.[0]?.n === 3 && (await q("select sum(copies)::int c from label_print_logs"))[0].c === 6, r);
r = await as(B, "select public.print_labels($1::uuid[], 1)", [`{${lots[0].id}}`]);
ok("another tenant cannot print our lots", /lot_not_found/.test(r.err ?? ""), r);
r = await as(C, "select public.print_labels('{}'::uuid[], 1)");
ok("empty print rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, "select lot_number, product_name, days_left, in_stock from public.expiring_lots(2)");
const names = r.rows.map((x) => x.product_name);
ok("expiring within 2 days: koreyka and old chicken; used-up lamb and frozen chicken are not", names.includes("Koreyka") && names.includes("Toyuq") &&
  !names.includes("Baranina") && !r.rows.some((x) => x.lot_number === lot2.lot_number), r.rows);
r = await as(B, "select count(*)::int n from public.expiring_lots(400)");
ok("other tenant sees none of them", r.rows[0].n === 0, r);
r = await as(A, "select count(*)::int n from product_lots");
ok("lots are visible to the tenant", r.rows[0].n > 0 && (await as(B, "select count(*)::int n from product_lots")).rows[0].n === 0);

done();
