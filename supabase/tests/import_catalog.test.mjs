// 20261028000700_import_catalog.sql: catalog import in one transaction. Dry run writes nothing; a valid
// file creates products, 'prihod' movements (product_stocks), lots and lot costs; any bad row or a
// failure while writing leaves the database untouched; foreign branches and cooks are refused.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/import_catalog.test.mjs
import fs from "node:fs";
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261028000700_import_catalog.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= FILE));
  ok(`${FILE} and later apply (run ${run})`, !failure, failure);
}

const near = (a, b) => a !== null && a !== undefined && Math.abs(Number(a) - b) < 1e-6;
const [A, C, M] = [U("8a"), U("8c"), U("8d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@a.io'),('${C}','cook@a.io'),('${M}','owner@m.io')`);
const tenant = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const [tA, tM] = [await tenant(A), await tenant(M)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id = '${C}'`);

const places = await q(`select id, branch_id, code from storage_locations where tenant_id='${tA}' and is_active order by type, number`);
const [place, other] = places;
const branch = place.branch_id;
const foreignBranch = (await q(`select id from branches where tenant_id='${tM}' limit 1`))[0].id;

// tests/fixtures/catalog-100.csv: plain comma-separated, no quoting.
const lines = fs.readFileSync("tests/fixtures/catalog-100.csv", "utf8").trim().split("\n");
const header = lines[0].split(",");
const number = (value) => (value === "" ? null : Number(value));
const toRow = (cells, line) => {
  const v = Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""]));
  return {
    row: line, name: v.name, unit: v.unit, barcode: v.barcode || null, category: v.category || null,
    price: number(v.price), shelf_life_days: number(v.shelf_life_days), min_stock: number(v.min_stock),
    initial_stock: number(v.initial_stock), location: v.location || null, expiry_date: v.expiry_date || null,
  };
};
const fixture = lines.slice(1).map((line, i) => toRow(line.split(","), i + 2));
ok("fixture has 100 rows, 60 with stock", fixture.length === 100 && fixture.filter((r) => r.initial_stock > 0).length === 60);

const run = (uid, rows, { dry = false, branchId = branch, locationId = place.id } = {}) =>
  as(uid, "select public.import_catalog($1, $2, $3::jsonb, $4) r", [branchId, locationId, JSON.stringify(rows), dry]);
const productCount = async () => Number((await q(`select count(*) n from products where tenant_id='${tA}'`))[0].n);
const before = await productCount();

// ---- dry run
let r = await run(A, fixture, { dry: true });
let res = r.rows?.[0]?.r;
ok("dry run: ok, 100 rows, 60 stocked, nothing written", !r.err && res?.ok === true && res.dry_run === true && res.rows === 100 && res.stocked === 60 && (await productCount()) === before, r.err ?? res);

// ---- import 100
const started = Date.now();
r = await run(A, fixture);
res = r.rows?.[0]?.r;
ok("import of 100 rows succeeds", !r.err && res?.ok === true && res.rows === 100 && res.stocked === 60, r.err ?? res);
console.log(`      100 rows imported in ${Date.now() - started} ms`);
ok("100 products created", (await productCount()) === before + 100);

const created = await q(`select id, name, internal_code, unit, barcode, cost from products where tenant_id='${tA}' and name like 'Test product %' order by name`);
ok("internal codes from the database sequence, unique", created.every((p) => /^ALO-\d+$/.test(p.internal_code)) && new Set(created.map((p) => p.internal_code)).size === 100);
ok("units and barcodes stored", created.find((p) => p.name === "Test product 002")?.barcode === "4600000000002" && created.find((p) => p.name === "Test product 005")?.unit === "box");

const stock = await q(`select p.name, sum(ps.quantity) qty from product_stocks ps join products p on p.id = ps.product_id
  where p.tenant_id='${tA}' and p.name like 'Test product %' group by p.name`);
const byName = Object.fromEntries(stock.map((s) => [s.name, Number(s.qty)]));
ok("initial stock lands in product_stocks", stock.length === 60 && fixture.filter((f) => f.initial_stock > 0).every((f) => near(byName[f.name], f.initial_stock)), stock.length);
const lots = await q(`select l.lot_number, l.quantity, c.cost_per_unit from product_lots l
  join products p on p.id = l.product_id left join product_lot_costs c on c.lot_id = l.id
  where p.tenant_id='${tA}' and p.name like 'Test product %'`);
ok("one lot (label) per stocked row, LOT-YYYYMMDD-NNNN", lots.length === 60 && lots.every((l) => /^LOT-\d{8}-\d{4,}$/.test(l.lot_number)), lots.slice(0, 2));
ok("lot costs carry the imported price", lots.every((l) => l.cost_per_unit !== null));
const moves = Number((await q(`select count(*) n from stock_movements m join products p on p.id = m.product_id
  where p.tenant_id='${tA}' and p.name like 'Test product %' and m.movement_type = 'prihod'`))[0].n);
ok("one 'prihod' movement per stocked row", moves === 60, moves);

// ---- duplicates
const fresh = (name, extra = {}) => ({ row: 2, name, unit: "kg", barcode: null, category: null, price: null, shelf_life_days: null, min_stock: null, initial_stock: null, location: null, expiry_date: null, ...extra });
const count0 = await productCount();
r = await run(A, [fresh("Brand new", { barcode: "4600000000002" })]);
res = r.rows?.[0]?.r;
ok("barcode already in the catalog is caught", res?.ok === false && res.errors?.[0]?.field === "barcode" && res.errors[0].code === "exists", res);
r = await run(A, [fresh("Dup one", { barcode: "999" }), fresh("Dup two", { row: 3, barcode: "999" })]);
res = r.rows?.[0]?.r;
ok("duplicate barcode inside the file is caught on its row", res?.ok === false && res.errors?.length === 1 && res.errors[0].row === 3 && res.errors[0].code === "duplicate_in_file", res);
r = await run(A, [fresh("test PRODUCT 001")]);
ok("existing product name is caught", r.rows?.[0]?.r?.errors?.[0]?.code === "exists", r.rows?.[0]?.r);

// ---- all or nothing
r = await run(A, [fresh("Good one"), fresh("Bad unit", { row: 3, unit: "bucket" }), fresh("Good two", { row: 4 })]);
res = r.rows?.[0]?.r;
ok("one bad row: errors returned, nothing written", res?.ok === false && res.errors.length === 1 && res.errors[0].code === "invalid_unit" && (await productCount()) === count0, res);
await q(`create function test_boom() returns trigger language plpgsql as $$ begin
  if new.name = 'Boom' then raise exception 'boom'; end if; return new; end $$`);
await q(`create trigger test_boom before insert on products for each row execute function test_boom()`);
r = await run(A, [fresh("Before boom", { initial_stock: 2 }), fresh("Boom", { row: 3 })]);
ok("failure while writing aborts the whole import", /boom/.test(r.err ?? "") && (await productCount()) === count0 &&
  (await q(`select count(*) n from products where name = 'Before boom'`))[0].n == 0, r.err);
await q(`drop trigger test_boom on products`);
await q(`drop function test_boom()`);

// ---- isolation and roles
r = await run(M, [fresh("Foreign")], { branchId: branch, locationId: null });
ok("other tenant cannot use this branch", /branch_not_found/.test(r.err ?? ""), r);
r = await run(A, [fresh("Foreign branch")], { branchId: foreignBranch, locationId: null });
ok("a foreign branch is refused", /branch_not_found/.test(r.err ?? ""), r);
r = await run(A, [fresh("Wrong place")], { branchId: branch, locationId: (await q(`select id from storage_locations where tenant_id='${tM}' limit 1`))[0].id });
ok("a foreign place is refused", /location_not_found/.test(r.err ?? ""), r);
r = await run(C, [fresh("Cook import")]);
ok("cooks cannot import", /forbidden/.test(r.err ?? ""), r);
r = await run(A, [fresh("No branch", { initial_stock: 1 })], { branchId: null, locationId: null });
ok("stock without a branch asks for one", r.rows?.[0]?.r?.errors?.[0]?.code === "branch_required", r.rows?.[0]?.r);

// ---- place by code, expiry date
const today = (await q(`select public.tenant_today('${tA}')::text d`))[0].d;
const inTen = (await q(`select ($1::date + 10)::text d`, [today]))[0].d;
r = await run(A, [
  fresh("Placed by code", { initial_stock: 4, location: other.code.toLowerCase(), expiry_date: inTen }),
  fresh("Old date", { row: 3, initial_stock: 1, expiry_date: "2001-01-01" }),
]);
res = r.rows?.[0]?.r;
ok("expired date is refused", res?.ok === false && res.errors.length === 1 && res.errors[0].code === "expiry_past", res);
r = await run(A, [fresh("Placed by code", { initial_stock: 4, location: other.code.toLowerCase(), expiry_date: inTen })]);
const placed = (await q(`select ps.location_id, ps.expiry_date::text e, l.expiry_date::text le from product_stocks ps
  join products p on p.id = ps.product_id join product_lots l on l.product_id = p.id where p.name = 'Placed by code'`))[0];
ok("place matched by code, expiry from the file", r.rows?.[0]?.r?.ok === true && placed?.location_id === other.id && placed.e === inTen && placed.le === inTen, placed ?? r);
r = await run(A, [fresh("Ghost place", { initial_stock: 1, location: "NOWHERE-9" })]);
ok("unknown place is reported", r.rows?.[0]?.r?.errors?.[0]?.code === "location_not_found", r.rows?.[0]?.r);

// ---- units: database list = lib/anbar/types.ts UNITS
const tsUnits = /UNITS = \[([^\]]+)\]/.exec(fs.readFileSync("lib/anbar/types.ts", "utf8"))[1].match(/"(\w+)"/g).map((u) => u.slice(1, -1));
const dbUnits = (await as(A, "select public.catalog_units() u")).rows[0].u;
ok("catalog_units() matches UNITS", JSON.stringify(dbUnits) === JSON.stringify(tsUnits), { dbUnits, tsUnits });

// ---- 247 rows
const big = Array.from({ length: 247 }, (_, i) => fresh(`Bulk ${String(i).padStart(3, "0")}`, { row: i + 2, initial_stock: (i % 5) + 1, price: 3 }));
const t0 = Date.now();
r = await run(A, big);
const ms = Date.now() - t0;
ok(`247 rows with stock imported (${ms} ms in PGlite)`, r.rows?.[0]?.r?.ok === true && r.rows[0].r.rows === 247, r.err ?? r.rows?.[0]?.r);

done();
