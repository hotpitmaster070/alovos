// create_wastage_with_movement (20261012_wastage_atomic.sql): the waste log, the movement and the lot
// decrease commit together or not at all; tenant and role are checked by the database. Also the
// read functions of 20261013_paged_reads.sql: pages, counts and totals over the full data.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/atomic_wastage.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles);
if (failure) console.log(failure);
ok(`all ${migrationFiles.length} migrations apply`, !failure);
for (const file of ["20261012_wastage_atomic.sql", "20261013_paged_reads.sql"]) {
  failure = await apply([file]);
  ok(`${file} applies again`, !failure, failure);
}

// ---- tenant A: owner, cook, staff; tenant B: owner
const [A, C, S, B] = [U("0a"), U("0c"), U("05"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','alice@acme.az'),('${C}','cook@acme.az'),('${S}','staff@acme.az'),('${B}','bob@other.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB] = [await tenantOf(A), await tenantOf(B)];
for (const [uid, role] of [[C, "cook"], [S, "staff"]]) {
  const r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  ok(`owner adds a ${role}`, !r.err, r);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const storeA = (await q(`select id from storage_locations where tenant_id='${tA}' order by name limit 1`))[0].id;
const storeB = (await q(`select id from storage_locations where tenant_id='${tB}' limit 1`))[0].id;

let r = await as(A, `insert into products(tenant_id, name, cost, unit) values ('${tA}','Milk',2,'l'),('${tA}','Rice',1,'kg') returning id, name`);
const milk = r.rows.find((row) => row.name === "Milk").id;
const rice = r.rows.find((row) => row.name === "Rice").id;
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date) values
  ('${tA}','${milk}','${branchA}','${storeA}',2,'prihod',3,'l','2026-12-01'),
  ('${tA}','${milk}','${branchA}','${storeA}',5,'prihod',2,'l','2026-11-01')`);
ok("seed two milk lots", !r.err, r);

const counts = async () => ({
  logs: (await q("select count(*)::int c from wastage_logs"))[0].c,
  moves: (await q("select count(*)::int c from stock_movements where movement_type='waste'"))[0].c,
});
const waste = (uid, product, quantity, reason, location = storeA, photo = null) =>
  as(uid, "select public.create_wastage_with_movement($1, $2, $3, $4, $5) id", [product, quantity, reason, location, photo]);

// ---- no lot: the cook's write-off fails and leaves nothing
r = await waste(C, rice, 1, "spoiled");
ok("cook: product without a lot -> insufficient_stock", /insufficient_stock/.test(r.err ?? ""), r);
ok("and wastage_logs has 0 rows", (await counts()).logs === 0);
ok("and no waste movement", (await counts()).moves === 0);

// ---- more than the lots hold
r = await waste(C, milk, 8, "spoiled");
ok("more than the stock -> insufficient_stock", /insufficient_stock/.test(r.err ?? ""), r);
ok("nothing written", (await counts()).logs === 0 && (await counts()).moves === 0);

// ---- success: log + movement + FEFO decrease in one call
r = await waste(C, milk, 6, "expired");
const logId = r.rows?.[0]?.id;
ok("cook writes off 6 l", !r.err && logId, r);
ok("one log and one movement", (await counts()).logs === 1 && (await counts()).moves === 1);
const lots = await q(`select expiry_date::text e, quantity::float q from product_stocks where product_id='${milk}' order by expiry_date`);
ok("earliest expiry taken first (5 from 2026-11-01, 1 from 2026-12-01)", lots[0].q === 0 && lots[1].q === 1, lots);
const log = (await q(`select tenant_id, branch_id, location_id, user_id, reason, quantity::float qty, cost::float cost from wastage_logs where id='${logId}'`))[0];
ok("log stamped with tenant, branch, location, user", log.tenant_id === tA && log.branch_id === branchA && log.location_id === storeA && log.user_id === C, log);
ok("log valued FEFO by the database (5*2 + 1*3)", log.cost === 13, log);
const move = (await q("select tenant_id, branch_id, from_location_id, quantity::float qty, reason, user_id from stock_movements where movement_type='waste'"))[0];
ok("movement matches the log", move.tenant_id === tA && move.branch_id === branchA && move.from_location_id === storeA && move.qty === 6 && move.reason === "expired" && move.user_id === C, move);

// ---- validation and access
r = await waste(C, milk, 0, "spoiled");
ok("zero quantity -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await waste(C, milk, 1, "lost");
ok("unknown reason -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await waste(C, milk, 1, "theft");
ok("theft without a photo -> photo_required", /photo_required/.test(r.err ?? ""), r);
r = await waste(C, milk, 1, "theft", storeA, `${tB}/x.jpg`);
ok("photo outside the tenant folder -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await waste(C, milk, 1, "theft", storeA, `${tA}/missing.jpg`);
ok("photo that was not uploaded -> invalid_input", /invalid_input/.test(r.err ?? ""), r);
r = await waste(B, milk, 1, "spoiled", storeB);
ok("other tenant's product -> product_not_found", /product_not_found/.test(r.err ?? ""), r);
r = await waste(C, milk, 1, "spoiled", storeB);
ok("other tenant's location -> location_not_found", /location_not_found/.test(r.err ?? ""), r);
r = await waste(S, milk, 1, "spoiled");
ok("staff member -> forbidden", /forbidden/.test(r.err ?? ""), r);
r = await as("", "select public.create_wastage_with_movement($1, 1, 'spoiled', $2)", [milk, storeA]);
ok("no user -> rejected", !!r.err, r);
ok("failed calls wrote nothing", (await counts()).logs === 1 && (await counts()).moves === 1);

// ---- the only way in
r = await as(C, `insert into wastage_logs(tenant_id, product_id, location_id, quantity, reason) values ('${tA}','${milk}','${storeA}',1,'spoiled')`);
ok("direct insert into wastage_logs denied", /permission denied/.test(r.err ?? ""), r);
r = await as(A, `update wastage_logs set quantity = 1 where id='${logId}'`);
ok("direct update of wastage_logs denied", /permission denied/.test(r.err ?? ""), r);
r = await as(C, `delete from wastage_logs where id='${logId}'`);
ok("cook still cannot delete a log", !!r.err || r.affected === 0, r);

// ---- theft with a photo; cleanup of an unused upload
r = await as(C, `insert into storage.objects(bucket_id, name) values ('wastage-photos','${tA}/used.jpg'),('wastage-photos','${tA}/orphan.jpg')`);
ok("cook uploads two photos", !r.err, r);
r = await waste(C, milk, 1, "theft", storeA, `${tA}/used.jpg`);
ok("theft with an uploaded photo", !r.err && r.rows?.[0]?.id, r);
r = await as(C, `delete from storage.objects where name='${tA}/used.jpg'`);
ok("cook cannot delete a photo a log uses", !r.err && r.affected === 0, r);
r = await as(C, `delete from storage.objects where name='${tA}/orphan.jpg'`);
ok("cook deletes own unused upload (failed write-off cleanup)", !r.err && r.affected === 1, r);
r = await as(S, `insert into storage.objects(bucket_id, name) values ('wastage-photos','${tA}/staff.jpg')`);
r = await as(C, `delete from storage.objects where name='${tA}/staff.jpg'`);
ok("cook cannot delete someone else's upload", !r.err && r.affected === 0, r);

// ---- paged reads over the full data
const many = Array.from({ length: 120 }, (_, i) => `('${tA}','Item ${String(i).padStart(3, "0")}','pcs','${i % 2 ? "Dry" : "Cold"}')`).join(",");
r = await as(A, `insert into products(tenant_id, name, unit, category) values ${many}`);
ok("seed 120 more products", !r.err, r);
const page = (uid, params) =>
  as(uid, "select id, stock::float stock, total_count::int total from public.catalog_page(p_branch_id => $1, p_search => $2, p_category => $3, p_low_only => $4, p_offset => $5, p_limit => $6)",
    [params.branch ?? null, params.search ?? null, params.category ?? null, params.low ?? false, params.offset ?? 0, params.limit ?? 50]);
r = await page(C, {});
ok("catalog page 1: 50 rows of 122", !r.err && r.rows.length === 50 && r.rows[0].total === 122, r.err ?? r.rows[0]);
r = await page(C, { offset: 100 });
ok("catalog page 3: the last 22", !r.err && r.rows.length === 22 && r.rows[0].total === 122, r.err);
r = await page(C, { category: "Dry" });
ok("category filter counts the whole tenant", !r.err && r.rows[0].total === 60, r.err ?? r.rows[0]);
r = await page(C, { search: "item 11" });
ok("search by name", !r.err && r.rows.length === 10 && r.rows[0].total === 10, r.err ?? r.rows.length);
r = await page(C, { search: "%" });
ok("wildcards in the search match literally", !r.err && r.rows.length === 0, r);
r = await page(C, { low: true, limit: 500 });
ok("low stock filter in the database (every product is below the default 5)", !r.err && r.rows[0].total === 122, r.err ?? r.rows[0]);
await q("update tenant_settings set low_stock_default = 0");
r = await page(C, { low: true });
ok("low_stock_default = 0: nothing tracked, nothing low", !r.err && r.rows.length === 0, r);
r = await page(B, {});
ok("other tenant sees only its own products", !r.err && r.rows.length === 0, r);
r = await as(C, "select count(*)::int c from public.catalog_categories()");
ok("categories", !r.err && r.rows[0].c === 2, r);

r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date) values
  ('${tA}','${rice}','${branchA}','${storeA}',3,'prihod',1.5,'kg','2027-01-01'),
  ('${tA}','${rice}','${branchA}','${storeA}',1,'prihod',1.5,'kg','2027-02-01')`);
ok("seed two rice lots", !r.err, r);
r = await as(C, "select product_name, quantity::float q, total_count::int total from public.stock_lines_page(p_location_id => $1)", [storeA]);
ok("stock lines: lots summed per product and place, empty balances hidden", !r.err && r.rows.length === 1 && r.rows[0].product_name === "Rice" && r.rows[0].q === 4 && r.rows[0].total === 1, r);
r = await as(C, "select count(*)::int c from public.stock_lines_page(p_search => 'milk')");
ok("stock lines search", !r.err && r.rows[0].c === 0, r);
r = await as(A, "select public.stock_value()::float v");
ok("owner sees the stock value", !r.err && r.rows[0].v === 6, r);
r = await as(C, "select public.stock_value() v");
ok("cook sees no stock value", !r.err && r.rows[0].v === null, r);
r = await as(A, "select public.wastage_total(now() - interval '1 day', now() + interval '1 day')::float v");
ok("owner: today's waste total over all logs", !r.err && r.rows[0].v === 16, r);
r = await as(C, "select public.wastage_total(now() - interval '1 day', now() + interval '1 day') v");
ok("cook: no waste total", !r.err && r.rows[0].v === null, r);

done();
