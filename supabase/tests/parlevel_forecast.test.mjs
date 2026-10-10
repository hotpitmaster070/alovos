// 20261016_parlevel_forecast.sql: supplier delivery days, next delivery date, average daily usage from
// stock movements, low_stock_with_forecast, automatic purchase requests without duplicate drafts,
// request approval, live stock value, owner figures and chef invitations.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/parlevel_forecast.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FORECAST = "20261016_parlevel_forecast.sql";
const { ok, done } = reporter();
const { q, as, sys, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FORECAST));
ok(`migrations before ${FORECAST} apply`, !failure, failure);

// ---- tenant A: owner, chef, cook; tenant B: owner. A legacy supplier with the old integer column.
const [A, CH, C, B, N] = [U("0a"), U("0e"), U("0c"), U("0b"), U("0d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${CH}','chef@acme.az'),('${C}','cook@acme.az'),('${B}','bob@beta.az'),('${N}','new@chef.az')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from profiles where id='${uid}'`))[0].t;
const [tA, tB] = [await tenantOf(A), await tenantOf(B)];
for (const [uid, role] of [[CH, "chef"], [C, "cook"]]) {
  const r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  ok(`owner adds a ${role}`, !r.err, r);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const storeA = (await q(`select id from storage_locations where tenant_id='${tA}' order by number, id limit 1`))[0].id;
await q(`insert into suppliers(tenant_id, name, contact, delivery_days) values ('${tA}','Köhnə Təchizat','+994501112233',2)`);

failure = await applyTwice(migrationFiles.filter((f) => f >= FORECAST));
ok(`${FORECAST} and later apply, each twice`, !failure, failure);

// ---- legacy supplier kept
const legacy = (await q(`select lead_time_days, delivery_days, code, is_active from suppliers where tenant_id='${tA}'`))[0];
ok("old integer delivery_days kept as lead_time_days, weekdays empty, code generated",
  legacy.lead_time_days === 2 && Array.isArray(legacy.delivery_days) && legacy.delivery_days.length === 0 && legacy.code === "KOH" && legacy.is_active, legacy);

// ---- get_next_delivery_date: Monday and Thursday
const next = async (from) => (await q(`select public.get_next_delivery_date(array[1,4], date '${from}')::text d`))[0].d;
ok("Sun -> Mon", (await next("2026-10-04")) === "2026-10-05");
ok("Mon -> Thu (today's delivery is already ordered)", (await next("2026-10-05")) === "2026-10-08");
ok("Thu -> next Mon", (await next("2026-10-08")) === "2026-10-12");
ok("Fri -> Mon", (await next("2026-10-09")) === "2026-10-12");
ok("no delivery days -> null", (await q("select public.get_next_delivery_date('{}', current_date) d"))[0].d === null);
ok("null days -> null", (await q("select public.get_next_delivery_date(null, current_date) d"))[0].d === null);

// ---- suppliers
const settings = (await q(`select timezone from tenant_settings where tenant_id='${tA}'`))[0];
const todayDow = (await q(`select extract(dow from (now() at time zone $1)::date)::int d`, [settings.timezone]))[0].d;
const deliveryDow = (todayDow + 3) % 7;
let r = await as(C, `insert into suppliers(tenant_id, name, delivery_days) values ('${tA}','Cook Supplier','{1}')`);
ok("a cook cannot add suppliers", !!r.err, r);
r = await as(CH, `insert into suppliers(tenant_id, name, delivery_days) values ('${tA}','  Ət Mərkəzi ','{${deliveryDow},${deliveryDow}}') returning id, name, code, delivery_days`);
ok("chef adds a supplier: trimmed name, code from the name, days without repeats", !r.err && r.rows[0].name === "Ət Mərkəzi" && r.rows[0].code === "ETM" && JSON.stringify(r.rows[0].delivery_days) === `[${deliveryDow}]`, r);
const meat = r.rows?.[0]?.id;
r = await as(CH, `insert into suppliers(tenant_id, name, delivery_days) values ('${tA}','Ət Mərkəzi 2','{4,1}') returning code, delivery_days`);
ok("next supplier code is unique, days sorted", !r.err && r.rows[0].code === "ETM2" && JSON.stringify(r.rows[0].delivery_days) === "[1,4]", r);
r = await as(CH, `insert into suppliers(tenant_id, name, delivery_days) values ('${tA}','Bad','{7}')`);
ok("weekday 7 rejected", /suppliers_delivery_days_check/.test(r.err ?? ""), r);
r = await as(CH, `insert into suppliers(tenant_id, name, code) values ('${tA}','Dup','etm')`);
ok("duplicate code rejected (case-insensitive)", /uniq_supplier_code_per_tenant/.test(r.err ?? ""), r);
r = await as(B, `select count(*)::int c from suppliers`);
ok("other tenant sees none of A's suppliers", r.rows[0].c === 0, r);

// ---- products and limits
await q(`update tenant_settings set low_stock_default = 0, usage_window_days = 4 where tenant_id='${tA}'`);
r = await as(A, `insert into products(tenant_id, name, unit, cost) values ('${tA}','Mal əti','kg',10),('${tA}','Toyuq','kg',5),('${tA}','Duz','kg',1) returning id, name`);
const id = Object.fromEntries(r.rows.map((row) => [row.name, row.id]));
const limits = (uid, product, par, min, supplier) =>
  as(uid, "select public.set_product_limits($1, $2, $3, $4)", [product, par, min, supplier]);
r = await limits(C, id["Mal əti"], 10, 3, meat);
ok("a cook cannot set limits", /forbidden/.test(r.err ?? ""), r);
r = await as(C, `update products set par_level = 10 where id='${id["Mal əti"]}'`);
ok("a cook cannot set par_level directly", /forbidden/.test(r.err ?? ""), r);
r = await as(CH, `update products set avg_daily_usage = 99 where id='${id["Mal əti"]}'`);
ok("nobody writes the usage snapshot directly", /forbidden/.test(r.err ?? ""), r);
r = await limits(CH, id["Mal əti"], 3, 10, meat);
ok("min above par rejected", /invalid_input/.test(r.err ?? ""), r);
r = await limits(CH, id["Mal əti"], 10, 3, meat);
ok("chef sets par 10, min 3, supplier", !r.err, r);
r = await limits(B, id["Mal əti"], 10, 3, null);
ok("another tenant cannot touch the product", /product_not_found/.test(r.err ?? ""), r);
r = await as(C, `select par_level::float p, supplier_id from products where id='${id["Mal əti"]}'`);
ok("everyone reads the limits", !r.err && r.rows[0].p === 10 && r.rows[0].supplier_id === meat, r);

// ---- usage: 20 in; out 5 (2 days ago) + 2 (today) + 1 waste (once, not twice); 4 out 10 days ago is outside the window
r = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
  values ('${tA}','${id["Mal əti"]}','${branchA}','${storeA}',20,'prihod',12,'kg')`);
ok("seed 20 kg", !r.err, r);
for (const [qty, daysAgo] of [[5, 2], [2, 0], [4, 10]]) {
  r = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, unit)
    values ('${tA}','${id["Mal əti"]}','${branchA}','${storeA}',${qty},'spisanie','kg') returning id`);
  ok(`write off ${qty}`, !r.err, r);
  await q(`update stock_movements set created_at = now() - interval '${daysAgo} days' where id='${r.rows[0].id}'`);
}
r = await as(C, `select public.create_wastage_with_movement('${id["Mal əti"]}', 1, 'spoiled', '${storeA}')`);
ok("cook writes off 1 kg as waste", !r.err, r);
const usage = async (product) => Number((await as(CH, `select public.calculate_avg_daily_usage('${product}') u`)).rows[0].u);
ok("avg daily usage = (5 + 2 + 1) / 4-day window = 2", (await usage(id["Mal əti"])) === 2, await usage(id["Mal əti"]));
ok("no movements -> 0", (await usage(id.Duz)) === 0);
r = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, unit)
  values ('${tA}','${id.Toyuq}','${branchA}','${storeA}',4,'prihod','kg'),('${tA}','${id.Toyuq}','${branchA}','${storeA}',1,'count','kg')`);
await q(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, unit) values ('${tA}','${id.Toyuq}','${branchA}','${storeA}',3,'count','kg')`);
ok("count shortage counts as usage, surplus is subtracted: (3 - 1) / 4", (await usage(id.Toyuq)) === 0.5, await usage(id.Toyuq));

