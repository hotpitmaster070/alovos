// 20261028000800_branch_transfers_transaction.sql: a transfer between two branches is one transaction.
// Tenant from the membership only, both branches/products/places checked, all rows locked and every item
// checked before writing; shortages abort everything and list every short product; a failure while
// writing rolls back the moves already made. Expiry and cost travel with the stock; labels untouched.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/branch_transfers.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261028000800_branch_transfers_transaction.sql";
const { ok, done } = reporter();
const { q, as, sys, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= FILE));
  ok(`${FILE} and later apply (run ${run})`, !failure, failure);
}

const [A, H, C, M] = [U("9a"), U("9b"), U("9c"), U("9d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@a.io'),('${H}','chef@a.io'),('${C}','cook@a.io'),('${M}','owner@m.io')`);
const tenantOf = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const [tA, tM] = [await tenantOf(A), await tenantOf(M)];
for (const [uid, role] of [[H, "chef"], [C, "cook"]]) {
  await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}

// Branches and places: the first branch exists; a second one gets a fridge and a dry store.
const b1 = (await q(`select id from branches where tenant_id='${tA}' order by created_at limit 1`))[0].id;
const b2 = (await as(A, `insert into branches(tenant_id, name) values ('${tA}','Second') returning id`)).rows[0].id;
const placeOf = async (branch, type) => {
  const found = await q(`select id from storage_locations where branch_id='${branch}' and type='${type}' and is_active order by number limit 1`);
  if (found[0]) return found[0].id;
  return (await as(A, `insert into storage_locations(tenant_id, branch_id, name, type) values ('${tA}','${branch}','${type} ${branch.slice(-4)}','${type}') returning id`)).rows[0].id;
};
const [fridge1, dry1, fridge2, dry2] = [await placeOf(b1, "soyuducu"), await placeOf(b1, "quru"), await placeOf(b2, "soyuducu"), await placeOf(b2, "quru")];
const mBranch = (await q(`select id from branches where tenant_id='${tM}' limit 1`))[0].id;
ok("places in both branches", [fridge1, dry1, fridge2, dry2].every(Boolean));

const today = (await q(`select public.tenant_today('${tA}')::text d`))[0].d;
const day = async (n) => (await q(`select ($1::date + $2::int)::text d`, [today, n]))[0].d;
const [past, soon, later] = [await day(-2), await day(3), await day(10)];

const products = (await as(A, `insert into products(tenant_id, name, unit) values ('${tA}','Milk','l'),('${tA}','Rice','kg') returning id, name`)).rows;
const milk = products.find((p) => p.name === "Milk").id;
const rice = products.find((p) => p.name === "Rice").id;
const mProduct = (await as(M, `insert into products(tenant_id, name, unit) values ('${tM}','Foreign','kg') returning id`)).rows[0].id;
const seed = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date) values
  ('${tA}','${milk}','${b1}','${fridge1}',3,'prihod',1,'l','${past}'),
  ('${tA}','${milk}','${b1}','${fridge1}',2,'prihod',3,'l','${soon}'),
  ('${tA}','${milk}','${b1}','${fridge1}',5,'prihod',2,'l','${later}'),
  ('${tA}','${rice}','${b1}','${dry1}',4,'prihod',1.5,'kg',null)`);
ok("seed stock in branch 1 (one milk row expired)", !seed.err, seed);

await q(`create or replace function test_transfer(p_from uuid, p_to uuid, p_items jsonb) returns jsonb language plpgsql as $$
declare v_detail text;
begin
  return public.transfer_stock_between_branches(p_from, p_to, p_items);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return jsonb_build_object('error', sqlerrm, 'detail', nullif(v_detail, ''));
end $$`);
const transfer = async (uid, from, to, items) => {
  const r = await as(uid, "select test_transfer($1, $2, $3::jsonb) r", [from, to, JSON.stringify(items)]);
  return r.err ? { error: r.err } : r.rows[0].r;
};
const snapshot = async () => JSON.stringify(await q(`select product_id, location_id, branch_id, expiry_date::text e, quantity::text, cost_per_unit::text c
  from product_stocks where tenant_id='${tA}' order by product_id, location_id, expiry_date nulls last`)) +
  (await q(`select count(*) n from stock_movements where tenant_id='${tA}'`))[0].n +
  (await q(`select count(*) n from branch_transfers`))[0].n;
const qty = async (product, branch) => Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where product_id='${product}' and branch_id='${branch}'`))[0].s);
const lotsBefore = Number((await q(`select count(*) n from product_lots where tenant_id='${tA}'`))[0].n);

// ---- happy path
let res = await transfer(A, b1, b2, [{ product_id: milk, quantity: 4 }, { product_id: rice, quantity: 1.5 }]);
ok("owner transfers two products in one call", res.ok === true && res.items === 2 && res.movements === 3 && Number(res.quantity) === 5.5, res);
const transferId = res.transfer_id;
const target = await q(`select location_id, branch_id, expiry_date::text e, quantity::numeric q, cost_per_unit::numeric c from product_stocks
  where product_id='${milk}' and branch_id='${b2}' and quantity > 0 order by expiry_date`);
ok("milk arrives FEFO with its own dates and costs, expired stock stays", target.length === 2 &&
  target[0].e === soon && Number(target[0].q) === 2 && Number(target[0].c) === 3 &&
  target[1].e === later && Number(target[1].q) === 2 && Number(target[1].c) === 2 &&
  target.every((t) => t.location_id === fridge2 && t.branch_id === b2), target);
ok("source keeps the expired row and the rest", (await qty(milk, b1)) === 6 &&
  Number((await q(`select quantity q from product_stocks where product_id='${milk}' and branch_id='${b1}' and expiry_date='${past}'`))[0].q) === 3);
