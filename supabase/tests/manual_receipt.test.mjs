// Manual goods receipt (/app/anbar/qebul): find a product by name or ALO code through catalog_page,
// receive it with receive_stock_with_lot_fx (explicit production date + shelf life), and check the
// LOT-YYYYMMDD-NNNN number from batch_daily_counters, the stock in the catalog and tenant isolation.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/manual_receipt.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

const failure = await apply(migrationFiles);
ok("all migrations apply", !failure, failure);

const near = (a, b) => a !== null && a !== undefined && Math.abs(Number(a) - b) < 1e-6;
const [A, C, M] = [U("7a"), U("7c"), U("7d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@a.io'),('${C}','cook@a.io'),('${M}','owner@m.io')`);
const tenant = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const [tA, tM] = [await tenant(A), await tenant(M)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id = '${C}'`);
await q(`update tenant_settings set timezone = 'Pacific/Kiritimati' where tenant_id = '${tA}'`);

const place = (await q(`select id from storage_locations where tenant_id='${tA}' and is_active order by number limit 1`))[0];
const lamb = (await as(A, "insert into products(name, unit) values ('Baranina', 'kg') returning id, internal_code")).rows[0];
ok("product gets an internal code from the database", typeof lamb.internal_code === "string" && lamb.internal_code !== "", lamb);
await as(M, "insert into products(name, unit) values ('Baranina M', 'kg')");

const search = async (uid, text) =>
  (await as(uid, "select id from public.catalog_page(null, $1, null, false, null, 0, 20)", [text])).rows?.map((row) => row.id) ?? [];
ok("found by name (ILIKE, any case)", (await search(C, "baran")).includes(lamb.id));
ok("found by internal code", (await search(C, lamb.internal_code.toLowerCase())).includes(lamb.id));
ok("other tenant's product not found", (await search(C, "Baranina M")).length === 0);
ok("wildcards match literally", (await search(C, "%")).length === 0);

const today = (await q(`select (now() at time zone 'Pacific/Kiritimati')::date::text d`))[0].d;
const receive = (uid, qty, price, storage = place.id) =>
  as(uid, "select * from public.receive_stock_with_lot_fx($1, $2, $3, $4, null, null, $5::date, 5, false)", [lamb.id, qty, storage, price, today]);

let r = await receive(C, 20, 15);
const lot = r.rows?.[0];
const day = today.replaceAll("-", "");
ok("cook receives 20 kg", !r.err && lot && near(lot.quantity, 20), r);
ok("lot number LOT-YYYYMMDD-NNNN in the tenant's time zone", new RegExp(`^LOT-${day}-\\d{4}$`).test(lot?.lot_number ?? ""), lot?.lot_number);
const dates = (await q(`select production_date::text made, expiry_date::text expires, ($2::date + 5)::text expected
  from product_lots where id = $1`, [lot?.id, today]))[0];
ok("production date = tenant today, expiry = + shelf life days", dates?.made === today && dates.expires === dates.expected, dates);

const stock = async (uid) =>
  (await as(uid, "select stock from public.catalog_page(null, null, null, false, $1, 0, 1)", [lamb.id])).rows?.[0]?.stock;
ok("catalog stock = 20", near(await stock(A), 20));
const sums = (await q(`select
  (select sum(quantity) from product_lots where product_id = '${lamb.id}') lots,
  (select sum(quantity) from product_stocks where product_id = '${lamb.id}') stocks`))[0];
ok("sum(product_lots) = sum(product_stocks) = 20", near(sums.lots, 20) && near(sums.stocks, 20), sums);

r = await as(A, "select cost_per_unit from product_lot_costs where lot_id = $1", [lot.id]);
ok("owner reads the lot price", !r.err && near(r.rows[0]?.cost_per_unit, 15), r);
r = await as(C, "select cost_per_unit from product_lot_costs where lot_id = $1", [lot.id]);
ok("cook does not read lot prices", r.err || r.rows.length === 0, r);

r = await receive(A, 5, 16);
const next = r.rows?.[0]?.lot_number ?? "";
ok("next lot of the day takes the next counter value", Number(next.slice(-4)) === Number(lot.lot_number.slice(-4)) + 1, [lot.lot_number, next]);
const counter = (await q(`select counter from batch_daily_counters where tenant_id = '${tA}' and date = $1::date`, [today]))[0];
ok("batch_daily_counters holds the tenant's day", counter && counter.counter >= 2, counter);
ok("catalog stock = 25", near(await stock(A), 25));

r = await as(M, "select * from public.receive_stock_with_lot_fx($1, 1, $2, 1, null, null, null, null, false)", [lamb.id, place.id]);
ok("other tenant cannot receive into this tenant", /product_not_found|location_not_found/.test(r.err ?? ""), r);
r = await receive(C, 0, 15);
ok("zero quantity rejected", /invalid_input/.test(r.err ?? ""), r);

done();