// ---- low_stock_with_forecast
const forecast = async (uid) => {
  const res = await as(uid, "select product_id, name, current_stock::float cur, par_level::float par, min_stock::float min, supplier_name, days_until_delivery d, avg_daily_usage::float avg, projected_stock::float proj, need_to_order::float need, on_order::float on_order, will_run_out, status from public.low_stock_with_forecast");
  return res.err ? res : Object.fromEntries(res.rows.map((row) => [row.name, row]));
};
let f = await forecast(CH);
const beef = f["Mal əti"];
ok("current stock 20 - 5 - 2 - 4 - 1 = 8", beef?.cur === 8, beef);
ok("next delivery in 3 days from the supplier's weekdays", beef?.d === 3 && beef?.supplier_name === "Ət Mərkəzi", beef);
ok("projected = 8 - 2 x 3 = 2", beef?.proj === 2, beef);
ok("projected below min 3: will run out, status order, need 10 - 2 = 8", beef?.will_run_out === true && beef?.status === "order" && beef?.need === 8, beef);
ok("product without limits (tenant default 0) -> no_limits", f.Duz?.status === "no_limits" && f.Duz?.proj === null, f.Duz);
r = await limits(CH, id.Toyuq, 5, 2, meat);
await sys(`insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type, unit) values ('${tA}','${id.Toyuq}','${branchA}','${storeA}',2,'spisanie','kg')`);
f = await forecast(CH);
ok("below min -> critical", f.Toyuq?.cur === 0 && f.Toyuq?.status === "critical", f.Toyuq);
await q(`update tenant_settings set low_stock_default = 5 where tenant_id='${tA}'`);
ok("without an own min the tenant default applies", (await forecast(CH)).Duz?.min === 5 && (await forecast(CH)).Duz?.status === "critical");
await q(`update tenant_settings set low_stock_default = 0 where tenant_id='${tA}'`);
r = await as(B, "select count(*)::int c from public.low_stock_with_forecast");
ok("another tenant sees none of A's forecast", !r.err && r.rows[0].c === 0, r);
r = await as(B, `select count(*)::int c from public.product_forecast('${tA}')`);
ok("product_forecast of another tenant returns nothing", !r.err && r.rows[0].c === 0, r);

