// Applies every migration in PGlite (in-memory Postgres) with stubbed Supabase auth and storage
// schemas, seeds data the pre-20261009 way, then checks 20261009_unify_tenant.sql: no data lost,
// organization model gone, memberships, tenant_settings, cost columns and cook restrictions.
// Not a real Supabase project.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/unify_tenant.test.mjs
import { freshDb, migrationFiles, readMigration as read, reporter, userId as U } from "./pglite.mjs";

const UNIFY = "20261009_unify_tenant.sql";
const STORAGE = "20261008020000_dynamic_storage_locations.sql";
const before = migrationFiles.filter((f) => f < STORAGE);

const { ok, done } = reporter();
const { db, q, as, apply } = await freshDb();

let failure = await apply(before);
if (failure) console.log(failure);
ok(`${before.length} migrations before ${STORAGE} apply`, !failure);

// ---- data created the old way: organization_id + tenant_id, current_org_id() policies
const [A, B, C, D] = [U("0a"), U("0b"), U("0c"), U("0d")];
await db.exec(`insert into auth.users(id,email) values ('${A}','alice@acme.az'),('${B}','bob@other.az'),('${C}','cook@acme.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB, tC] = [await tenantOf(A), await tenantOf(B), await tenantOf(C)];
ok("signup created organizations, tenants and profiles with the same id", (await q(`select count(*)::int c from organizations where id in ('${tA}','${tB}')`))[0].c === 2);
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const storeA = (await q(`select id from storage_locations where tenant_id='${tA}'`))[0].id;

let r = await as(A, `insert into products(organization_id, tenant_id, name, cost, unit) values ('${tA}','${tA}','Milk',1.75,'l') returning id`);
ok("legacy product insert as owner", !r.err, r);
const milk = r.rows?.[0]?.id;
await db.exec(`insert into products(organization_id, tenant_id, name) values ('${tB}','${tB}','Bread')`);
await db.exec(`insert into locations(organization_id, name) values ('${tA}','Bar')`);
await db.exec(`insert into suppliers(organization_id, tenant_id, name) values ('${tA}','${tA}','Agro')`);
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
  values ('${tA}','${milk}','${branchA}','${storeA}',5,'prihod',2,'l')`);
ok("legacy receipt as owner", !r.err, r);
await db.exec(`insert into kitchen_tasks(tenant_id, title) values ('${tA}','Prep')`);
await db.exec(`insert into storage.buckets(id,name,public) values ('invoices','invoices',false) on conflict do nothing`);
r = await as(A, `insert into storage.objects(bucket_id, name) values ('invoices','${tA}/inv.pdf')`);
ok("legacy invoice upload under the organization folder", !r.err, r);
await db.exec(`update tenants set settings = '{"currency":"USD","currency_symbol":"$","language":"en"}' where id='${tA}'`);

