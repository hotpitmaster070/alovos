// 20261020_waste_photo_ai.sql: waste photos, the AI check as a paid add-on (reserve / record by the
// server with service_role only), monthly limits, owner review, plans and plan requests.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/waste_ai.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261020_waste_photo_ai.sql";
const { ok, done } = reporter();
const { db, q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= FILE));
  ok(`${FILE} applies (run ${run})`, !failure, failure);
}

// The server's service_role client (Supabase grants it schema usage).
await db.exec("grant usage on schema public to service_role");
const service = async (sql, params) => {
  await db.exec("set role service_role");
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { err: e.message };
  } finally {
    await db.exec("reset role");
  }
};

const [A, C, B] = [U("3a"), U("3c"), U("3b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB] = [await tenantOf(A), await tenantOf(B)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const store = (await q(`select id from storage_locations where tenant_id='${tA}' order by name limit 1`))[0].id;

// ---- plans: prices from the table, readable before sign-in
let r = await as("", "select code, price, currency, trial_days, ai_photos from billing_plans order by sort");
const plans = Object.fromEntries((r.rows ?? []).map((p) => [p.code, p]));
ok("anon reads the plans: base 79 AZN / 14 days, AI 19 AZN / 500 photos",
  Number(plans.base?.price) === 79 && plans.base.currency === "AZN" && plans.base.trial_days === 14 &&
  Number(plans.waste_ai?.price) === 19 && plans.waste_ai.ai_photos === 500, r);
r = await as(A, "update billing_plans set price = 1 where code = 'base'");
ok("owner cannot change prices", !!r.err || r.affected === 0, r);

// ---- defaults
r = await as(C, "select * from public.waste_ai_state()");
let state = r.rows?.[0];
ok("defaults: photos on, AI off, free plan 0/50", state && state.photo_enabled && !state.ai_enabled && state.plan === "free" &&
  state.used === 0 && state.ai_limit === 50 && Number(state.tolerance_percent) === 50, r);

// ---- clients cannot touch billing columns or verdicts
r = await as(A, `update tenant_settings set waste_ai_used_photos = 0, waste_ai_enabled = true where tenant_id='${tA}'`);
ok("owner cannot update AI counters directly", /permission denied/.test(r.err ?? ""), r);
r = await as(C, "select public.set_waste_photo_settings(true, true, null)");
ok("cook cannot switch AI on", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select public.set_waste_photo_settings(null, null, 0)");
ok("tolerance 0 rejected", /invalid_input/.test(r.err ?? ""), r);

// ---- a waste log with a photo
const milk = (await as(A, `insert into products(tenant_id, name, cost, unit) values ('${tA}','Milk',2,'l') returning id`)).rows[0].id;
await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date)
  values ('${tA}','${milk}','${branch}','${store}',100,'prihod',2,'l','2026-12-01')`);
let photoN = 0;
const wasteWithPhoto = async (qty = 1) => {
  const path = `${tA}/2026-10-09/p${++photoN}.jpg`;
  await as(C, `insert into storage.objects(bucket_id, name) values ('wastage-photos','${path}')`);
  const res = await as(C, "select public.create_wastage_with_movement($1, $2, 'spoiled', $3, $4) id", [milk, qty, store, path]);
  return res.rows?.[0]?.id;
};
const log = async (id) => (await q(`select * from wastage_logs where id='${id}'`))[0];

const first = await wasteWithPhoto(2);
let row = await log(first);
ok("photo saved, ai_status not_checked, storage path kept", row && row.ai_status === "not_checked" && row.photo_storage_path === row.photo_url, row);
r = await as(C, `select ai_status, ai_confidence, requires_owner_review, photo_storage_path from wastage_logs where id='${first}'`);
ok("cook reads the AI columns", !r.err && r.rows[0].ai_status === "not_checked", r);
r = await as(C, `update wastage_logs set ai_status = 'approved' where id='${first}'`);
ok("cook cannot approve a log", !!r.err, r);
r = await as(C, `select public.waste_ai_reserve('${tA}', '${first}')`);
ok("cook cannot reserve an AI check", /permission denied/.test(r.err ?? ""), r);
r = await as(C, `select public.waste_ai_record('${tA}', '${first}', 'approved', 99, '{}')`);
ok("cook cannot record a verdict", /permission denied/.test(r.err ?? ""), r);

// ---- AI off: no check, nothing counted
r = await service(`select public.waste_ai_reserve('${tA}', '${first}') x`);
ok("AI off -> not_checked, AI not called", r.rows?.[0]?.x.status === "not_checked", r);
ok("…counter stays 0", (await q(`select waste_ai_used_photos u from tenant_settings where tenant_id='${tA}'`))[0].u === 0);
ok("liters converted to kg only with a density: unknown -> null", r.rows?.[0]?.x.logged_kg === null, r);

// ---- owner switches AI on (free checks)
r = await as(A, "select public.set_waste_photo_settings(null, true, 40)");
ok("owner switches AI on", !r.err, r);
await as(A, `select public.set_product_economics('${milk}', 'raw', null, 1.03, null)`);
const second = await wasteWithPhoto(2);
r = await service(`select public.waste_ai_reserve('${tA}', '${second}') x`);
let reserved = r.rows?.[0]?.x;
ok("AI on -> pending, prompt data: 2 l = 2.06 kg, tolerance 40", reserved?.status === "pending" && Math.abs(reserved.logged_kg - 2.06) < 1e-9 &&
  Number(reserved.tolerance_percent) === 40 && reserved.photo_path.startsWith(`${tA}/`), r);
r = await service(`select public.waste_ai_reserve('${tA}', '${second}') x`);
ok("a log is reserved once", /invalid_input/.test(r.err ?? ""), r);
r = await service(`select (public.waste_ai_record('${tA}', '${second}', 'approved', 95, '{"detected":"milk","estimated_kg":2}')).ai_status s`);
row = await log(second);
ok("approved 95%", !r.err && row.ai_status === "approved" && Number(row.ai_confidence) === 95 && row.ai_checked_at && !row.requires_owner_review, { r, row });
r = await service(`select public.waste_ai_record('${tA}', '${second}', 'suspicious', 10, '{}')`);
ok("a verdict is recorded once", /invalid_input/.test(r.err ?? ""), r);

const third = await wasteWithPhoto(1);
await service(`select public.waste_ai_reserve('${tA}', '${third}')`);
await service(`select public.waste_ai_record('${tA}', '${third}', 'suspicious', 80, '{"estimated_kg":5}')`);
row = await log(third);
ok("suspicious -> owner review", row.ai_status === "suspicious" && row.requires_owner_review, row);
r = await as(C, "select * from public.waste_photo_summary()");
ok("cook cannot read the owner summary", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select * from public.waste_photo_summary()");
let sum = r.rows?.[0];
ok("summary today: 3 logs, 3 photos, 1 approved, 1 suspicious, 1 to review", sum && sum.logs === 3 && sum.with_photo === 3 &&
  sum.approved === 1 && sum.suspicious === 1 && sum.needs_review === 1, r);
r = await as(C, `select public.review_waste_photo('${third}')`);
ok("cook cannot clear a review", /forbidden/.test(r.err ?? ""), r);
r = await as(A, `select public.review_waste_photo('${third}')`);
row = await log(third);
ok("owner clears the review", !r.err && !row.requires_owner_review && row.reviewed_by === A, { r, row });

// ---- AI failure gives the check back
const fourth = await wasteWithPhoto(1);
await service(`select public.waste_ai_reserve('${tA}', '${fourth}')`);
const usedBefore = (await q(`select waste_ai_used_photos u from tenant_settings where tenant_id='${tA}'`))[0].u;
await service(`select public.waste_ai_record('${tA}', '${fourth}', 'not_checked', null, '{"error":"timeout"}')`);
const usedAfter = (await q(`select waste_ai_used_photos u from tenant_settings where tenant_id='${tA}'`))[0].u;
ok("AI failed -> not_checked, check returned", (await log(fourth)).ai_status === "not_checked" && usedAfter === usedBefore - 1, { usedBefore, usedAfter });

// ---- limit reached
await q(`update tenant_settings set waste_ai_used_photos = waste_ai_free_photos where tenant_id='${tA}'`);
const fifth = await wasteWithPhoto(1);
r = await service(`select public.waste_ai_reserve('${tA}', '${fifth}') x`);
ok("over the free limit -> limit_reached, AI not called", r.rows?.[0]?.x.status === "limit_reached" && (await log(fifth)).ai_status === "limit_reached", r);

// ---- new month: the counter starts again
await q(`update tenant_settings set waste_ai_period_start = date '2000-01-01' where tenant_id='${tA}'`);
state = (await as(A, "select * from public.waste_ai_state()")).rows[0];
ok("a new month counts from 0", state.used === 0, state);
const sixth = await wasteWithPhoto(1);
r = await service(`select public.waste_ai_reserve('${tA}', '${sixth}') x`);
ok("…and checks again", r.rows?.[0]?.x.status === "pending", r);

// ---- buying the AI package: request by the owner, activation by the platform
r = await as(C, "select public.request_billing_plan('waste_ai')");
ok("cook cannot request a plan", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select public.request_billing_plan('nope')");
ok("unknown plan rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select (public.request_billing_plan('waste_ai')).id");
const request = r.rows?.[0]?.id;
r = await as(A, "select (public.request_billing_plan('waste_ai')).id");
ok("one open request per plan", request && r.rows?.[0]?.id === request, r);
state = (await as(A, "select * from public.waste_ai_state()")).rows[0];
ok("state shows the requested plan, still free", state.requested_plan === "waste_ai" && state.plan === "free", state);
r = await as(A, `select public.activate_billing_request('${request}')`);
ok("owner cannot activate (pay) a plan", /permission denied/.test(r.err ?? ""), r);
r = await service(`select public.activate_billing_request('${request}')`);
state = (await as(A, "select * from public.waste_ai_state()")).rows[0];
ok("platform activates: AI on, plan waste_ai, 500 a month", !r.err && state.ai_enabled && state.plan === "waste_ai" && state.ai_limit === 500 && !state.requested_plan, { r, state });

// ---- other tenant
r = await as(B, "select * from public.waste_ai_state()");
ok("other tenant sees its own defaults", r.rows?.[0]?.used === 0 && r.rows[0].plan === "free", r);
r = await as(B, `select public.review_waste_photo('${third}')`);
ok("other tenant cannot touch our logs", /invalid_input/.test(r.err ?? ""), r);
r = await as(B, "select * from billing_requests");
ok("other tenant cannot see our requests", !r.err && r.rows.length === 0, r);
r = await service(`select public.waste_ai_reserve('${tB}', '${sixth}')`);
ok("reserve checks the tenant of the log", /invalid_input/.test(r.err ?? ""), r);

// ---- a log without a photo
r = await as(C, "select public.create_wastage_with_movement($1, 1, 'spoiled', $2, null) id", [milk, store]);
ok("no photo -> no ai_status", !r.err && (await log(r.rows[0].id)).ai_status === null, r);

done();
