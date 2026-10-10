// 20261023000000_inventory_tasks.sql: chef-assigned blind counts in two modes. control_parallel: three
// cooks count one zone, the merge takes their average against the expected balance; fast_zones: one
// cook per zone. Cooks see only their own work, never the expected quantity; other tenants nothing.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/inventory_tasks.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261023000000_inventory_tasks.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
// Each later file is applied twice in a row (idempotent), in deploy order.
for (const file of migrationFiles.filter((f) => f >= FILE)) {
  for (const run of [1, 2]) {
    failure = await apply([file]);
    ok(`${file} applies (run ${run})`, !failure, failure);
  }
}

const [A, H, C1, C2, C3, B] = [U("0a"), U("0f"), U("01"), U("02"), U("03"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${H}','chef@acme.az'),
  ('${C1}','c1@acme.az'),('${C2}','c2@acme.az'),('${C3}','c3@acme.az'),('${B}','bob@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
for (const [uid, role] of [[H, "chef"], [C1, "cook"], [C2, "cook"], [C3, "cook"]]) {
  await as(A, `insert into memberships(user_id, tenant_id, role) values ('${uid}','${tA}','${role}')`);
  await q(`update profiles set tenant_id='${tA}' where id='${uid}'`);
}
const branch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
const branchB = (await q(`select id from branches where tenant_id='${tB}'`))[0].id;

// ---- default zones
// One per kind, found by type (dry / cold / frozen); the receiving zone is a custom place found by name.
const RECEIVING = ["Qəbul zonası", "Зона приёмки", "Receiving"];
const zonesOf = async (b) =>
  q(
    `select id, name, type from storage_locations
     where branch_id = $1 and (type in ('quru', 'soyuducu', 'dondurucu') or name = any($2))
     order by array_position(array['quru', 'soyuducu', 'dondurucu', 'custom'], type), number`,
    [b, RECEIVING],
  );
let zones = await zonesOf(branch);
const kinds = (list) => list.map((z) => z.type).join(",");
ok("the migration seeded 4 default zones per branch, one per kind", zones.length === 4 && kinds(zones) === "quru,soyuducu,dondurucu,custom" &&
  kinds(await zonesOf(branchB)) === "quru,soyuducu,dondurucu,custom", zones);
let r = await as(H, `select public.ensure_default_zones('${branch}') n`);
ok("ensure_default_zones is idempotent", !r.err && r.rows[0].n === 0, r);
r = await as(C1, `select public.ensure_default_zones('${branch}')`);
ok("a cook cannot seed zones", /forbidden/.test(r.err ?? ""), r);
r = await as(H, `select public.ensure_default_zones('${branchB}')`);
ok("nor a chef in another tenant", /forbidden/.test(r.err ?? ""), r);
const [meat, veg] = [zones[0].id, zones[1].id];
r = await as(C1, `select count(*)::int n from storage_zones where branch_id='${branch}'`);
const rB = await as(B, `select count(*)::int n from storage_zones where branch_id='${branch}'`);
ok("storage_zones follows the tenant's RLS", !r.err && r.rows[0].n >= 4 && rB.rows?.[0]?.n === 0, [r, rB]);

// ---- staff and stock
r = await as(H, `select user_id, role from public.inventory_staff('${branch}')`);
ok("chef lists the branch staff, cooks first", !r.err && r.rows.length === 5 && r.rows[0].role === "cook", r);
r = await as(C1, `select * from public.inventory_staff('${branch}')`);
ok("a cook cannot list staff", /forbidden/.test(r.err ?? ""), r);

const product = (await as(A, `insert into products(name, unit, storage_location_id) values ('Mal əti','kg','${meat}') returning id`)).rows[0].id;
r = await as(A, `select * from public.receive_stock_with_lot('${product}', 10, '${meat}', 5)`);
ok("10 kg of meat at 5 per kg", !r.err, r);

// ---- control_parallel: validation
const create = (who, mode, pairs, title = "Weekly control") =>
  as(who, `select public.create_inventory_task('${branch}', '${mode}', '${title}', '${JSON.stringify(pairs)}'::jsonb) id`);
r = await create(C1, "control_parallel", [{ zone_id: meat, assignee_id: C1 }, { zone_id: meat, assignee_id: C2 }]);
ok("a cook cannot create tasks", /forbidden/.test(r.err ?? ""), r);
r = await create(H, "control_parallel", [{ zone_id: meat, assignee_id: C1 }]);
ok("parallel control needs at least 2 cooks", /invalid_input/.test(r.err ?? ""), r);
r = await create(H, "control_parallel", [{ zone_id: meat, assignee_id: C1 }, { zone_id: veg, assignee_id: C2 }]);
ok("parallel control is one zone", /invalid_input/.test(r.err ?? ""), r);
r = await create(H, "control_parallel", [{ zone_id: meat, assignee_id: C1 }, { zone_id: meat, assignee_id: C1 }]);
ok("the same cook twice", /invalid_input/.test(r.err ?? ""), r);
r = await create(H, "control_parallel", [{ zone_id: meat, assignee_id: C1 }, { zone_id: meat, assignee_id: B }]);
ok("a stranger cannot be assigned", /assignee_not_found/.test(r.err ?? ""), r);
const zoneB = (await zonesOf(branchB))[0].id;
r = await create(H, "fast_zones", [{ zone_id: zoneB, assignee_id: C1 }]);
ok("another tenant's zone", /location_not_found/.test(r.err ?? ""), r);
r = await create(H, "control_parallel", [{ zone_id: meat, assignee_id: C1 }, { zone_id: meat, assignee_id: C2 }], "  ");
ok("a title is required", /invalid_input/.test(r.err ?? ""), r);

r = await create(H, "control_parallel", [C1, C2, C3].map((c) => ({ zone_id: meat, assignee_id: c })));
const task = r.rows?.[0]?.id;
ok("chef creates a parallel control for 3 cooks", !r.err && !!task, r);
r = await create(H, "fast_zones", [{ zone_id: meat, assignee_id: C1 }]);
ok("the zone is already being counted", /open_count/.test(r.err ?? ""), r);
r = await as(A, `insert into inventory_tasks(tenant_id, branch_id, mode, title) values ('${tA}','${branch}','fast_zones','x')`);
ok("no direct writes", !!r.err, r);

// ---- what a cook sees
r = await as(C1, `select id, status from task_assignees`);
ok("a cook sees only their own assignment", !r.err && r.rows.length === 1, r);
const a1 = r.rows[0].id;
const assignment = async (uid) => (await as(uid, `select id from task_assignees`)).rows[0].id;
const [a2, a3] = [await assignment(C2), await assignment(C3)];
r = await as(C1, `select id from inventory_tasks`);
ok("and their task", r.rows?.length === 1 && r.rows[0].id === task, r);
r = await as(H, `select id from task_assignees where task_id='${task}'`);
ok("the chef sees all three", r.rows?.length === 3, r);
r = await as(B, `select id from inventory_tasks union all select id from task_assignees`);
ok("another tenant sees nothing", !r.err && r.rows.length === 0, r);

r = await as(C1, `select public.start_task_assignment('${a1}') count_id`);
const countId = r.rows?.[0]?.count_id;
ok("start returns the zone's count", !r.err && !!countId, r);
r = await as(C1, `select * from public.count_products_page('${meat}', 0, 50)`);
ok("the product list has name and unit only", !r.err && r.rows.length === 1 && Object.keys(r.rows[0]).sort().join() === "id,name,total_count,unit", r);
r = await as(C2, `select public.start_task_assignment('${a1}')`);
ok("nobody else's assignment", /task_not_found/.test(r.err ?? ""), r);

const submit = (uid, id, qty) => as(uid, `select public.submit_task_assignment('${id}', '[{"product_id":"${product}","quantity":${qty}}]'::jsonb) s`);
r = await submit(C1, a1, 9);
ok("cook 1 sends 9", !r.err && r.rows[0].s === "in_progress", r);
r = await submit(C1, a1, 1);
ok("only once", /already_submitted/.test(r.err ?? ""), r);
r = await as(C1, `select user_id, is_blind from stock_count_items`);
ok("cook 1 reads only their own blind entry", !r.err && r.rows.length === 1 && r.rows[0].user_id === C1 && r.rows[0].is_blind === true, r);
r = await as(C1, `select system_quantity from stock_count_items`);
ok("the expected column stays hidden", /permission denied/.test(r.err ?? ""), r);
r = await submit(C2, a2, 9);
r = await as(C2, `select user_id from stock_count_items`);
ok("cook 2 does not see cook 1", r.rows?.length === 1 && r.rows[0].user_id === C2, r);
r = await as(C1, `select * from public.stock_count_lines('${countId}')`);
ok("no expected quantity while counting", !r.err && r.rows.every((row) => row.expected_quantity == null), r);

r = await as(C1, `select * from public.inventory_discrepancy_lines()`);
ok("a cook cannot open the report", /forbidden/.test(r.err ?? ""), r);
r = await submit(C3, a3, 6);
ok("the last cook completes the task", !r.err && r.rows[0].s === "completed", r);
r = await q(`select status from stock_counts where id='${countId}'`);
ok("the zone waits for approval", r[0].status === "merging", r);
r = await q(`select counted_quantity::float8 c, system_quantity::float8 s from stock_count_items where stock_count_id='${countId}' and user_id is null`);
ok("merged: average 8 against 10 expected", r.length === 1 && r[0].c === 8 && r[0].s === 10, r);

r = await as(A, `select * from public.inventory_discrepancy_lines('${branch}')`);
const line = r.rows?.[0];
ok("owner report: expected, three counts, unit cost from the database",
  !r.err && r.rows.length === 1 && Number(line.expected_quantity) === 10 && line.counts.length === 3 && Number(line.unit_cost) === 5 && line.mode === "control_parallel", r);
r = await as(A, `select * from public.inventory_discrepancy_lines('${branch}', current_date + 1)`);
ok("date filter", !r.err && r.rows.length === 0, r);
r = await as(B, `select * from public.inventory_discrepancy_lines()`);
ok("another owner gets nothing", !r.err && r.rows.length === 0, r);
r = await as(C1, `select * from public.stock_count_lines('${countId}')`);
ok("cooks still cannot see the expected quantity", !r.err && r.rows.every((row) => row.expected_quantity == null), r);

r = await as(H, `select public.approve_stock_count('${countId}')`);
ok("chef approves through the usual flow", !r.err, r);
r = await q(`select coalesce(sum(quantity),0)::float8 q from product_stocks where product_id='${product}' and location_id='${meat}'`);
ok("stock becomes the counted 8 kg", r[0].q === 8, r);

// ---- fast_zones and cancel
r = await create(H, "fast_zones", [{ zone_id: meat, assignee_id: C1 }, { zone_id: meat, assignee_id: C2 }], "Daily");
ok("one cook per zone", /invalid_input/.test(r.err ?? ""), r);
r = await create(H, "fast_zones", [{ zone_id: meat, assignee_id: C1 }, { zone_id: veg, assignee_id: C2 }], "Daily");
const daily = r.rows?.[0]?.id;
ok("chef splits zones between cooks", !r.err && !!daily, r);
r = await q(`select count(distinct stock_count_id)::int n from task_assignees where task_id='${daily}'`);
ok("one count per zone", r[0].n === 2, r);
r = await as(C1, `select public.cancel_inventory_task('${daily}')`);
ok("a cook cannot cancel", /forbidden/.test(r.err ?? ""), r);
r = await as(H, `select public.cancel_inventory_task('${daily}')`);
ok("chef cancels", !r.err, r);
r = await q(`select t.status ts, array_agg(distinct c.status) cs from inventory_tasks t join task_assignees a on a.task_id=t.id join stock_counts c on c.id=a.stock_count_id where t.id='${daily}' group by t.status`);
ok("task and its counts are cancelled", r[0].ts === "cancelled" && r[0].cs.join() === "cancelled", r);
r = await as(C1, `select public.submit_task_assignment((select id from task_assignees where task_id='${daily}'), '[{"product_id":"${product}","quantity":1}]'::jsonb)`);
ok("a cancelled task takes no counts", /task_closed/.test(r.err ?? ""), r);

// ---- 20261025000000_inventory_close.sql: closing, reveal, reasons, reads
r = await as(C1, `select * from public.close_inventory_task('${task}')`);
ok("a cook cannot close", /forbidden/.test(r.err ?? ""), r);
r = await as(H, `select total_loss::float8 l, total_surplus::float8 s from public.close_inventory_task('${task}')`);
ok("closing the parallel task: 2 kg short x 5 = 10 lost", !r.err && r.rows[0].l === 10 && r.rows[0].s === 0, r);
r = await q(`select status, closed_by, total_loss::float8 l from inventory_tasks where id='${task}'`);
ok("the task is closed by the chef with its loss", r[0].status === "closed" && r[0].closed_by === H && r[0].l === 10, r);
r = await as(H, `select * from public.close_inventory_task('${task}')`);
ok("only once", /task_closed/.test(r.err ?? ""), r);
r = await as(C1, `select my_quantity::float8 m, expected_quantity::float8 e, revealed from public.my_assignment_lines('${a1}')`);
ok("after closing the cook sees the expected balance", !r.err && r.rows[0].revealed && r.rows[0].m === 9 && r.rows[0].e === 10, r);
r = await as(C2, `select * from public.my_assignment_lines('${a1}')`);
ok("not someone else's lines", /task_not_found/.test(r.err ?? ""), r);
r = await as(C1, `select open_count, sent_count, accuracy::float8 a from public.my_inventory_stats()`);
ok("cook accuracy 9 against 10 = 90%", !r.err && r.rows[0].sent_count === 1 && r.rows[0].a === 90, r);

r = await create(H, "fast_zones", [{ zone_id: meat, assignee_id: C1 }, { zone_id: veg, assignee_id: C2 }], "Evening");
const evening = r.rows?.[0]?.id;
ok("a new fast task", !r.err && !!evening, r);
r = await as(C1, `select assignment_id, product_count, peers_total from public.my_inventory_tasks() where task_id='${evening}'`);
const e1 = r.rows?.[0]?.assignment_id;
ok("the cook's task list with the zone's product count", !r.err && r.rows.length === 1 && r.rows[0].product_count === 1 && r.rows[0].peers_total === 0, r);
r = await as(C1, `select expected_quantity, revealed from public.my_assignment_lines('${e1}')`);
ok("blind before sending", !r.err && r.rows.length === 1 && r.rows[0].expected_quantity === null && !r.rows[0].revealed, r);
r = await submit(C1, e1, 7);
r = await as(C1, `select expected_quantity::float8 e from public.my_assignment_lines('${e1}')`);
ok("fast_zones: revealed to the cook once sent", !r.err && r.rows[0].e === 8, r);
r = await as(H, `select expected_quantity::float8 e, counts from public.inventory_task_lines('${evening}')`);
ok("chef sees the line live", !r.err && r.rows.length === 1 && r.rows[0].e === 8 && r.rows[0].counts.length === 1, r);
r = await as(C1, `select * from public.inventory_task_lines('${evening}')`);
ok("cooks cannot read task lines", /forbidden/.test(r.err ?? ""), r);
r = await as(H, `select total_loss::float8 l from public.close_inventory_task('${evening}')`);
ok("forced close: the counted zone is written off (1 kg x 5)", !r.err && r.rows[0].l === 5, r);
r = await q(`select array_agg(c.status order by l.name) s from task_assignees a join stock_counts c on c.id=a.stock_count_id join storage_locations l on l.id=a.zone_id where a.task_id='${evening}'`);
ok("the zone nobody sent is cancelled", r[0].s.includes("cancelled") && r[0].s.includes("approved"), r);
r = await q(`select coalesce(sum(quantity),0)::float8 q from product_stocks where product_id='${product}' and location_id='${meat}'`);
ok("stock is the counted 7 kg", r[0].q === 7, r);

const eveningCount = (await q(`select stock_count_id id from task_assignees where task_id='${evening}' and zone_id='${meat}'`))[0].id;
r = await as(H, `select public.set_discrepancy_reason('${eveningCount}', '${product}', 'theft')`);
ok("chef sets a reason", !r.err, r);
r = await as(H, `select public.set_discrepancy_reason('${eveningCount}', '${product}', 'aliens')`);
ok("unknown reason", /invalid_input/.test(r.err ?? ""), r);
r = await as(C1, `select public.set_discrepancy_reason('${eveningCount}', '${product}', null)`);
ok("a cook cannot set reasons", /forbidden/.test(r.err ?? ""), r);
r = await as(A, `select task_status, discrepancy_reason, counted_quantity::float8 c from public.inventory_discrepancy_lines('${branch}', null, null, '${evening}')`);
ok("the report includes closed tasks with their reason", !r.err && r.rows.length === 1 && r.rows[0].task_status === "closed" && r.rows[0].discrepancy_reason === "theft" && r.rows[0].c === 7, r);
r = await as(H, `select id, status, submitted, assigned, zones, assignees, total_count from public.inventory_task_board('${branch}')`);
ok("chef board lists the tasks with zones and assignees", !r.err && r.rows.length === 3 && Number(r.rows[0].total_count) === 3 && r.rows.every((row) => row.zones.length >= 1 && row.assignees.length >= 1), r);
r = await as(H, `select active, finished, awaiting from public.inventory_task_counts('${branch}')`);
ok("chef counters", !r.err && r.rows[0].active === 0 && r.rows[0].finished === 2 && r.rows[0].awaiting === 0, r);
r = await as(C1, `select * from public.inventory_task_board()`);
ok("cooks have no board", /forbidden/.test(r.err ?? ""), r);

done();
