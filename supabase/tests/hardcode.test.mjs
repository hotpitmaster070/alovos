// 20261010_cleanup_and_hardcode.sql on legacy data, and the app reading its thresholds from tenant_settings:
// the compiled getSettings() runs against PGlite as a real user, and expiry, low stock and day bounds
// follow the stored values, not code constants.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/hardcode.test.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const CLEANUP = "20261010_cleanup_and_hardcode.sql";
const before = migrationFiles.filter((f) => f < CLEANUP);

const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(before);
if (failure) console.log(failure);
ok(`${before.length} migrations before ${CLEANUP} apply`, !failure);

// ---- legacy data: a balance only in products.quantity/qty, a lot in product_stocks, a legacy location
const [A, C] = [U("0a"), U("0c")];
await q(`insert into auth.users(id,email) values ('${A}','alice@acme.az'),('${C}','cook@acme.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
const storeA = (await q(`select id from storage_locations where tenant_id='${tA}' order by name limit 1`))[0].id;
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;

let r = await as(A, `insert into products(tenant_id, name, cost, unit, expiry_date) values ('${tA}','Milk',1.5,'l','2027-01-31') returning id`);
const milk = r.rows?.[0]?.id;
r = await as(A, `insert into products(tenant_id, name, cost, unit) values ('${tA}','Rice',2,'kg') returning id`);
const rice = r.rows?.[0]?.id;
ok("seed products", milk && rice, r);
await q(`update products set quantity = 4, qty = 4 where id = '${milk}'`);
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
  values ('${tA}','${rice}','${branchA}','${storeA}',3,'prihod',2,'kg')`);
ok("seed rice lot", !r.err, r);
await q(`insert into locations(tenant_id, name) values ('${tA}','Bar')`);

r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
ok("owner adds a cook", !r.err, r);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
r = await as(C, `insert into wastage_logs(tenant_id, product_id, location_id, quantity, reason) values ('${tA}','${rice}','${storeA}',1,'spoiled') returning id`);
const waste = r.rows?.[0]?.id;
ok("cook logs waste", !r.err && waste, r);

for (const run of [1, 2]) {
  failure = await apply([CLEANUP]);
  if (failure) console.log(failure);
  ok(`${CLEANUP} applies (run ${run})`, !failure);
}

// ---- one stock model
ok("public.locations dropped", (await q("select to_regclass('public.locations') t"))[0].t === null);
ok("products.qty and products.quantity dropped", (await q("select count(*)::int c from information_schema.columns where table_schema='public' and table_name='products' and column_name in ('qty','quantity')"))[0].c === 0);
const milkLots = await q(`select quantity::float q, cost_per_unit::float c, expiry_date::text e from product_stocks where product_id='${milk}'`);
ok("legacy balance became a lot (quantity, cost, expiry kept)", milkLots.length === 1 && milkLots[0].q === 4 && milkLots[0].c === 1.5 && milkLots[0].e === "2027-01-31", milkLots);
ok("and the movement log explains it", (await q(`select count(*)::int c from stock_movements where product_id='${milk}' and movement_type='prihod' and reason='legacy products balance'`))[0].c === 1);
ok("existing lots untouched", Number((await q(`select sum(quantity) s from product_stocks where product_id='${rice}'`))[0].s) === 3);

// ---- waste value hidden from the cook
r = await as(C, "select cost from wastage_logs");
ok("cook cannot read wastage_logs.cost", /permission denied/.test(r.err ?? ""), r);
r = await as(C, "select id, quantity, reason from wastage_logs");
ok("cook still reads the other columns", !r.err && r.rows.length === 1, r);
r = await as(C, "select count(*)::int c from wastage_costs");
ok("cook sees no waste values", !r.err && r.rows[0].c === 0, r);
r = await as(A, "select cost::float c from wastage_costs");
ok("owner reads the waste value through wastage_costs", !r.err && r.rows.length === 1 && r.rows[0].c === 2, r);
ok("memberships(tenant_id, user_id) index", (await q("select count(*)::int c from pg_indexes where tablename='memberships' and indexdef ilike '%(tenant_id, user_id)%'"))[0].c >= 1);

// ---- tenant_settings stays usable for code without defaults
r = await as(A, "update tenant_settings set timezone = 'Mars/Olympus'");
ok("unknown timezone rejected", /invalid_timezone/.test(r.err ?? ""), r);
r = await as(A, "update tenant_settings set expiry_warn_days = 40, expiry_critical_days = 30");
ok("red threshold above yellow rejected", /expiry_order/.test(r.err ?? ""), r);
r = await as(C, "update tenant_settings set low_stock_default = 1");
ok("cook cannot change thresholds", !r.err && r.affected === 0, r);
r = await as(A, `update tenant_settings set timezone = 'America/New_York', expiry_warn_days = 3, expiry_critical_days = 10,
  low_stock_default = 2, currency = 'USD', currency_symbol = '$'`);
ok("owner changes thresholds", !r.err && r.affected === 1, r);