// ---- automatic purchase requests
await limits(CH, id.Toyuq, null, null, null);
const drafts = async () => (await q(`select id, items, auto_created, created_by, request_date::text d from purchase_requests where tenant_id='${tA}' and status='draft'`));
r = await as(C, "select public.check_and_create_auto_requests() n");
ok("a cook cannot run the check", /forbidden/.test(r.err ?? ""), r);
r = await as(CH, "select public.check_and_create_auto_requests() n");
ok("first check creates one draft", !r.err && r.rows[0].n === 1, r);
let d = await drafts();
ok("draft: auto, chef, one item 8 kg of beef", d.length === 1 && d[0].auto_created && d[0].created_by === CH && d[0].items.length === 1 && d[0].items[0].product_id === id["Mal əti"] && Number(d[0].items[0].qty) === 8 && d[0].items[0].unit === "kg", d);
ok("usage snapshot refreshed", Number((await q(`select avg_daily_usage a from products where id='${id["Mal əti"]}'`))[0].a) === 2);
r = await as(CH, "select public.check_and_create_auto_requests() n");
ok("second check today does not duplicate the draft", !r.err && r.rows[0].n === 0 && (await drafts()).length === 1, r);
r = await as(A, `insert into purchase_requests(tenant_id, supplier_id, request_date) values ('${tA}','${meat}', current_date)`);
ok("clients cannot insert requests", !!r.err, r);
await limits(CH, id.Toyuq, 5, 2, meat);
r = await as(CH, "select public.check_and_create_auto_requests() n");
d = await drafts();
ok("a new low product is added to today's draft, not a second draft", !r.err && r.rows[0].n === 1 && d.length === 1 && d[0].items.length === 2, d);
r = await q("select public.check_and_create_auto_requests_all() n");
ok("scheduler run for all tenants adds nothing new", r[0].n === 0);
r = await as(A, "select public.check_and_create_auto_requests_all()");
ok("clients cannot run the all-tenant check", /permission denied/.test(r.err ?? ""), r);

