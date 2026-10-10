// 20261029000400_auto_order_send.sql: drafts at auto_order_draft_time, the chef's send logged, at the deadline
// (auto_order_time) the system claims today's open drafts once, logs each delivery and puts undelivered ones
// back to draft; the day's log for the owner; one cron job running auto_order_tick().
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/auto_order_send.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const MIGRATION = "20261029000400_auto_order_send.sql";
const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
const sql = readMigration(MIGRATION);
ok("no other cron job and no product_lots / storage_locations touched",
  !/cron\.unschedule|cleanup_empty_tenants|notify_expiring|product_lots|storage_locations/i.test(sql));

const [A, CH, C, B] = [U("2a"), U("2b"), U("2c"), U("2d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${CH}','chef@acme.az'),('${C}','cook@acme.az'),('${B}','owner@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
for (const [uid, role] of [[CH, "chef"], [C, "cook"]]) {
  await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
await q(`update tenants set name = 'Acme Kitchen' where id='${tA}'`);
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;

// ---- settings
const settings = async (t = tA) =>
  (await q(`select auto_order_draft_time::text d, auto_order_time::text s, auto_send_if_not_confirmed a, auto_order_last_send l from tenant_settings where tenant_id='${t}'`))[0];
let st = await settings();
ok("defaults: draft 15:00, deadline 18:00, auto-send on", st.d === "15:00:00" && st.s === "18:00:00" && st.a === true && st.l === null, st);
let r = await as(A, `update tenant_settings set auto_order_draft_time = '14:00', auto_send_if_not_confirmed = false where tenant_id='${tA}'`);
ok("owner sets the draft time and auto-send", !r.err && r.affected === 1, r);
ok("chef cannot (row-level security)", (await as(CH, `update tenant_settings set auto_order_draft_time = '13:00' where tenant_id='${tA}'`)).affected === 0);
ok("the draft time may not be after the deadline",
  /auto_order_times_check/.test((await as(A, `update tenant_settings set auto_order_draft_time = '19:00' where tenant_id='${tA}'`)).err ?? ""));
ok("the send date is the database's",
  /permission denied/.test((await as(A, `update tenant_settings set auto_order_last_send = null where tenant_id='${tA}'`)).err ?? ""));

// ---- products below the restaurant's minimum (5), three suppliers: phone, email, nothing
const supplier = async (name, phone, email) =>
  (await sys(`insert into suppliers(tenant_id, name, phone, email) values ('${tA}','${name}',${phone ? `'${phone}'` : "null"},${email ? `'${email}'` : "null"}) returning id`)).rows[0].id;
const [s1, s2, s3] = [await supplier("Alfa", "+994501112233", null), await supplier("Beta", null, "beta@example.com"), await supplier("Gamma", null, null)];
const product = async (name, sup) =>
  (await sys(`insert into products(tenant_id, branch_id, name, unit, supplier_id, cost) values ('${tA}','${branch}','${name}','kg','${sup}', 3) returning id`)).rows[0].id;
const [p1, p2, p3] = [await product("Toyuq", s1), await product("Et", s2), await product("Duz", s3)];

// The restaurant's clock: a zone where shifting by 2 hours stays on the same day.
const zone = (await q(`select z from unnest(array['UTC','Asia/Tokyo','America/New_York']) z
  where extract(hour from now() at time zone z) between 3 and 20 limit 1`))[0].z;
const at = (hours) => `((now() at time zone '${zone}') + interval '${hours} hour')::time`;
const run = () => q("select tenant_id, branch_id, drafts from public.run_due_auto_orders()");
const claim = () => q("select * from public.claim_due_auto_order_sends()");

await q(`update tenant_settings set auto_order_enabled = true, auto_send_if_not_confirmed = true, auto_order_notify = 'whatsapp',
  timezone = '${zone}', auto_order_time = '23:59', auto_order_draft_time = ${at(1)} where tenant_id='${tA}'`);
ok("before the draft time: no drafts", (await run()).length === 0);
await q(`update tenant_settings set auto_order_draft_time = ${at(-2)} where tenant_id='${tA}'`);
let rows = await run();
ok("at the draft time: a draft per supplier", rows.length === 1 && rows[0].drafts === 3, rows);
const draftOf = async (sup) => (await q(`select id, status, sent_by from purchase_requests where tenant_id='${tA}' and supplier_id='${sup}'`))[0];
const [d1, d2, d3] = [await draftOf(s1), await draftOf(s2), await draftOf(s3)];
ok("before the deadline: nothing claimed", (await claim()).length === 0 && (await settings()).l === null);

// ---- the chef sends Alfa's draft himself
const logAs = (uid, id, status = "sent", channel = "whatsapp") =>
  as(uid, `select public.log_purchase_request_delivery('${id}', '${channel}', '${status}', 'wamid.1', null)`);
ok("a draft's delivery cannot be logged", /invalid_status/.test((await logAs(CH, d1.id)).err ?? ""));
r = await as(CH, `select public.send_purchase_request('${d1.id}')`);
ok("chef sends one draft", !r.err, r);
r = await logAs(CH, d1.id);
ok("chef logs its delivery", !r.err, r);
ok("cook may not log; another restaurant's owner does not find it",
  /forbidden/.test((await logAs(C, d1.id)).err ?? "") && /request_not_found/.test((await logAs(B, d1.id)).err ?? ""));

// ---- the deadline
await q(`update tenant_settings set auto_order_notify = 'system', auto_order_time = ${at(-1)} where tenant_id='${tA}'`);
ok("channel 'system' (the chef sends): nothing claimed at the deadline", (await claim()).length === 0 && (await settings()).l === null);
await q(`update tenant_settings set auto_order_notify = 'email' where tenant_id='${tA}'`);
rows = await claim();
const claimOf = (id) => rows.find((x) => x.request_id === id);
ok("deadline: the two drafts the chef did not send are claimed, Alfa's is not",
  rows.length === 2 && claimOf(d2.id) && claimOf(d3.id) && !claimOf(d1.id), rows);
ok("a claim carries the restaurant, language, channel and supplier contact",
  claimOf(d2.id)?.restaurant === "Acme Kitchen" && claimOf(d2.id)?.channel === "email" && "language" in (claimOf(d2.id) ?? {}) &&
  claimOf(d2.id)?.supplier_name === "Beta" && claimOf(d2.id)?.supplier_email === "beta@example.com" && claimOf(d2.id)?.supplier_phone === null, claimOf(d2.id));
ok("its items have product names and units",
  claimOf(d2.id)?.items.length === 1 && claimOf(d2.id).items[0].name === "Et" && claimOf(d2.id).items[0].unit === "kg" && claimOf(d2.id).items[0].qty === 5,
  claimOf(d2.id)?.items);
const claimed = await draftOf(s2);
ok("claimed drafts are sent by the system (no user)", claimed.status === "sent" && claimed.sent_by === null, claimed);
ok("once per local day", (await claim()).length === 0 && (await settings()).l !== null);

// ---- outcome of each claimed request
const finish = (id, status, channel = "email", error = null) =>
  sys(`select public.finish_auto_order_send('${id}', '${channel}', '${status}', 'msg-1', ${error ? `'${error}'` : "null"})`);
r = await finish(d2.id, "sent");
ok("delivered: stays sent", !r.err && (await draftOf(s2)).status === "sent", r);
r = await finish(d3.id, "skipped", "none", "no_contact");
ok("not delivered: back to draft for the chef", !r.err && (await draftOf(s3)).status === "draft", r);
ok("unknown status refused", /invalid_input/.test((await finish(d2.id, "maybe")).err ?? ""));

await q(`update purchase_requests set status = 'sent', sent_at = now(), sent_by = null where id='${d3.id}'`);
await sys(`insert into purchase_requests(tenant_id, branch_id, supplier_id, status, items, request_date)
  values ('${tA}','${branch}','${s3}','draft','[]', public.stock_today('${tA}'))`);
r = await finish(d3.id, "failed", "email", "http_500");
ok("a new draft for the supplier in the meantime: the failed one stays sent, no error", !r.err && (await draftOf(s3)).status === "sent", r);

// ---- amounts: phase 1 estimate at sending, phase 2 actual from receipts at invoice prices
const amounts = async (id) =>
  (await q(`select estimated_amount::float8 e, actual_amount::float8 a from purchase_request_deliveries where request_id='${id}' order by created_at`));
let am = await amounts(d1.id);
ok("phase 1: estimate stored at sending (5 kg x last price 3), actual empty", am.length === 1 && am[0].e === 15 && am[0].a === null, am);
const fridge = (await q(`select id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by created_at limit 1`))[0].id;
const receipts = async (id) => (await q(`select count(*)::int n from purchase_request_receipts where request_id='${id}'`))[0].n;
r = await as(CH, `select (public.receive_stock_with_lot('${p1}', 4, '${fridge}', 7)).id`);
am = await amounts(d1.id);
ok("phase 2: receiving 4 kg at the invoice price 7 (receiving screen) sets actual 28", !r.err && am[0].a === 28 && (await receipts(d1.id)) === 1, { r, am });
ok("the estimate stays what it was at sending", am[0].e === 15);
const receive = (id, qty, cost) =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
    values ('${tA}','${id}','${branch}','${fridge}',${qty},'prihod',${cost},'kg')`);
await receive(p1, 2, 7);
am = await amounts(d1.id);
ok("a second receipt of the same order adds up: 28 + 14 = 42", am[0].a === 42 && (await receipts(d1.id)) === 2, am);
await receive(p1, 1, 7);
ok("once all of it has come (6 of 5 kg), further receipts are not counted", (await receipts(d1.id)) === 2 && (await amounts(d1.id))[0].a === 42);
await receive(p2, 5, null);
ok("a receipt without a price is not counted", (await receipts(d2.id)) === 0 && (await amounts(d2.id)).every((x) => x.a === null));
const p4 = (await sys(`insert into products(tenant_id, branch_id, name, unit, cost) values ('${tA}','${branch}','Un','kg', 1) returning id`)).rows[0].id;
r = await receive(p4, 3, 2);
ok("a product nobody ordered: received normally, counted nowhere", !r.err && (await q("select count(*)::int n from purchase_request_receipts"))[0].n === 2, r);
await receive(p2, 5, 4.5);
am = await amounts(d2.id);
ok("Beta's 5 kg at 4.5: actual 22.5", am.length === 1 && am[0].a === 22.5, am);
await receive(p3, 5, 2);
am = await amounts(d3.id);
ok("Gamma's request (two delivery attempts): actual 10 on every delivery row", am.length === 2 && am.every((x) => x.a === 10), am);

// ---- the day's log
const log = async (uid, day) =>
  as(uid, `select supplier_name, trigger, channel, status, error, lines, lines_received, estimated_amount::float8 e, actual_amount::float8 a, currency
    from public.auto_order_send_log(${day ? `'${day}'` : "null"}) order by sent_at`);
const today = (await q(`select public.stock_today('${tA}')::text d`))[0].d;
r = await log(A, today);
ok("today's log: the chef's send and the system's three outcomes", !r.err && r.rows.length === 4 &&
  r.rows[0].trigger === "chef" && r.rows[0].supplier_name === "Alfa" && r.rows.slice(1).every((x) => x.trigger === "auto"), r);
ok("the owner sees ~estimate, actual, lines received and the restaurant's currency",
  r.rows[0].e === 15 && r.rows[0].a === 42 && r.rows[0].lines === 1 && r.rows[0].lines_received === 1 &&
  typeof r.rows[0].currency === "string" && r.rows[0].currency !== "", r.rows[0]);
ok("reasons are kept", r.rows.some((x) => x.status === "skipped" && x.error === "no_contact" && x.channel === "none"), r.rows);
ok("default day is yesterday: empty", (await log(A, null)).rows?.length === 0);
ok("cook may not read the log; another restaurant sees none of it",
  /forbidden/.test((await log(C, today)).err ?? "") && (await log(B, today)).rows?.length === 0);

// ---- access
ok("clients cannot claim, finish or read deliveries directly",
  /permission denied/.test((await as(A, "select * from public.claim_due_auto_order_sends()")).err ?? "") &&
  /permission denied/.test((await as(CH, `select public.finish_auto_order_send('${d2.id}', 'email', 'sent', null, null)`)).err ?? "") &&
  /permission denied/.test((await as(A, "select * from purchase_request_deliveries")).err ?? "") &&
  /permission denied/.test((await as(A, "select public.auto_order_tick()")).err ?? ""));
r = await sys("select public.auto_order_tick()");
ok("auto_order_tick() drafts without pg_net or Vault secrets and does not fail", !r.err, r);
ok("restaurant B (auto-order off) is never claimed", (await settings(tB)).l === null && tB !== tA);

// ---- cron: the one job now runs auto_order_tick(), the others stay
for (const statement of [
  "create schema if not exists cron",
  "create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text)",
  `create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
    $f$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
        on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$`,
  "select cron.schedule('alovos-auto-order', '*/15 * * * *', 'select public.run_due_auto_orders()')",
  "select cron.schedule('cleanup-empty-tenants', '0 3 * * *', 'select public.cleanup_empty_tenants()')",
  "select cron.schedule('notify-expiring', '*/15 * * * *', 'select public.notify_expiring_batches()')",
]) await q(statement);
for (let pass = 0; pass < 2; pass += 1) for (const m of sql.matchAll(/execute \$cron\$([\s\S]*?)\$cron\$/g)) await q(m[1]);
const jobs = await q("select jobname, schedule, command from cron.job order by jobname");
ok("cron.job: alovos-auto-order every 15 min runs auto_order_tick(), cleanup-empty-tenants and notify-expiring unchanged",
  JSON.stringify(jobs.map((job) => job.jobname)) === JSON.stringify(["alovos-auto-order", "cleanup-empty-tenants", "notify-expiring"]) &&
  jobs[0].schedule === "*/15 * * * *" && jobs[0].command === "select public.auto_order_tick()" &&
  jobs[1].command === "select public.cleanup_empty_tenants()" && jobs[2].command === "select public.notify_expiring_batches()", jobs);

done();