// ---- the app code, compiled, against this database (it reads columns of the later migrations too)
const later = migrationFiles.filter((f) => f > CLEANUP);
failure = await apply(later);
if (failure) console.log(failure);
ok(`${later.length} later migrations apply`, !failure);
execSync("npx tsc -p scripts/tsconfig.test.json", { stdio: "inherit" });
const OUT = path.resolve(".test-out");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.join(OUT, request.slice(2)) : request, ...rest);
};
const require = createRequire(import.meta.url);
const { getSettings } = require(path.join(OUT, "lib/tenant-settings/getSettings.js"));
const { currencyOf, formatMoney } = require(path.join(OUT, "lib/money.js"));
const { getExpiryInfo } = require(path.join(OUT, "lib/expiry.js"));
const status = require(path.join(OUT, "lib/anbar/catalog-status.js"));
const time = require(path.join(OUT, "lib/tenant-settings/time.js"));

/** The slice of supabase-js getSettings() uses, executed as `uid` so RLS applies. */
function clientAs(uid) {
  return {
    from(table) {
      const state = { columns: "*", filters: [], single: false };
      const builder = {
        select(columns) { state.columns = columns; return builder; },
        eq(column, value) { state.filters.push([column, value]); return builder; },
        maybeSingle() { state.single = true; return builder; },
        then(resolveFn, rejectFn) {
          const where = state.filters.map(([column], i) => `${column} = $${i + 1}`).join(" and ");
          return as(uid, `select ${state.columns} from public.${table}${where ? ` where ${where}` : ""}`, state.filters.map(([, v]) => v))
            .then((res) => (res.err ? { data: null, error: { message: res.err } } : { data: state.single ? (res.rows[0] ?? null) : res.rows, error: null }))
            .then(resolveFn, rejectFn);
        },
      };
      return builder;
    },
  };
}

const settings = await getSettings({ client: clientAs(C), tenantId: tA });
ok("getSettings reads the tenant's row (as the cook)", settings.timezone === "America/New_York" && settings.expiryWarnDays === 3 && settings.expiryCriticalDays === 10 && settings.lowStockDefault === 2, settings);
const money = formatMoney(1234.5, currencyOf(settings));
ok("money from settings: USD, en-US format filled by the migration", settings.currency === "USD" && settings.locale === "en-US" && money === "$1,234.50", { settings, money });

const now = new Date("2026-10-06T10:00:00Z");
const level = (date) => getExpiryInfo(date, now, settings).level;
ok("expiry: 2 days left is red (under expiry_warn_days = 3)", level("2026-10-08") === "red");
ok("expiry: 5 days left is yellow (the old constant 7 would say red)", level("2026-10-11") === "yellow");
ok("expiry: 12 days left is green (the old constant 30 would say yellow)", level("2026-10-18") === "green");
ok("catalog dot follows the same thresholds", status.expiryStatus("2026-10-11", now, settings).dot === "yellow");
ok("low stock: low_stock_default = 2 when the product has no min_stock (old constant 5)", status.isLowStock(1, null, settings) && !status.isLowStock(3, null, settings));
ok("low stock: the product's min_stock wins", status.isLowStock(8, 10, settings) && !status.isLowStock(1, 0, settings));
ok("getLowStockThreshold", status.getLowStockThreshold(settings) === 2 && status.getLowStockThreshold(settings, 7) === 7);

const day = time.todayBounds(settings.timezone, now);
ok("today in the tenant's zone (EDT, UTC-4)", day.start === "2026-10-06T04:00:00.000Z" && day.end === "2026-10-07T04:00:00.000Z", day);
const fallBack = time.dateBounds("2026-11-01", settings.timezone);
ok("DST end day lasts 25 hours", fallBack.start === "2026-11-01T04:00:00.000Z" && fallBack.end === "2026-11-02T05:00:00.000Z", fallBack);
const baku = time.dateBounds("2026-10-06", "Asia/Baku");
ok("Asia/Baku day bounds", baku.start === "2026-10-05T20:00:00.000Z" && baku.end === "2026-10-06T20:00:00.000Z", baku);

let missing = null;
try { await getSettings({ client: clientAs(A), tenantId: "99999999-9999-4999-8999-999999999999" }); }
catch (e) { missing = e; }
ok("no settings row: an error, not a code default", missing?.name === "TenantSettingsError", missing?.message);

// ---- no hardcoded thresholds left in the app
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? files(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
});
const sources = ["app", "lib", "components"].flatMap(files);
const banned = /LOW_STOCK_THRESHOLD|BAKU_OFFSET|EXPIRY_RED_DAYS|EXPIRY_YELLOW_DAYS|\+04:00|organization_id|from\("locations"\)|products\.qty/;
const offenders = sources.filter((file) => banned.test(fs.readFileSync(file, "utf8")));
ok("no hardcoded thresholds, Baku offset or legacy model in app/lib/components", offenders.length === 0, offenders);
const dictionary = fs.readFileSync("lib/i18n/dictionaries.ts", "utf8");
ok("no currency in the dictionaries", !/currency:\s*"/.test(dictionary));

done();