const snapshot = async () => ({
  products: (await q("select count(*)::int c from products"))[0].c,
  milkTenant: (await q(`select tenant_id t from products where id='${milk}'`))[0].t,
  stock: Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where tenant_id='${tA}'`))[0].s),
  locations: (await q("select count(*)::int c from locations"))[0].c,
  suppliers: (await q(`select count(*)::int c from suppliers where tenant_id='${tA}'`))[0].c,
  tenants: (await q("select count(*)::int c from tenants"))[0].c,
});

failure = await apply([STORAGE]);
if (failure) console.log(failure);
ok(`${STORAGE} applies on legacy data`, !failure);
const pre = await snapshot();

// ---- the migration under test, twice
for (const run of [1, 2]) {
  failure = await apply([UNIFY]);
  if (failure) console.log(failure);
  ok(`${UNIFY} applies (run ${run})`, !failure);
}
const post = await snapshot();
ok("no rows lost: products, stock, legacy locations, suppliers, tenants", JSON.stringify(pre) === JSON.stringify(post), { pre, post });
ok("tenant_id kept the former organization id", post.milkTenant === tA);

ok("organizations dropped", (await q("select to_regclass('public.organizations') t"))[0].t === null);
ok("no organization_id column left", (await q("select count(*)::int c from information_schema.columns where table_schema='public' and column_name='organization_id'"))[0].c === 0);
ok("only current_tenant_id() remains", (await q("select string_agg(proname, ',' order by proname) n from pg_proc where proname in ('current_org_id','my_tenant_id','current_tenant_id','ensure_my_organization','move_stock')"))[0].n === "current_tenant_id");
ok("no policy references the old helpers", (await q("select count(*)::int c from pg_policies where coalesce(qual,'') || coalesce(with_check,'') ~ '(current_org_id|my_tenant_id|organization_id)'"))[0].c === 0);
ok("products.tenant_id and locations.tenant_id are not null", (await q("select count(*)::int c from information_schema.columns where table_schema='public' and table_name in ('products','locations') and column_name='tenant_id' and is_nullable='NO'"))[0].c === 2);

ok("existing users became owners", (await q(`select count(*)::int c from memberships where role='owner' and (user_id, tenant_id) in (('${A}','${tA}'),('${B}','${tB}'))`))[0].c === 2);
const settingsA = (await q(`select * from tenant_settings where tenant_id='${tA}'`))[0];
ok("tenant_settings copied from tenants.settings", settingsA.currency === "USD" && settingsA.currency_symbol === "$" && settingsA.language === "en" && settingsA.timezone === "Asia/Baku" && settingsA.expiry_warn_days === 7 && settingsA.expiry_critical_days === 30 && settingsA.low_stock_default === 5);
ok("tenant without settings gets the defaults", (await q(`select currency from tenant_settings where tenant_id='${tB}'`))[0].currency === "AZN");

// ---- owner: tenant isolation and costs through the views only
r = await as(A, "select id, name from products");
ok("owner reads own products only", !r.err && r.rows.length === 1 && r.rows[0].id === milk, r);
r = await as(A, "select cost from products");
ok("cost column is not readable directly", /permission denied/.test(r.err ?? ""), r);
r = await as(A, "select cost_per_unit from product_stocks");
ok("cost_per_unit is not readable directly", /permission denied/.test(r.err ?? ""), r);
r = await as(A, "select cost from product_costs");
ok("owner reads price through product_costs", !r.err && r.rows.length === 1 && Number(r.rows[0].cost) === 1.75, r);
r = await as(A, "select cost_per_unit from product_stock_costs");
ok("owner reads lot cost through product_stock_costs", !r.err && r.rows.length === 1 && Number(r.rows[0].cost_per_unit) === 2, r);
r = await as(B, `select count(*)::int c from product_costs where id='${milk}' or tenant_id='${tA}'`);
ok("cost views are tenant-scoped", !r.err && r.rows[0].c === 0, r);
r = await as(A, `select name from storage.objects where bucket_id='invoices'`);
ok("bucket policy now uses the tenant folder", !r.err && r.rows.length === 1, r);
r = await as(A, `insert into branches(tenant_id, name) values ('${tA}','Second')`);
ok("owner creates a branch (enforce_tenant_id on branches)", !r.err, r);
r = await as(B, `select name from storage.objects where bucket_id='invoices'`);
ok("other tenant cannot see the file", !r.err && r.rows.length === 0, r);

// ---- memberships: owner adds a cook; nobody edits their own row
r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
ok("owner adds a cook", !r.err, r);
r = await as(A, `update memberships set role='chef' where user_id='${A}'`);
ok("owner cannot change their own membership", !r.err && r.affected === 0, r);
r = await as(A, `insert into memberships(user_id, tenant_id, role, branch_ids) values ('${D}','${tA}','staff', array['${U("ff")}'::uuid])`);
ok("foreign or unknown branch ids rejected", !!r.err, r);
await db.exec(`update profiles set tenant_id='${tA}' where id='${C}'`);

r = await as(C, "select public.current_tenant_id() t, public.current_member_role() r");
ok("cook resolves to the owner's tenant", r.rows?.[0]?.t === tA && r.rows?.[0]?.r === "cook", r);
r = await as(C, "select id, name from products");
ok("cook reads products", !r.err && r.rows.length === 1, r);
r = await as(C, "select count(*)::int c from product_costs");
ok("cook gets no prices", !r.err && r.rows[0].c === 0, r);
r = await as(C, "select count(*)::int c from product_stock_costs");
ok("cook gets no lot costs", !r.err && r.rows[0].c === 0, r);
r = await as(C, "delete from kitchen_tasks");
ok("cook cannot delete", !r.err && r.affected === 0 && (await q(`select count(*)::int c from kitchen_tasks where tenant_id='${tA}'`))[0].c === 1, r);
r = await as(C, `update tenant_settings set currency='EUR'`);
ok("cook cannot change tenant settings", !r.err && r.affected === 0, r);
r = await as(C, `insert into memberships(user_id, tenant_id, role) values ('${B}','${tA}','owner')`);
ok("cook cannot add members", !!r.err, r);
r = await as(C, `insert into wastage_logs(tenant_id, product_id, location_id, quantity, reason) values ('${tA}','${milk}','${storeA}',1.5,'spoiled') returning id`);
ok("cook logs waste", !r.err, r);
ok("waste value computed by the database from the FEFO lot", Number((await q("select cost from wastage_logs"))[0].cost) === 3);
r = await as(A, "delete from kitchen_tasks");
ok("owner can delete", !r.err && r.affected === 1, r);

// ---- removed member loses the tenant; recovery gives them their own
r = await as(A, `delete from memberships where user_id='${C}'`);
ok("owner removes the cook", !r.err && r.affected === 1, r);
r = await as(C, "select public.current_tenant_id() t");
ok("removed member has no tenant", r.rows?.[0]?.t === null, r);
r = await as(C, "select public.ensure_my_tenant() t");
const own = r.rows?.[0]?.t;
ok("ensure_my_tenant gives a removed member a new tenant", !r.err && own && own !== tA && own !== tC, r);
r = await as(C, "select count(*)::int c from products");
ok("and nothing of the old tenant is visible", !r.err && r.rows[0].c === 0, r);

// ---- new signup
await db.exec(`insert into auth.users(id,email) values ('${D}','dana@new.az')`);
const tD = await tenantOf(D);
ok("signup: tenant, owner membership, settings, branch with default storage", (await q(`select
  (select count(*) from memberships where user_id='${D}' and tenant_id='${tD}' and role='owner')::int m,
  (select count(*) from tenant_settings where tenant_id='${tD}')::int s,
  (select count(*) from storage_locations where tenant_id='${tD}')::int l`))[0].m === 1);
r = await as(D, `insert into products(tenant_id, name, cost) values ('${tD}','Salt',0.5) returning id`);
ok("new owner inserts a product with a price (no organization_id needed)", !r.err, r);

done();
