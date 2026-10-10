// 20261006120000_multitenant_rls.sql on a fresh database and on one whose tables predate it
// without qty / organization_id (create table if not exists skips them).
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/multitenant_rls.test.mjs
import { freshDb, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261006120000_multitenant_rls.sql";
const INDEXES = [
  "idx_organizations_id_unique",
  "idx_profiles_id_unique",
  "idx_profiles_organization_id",
  "idx_locations_organization_id",
  "idx_products_organization_id",
  "idx_products_location_id",
  "idx_products_barcode_org",
  "idx_suppliers_organization_id",
  "idx_invoices_organization_id",
  "idx_invoices_supplier_id",
];
const { ok, done } = reporter();

async function inspect(q) {
  const indexes = (await q(`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => r.indexname);
  const policies = (await q(`select tablename || '.' || policyname p from pg_policies where schemaname = 'public'`)).map((r) => r.p);
  const constraint = (await q(`select 1 from pg_constraint where conname = 'products_qty_non_negative'`)).length;
  const rls = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity`)).map((r) => r.relname);
  const fn = (await q(`select 1 from pg_proc where proname = 'current_org_id'`)).length;
  return { indexes, policies, constraint, rls, fn };
}

// --- 1. Fresh database: everything is created. --------------------------------------------
{
  const { q, as, apply } = await freshDb();
  ok("fresh: applies (run 1)", (await apply([FILE])) === null);
  ok("fresh: applies (run 2)", (await apply([FILE])) === null);
  const s = await inspect(q);
  ok("fresh: all 10 indexes", INDEXES.every((name) => s.indexes.includes(name)), s.indexes);
  ok("fresh: qty constraint", s.constraint === 1);
  ok("fresh: RLS on all six tables", s.rls.length === 6, s.rls);
  ok("fresh: 23 policies (2 + 3 + 4 x 4)", s.policies.length === 2 + 3 + 16, s.policies);
  const negative = await q(`select 1`).then(async () => {
    try {
      await q(`insert into public.organizations(id, name) values ('${U(90)}', 'X')`);
      await q(`insert into public.products(organization_id, name, qty) values ('${U(90)}', 'bad', -1)`);
      return "inserted";
    } catch (e) {
      return e.message;
    }
  });
  ok("fresh: negative qty rejected", /products_qty_non_negative/.test(negative), negative);

  await q(`insert into auth.users(id, email) values ('${U(11)}', 'a@x.az'), ('${U(12)}', 'b@x.az')`);
  const own = await as(U(11), `select name from public.organizations`);
  ok("fresh: signup creates the org, a user sees only their own", own.rows?.length === 1 && own.rows[0].name === "a", own);
  const org = (await as(U(11), `select organization_id from public.profiles`)).rows?.[0]?.organization_id;
  const add = await as(U(11), `insert into public.products(organization_id, name) values ('${org}', 'Toyuq')`);
  const other = await as(U(12), `select * from public.products`);
  ok("fresh: products isolated by organization", !add.err && other.rows?.length === 0, { add, other });
}

// --- 2. Old tables without qty / organization_id: no error, the dependent parts are skipped. --
{
  const { q, as, apply } = await freshDb();
  await q(`create table public.profiles (id uuid primary key, email text)`);
  await q(`create table public.products (id uuid primary key default gen_random_uuid(), name text)`);
  ok("legacy: applies (run 1)", (await apply([FILE])) === null);
  ok("legacy: applies (run 2)", (await apply([FILE])) === null);
  const s = await inspect(q);
  ok("legacy: no qty constraint", s.constraint === 0);
  const skipped = ["idx_profiles_organization_id", "idx_products_organization_id", "idx_products_location_id", "idx_products_barcode_org"];
  ok("legacy: indexes on missing columns skipped", skipped.every((name) => !s.indexes.includes(name)), s.indexes);
  ok(
    "legacy: the other indexes created",
    INDEXES.filter((name) => !skipped.includes(name)).every((name) => s.indexes.includes(name)),
    s.indexes,
  );
  ok("legacy: no products policies", !s.policies.some((p) => p.startsWith("products.")), s.policies);
  ok(
    "legacy: profiles limited to the own row, other tables policed",
    ["profiles.profiles_select", "profiles.profiles_insert", "profiles.profiles_update", "locations.locations_select", "invoices.invoices_delete"].every(
      (p) => s.policies.includes(p),
    ),
    s.policies,
  );
  ok("legacy: RLS still on all six tables", s.rls.length === 6, s.rls);
  ok("legacy: current_org_id exists for later migrations", s.fn === 1);

  await q(`insert into public.profiles(id, email) values ('${U(21)}', 'own@x.az'), ('${U(22)}', 'other@x.az')`);
  const mine = await as(U(21), `select email from public.profiles`);
  ok("legacy: a user sees only their own profile", mine.rows?.length === 1 && mine.rows[0].email === "own@x.az", mine);
  const products = await as(U(21), `select * from public.products`);
  ok("legacy: products without a policy are closed", products.rows?.length === 0, products);
}

done();
