// 20261017_cleanup_empty_tenants.sql: empty abandoned tenants created 7..30 days ago are deleted (once in
// the migration, then by cleanup_empty_tenants()); tenants with products, suppliers, members, pending
// invitations, fresh or old ones are kept. Signup with an invitation token creates no tenant.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/cleanup_empty_tenants.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const CLEANUP = "20261017_cleanup_empty_tenants.sql";
const { ok, done } = reporter();
const { q, as, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < CLEANUP));
ok(`migrations before ${CLEANUP} apply`, !failure, failure);

const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0]?.t ?? null;
const tenantCount = async () => (await q("select count(*)::int n from tenants"))[0].n;
const exists = async (tenant) => (await q(`select count(*)::int n from tenants where id='${tenant}'`))[0].n === 1;
const age = (tenant, days) => q(`update tenants set created_at = now() - interval '${days} days' where id='${tenant}'`);

const OWNER = U("0a");
await q(`insert into auth.users(id,email) values ('${OWNER}','owner@acme.az')`);
const tOwner = await tenantOf(OWNER);
await as(OWNER, "insert into products(name, unit) values ('Un','kg')");

let phone = 501000000;
const invite = async (role = "chef") => (await as(OWNER, `select token from public.create_invitation('+994${phone++}', '${role}')`)).rows[0].token;

/** A user signs up (own tenant, old flow), optionally fills it, then accepts an invitation and leaves it. */
async function abandoned(n, days, fill = null) {
  const uid = U(n);
  await q(`insert into auth.users(id,email) values ('${uid}','u${n}@x.az')`);
  const tenant = await tenantOf(uid);
  if (fill) {
    const r = await as(uid, fill.replaceAll(":tenant", tenant));
    ok(`setup ${n}: ${fill.split(" ")[2]}`, !r.err, r);
  }
  const r = await as(uid, "select public.accept_invitation($1) t", [await invite()]);
  if (r.rows?.[0]?.t !== tOwner) ok(`setup ${n}: user moved to the owner's tenant`, false, r);
  await age(tenant, days);
  return { uid, tenant };
}

// ---- before the migration
const empty10 = await abandoned("10", 10);
const withProduct = await abandoned("11", 10, "insert into products(name, unit) values ('Düyü','kg')");
const withSupplier = await abandoned("12", 10, "insert into suppliers(tenant_id, name) values (':tenant','Bazar')");
const old45 = await abandoned("13", 45);
const fresh3 = await abandoned("14", 3);
const pending = await abandoned("15", 10);
// An unused invitation of its own tenant, created by its former owner while still there.
await q(`insert into invitations(tenant_id, phone, role, expires_at) values ('${pending.tenant}','+994509999999','chef', now() + interval '3 days')`);
const KEEPER = U("16");
await q(`insert into auth.users(id,email) values ('${KEEPER}','keeper@x.az')`);
const tKeeper = await tenantOf(KEEPER);
await age(tKeeper, 20);

failure = await applyTwice(migrationFiles.filter((f) => f >= CLEANUP));
ok(`${CLEANUP} and later apply, each twice`, !failure, failure);

ok("empty tenant from 10 days ago without products is deleted", !(await exists(empty10.tenant)));
ok("…with its memberships, branches, storage places and settings", (await q(`select
  (select count(*) from memberships where tenant_id='${empty10.tenant}') +
  (select count(*) from branches where tenant_id='${empty10.tenant}') +
  (select count(*) from storage_locations where tenant_id='${empty10.tenant}') +
  (select count(*) from tenant_settings where tenant_id='${empty10.tenant}') n`))[0].n == 0);
ok("tenant with a product is kept", await exists(withProduct.tenant));
ok("tenant with a supplier is kept", await exists(withSupplier.tenant));
ok("tenant older than 30 days is kept", await exists(old45.tenant));
ok("tenant younger than 7 days is kept", await exists(fresh3.tenant));
ok("tenant with a pending invitation is kept", await exists(pending.tenant));
ok("tenant somebody works in is kept even when empty", await exists(tKeeper));
ok("tenant with data and members is kept", await exists(tOwner));
let r = await as(empty10.uid, "select public.current_tenant_id() t, public.current_member_role() role");
ok("the user of the deleted tenant still works in the owner's tenant", r.rows[0].t === tOwner && r.rows[0].role === "chef", r);

