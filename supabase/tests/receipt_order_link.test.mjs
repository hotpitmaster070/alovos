// 20261029000500_receipt_order_link.sql: the receiving form may link a delivery to a chosen sent order (the
// same product ordered from two suppliers); without a choice the automatic match stays; manual links are
// marked, never rewritten, and counted on the owner's log.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/receipt_order_link.test.mjs
import { freshDb, migrationFiles, readMigration, reporter, userId as U } from "./pglite.mjs";

const { ok, done } = reporter();
const { q, as, sys, applyTwice } = await freshDb();

const failure = await applyTwice(migrationFiles);
ok(`all ${migrationFiles.length} migrations apply, each twice`, !failure, failure);
ok("product_lots, storage_locations and the cron jobs untouched",
  !/alter table[^;]*product_lots|alter table[^;]*storage_locations|cron\./i.test(readMigration("20261029000500_receipt_order_link.sql")));

const [A, CH, C, B] = [U("3a"), U("3b"), U("3c"), U("3d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${CH}','chef@acme.az'),('${C}','cook@acme.az'),('${B}','owner@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
for (const [uid, role] of [[CH, "chef"], [C, "cook"]]) {
  await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const fridge = (await q(`select id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by created_at limit 1`))[0].id;
const supplier = async (name) => (await sys(`insert into suppliers(tenant_id, name) values ('${tA}','${name}') returning id`)).rows[0].id;
const [s1, s2] = [await supplier("Alfa"), await supplier("Beta")];
const product = async (name) =>
  (await sys(`insert into products(tenant_id, branch_id, name, unit, cost) values ('${tA}','${branch}','${name}','kg', 50) returning id`)).rows[0].id;
const [truffle, salt] = [await product("Truffle"), await product("Salt")];

// Truffle 10 kg from each supplier: Alfa's sent an hour before Beta's.
const sent = async (sup, ago, status = "sent") => {
  const id = (await sys(`insert into purchase_requests(tenant_id, branch_id, supplier_id, status, items, request_date, sent_at)
    values ('${tA}','${branch}','${sup}','${status}','[{"product_id":"${truffle}","qty":10,"unit":"kg"}]', public.stock_today('${tA}'),
    ${status === "draft" ? "null" : `now() - interval '${ago} hour'`}) returning id`)).rows[0].id;
  if (status !== "draft") {
    await sys(`insert into purchase_request_deliveries(tenant_id, request_id, supplier_id, trigger, channel, status, estimated_amount)
      values ('${tA}','${id}','${sup}','chef','whatsapp','sent', 500)`);
  }
  return id;
};
const rA = await sent(s1, 2);
const rB = await sent(s2, 1);

const options = async (uid, b = branch) =>
  as(uid, `select request_id, supplier_name, ordered::float8 o, received::float8 r, unit, estimated_amount::float8 e, currency
    from public.receipt_order_options('${truffle}', ${b ? `'${b}'` : "null"})`);
let r = await options(C);
ok("cook sees both open orders of the product, newest first, without amounts",
  !r.err && r.rows.length === 2 && r.rows[0].request_id === rB && r.rows[1].request_id === rA && r.rows[0].supplier_name === "Beta" &&
  r.rows[0].o === 10 && r.rows[0].r === 0 && r.rows[0].unit === "kg" && r.rows.every((x) => x.e === null), r);
r = await options(A);
ok("owner sees the ~amount and the restaurant's currency", r.rows[0].e === 500 && typeof r.rows[0].currency === "string" && r.rows[0].currency !== "", r.rows[0]);
ok("another restaurant sees nothing", (await options(B, null)).rows?.length === 0);

const link = async (id) => (await q(`select request_id, is_manual_link m from purchase_request_receipts rc
  join stock_movements sm on sm.id = rc.movement_id order by rc.created_at desc, sm.quantity desc limit 1`))[0];
r = await as(CH, `select (public.receive_stock_with_lot('${truffle}', 4, '${fridge}', 25)).id`);
let l = await link();
ok("no choice: the automatic match takes the newest order (Beta), not marked manual", !r.err && l?.request_id === rB && l?.m === false, { r, l });

r = await as(C, `select (public.receive_stock_for_request('${rA}', '${truffle}', 6, '${fridge}', 30, null, null)).id`);
l = await link();
ok("chosen by hand: Alfa's order gets the receipt, marked manual", !r.err && l?.request_id === rA && l?.m === true, { r, l });
const actual = async (id) => (await q(`select actual_amount::float8 a from purchase_request_deliveries where request_id='${id}'`))[0].a;
ok("actual amounts follow: Alfa 6 x 30 = 180, Beta 4 x 25 = 100", (await actual(rA)) === 180 && (await actual(rB)) === 100);

r = await as(CH, `select (public.receive_stock_with_lot('${truffle}', 6, '${fridge}', 26)).id`);
const links = await q(`select request_id, is_manual_link m, qty::float8 qty from purchase_request_receipts order by created_at, qty`);
ok("a later automatic receipt fills Beta's remaining 6 kg; the manual link to Alfa is not rewritten",
  !r.err && links.length === 3 && links.filter((x) => x.request_id === rA).length === 1 && links.find((x) => x.request_id === rA).m === true &&
  links.filter((x) => x.request_id === rB).length === 2, links);
r = await options(C);
ok("options: Beta fully received drops out, Alfa shows 6 of 10 received", r.rows.length === 1 && r.rows[0].request_id === rA && r.rows[0].r === 6, r.rows);

const forRequest = (uid, request, prod = truffle, price = "30") =>
  as(uid, `select (public.receive_stock_for_request('${request}', '${prod}', 1, '${fridge}', ${price}, null, null)).id`);
const draft = await sent(s1, 0, "draft");
ok("a link by hand needs a price", /invalid_input/.test((await forRequest(C, rA, truffle, "null")).err ?? ""));
ok("the product must be on the chosen order; a draft cannot be chosen",
  /request_not_found/.test((await forRequest(C, rA, salt)).err ?? "") && /request_not_found/.test((await forRequest(C, draft)).err ?? ""));
const bBranch = (await q(`select id from branches where tenant_id='${tB}'`))[0].id;
const bSupplier = (await sys(`insert into suppliers(tenant_id, name) values ('${tB}','Gamma') returning id`)).rows[0].id;
const foreignInsert = await sys(`insert into purchase_requests(tenant_id, branch_id, supplier_id, status, items, request_date, sent_at)
  values ('${tB}','${bBranch}','${bSupplier}','sent','[{"product_id":"${truffle}","qty":1,"unit":"kg"}]', current_date, now()) returning id`);
ok("another restaurant's sent order exists for the check", !foreignInsert.err, foreignInsert.err);
const foreign = foreignInsert.rows?.[0]?.id;
ok("another restaurant's order cannot be chosen", /request_not_found/.test((await forRequest(C, foreign)).err ?? ""));
ok("nothing was received by the refused calls", (await q("select count(*)::int n from purchase_request_receipts"))[0].n === 3);

const today = (await q(`select public.stock_today('${tA}')::text d`))[0].d;
r = await as(A, `select request_id, manual_links from public.auto_order_manual_links('${today}')`);
ok("owner's log: manual links counted per order (Alfa 1, Beta none)",
  !r.err && r.rows.length === 1 && r.rows[0].request_id === rA && r.rows[0].manual_links === 1, r);
ok("cook may not read it", /forbidden/.test((await as(C, `select * from public.auto_order_manual_links('${today}')`)).err ?? ""));
const anon = (fn) => q(`select has_function_privilege('anon', 'public.${fn}', 'execute') ok`);
ok("anon cannot list or receive",
  !(await anon("receive_stock_for_request(uuid, uuid, numeric, uuid, numeric, text, numeric, date, integer, boolean)"))[0].ok &&
  !(await anon("receipt_order_options(uuid, uuid)"))[0].ok);

done();
