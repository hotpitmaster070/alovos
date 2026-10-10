// 20261029000200_smart_settings_suppliers.sql: inherited limits (branch -> product -> restaurant -> 0),
// what to order grouped by supplier, one draft per supplier, extras, the scheduled run in the restaurant's
// time, owner-only settings and the loss alert switch.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/smart_settings_auto_order.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const MIGRATION = "20261029000200_smart_settings_suppliers.sql";
const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
const sql = readMigration(MIGRATION);
ok("existing cron jobs and their functions untouched",
  !/cron\.unschedule|check_and_create_auto_requests|auto_purchase_requests_for_tenant|cleanup_empty_tenants|handle_stock_movement|par_alerts/i.test(sql));

const [A, CH, C, B] = [U("1a"), U("1b"), U("1c"), U("1d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${CH}','chef@acme.az'),('${C}','cook@acme.az'),('${B}','owner@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
for (const [uid, role] of [[CH, "chef"], [C, "cook"]]) {
  await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const branchB = (await q(`select id from branches where tenant_id='${tB}'`))[0].id;
const fridge = (await q(`select id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by created_at limit 1`))[0].id;

const supplier = async (name, phone) =>
  (await sys(`insert into suppliers(tenant_id, name, phone) values ('${tA}','${name}',${phone ? `'${phone}'` : "null"}) returning id`)).rows[0].id;
const [s1, s2] = [await supplier("Alfa Toyuq", "+994501112233"), await supplier("Beta Et", null)];
const product = async (name, sup, par = "null") =>
  (await sys(`insert into products(tenant_id, name, unit, supplier_id, par_level) values ('${tA}','${name}','kg',${sup ? `'${sup}'` : "null"},${par}) returning id`)).rows[0].id;
const chicken = await product("Toyuq", s1, 20);
const meat = await product("Et", s2);
const milk = await product("Sud", s1);
const onion = await product("Sogan", null);
const salt = await product("Duz", s1);
const flour = await product("Un", s2);
const receive = (id, qty) =>
  sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
    values ('${tA}','${id}','${branch}','${fridge}',${qty},'prihod',2,'kg')`);
for (const [id, qty] of [[chicken, 4], [meat, 2], [milk, 1], [onion, 1], [salt, 1], [flour, 30]]) await receive(id, qty);

ok("supplier phone and email are checked",
  /suppliers_phone_check/.test((await sys(`update suppliers set phone = 'call me' where id='${s2}'`)).err ?? "") &&
  /suppliers_email_check/.test((await sys(`update suppliers set email = 'nope' where id='${s2}'`)).err ?? ""));

// ---- limits: branch -> product -> restaurant -> 0
const save = (items, uid = CH, b = branch) => as(uid, `select public.save_stock_limits(${b ? `'${b}'` : "null"}, '${JSON.stringify(items)}'::jsonb) n`);
const limit = async (id) => (await as(A, `select min_qty::float8 m, source, quantity::float8 qty from public.stock_limits('${branch}') where product_id='${id}'`)).rows?.[0];
let r = await save([{ product_id: flour, min_stock: 15, branch_min: 20 }]);
ok("chef saves product and branch limits in one call", !r.err && r.rows[0].n === 1, r);
let l = await limit(flour);
ok("inheritance: branch 20 wins", l?.m === 20 && l?.source === "branch" && l?.qty === 30, l);
await save([{ product_id: flour, branch_min: null }]);
l = await limit(flour);
ok("inheritance: without the branch row the product's 15", l?.m === 15 && l?.source === "product", l);
await save([{ product_id: flour, min_stock: null }]);
l = await limit(flour);
ok("inheritance: without its own the restaurant's 5", l?.m === 5 && l?.source === "tenant", l);
await q(`update tenant_settings set low_stock_default = 0 where tenant_id='${tA}'`);
l = await limit(flour);
ok("inheritance: restaurant default 0 = not tracked", l?.m === 0 && l?.source === "off", l);
await q(`update tenant_settings set low_stock_default = 5 where tenant_id='${tA}'`);

await save([{ product_id: chicken, min_stock: 10 }, { product_id: meat, branch_min: 12 }, { product_id: salt, min_stock: 0 }]);
l = await limit(salt);
ok("min_stock 0 = not tracked even with the restaurant's 5", l?.m === 0 && l?.source === "product", l);
r = await save([{ product_id: chicken, min_stock: 25 }]);
ok("a minimum above the order-up-to level is refused", /min_above_par/.test(r.err ?? ""), r);
ok("cook may not change limits", /forbidden/.test((await save([{ product_id: milk, min_stock: 1 }], C)).err ?? ""));

// ---- grouped by supplier
const grouped = async (uid = A, b = branch) => {
  const res = await as(uid, `select public.get_auto_order_items_grouped('${b}') g`);
  return { err: res.err, groups: res.rows?.[0]?.g ?? [] };
};
let g = await grouped();
const group = (id) => g.groups.find((x) => x.supplier_id === id);
const item = (grp, id) => grp?.items.find((x) => x.product_id === id);
ok("three groups: two suppliers, then the products without one", !g.err && g.groups.length === 3 && g.groups[2].supplier_id === null &&
  g.groups[0].supplier_id === s1 && g.groups[1].supplier_id === s2, g);
ok("group carries the supplier's name and phone", group(s1)?.name === "Alfa Toyuq" && group(s1)?.phone === "+994501112233", group(s1));
ok("need = order-up-to - stock: chicken par 20, min 10, stock 4 -> 16", item(group(s1), chicken)?.need === 16 && item(group(s1), chicken)?.source === "product", group(s1));
ok("without a par level the minimum is the target: meat branch min 12, stock 2 -> 10", item(group(s2), meat)?.need === 10 && item(group(s2), meat)?.source === "branch");
ok("restaurant default 5: milk stock 1 -> 4", item(group(s1), milk)?.need === 4 && item(group(s1), milk)?.source === "tenant");
ok("onion has no supplier: in the null group", item(group(null), onion)?.need === 4);
ok("not tracked (salt) and above the minimum (flour 30) are not ordered",
  g.groups.every((x) => !item(x, salt) && !item(x, flour)));

await sys(`insert into purchase_requests(tenant_id, branch_id, supplier_id, status, items, request_date)
  values ('${tA}','${branch}','${s1}','sent','[{"product_id":"${milk}","qty":3,"unit":"kg"}]', public.stock_today('${tA}') - 1)`);
g = await grouped();
ok("already ordered (sent) is subtracted: milk 4 - 3 -> 1", item(group(s1), milk)?.need === 1 && item(group(s1), milk)?.on_order === 3, group(s1));
ok("cook: forbidden; another restaurant's branch: branch_not_found",
  /forbidden/.test((await grouped(C)).err ?? "") && /branch_not_found/.test((await grouped(A, branchB)).err ?? ""));

// ---- drafts per supplier
r = await as(CH, `select public.create_auto_order_drafts('${branch}') n`);
const drafts = async () => q(`select id, supplier_id, items, auto_created, scheduled_for, request_date::text d from purchase_requests where tenant_id='${tA}' and status='draft' order by supplier_id`);
let d = await drafts();
const today = (await q(`select public.stock_today('${tA}')::text d`))[0].d;
ok("one draft per supplier, none for the products without one", !r.err && r.rows[0].n === 2 && d.length === 2 &&
  d.every((x) => x.auto_created && x.scheduled_for && x.d === today) && new Set(d.map((x) => x.supplier_id)).size === 2, { r, d });
const draftOf = (id) => d.find((x) => x.supplier_id === id);
ok("Alfa's draft: chicken 16 and milk 1", draftOf(s1)?.items.length === 2 &&
  draftOf(s1).items.find((x) => x.product_id === chicken)?.qty === 16 && draftOf(s1).items.find((x) => x.product_id === milk)?.qty === 1, draftOf(s1));
await as(CH, `select public.create_auto_order_drafts('${branch}')`);
d = await drafts();
ok("a second run adds nothing twice", d.length === 2 && draftOf(s1).items.length === 2 && draftOf(s2).items.length === 1, d);

// ---- extras
const extra = (id, productId, qty, uid = CH) => as(uid, `select public.add_purchase_request_extra('${id}','${productId}',${qty}) items`);
r = await extra(draftOf(s2).id, onion, 5);
ok("extra onion on Beta's draft, marked extra", !r.err && r.rows[0].items.find((x) => x.product_id === onion)?.extra === true &&
  r.rows[0].items.find((x) => x.product_id === onion)?.qty === 5, r);
r = await extra(draftOf(s2).id, meat, 3);
const meatLine = r.rows?.[0]?.items.find((x) => x.product_id === meat);
ok("extra of a product already there adds to its line: meat 10 + 3", meatLine?.qty === 13 && meatLine?.extra === undefined, r);
const sent = (await q(`select id from purchase_requests where tenant_id='${tA}' and status='sent'`))[0].id;
ok("no extras on a sent request; cook may not add", /invalid_status/.test((await extra(sent, onion, 1)).err ?? "") &&
  /forbidden/.test((await extra(draftOf(s2).id, onion, 1, C)).err ?? ""));

// ---- settings: owner only, checked values
r = await as(A, `update tenant_settings set loss_alert_percent = 15, loss_alert_enabled = false, auto_order_enabled = true,
  auto_order_time = '05:30', auto_order_notify = 'whatsapp' where tenant_id='${tA}'`);
ok("owner changes the smart settings", !r.err && r.affected === 1, r);
r = await as(CH, `update tenant_settings set loss_alert_percent = 20 where tenant_id='${tA}'`);
ok("chef cannot (row-level security: nothing updated)", !r.err && r.affected === 0, r);
ok("unknown notify channel refused; the run date is the database's",
  /auto_order_notify_check/.test((await as(A, `update tenant_settings set auto_order_notify = 'sms' where tenant_id='${tA}'`)).err ?? "") &&
  /permission denied/.test((await as(A, `update tenant_settings set auto_order_last_run = null where tenant_id='${tA}'`)).err ?? ""));

// ---- loss alert switch: 5% vs 15% against a 10% line
await q(`update tenant_settings set loss_alert_percent = 10, loss_alert_enabled = true where tenant_id='${tA}'`);
const rice = await product("Duyu", null);
await receive(rice, 50);
const card = (await sys(`insert into tech_cards(tenant_id, name) values ('${tA}','Plov') returning id`)).rows[0].id;
await sys(`insert into tech_card_ingredients(tenant_id, tech_card_id, product_id, brutto, netto, waste_percent) values ('${tA}','${card}','${rice}',0,0.2,0)`);
await as(A, `select * from public.deduce_sale('${branch}', '[{"recipe_id":"${card}","quantity":10}]'::jsonb)`);
const countOut = (qty) => sys(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, unit)
  values ('${tA}','${rice}','${branch}','${fridge}',${qty},'count','kg')`);
const riceRow = async () => (await as(A, `select loss_pct::float8 p, over_limit from public.get_theoretical_vs_actual('${branch}', '${today}', '${today}') where product_id='${rice}'`)).rows?.[0];
await countOut(0.1);
let lr = await riceRow();
ok("5% loss under a 10% line: not red", lr?.p === 5 && lr?.over_limit === false, lr);
await countOut(0.2);
lr = await riceRow();
ok("15% loss over a 10% line: red", lr?.p === 15 && lr?.over_limit === true, lr);
await q(`update tenant_settings set loss_alert_enabled = false where tenant_id='${tA}'`);
lr = await riceRow();
ok("alert switched off: 15% is not red", lr?.p === 15 && lr?.over_limit === false, lr);

// ---- the scheduled run, in the restaurant's time
const run = async () => q("select tenant_id, branch_id, drafts, notify from public.run_due_auto_orders()");
await q(`update tenant_settings set auto_order_enabled = true, auto_order_time = '00:00', auto_order_notify = 'system' where tenant_id='${tA}'`);
let rows = await run();
const mine = rows.filter((x) => x.tenant_id === tA);
ok("due restaurant: drafts for its branch, channel returned", mine.length === 1 && mine[0].branch_id === branch && mine[0].drafts === 2 && mine[0].notify === "system", rows);
const note = await q(`select payload from notifications where tenant_id='${tA}' and type='auto_order_ready'`);
ok("one 'auto order ready' notification with the supplier count", note.length === 1 && note[0].payload.suppliers === 2, note);
ok("runs once per local day", (await run()).length === 0);

ok("restaurant B with auto order off: not run", (await q(`select auto_order_last_run from tenant_settings where tenant_id='${tB}'`))[0].auto_order_last_run === null);
const zone = (await q(`select z from unnest(array['UTC','Asia/Tokyo','America/New_York']) z
  where extract(hour from now() at time zone z) between 1 and 21 limit 1`))[0].z;
await q(`update tenant_settings set auto_order_enabled = true, timezone = '${zone}',
  auto_order_time = ((now() at time zone '${zone}') + interval '1 hour')::time where tenant_id='${tB}'`);
await run();
ok("restaurant B before its local time: not run yet", (await q(`select auto_order_last_run from tenant_settings where tenant_id='${tB}'`))[0].auto_order_last_run === null);
await q(`update tenant_settings set auto_order_time = ((now() at time zone '${zone}') - interval '1 hour')::time where tenant_id='${tB}'`);
await run();
ok("after its local time: run, on its own date", (await q(`select auto_order_last_run::text d from tenant_settings where tenant_id='${tB}'`))[0].d ===
  (await q(`select (now() at time zone '${zone}')::date::text d`))[0].d);
ok("clients cannot start the run", /permission denied/.test((await as(A, "select * from public.run_due_auto_orders()")).err ?? ""));

done();