// ---- approve and send, receive
const draftId = d[0].id;
r = await as(C, `select public.send_purchase_request('${draftId}')`);
ok("a cook cannot send", /forbidden/.test(r.err ?? ""), r);
r = await as(CH, `select public.send_purchase_request('${draftId}', $1::jsonb)`, [JSON.stringify([{ product_id: id["Mal əti"], qty: 0 }])]);
ok("zero quantity rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(CH, `select public.send_purchase_request('${draftId}', $1::jsonb)`, [JSON.stringify([{ product_id: "x", qty: 1 }])]);
ok("bad product id rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(CH, `select public.send_purchase_request('${draftId}', $1::jsonb)`, [JSON.stringify([{ product_id: id["Mal əti"], qty: 9 }, { product_id: id.Toyuq, qty: 5 }])]);
ok("chef approves with edited quantity and sends", !r.err, r);
const sent = (await q(`select status, sent_by, items from purchase_requests where id='${draftId}'`))[0];
ok("request sent by the chef with the edited items", sent.status === "sent" && sent.sent_by === CH && Number(sent.items[0].qty) === 9, sent);
f = await forecast(CH);
ok("forecast shows the quantity on order", f["Mal əti"]?.on_order === 9, f["Mal əti"]);
r = await as(CH, "select public.check_and_create_auto_requests() n");
ok("products on order get no new draft", !r.err && r.rows[0].n === 0 && (await drafts()).length === 0, r);
r = await as(CH, `select public.send_purchase_request('${draftId}')`);
ok("a sent request cannot be sent again", /invalid_status/.test(r.err ?? ""), r);
r = await as(CH, `select public.receive_purchase_request('${draftId}')`);
ok("chef marks the request received", !r.err && (await q(`select status from purchase_requests where id='${draftId}'`))[0].status === "received", r);
r = await as(CH, "select public.check_and_create_auto_requests() n");
ok("still low after delivery was received -> a new draft", !r.err && r.rows[0].n === 1, r);
const second = (await drafts())[0].id;
r = await as(CH, `select public.discard_purchase_request('${second}')`);
ok("chef discards a draft", !r.err && (await drafts()).length === 0, r);

// ---- live stock value and owner figures
r = await as(A, "select type, value::float v from public.stock_value_by_type()");
const storeType = (await q(`select type from storage_locations where id='${storeA}'`))[0].type;
ok("stock value = 8 kg beef x last purchase price 12 = 96, under the place's type", !r.err && r.rows.length === 1 && r.rows[0].type === storeType && r.rows[0].v === 96, r);
r = await as(C, "select count(*)::int c from public.stock_value_by_type()");
ok("a cook gets no stock value", !r.err && r.rows[0].c === 0, r);
r = await as(A, "select stock_value::float v, low_stock_count l, critical_count c, auto_request_count a from public.owner_summary()");
ok("owner figures: value, low and critical counts, auto drafts", !r.err && r.rows[0].v === 96 && r.rows[0].l === 2 && r.rows[0].c === 1 && r.rows[0].a === 0, r);
r = await as(C, "select * from public.owner_summary()");
ok("a cook cannot read owner figures", /forbidden/.test(r.err ?? ""), r);

// ---- invitations
r = await as(CH, "select token from public.create_invitation('+994 50 123 45 67', 'chef')");
ok("only owners invite", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select token from public.create_invitation('050 abc', 'chef')");
ok("bad phone rejected", /invalid_input/.test(r.err ?? ""), r);
r = await as(A, "select token, phone, role, (expires_at - created_at) > interval '6 days' ttl from public.create_invitation('+994 (50) 123-45-67', 'chef')");
ok("owner invites a chef: phone normalised, ttl from settings", !r.err && r.rows[0].phone === "+994501234567" && r.rows[0].role === "chef" && r.rows[0].ttl && r.rows[0].token.length === 64, r);
const token = r.rows[0].token;
r = await as(N, "select * from public.invitation_preview($1)", [token]);
ok("invitee sees the restaurant and role", !r.err && r.rows[0].role === "chef" && r.rows[0].state === "valid" && r.rows[0].tenant_name, r);
r = await as(N, "select state from public.invitation_preview('nope')");
ok("unknown token -> not_found", r.rows?.[0]?.state === "not_found", r);
r = await as(N, "select public.accept_invitation($1) t", [token]);
ok("invitee accepts and joins tenant A", !r.err && r.rows[0].t === tA, r);
r = await as(N, "select public.current_tenant_id() t, public.current_member_role() role");
ok("new chef works in tenant A as chef", r.rows[0].t === tA && r.rows[0].role === "chef", r);
r = await as(B, "select public.accept_invitation($1)", [token]);
ok("a used link cannot be used again", /invitation_used/.test(r.err ?? ""), r);
r = await as(A, "select token from public.create_invitation('+994501234568', 'chef')");
await q(`update invitations set expires_at = now() - interval '1 minute' where token='${r.rows[0].token}'`);
r = await as(B, "select public.accept_invitation($1)", [r.rows[0].token]);
ok("an expired link is rejected", /invitation_expired/.test(r.err ?? ""), r);
r = await as(CH, "select count(*)::int c from invitations");
ok("only owners read invitations", r.rows[0].c === 0 && (await as(A, "select count(*)::int c from invitations")).rows[0].c === 2);
r = await as(A, `insert into invitations(tenant_id, phone, role, expires_at) values ('${tA}','+994500000000','owner', now())`);
ok("clients cannot insert invitations directly", !!r.err, r);

// ---- branch code helper still behaves the same
r = await as(A, `insert into branches(tenant_id, name) values ('${tA}','Gənclik') returning code`);
ok("branch codes unchanged after the shared helper", !r.err && r.rows[0].code === "GEN", r);

// ---- re-running the migration on live data keeps every row
const snapshot = async () =>
  JSON.stringify(
    await q(`select
      (select json_agg(json_build_object('id', id, 'code', code, 'days', delivery_days, 'lead', lead_time_days) order by id) from suppliers) s,
      (select json_agg(json_build_object('id', id, 'par', par_level, 'min', min_stock, 'sup', supplier_id) order by id) from products) p,
      (select json_agg(json_build_object('id', id, 'status', status, 'items', items) order by id) from purchase_requests) r,
      (select json_agg(json_build_object('id', id, 'used', used_at) order by id) from invitations) i`),
  );
const before = await snapshot();
failure = await apply([FORECAST]);
ok(`${FORECAST} re-applies on live data`, !failure, failure);
ok("suppliers, limits, requests and invitations survive the re-run", (await snapshot()) === before);

done();