ok("rice lands in the same type of place", (await qty(rice, b2)) === 1.5 && (await qty(rice, b1)) === 2.5 &&
  (await q(`select location_id from product_stocks where product_id='${rice}' and branch_id='${b2}'`))[0].location_id === dry2);
const moves = await q(`select movement_type, branch_id, from_location_id, to_location_id, branch_transfer_id from stock_movements where branch_transfer_id='${transferId}'`);
ok("one 'transfer' movement per source row, linked to the document", moves.length === 3 && moves.every((m) => m.movement_type === "transfer" && m.branch_id === b2));
const doc = await q(`select from_branch_id, to_branch_id, created_by, (select count(*) from branch_transfer_items i where i.transfer_id = t.id) n from branch_transfers t where id='${transferId}'`);
ok("transfer document with its items and author", doc[0]?.from_branch_id === b1 && doc[0].to_branch_id === b2 && doc[0].created_by === A && Number(doc[0].n) === 2, doc);
ok("product_lots (labels) untouched", Number((await q(`select count(*) n from product_lots where tenant_id='${tA}'`))[0].n) === lotsBefore);

// ---- shortage: everything or nothing, every short item listed
let before = await snapshot();
res = await transfer(A, b1, b2, [{ product_id: milk, quantity: 100 }, { product_id: rice, quantity: 1 }]);
const short = res.detail ? JSON.parse(res.detail) : [];
ok("shortage aborts the whole transfer", res.error === "insufficient_stock" && (await snapshot()) === before, res);
ok("shortage detail names the product and what is available (expired excluded)", short.length === 1 && short[0].product_id === milk &&
  Number(short[0].requested) === 100 && Number(short[0].available) === 3, short);
res = await transfer(A, b1, b2, [{ product_id: milk, quantity: 100 }, { product_id: rice, quantity: 100 }]);
ok("all short products are reported at once", res.error === "insufficient_stock" && JSON.parse(res.detail).length === 2, res);

// ---- failure while writing: moves already made are rolled back
const last = [milk, rice].sort().at(-1);
await q(`create function test_fail() returns trigger language plpgsql as $$ begin
  if new.product_id = '${last}' and new.movement_type = 'transfer' then raise exception 'boom'; end if; return new; end $$`);
await q(`create trigger test_fail before insert on stock_movements for each row execute function test_fail()`);
before = await snapshot();
res = await transfer(A, b1, b2, [{ product_id: milk, quantity: 1 }, { product_id: rice, quantity: 1 }]);
ok("failure on the second product rolls back the first", res.error === "boom" && (await snapshot()) === before, res);
await q(`drop trigger test_fail on stock_movements`);
await q(`drop function test_fail()`);

// ---- isolation and roles
ok("cook is refused", (await transfer(C, b1, b2, [{ product_id: milk, quantity: 1 }])).error === "forbidden");
ok("chef may transfer", (await transfer(H, b2, b1, [{ product_id: rice, quantity: 0.5 }])).ok === true);
ok("other tenant cannot move from these branches", (await transfer(M, b1, b2, [{ product_id: milk, quantity: 1 }])).error === "from_branch_not_found");
ok("cannot send to another tenant's branch", (await transfer(A, b1, mBranch, [{ product_id: milk, quantity: 1 }])).error === "to_branch_not_found");
ok("another tenant's product is refused", (await transfer(A, b1, b2, [{ product_id: mProduct, quantity: 1 }])).error === "product_not_found");
ok("target place must be in the target branch", (await transfer(A, b1, b2, [{ product_id: milk, quantity: 1, to_location_id: fridge1 }])).error === "location_not_found");
ok("source place must be in the source branch", (await transfer(A, b1, b2, [{ product_id: milk, quantity: 1, from_location_id: fridge2 }])).error === "location_not_found");
ok("same branch refused", (await transfer(A, b1, b1, [{ product_id: milk, quantity: 1 }])).error === "same_branch");
const invalid = [
  [], [{ product_id: milk, quantity: 0 }], [{ product_id: milk, quantity: "1" }], [{ product_id: "x", quantity: 1 }],
  [{ product_id: milk, quantity: 1 }, { product_id: milk, quantity: 2 }], [{ product_id: milk, quantity: 1, to_location_id: "nope" }],
];
let allInvalid = true;
for (const items of invalid) allInvalid = allInvalid && (await transfer(A, b1, b2, items)).error === "invalid_input";
ok("malformed items refused", allInvalid);
ok("anon cannot call", (await q(`select has_function_privilege('anon','public.transfer_stock_between_branches(uuid,uuid,jsonb,text)','execute') p`))[0].p === false);
const direct = await as(A, `insert into branch_transfers(tenant_id, from_branch_id, to_branch_id) values ('${tA}','${b1}','${b2}')`);
ok("documents cannot be written directly", /permission denied/.test(direct.err ?? ""), direct);
ok("documents readable only inside the tenant", (await as(M, `select count(*) n from branch_transfers`)).rows[0].n == 0 &&
  (await as(A, `select count(*) n from branch_transfers`)).rows[0].n >= 1);

// ---- explicit source place, open count blocks
res = await transfer(A, b1, b2, [{ product_id: rice, quantity: 1, from_location_id: dry1, to_location_id: dry2 }]);
ok("explicit source and target places", res.ok === true && (await qty(rice, b1)) === 2, res);
await q(`insert into stock_counts(tenant_id, location_id, user_id) values ('${tA}','${fridge2}','${A}')`);
before = await snapshot();
res = await transfer(A, b1, b2, [{ product_id: milk, quantity: 1 }]);
ok("an open count at the target blocks the transfer", res.error === "open_count" && (await snapshot()) === before, res);

done();
