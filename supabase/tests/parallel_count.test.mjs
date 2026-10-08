// 20261011_parallel_count.sql: three people count one storage place in parallel, nothing moves
// stock until a chef approves, the approval runs once and brings each counted product to the
// counted quantity. Blind counting, roles, merge modes and legacy counts.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/parallel_count.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const COUNT = "20261011_parallel_count.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < COUNT));
ok(`migrations before ${COUNT} apply`, !failure, failure);

// ---- tenant A: owner, chef, two cooks, staff
const [A, H, C1, C2, S] = [U("0a"), U("0b"), U("0c"), U("0d"), U("05")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${H}','chef@acme.az'),('${C1}','c1@acme.az'),('${C2}','c2@acme.az'),('${S}','staff@acme.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
for (const [uid, role] of [[H, "chef"], [C1, "cook"], [C2, "cook"], [S, "staff"]]) {
  const r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  ok(`owner adds ${role}`, !r.err, r);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branchA = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const [storeA, storeB] = (await q(`select id from storage_locations where tenant_id='${tA}' order by name`)).map((row) => row.id);

let r = await as(A, `insert into products(tenant_id, name, cost, unit, storage_location_id) values
  ('${tA}','Milk',2,'l',null),('${tA}','Rice',1,'kg',null),('${tA}','Beans',3,'kg','${storeA}'),('${tA}','Salt',1,'kg','${storeB}')
  returning id, name`);
const id = Object.fromEntries(r.rows.map((row) => [row.name, row.id]));
r = await as(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit, expiry_date) values
  ('${tA}','${id.Milk}','${branchA}','${storeA}',6,'prihod',2,'l','2026-11-01'),
  ('${tA}','${id.Milk}','${branchA}','${storeA}',4,'prihod',2.5,'l','2026-12-01'),
  ('${tA}','${id.Rice}','${branchA}','${storeA}',5,'prihod',1,'kg',null)`);
ok("seed lots: milk 10, rice 5 at the place", !r.err, r);

// ---- a count made the old way (it already moved stock)
await q(`insert into stock_counts(tenant_id, location_id, user_id) values ('${tA}','${storeA}','${C1}')`);
const legacy = (await q("select id from stock_counts"))[0].id;
await q(`insert into stock_count_items(tenant_id, stock_count_id, product_id, counted_quantity) values ('${tA}','${legacy}','${id.Rice}',5)`);

for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= COUNT));
  ok(`${COUNT} and later apply (run ${run})`, !failure, failure);
}
const old = (await q(`select status, approved_by, branch_id from stock_counts where id='${legacy}'`))[0];
ok("legacy count is approved, attributed and has its branch", old.status === "approved" && old.approved_by === C1 && old.branch_id === branchA, old);
ok("legacy entry keeps its counter", (await q(`select user_id from stock_count_items where stock_count_id='${legacy}'`))[0].user_id === C1);

const balance = async (product, location = storeA) =>
  Number((await q(`select coalesce(sum(quantity),0) s from product_stocks where product_id='${product}' and location_id='${location}'`))[0].s);
const countMoves = async () => Number((await q("select count(*) c from stock_movements where movement_type='count'"))[0].c);
const call = (uid, sql, params) => as(uid, sql, params);
const save = (uid, count, items) => call(uid, "select public.save_stock_count_items($1, $2::jsonb) n", [count, JSON.stringify(items)]);

// ---- three people open the same place
r = await call(C1, "select public.start_stock_count($1, 'friday') id", [storeA]);
const countId = r.rows?.[0]?.id;
ok("cook 1 starts the count (draft -> counting)", !r.err && countId, r);
r = await call(C2, "select public.start_stock_count($1) id", [storeA]);
ok("cook 2 joins the same document", r.rows?.[0]?.id === countId, r);
r = await call(H, "select public.start_stock_count($1) id", [storeA]);
ok("chef joins the same document", r.rows?.[0]?.id === countId, r);
ok("one open count for the place, status counting",
  (await q(`select count(*)::int c, max(status) s from stock_counts where location_id='${storeA}' and status in ('draft','counting','merging')`))[0].s === "counting");
r = await call(S, "select public.start_stock_count($1) id", [storeA]);
ok("staff cannot count", /forbidden/.test(r.err ?? ""), r);

r = await save(C1, countId, [{ product_id: id.Milk, quantity: 7 }, { product_id: id.Rice, quantity: 5 }]);
ok("cook 1 saves milk 7, rice 5", !r.err && r.rows[0].n === 2, r);
await q("select pg_sleep(0.01)");
r = await save(C2, countId, [{ product_id: id.Milk, quantity: 8 }]);
ok("cook 2 saves milk 8 (later)", !r.err, r);
r = await save(H, countId, [{ product_id: id.Beans, quantity: 3 }]);
ok("chef saves beans 3 (no stock yet)", !r.err, r);
r = await save(C1, countId, [{ product_id: id.Rice, quantity: 5 }]);
ok("saving again updates, not duplicates", !r.err && (await q(`select count(*)::int c from stock_count_items where stock_count_id='${countId}' and user_id='${C1}'`))[0].c === 2);
r = await save(C1, countId, [{ product_id: id.Milk, quantity: -1 }]);
ok("negative quantity rejected", /invalid_input/.test(r.err ?? ""), r);
r = await save(C1, countId, [{ product_id: id.Milk }]);
ok("missing quantity rejected", /invalid_input/.test(r.err ?? ""), r);

ok("counting did not touch stock", (await balance(id.Milk)) === 10 && (await balance(id.Rice)) === 5 && (await balance(id.Beans)) === 0);
ok("and wrote no movements", (await countMoves()) === 0);

// ---- blind and locked down
r = await call(C2, "select product_name, counted_quantity::float c, counters, expected_quantity, difference from public.stock_count_lines($1) order by product_name", [countId]);
const milkLine = r.rows?.find((row) => row.product_name === "Milk");
ok("merged list while counting: last entry wins (milk 8 from 2 counters)", milkLine && milkLine.c === 8 && milkLine.counters === 2, r);
ok("blind: no expected quantity or difference while counting", r.rows?.every((row) => row.expected_quantity === null && row.difference === null), r.rows);
r = await call(C1, "select system_quantity from stock_count_items");
ok("system_quantity not readable by clients", /permission denied/.test(r.err ?? ""), r);
r = await call(C1, `update stock_counts set status = 'approved' where id='${countId}'`);
ok("cook cannot change the status directly", /permission denied/.test(r.err ?? ""), r);
r = await call(C1, "select public.merge_stock_count($1)", [countId]);
ok("cook cannot merge", /forbidden/.test(r.err ?? ""), r);
r = await call(C1, "select public.approve_stock_count($1)", [countId]);
ok("cook cannot approve", /forbidden/.test(r.err ?? ""), r);
r = await call(H, "select public.approve_stock_count($1)", [countId]);
ok("approve before merge -> invalid_status", /invalid_status/.test(r.err ?? ""), r);
r = await call(C1, `insert into stock_counts(tenant_id, location_id, user_id, status) values ('${tA}','${storeB}','${C1}','approved')`);
ok("cook cannot insert an approved count", !!r.err, r);
r = await call(C1, `insert into stock_counts(tenant_id, location_id, user_id) values ('${tA}','${storeB}','${C1}') returning id`);
const draftB = r.rows?.[0]?.id;
ok("cook can create a draft", !r.err && draftB, r);

r = await call(C1, "select public.finish_my_stock_count($1)", [countId]);
ok("cook 1 finishes", !r.err, r);
r = await save(C1, countId, [{ product_id: id.Milk, quantity: 1 }]);
ok("finished counter cannot change entries", /already_finished/.test(r.err ?? ""), r);
r = await call(C1, `update stock_count_items set counted_quantity = 1 where stock_count_id='${countId}' and user_id='${C1}'`);
ok("not even directly", !r.err && r.affected === 0, r);
ok("counted_by lists the finished counter", (await q(`select counted_by from stock_counts where id='${countId}'`))[0].counted_by.includes(C1));

// ---- merge
r = await call(H, "select public.merge_stock_count($1) n", [countId]);
ok("chef merges: 3 products", !r.err && r.rows[0].n === 3, r);
r = await save(C2, countId, [{ product_id: id.Milk, quantity: 9 }]);
ok("no entries after the merge", /invalid_status/.test(r.err ?? ""), r);
r = await call(H, "select product_name, counted_quantity::float c, expected_quantity::float e, difference::float d, difference_value::float v from public.stock_count_lines($1)", [countId]);
const chefMilk = r.rows?.find((row) => row.product_name === "Milk");
ok("chef sees the discrepancies once merged (milk: should 10, counted 8, -2)", chefMilk && chefMilk.e === 10 && chefMilk.c === 8 && chefMilk.d === -2 && chefMilk.v === -4.4, r);
r = await call(C2, "select expected_quantity from public.stock_count_lines($1)", [countId]);
ok("cook still counts blind after the merge", r.rows?.every((row) => row.expected_quantity === null), r);
ok("merging did not touch stock either", (await balance(id.Milk)) === 10 && (await countMoves()) === 0);

// stock moves between merge and approval: approval still lands on the counted quantity
r = await call(A, `insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit) values ('${tA}','${id.Rice}','${branchA}','${storeA}',1,'prihod',1,'kg')`);
ok("a delivery of 1 kg rice arrives meanwhile", !r.err && (await balance(id.Rice)) === 6, r);

// ---- approve once
r = await call(H, "select public.approve_stock_count($1) n", [countId]);
ok("chef approves: 3 movements (milk -2, rice -1, beans +3)", !r.err && r.rows[0].n === 3, r);
ok("milk is 8, taken FEFO from the earliest lot", (await balance(id.Milk)) === 8 &&
  Number((await q(`select quantity from product_stocks where product_id='${id.Milk}' and expiry_date='2026-11-01'`))[0].quantity) === 4);
ok("rice is the counted 5", (await balance(id.Rice)) === 5);
ok("beans surplus became a lot of 3 in the place's branch, valued at the product cost",
  JSON.stringify(await q(`select quantity::float q, branch_id, cost_per_unit::float c from product_stocks where product_id='${id.Beans}'`)) === JSON.stringify([{ q: 3, branch_id: branchA, c: 3 }]));
const moves = await q(`select product_id, quantity::float q, from_location_id, to_location_id, branch_id, user_id, reason from stock_movements where movement_type='count' order by product_id`);
ok("exactly 3 count movements, by the approver, referencing the count", moves.length === 3 && moves.every((m) => m.user_id === H && m.reason === `stock_count ${countId}` && m.branch_id === branchA), moves);
const doc = (await q(`select status, approved_by, approved_at, merge_mode from stock_counts where id='${countId}'`))[0];
ok("document approved by the chef, mode recorded", doc.status === "approved" && doc.approved_by === H && doc.approved_at && doc.merge_mode === "last", doc);
const rice = (await q(`select system_quantity::float s, difference::float d from stock_count_items where stock_count_id='${countId}' and product_id='${id.Rice}' and user_id is null`))[0];
ok("report keeps the balance the difference was taken from (6 at approval)", rice.s === 6 && rice.d === -1, rice);

r = await call(A, "select public.approve_stock_count($1)", [countId]);
ok("second approval rejected", /invalid_status/.test(r.err ?? ""), r);
ok("stock changed once", (await countMoves()) === 3 && (await balance(id.Milk)) === 8 && (await balance(id.Rice)) === 5 && (await balance(id.Beans)) === 3);
r = await call(C2, "select expected_quantity::float e from public.stock_count_lines($1) where product_name = 'Milk'", [countId]);
ok("after approval the cook sees the report", r.rows?.[0]?.e === 10, r);
r = await call(A, `delete from stock_counts where id='${countId}'`);
ok("an approved count cannot be deleted", !r.err && r.affected === 0, r);

// ---- sum mode: two people count different shelves of the place
r = await call(A, "update tenant_settings set count_merge_mode = 'sum'");
ok("owner switches merge mode to sum", !r.err && r.affected === 1, r);
r = await call(C1, "select public.start_stock_count($1) id", [storeA]);
const second = r.rows?.[0]?.id;
ok("a new count opens after approval", second && second !== countId, r);
await save(C1, second, [{ product_id: id.Milk, quantity: 5 }]);
await save(C2, second, [{ product_id: id.Milk, quantity: 3 }]);
r = await call(H, "select public.merge_stock_count($1)", [second]);
r = await call(H, "select counted_quantity::float c, difference::float d from public.stock_count_lines($1)", [second]);
ok("sum mode: 5 + 3 = 8, no difference", r.rows?.[0]?.c === 8 && r.rows?.[0]?.d === 0, r);
r = await call(H, "select public.approve_stock_count($1) n", [second]);
ok("approval without differences writes nothing", !r.err && r.rows[0].n === 0 && (await countMoves()) === 3, r);

// ---- cancel, products of a place
r = await call(C1, "select public.start_stock_count($1) id", [storeB]);
ok("cook's draft for the second place is started", r.rows?.[0]?.id === draftB, r);
r = await call(C1, "select public.cancel_stock_count($1)", [draftB]);
ok("cook cannot cancel", /forbidden/.test(r.err ?? ""), r);
r = await call(H, "select public.cancel_stock_count($1)", [draftB]);
ok("chef cancels", !r.err && (await q(`select status from stock_counts where id='${draftB}'`))[0].status === "cancelled", r);
r = await call(C1, "select name, total_count::int t from public.count_products_page($1) order by name", [storeA]);
ok("place A lists its products (lots or default place), not Salt", JSON.stringify(r.rows?.map((row) => row.name)) === JSON.stringify(["Beans", "Milk", "Rice"]) && r.rows[0].t === 3, r);
r = await call(C1, "select name from public.count_products_page($1)", [storeB]);
ok("place B lists Salt only", JSON.stringify(r.rows?.map((row) => row.name)) === JSON.stringify(["Salt"]), r);
r = await call(C1, "select product_id, counted_quantity::float c from public.my_stock_count_items($1)", [second]);
ok("own entries only", r.rows?.length === 1 && r.rows[0].c === 5, r);

done();