// ---- daily function, same rules
await age(fresh3.tenant, 8);
r = await q("select public.cleanup_empty_tenants() n");
ok("cleanup_empty_tenants() deletes it once it is older than 7 days and returns the count", r[0].n === 1 && !(await exists(fresh3.tenant)), r);
await q(`update invitations set expires_at = now() - interval '1 minute' where tenant_id='${pending.tenant}'`);
r = await q("select public.cleanup_empty_tenants() n");
ok("an expired invitation no longer keeps a tenant", r[0].n === 1 && !(await exists(pending.tenant)), r);
r = await q("select public.cleanup_empty_tenants() n");
ok("a second run deletes nothing", r[0].n === 0, r);
ok("old, product and supplier tenants survive the daily run", (await exists(old45.tenant)) && (await exists(withProduct.tenant)) && (await exists(withSupplier.tenant)));

// A new table with a foreign key to tenants counts without changing the migration.
await q("create table public.cleanup_probe (id serial primary key, tenant_id uuid references public.tenants(id))");
const probe = await abandoned("17", 10);
await q(`insert into public.cleanup_probe(tenant_id) values ('${probe.tenant}')`);
r = await q("select public.cleanup_empty_tenants() n");
ok("a row in a new table referencing tenants keeps the tenant", r[0].n === 0 && (await exists(probe.tenant)), r);
await q("drop table public.cleanup_probe");
r = await q("select public.cleanup_empty_tenants() n");
ok("…and without it the tenant is deleted", r[0].n === 1 && !(await exists(probe.tenant)), r);

// ---- privileges
r = await as(OWNER, "select public.cleanup_empty_tenants()");
ok("clients cannot run cleanup_empty_tenants()", /permission denied/.test(r.err ?? ""), r);
r = await as(OWNER, "select public.delete_empty_tenants(interval '0 seconds', interval '100 years')");
ok("clients cannot call the delete helper", /permission denied/.test(r.err ?? ""), r);
ok("only the service role may execute it", (await q("select has_function_privilege('service_role', 'public.cleanup_empty_tenants()', 'execute') ok"))[0].ok);

// ---- signup with an invitation token creates no tenant
const token = await invite();
const NEWCHEF = U("20");
let before = await tenantCount();
await q(`insert into auth.users(id,email,raw_user_meta_data) values ('${NEWCHEF}','new.chef@acme.az', jsonb_build_object('invite_token', $1::text))`, [token]);
ok("signup with a valid token creates no tenant", (await tenantCount()) === before);
r = await as(NEWCHEF, "select public.current_tenant_id() t, public.current_member_role() role");
ok("new user works in the inviting tenant as chef", r.rows[0].t === tOwner && r.rows[0].role === "chef", r);
ok("new user has exactly one membership", (await q(`select count(*)::int n from memberships where user_id='${NEWCHEF}'`))[0].n === 1);
const inv = (await q("select used_at, used_by from invitations where token=$1", [token]))[0];
ok("invitation is marked used by the new user", inv.used_at && inv.used_by === NEWCHEF, inv);
r = await as(NEWCHEF, "select state from public.invitation_preview($1)", [token]);
ok("the new user sees the link as joined", r.rows[0].state === "joined", r);
r = await as(KEEPER, "select state from public.invitation_preview($1)", [token]);
ok("anyone else sees it as used", r.rows[0].state === "used", r);
r = await as(KEEPER, "select public.accept_invitation($1)", [token]);
ok("the token cannot be used again", /invitation_used/.test(r.err ?? ""), r);
r = await as(NEWCHEF, "select public.ensure_my_tenant() t");
ok("ensure_my_tenant keeps the invited tenant (no new one)", r.rows?.[0]?.t === tOwner && (await tenantCount()) === before, r);

// Used, expired or unknown token at signup: own tenant as before, the signup does not fail.
const expiredToken = await invite();
await q(`update invitations set expires_at = now() - interval '1 minute' where token='${expiredToken}'`);
before = await tenantCount();
const [U1, U2, U3] = [U("21"), U("22"), U("23")];
await q(`insert into auth.users(id,email,raw_user_meta_data) values
  ('${U1}','u21@x.az', jsonb_build_object('invite_token', $1::text)),
  ('${U2}','u22@x.az', jsonb_build_object('invite_token', $2::text)),
  ('${U3}','u23@x.az', '{"invite_token":"nope"}')`, [token, expiredToken]);
ok("used / expired / unknown token -> own tenant as before", (await tenantCount()) === before + 3);
r = await as(U2, "select public.current_member_role() role");
ok("…as owner of it", r.rows[0].role === "owner", r);
ok("the expired invitation stays unused", (await q("select used_at from invitations where token=$1", [expiredToken]))[0].used_at === null);
r = await as(U3, "select public.accept_invitation($1) t", [await invite("owner")]);
ok("signed-in accept still joins with the invited role", r.rows?.[0]?.t === tOwner && (await as(U3, "select public.current_member_role() r")).rows[0].r === "owner", r);

done();
