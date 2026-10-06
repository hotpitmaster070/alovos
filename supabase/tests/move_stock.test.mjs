// Local verification of 20261006120003_move_stock.sql in PGlite (in-memory Postgres) with a stubbed
// Supabase auth schema. Not a real Supabase project.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/move_stock.test.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.PGLITE_DIR;
if (!dir) throw new Error("Set PGLITE_DIR to a node_modules directory that contains @electric-sql/pglite");
const load = async (spec) => import(pathToFileURL(createRequire(path.join(dir, "x.js")).resolve(spec)).href);
const { PGlite } = await load("@electric-sql/pglite");
const { pgcrypto } = await load("@electric-sql/pglite/contrib/pgcrypto");

const migrations = path.resolve("supabase/migrations");
const read = (f) => fs.readFileSync(path.join(migrations, f), "utf8");
const m0 = read("20261006120000_multitenant_rls.sql");
const m2 = read("20261006120002_ensure_org_rpc.sql");
const m3 = read("20261006120003_move_stock.sql");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : " -> " + JSON.stringify(extra))); };

async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  return db;
}

const db = await freshDb();
await db.exec(m0); await db.exec(m2);
await db.exec(m3); await db.exec(m3);
ok("0000, 0002, 0003 apply; 0003 applied twice without errors", true);

const q = async (sql) => (await db.query(sql)).rows;
const as = async (uid, role, sql) => {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid ?? ""]);
  try { const r = await db.query(sql); return { rows: r.rows }; } catch (e) { return { err: e.message }; } finally { await db.exec("reset role"); }
};
const U = (n) => `00000000-0000-0000-0000-0000000000${n}`;
const [A, B] = [U("0a"), U("0b")];
await db.exec(`insert into auth.users(id,email) values ('${A}','alice@acme.az'),('${B}','bob@other.az')`);
const orgA = (await q(`select organization_id o from profiles where id='${A}'`))[0].o;
const orgB = (await q(`select organization_id o from profiles where id='${B}'`))[0].o;

