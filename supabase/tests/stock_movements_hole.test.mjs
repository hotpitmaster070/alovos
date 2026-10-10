// 20261028000900_close_stock_movements_hole.sql + 20261028001000_revoke_direct_stock_movements.sql:
// no client can write a 'transfer' movement around transfer_stock_between_branches(); receipts and
// write-offs go through SECURITY DEFINER RPCs; after step 2 clients cannot insert movements at all.
// Also transfer numbers (TRF-YYYYMMDD-NNNN) and the stock options of the transfer screen.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/stock_movements_hole.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const STEP1 = "20261028000900_close_stock_movements_hole.sql";
const STEP2 = "20261028001000_revoke_direct_stock_movements.sql";
const { ok, done } = reporter();
const { q, as, sys, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < STEP2));
ok(`migrations through ${STEP1} apply`, !failure, failure);
failure = await apply([STEP1]);
ok(`${STEP1} applies again`, !failure, failure);

const [A, C, M] = [U("7a"), U("7c"), U("7d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@a.io'),('${C}','cook@a.io'),('${M}','owner@m.io')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const [tA, tM] = [await tenantOf(A), await tenantOf(M)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);

const b1 = (await q(`select id from branches where tenant_id='${tA}' order by created_at limit 1`))[0].id;
const b2 = (await as(A, `insert into branches(tenant_id, name) values ('${tA}','Second') returning id`)).rows[0].id;
const placeOf = async (branch, type) => {
  const found = await q(`select id from storage_locations where branch_id='${branch}' and type='${type}' and is_active order by number limit 1`);
  if (found[0]) return found[0].id;
  return (await as(A, `insert into storage_locations(tenant_id, branch_id, name, type) values ('${tA}','${branch}','${type} ${branch.slice(-4)}','${type}') returning id`)).rows[0].id;
};
const [fridge1, dry1, fridge2] = [await placeOf(b1, "soyuducu"), await placeOf(b1, "quru"), await placeOf(b2, "soyuducu")];
const mPlace = (await q(`select id from storage_locations where tenant_id='${tM}' limit 1`))[0].id;
const mBranch = (await q(`select id from branches where tenant_id='${tM}' limit 1`))[0].id;

const today = (await q(`select public.tenant_today('${tA}')::text d`))[0].d;
const day = async (n) => (await q(`select ($1::date + $2::int)::text d`, [today, n]))[0].d;
const [past, soon, later] = [await day(-1), await day(2), await day(9)];
const made = (await as(A, `insert into products(tenant_id, name, unit, barcode) values
  ('${tA}','Milk','l','4600000000001'),('${tA}','Rice','kg','4600000000002'),('${tA}','Salt','kg',null) returning id, name, internal_code`)).rows;
const id = Object.fromEntries(made.map((p) => [p.name, p.id]));
const code = Object.fromEntries(made.map((p) => [p.name, p.internal_code]));
const mProduct = (await as(M, `insert into products(tenant_id, name, unit) values ('${tM}','Foreign','kg') returning id`)).rows[0].id;

// ---- step 1: the guard
const directTransfer = (uid, extra = "") => as(uid, `insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, to_location_id, quantity, movement_type${extra ? ", branch_transfer_id" : ""})
  values ('${tA}','${id.Milk}','${b2}','${fridge1}','${fridge2}',1,'transfer'${extra ? `,'${extra}'` : ""})`);
let r = await as(A, `select public.receive_stock_rpc('${id.Milk}','${fridge1}',3,1,'${past}')`);
r = await as(A, `select public.receive_stock_rpc('${id.Milk}','${fridge1}',2,3,'${soon}')`);
r = await as(C, `select public.receive_stock_rpc('${id.Milk}','${fridge1}',5,2,'${later}', null, 'invoice 42')`);
ok("receive_stock_rpc: members receive into a place", !r.err && typeof r.rows[0].receive_stock_rpc === "string", r);
const mv = (await q(`select movement_type, branch_id, to_location_id, unit, reason, user_id from stock_movements where id='${r.rows[0].receive_stock_rpc}'`))[0];
ok("receive_stock_rpc: branch, unit, reason and author recorded", mv.movement_type === "prihod" && mv.branch_id === b1 && mv.to_location_id === fridge1 &&
  mv.unit === "l" && mv.reason === "invoice 42" && mv.user_id === C, mv);
await as(A, `select public.receive_stock_rpc('${id.Rice}','${dry1}',4,1.5)`);

r = await directTransfer(C);
ok("hole: cook cannot insert a transfer movement directly", /direct_transfer_forbidden/.test(r.err ?? ""), r);
r = await directTransfer(A);
ok("hole: owner cannot insert a transfer movement directly either", /direct_transfer_forbidden/.test(r.err ?? ""), r);

r = await as(A, `select public.transfer_stock_between_branches('${b1}','${b2}','[{"product_id":"${id.Milk}","quantity":1}]'::jsonb) t`);
ok("transfers still work through the function", !r.err && r.rows[0].t.ok === true, r);
const transferId = r.rows[0].t.transfer_id;
r = await directTransfer(C, transferId);
ok("hole: reusing an existing transfer document does not help", /direct_transfer_forbidden/.test(r.err ?? ""), r);
r = await as(C, `insert into branch_transfers(tenant_id, from_branch_id, to_branch_id) values ('${tA}','${b1}','${b2}')`);
ok("hole: cook cannot forge a transfer document", /permission denied/.test(r.err ?? ""), r);
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, unit) values ('${tA}','${id.Salt}','${b1}','${dry1}',1,'prihod','kg')`);
ok("step 1 keeps the old receipt path working", !r.err, r);

// ---- transfer numbers and status
const doc = (await q(`select number, status from branch_transfers where id='${transferId}'`))[0];
const ymd = today.replaceAll("-", "");
ok("transfer number TRF-YYYYMMDD-NNNN on the tenant's day, status completed", doc.number === `TRF-${ymd}-0001` && doc.status === "completed", doc);
r = await as(A, `select public.transfer_stock_between_branches('${b1}','${b2}','[{"product_id":"${id.Rice}","quantity":0.5}]'::jsonb) t`);
const second = (await q(`select number from branch_transfers where id='${r.rows[0].t.transfer_id}'`))[0].number;
ok("numbers count up per tenant and day", second === `TRF-${ymd}-0002`, second);
r = await as(A, `select count(*) n from branch_transfer_counters`);
ok("the counter table is closed to clients", /permission denied/.test(r.err ?? ""), r);

// ---- write-off and move RPCs
r = await as(C, `select public.wastage_stock_rpc('${id.Rice}','${dry1}',0.5,'waste','spilled')`);
ok("wastage_stock_rpc writes off (waste)", !r.err && Number((await q(`select sum(quantity) s from product_stocks where product_id='${id.Rice}' and location_id='${dry1}'`))[0].s) === 3, r);
r = await as(C, `select public.wastage_stock_rpc('${id.Rice}','${dry1}',99)`);
ok("wastage_stock_rpc: shortage refused", /insufficient_stock/.test(r.err ?? ""), r);
r = await as(C, `select public.wastage_stock_rpc('${id.Rice}','${dry1}',1,'transfer')`);
ok("wastage_stock_rpc: only write-off types", /invalid_input/.test(r.err ?? ""), r);
r = await as(C, `select public.move_stock_rpc('${id.Rice}','${dry1}','${fridge1}',1)`);
ok("move_stock_rpc moves inside a branch", !r.err, r);
r = await as(C, `select public.move_stock_rpc('${id.Rice}','${dry1}','${fridge2}',1)`);
ok("move_stock_rpc refuses another branch (that is a transfer)", /location_not_found/.test(r.err ?? ""), r);
r = await as(A, `select public.receive_stock_rpc('${mProduct}','${fridge1}',1)`);
ok("RPCs refuse another tenant's product", /product_not_found/.test(r.err ?? ""), r);
r = await as(A, `select public.receive_stock_rpc('${id.Milk}','${mPlace}',1)`);
ok("RPCs refuse another tenant's place", /location_not_found/.test(r.err ?? ""), r);
r = await as(A, `select public.receive_stock_rpc('${id.Milk}','${fridge1}',-1)`);
ok("RPCs refuse bad quantities", /invalid_input/.test(r.err ?? ""), r);

// ---- stock options for the transfer screen
const options = async (uid, args) => as(uid, `select * from public.transfer_stock_options(${args})`);
r = await options(A, `'${b1}', null, 'mil'`);
ok("options: search by name, expired stock excluded, nearest expiry (FEFO)", !r.err && r.rows.length === 1 &&
  Number(r.rows[0].available) === 6 && String(r.rows[0].nearest_expiry?.toISOString?.() ?? r.rows[0].nearest_expiry).startsWith(soon), r.rows);
r = await options(A, `'${b1}', null, '${code.Rice}'`);
ok("options: search by ALO code", r.rows?.length === 1 && r.rows[0].product_id === id.Rice, r);
r = await options(A, `'${b1}', null, '4600000000001'`);
ok("options: search by barcode, exact match first", r.rows?.[0]?.product_id === id.Milk, r);
r = await options(A, `'${b1}', '${dry1}', null`);
ok("options: one place of the branch only", r.rows?.every((row) => row.product_id !== id.Milk), r);
r = await options(A, `'${b2}', null, null, array['${id.Salt}','${id.Milk}']::uuid[]`);
ok("options: requested products with zero when out of stock", r.rows?.length === 2 && Number(r.rows.find((x) => x.product_id === id.Salt).available) === 0, r);
r = await options(A, `'${b1}', null, '%'`);
ok("options: LIKE wildcards are literal", !r.err && r.rows.length === 0, r);
ok("options: cooks refused", /forbidden/.test((await options(C, `'${b1}'`)).err ?? ""));
ok("options: another tenant's branch refused", /branch_not_found/.test((await options(A, `'${mBranch}'`)).err ?? ""));

// ---- step 2: no direct inserts at all
for (const run of [1, 2]) {
  failure = await apply([STEP2]);
  ok(`${STEP2} applies (run ${run})`, !failure, failure);
}
r = await directTransfer(C);
ok("revoked: cook direct transfer insert refused", /permission denied/.test(r.err ?? ""), r);
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, unit) values ('${tA}','${id.Salt}','${b1}','${dry1}',1,'prihod','kg')`);
ok("revoked: owner direct receipt insert refused", /permission denied/.test(r.err ?? ""), r);
r = await as(C, `insert into stock_movements(tenant_id, product_id, branch_id, from_location_id, quantity, movement_type) values ('${tA}','${id.Rice}','${b1}','${dry1}',1,'spisanie')`);
ok("revoked: cook direct write-off insert refused", /permission denied/.test(r.err ?? ""), r);
r = await as(A, `select public.receive_stock_rpc('${id.Salt}','${dry1}',2)`);
const r2 = await as(C, `select public.wastage_stock_rpc('${id.Salt}','${dry1}',1)`);
const r3 = await as(A, `select public.transfer_stock_between_branches('${b1}','${b2}','[{"product_id":"${id.Salt}","quantity":1}]'::jsonb) t`);
ok("revoked: receipts, write-offs and transfers still work through RPCs", !r.err && !r2.err && r3.rows?.[0]?.t?.ok === true, { r, r2, r3 });
r = await as(C, `select count(*) n from stock_movements`);
ok("revoked: members still read the movement log", !r.err && Number(r.rows[0].n) > 0, r);
r = await sys(`select count(*) n from stock_movements where movement_type='transfer' and branch_transfer_id is null`);
ok("every transfer movement belongs to a document", Number(r.rows[0].n) === 0, r);

done();