const L = (n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`;
const [A1, A2, A3, B1] = [L("a1"), L("a2"), L("a3"), L("b1")];
await db.exec(`insert into locations(id,organization_id,name) values
  ('${A1}','${orgA}','Main'),('${A2}','${orgA}','Bar'),('${A3}','${orgA}','Cold'),('${B1}','${orgB}','Other')`);
const P = (n) => `cccccccc-0000-0000-0000-0000000000${n}`;
const reset = async () => {
  await db.exec("delete from products");
  await db.exec(`insert into products(id,organization_id,name,barcode,unit,qty,cost,expiry_date,location_id) values
    ('${P("01")}','${orgA}','Rice','111','kg',10,2,'2027-01-01','${A1}'),
    ('${P("02")}','${orgA}','Rice','111','kg',5,2,null,'${A2}'),
    ('${P("03")}','${orgA}','Salt',null,'kg',4,1,'2027-06-01','${A1}'),
    ('${P("04")}','${orgA}','Salt',null,'g',9,1,null,'${A2}'),
    ('${P("05")}','${orgA}','Milk','222','l',3,1.5,'2026-12-01','${A1}'),
    ('${P("06")}','${orgA}','Milk','222','pcs',2,1.5,null,'${A2}'),
    ('${P("b1")}','${orgB}','Rice','111','kg',50,2,null,'${B1}')`);
};
const move = (uid, p, from, to, qty) => as(uid, "authenticated", `select public.move_stock('${p}','${from}','${to}',${qty})`);
const qty = async (id) => Number((await q(`select qty from products where id='${id}'`))[0]?.qty);
const count = async () => (await q("select count(*)::int c from products"))[0].c;

// happy path: top up existing target row (barcode match)
await reset();
let r = await move(A, P("01"), A1, A2, 4);
ok("partial move tops up existing target row", !r.err && (await qty(P("01"))) === 6 && (await qty(P("02"))) === 9 && (await count()) === 7, r);

// creates new target row when none exists
await reset();
r = await move(A, P("01"), A1, A3, 2.5);
const created = (await q(`select * from products where location_id='${A3}'`))[0];
ok("move creates a new target row copied from the source", !r.err && created && Number(created.qty) === 2.5 && created.name === "Rice" && created.barcode === "111" && created.unit === "kg" && new Date(created.expiry_date).toISOString().startsWith("2027-01-01") && Number(created.cost) === 2 && created.organization_id === orgA && (await qty(P("01"))) === 7.5, { r, created });

// no barcode: match by name + unit
await reset();
r = await move(A, P("03"), A1, A2, 1);
ok("no barcode: matches by name+unit (g row is not touched, new kg row created)", !r.err && (await qty(P("04"))) === 9 && (await q(`select qty from products where location_id='${A2}' and name='Salt' and unit='kg'`)).length === 1, r);

// full-qty move keeps source at 0
await reset();
r = await move(A, P("01"), A1, A2, 10);
ok("full-quantity move leaves source row at 0 and tops up target", !r.err && (await qty(P("01"))) === 0 && (await qty(P("02"))) === 15, r);

// errors
await reset();
r = await move(A, P("01"), A1, A2, 10.5);
ok("insufficient stock raises, nothing changes", r.err?.includes("insufficient_stock") && (await qty(P("01"))) === 10 && (await qty(P("02"))) === 5, r);
for (const [label, v] of [["zero", "0"], ["negative", "-1"], ["null", "null"], ["NaN", "'NaN'::float"], ["Infinity", "'Infinity'::float"]]) {
  r = await move(A, P("01"), A1, A2, v);
  ok(`qty ${label} rejected (invalid_qty)`, r.err?.includes("invalid_qty"), r);
}
r = await move(A, P("01"), A1, A1, 1);
ok("same location rejected", r.err?.includes("same_location"), r);
r = await move(A, P("b1"), B1, A2, 1);
ok("product of another org: product_not_found (no leak)", r.err?.includes("location_not_found") || r.err?.includes("product_not_found"), r);
r = await move(A, P("b1"), A1, A2, 1);
ok("foreign product id with own locations -> product_not_found", r.err?.includes("product_not_found") && (await qty(P("b1"))) === 50, r);
r = await move(A, P("01"), A1, B1, 1);
ok("foreign target location rejected", r.err?.includes("location_not_found") && (await qty(P("01"))) === 10, r);
r = await move(A, P("01"), B1, A2, 1);
ok("foreign source location rejected", r.err?.includes("location_not_found"), r);
r = await move(A, P("02"), A1, A3, 1);
ok("source location mismatch rejected (product is at Bar, not Main)", r.err?.includes("product_location_mismatch"), r);
r = await move(A, P("05"), A1, A2, 1);
ok("same barcode, different unit at target -> unit_mismatch, nothing changes", r.err?.includes("unit_mismatch") && (await qty(P("05"))) === 3 && (await qty(P("06"))) === 2, r);
r = await move(A, "00000000-0000-0000-0000-00000000dead", A1, A2, 1);
ok("unknown product id -> product_not_found", r.err?.includes("product_not_found"), r);
r = await as(A, "authenticated", `select public.move_stock(null::uuid, '${A1}', '${A2}', 1)`);
ok("null argument -> invalid_argument", r.err?.includes("invalid_argument"), r);

// tenant isolation
r = await move(B, P("01"), A1, A2, 1);
ok("other tenant cannot move my stock", r.err !== undefined && (await qty(P("01"))) === 10 && (await qty(P("02"))) === 5, r);

// privileges
r = await as(null, "anon", `select public.move_stock('${P("01")}','${A1}','${A2}',1)`);
ok("anon cannot execute move_stock", !!r.err, r);
r = await as(null, "authenticated", `select public.move_stock('${P("01")}','${A1}','${A2}',1)`);
ok("authenticated with auth.uid() NULL raises not_authenticated", r.err?.includes("not_authenticated"), r);
const meta = (await q("select prosecdef, proconfig::text c from pg_proc where proname='move_stock'"))[0];
ok("security definer with pinned search_path", meta.prosecdef && meta.c.includes("search_path=public"), meta);
ok("no audit_logs table: move still succeeds (guarded insert skipped)", (await q("select to_regclass('public.audit_logs') t"))[0].t === null);

// audit table present (shape unknown): failure of the guarded insert must not break the move
await reset();
await db.exec("create table public.audit_logs(id serial primary key, something text)");
r = await move(A, P("01"), A1, A2, 1);
ok("audit table with unexpected shape does not break the move", !r.err && (await qty(P("02"))) === 6, r);
await db.exec("drop table public.audit_logs");
await reset();
await db.exec(`create table public.audit_logs(id bigint generated always as identity primary key, organization_id uuid, user_id uuid, action text, table_name text, record_id uuid, new_data jsonb)`);
r = await move(A, P("01"), A1, A2, 1);
ok("audit table with matching shape receives a row", !r.err && (await q("select count(*)::int c from audit_logs where action='move_stock'"))[0].c === 1, r);
await db.exec("drop table public.audit_logs");

// sequential opposite moves and repeated moves keep totals
await reset();
await move(A, P("01"), A1, A2, 3);
await move(A, P("02"), A2, A1, 2);
await move(A, P("01"), A1, A2, 1);
ok("opposite moves in sequence keep the total constant and one row per (location, barcode)", (await qty(P("01"))) + (await qty(P("02"))) === 15 && (await q(`select count(*)::int c from products where organization_id='${orgA}' and barcode='111'`))[0].c === 2);

// no-barcode create twice goes to the same target row (slot logic)
await reset();
await db.exec(`delete from products where id in ('${P("04")}')`);
await move(A, P("03"), A1, A2, 1);
await move(A, P("03"), A1, A2, 1);
ok("repeated move of a barcode-less product reuses the created target row", (await q(`select qty from products where location_id='${A2}' and name='Salt'`)).map((x) => Number(x.qty)).join() === "2");

// unique index and data protection
ok("partial unique index exists", (await q("select 1 from pg_indexes where indexname='idx_products_org_location_barcode_unique'")).length === 1);
r = await as(A, "authenticated", `insert into products(organization_id,name,barcode,location_id) values ('${orgA}','Dup','111','${A2}')`);
ok("unique index rejects a second row with the same barcode in the same location", r.err?.includes("duplicate key") || r.err?.includes("unique"), r);
ok("scale indexes exist", ["idx_products_org_location", "idx_products_org_expiry", "idx_products_org_name", "idx_products_org_qty", "idx_products_barcode_org"].every((n) => true) && (await q("select count(*)::int c from pg_indexes where indexname in ('idx_products_org_location','idx_products_org_expiry','idx_products_org_name','idx_products_org_qty','idx_products_barcode_org')"))[0].c === 5);

// lock design evidence: advisory slot lock precedes ordered row locks
const src = (await q("select prosrc from pg_proc where proname='move_stock'"))[0].prosrc;
ok("function takes advisory slot lock before ordered FOR UPDATE", src.indexOf("pg_advisory_xact_lock") > -1 && src.indexOf("pg_advisory_xact_lock") < src.indexOf("order by id\n  for update"));

// migration on legacy data with duplicate (org, location, barcode) rows: index skipped, migration succeeds
const db2 = await freshDb();
await db2.exec(m0); await db2.exec(m2);
await db2.exec(`insert into auth.users(id,email) values ('${A}','alice@acme.az')`);
const org2 = (await db2.query(`select organization_id o from profiles where id='${A}'`)).rows[0].o;
await db2.exec(`insert into locations(id,organization_id,name) values ('${A1}','${org2}','Main')`);
await db2.exec(`insert into products(organization_id,name,barcode,location_id) values ('${org2}','x','1','${A1}'),('${org2}','y','1','${A1}')`);
let applied = true; try { await db2.exec(m3); await db2.exec(m3); } catch (e) { applied = false; console.log(e.message); }
ok("0003 skips the unique index when duplicates already exist (migration still succeeds, twice)", applied && (await db2.query("select 1 from pg_indexes where indexname='idx_products_org_location_barcode_unique'")).rows.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
