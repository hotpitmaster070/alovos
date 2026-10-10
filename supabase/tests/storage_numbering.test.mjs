// 20261015_storage_numbering.sql: fixed numbers per (branch, type), branch codes unique per tenant, bulk
// creation, display order, product/open-count overview, deactivation guard. Place codes are {TYPE}-{number}
// (SOY-1) since 20261028000300, unique per branch; 20261023 adds two default fridges to existing branches.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/storage_numbering.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const NUMBERING = "20261015_storage_numbering.sql";
const { ok, done } = reporter();
const { q, as, sys, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < NUMBERING));
ok(`migrations before ${NUMBERING} apply`, !failure, failure);

// ---- legacy data: tenants with branches and unnumbered places
const [A, C, B] = [U("0a"), U("0c"), U("0b")];
await q(`insert into auth.users(id,email) values ('${A}','owner@acme.az'),('${C}','cook@acme.az'),('${B}','other@beta.az')`);
const tA = (await q(`select tenant_id t from profiles where id='${A}'`))[0].t;
const tB = (await q(`select tenant_id t from profiles where id='${B}'`))[0].t;
let r = await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook')`);
ok("owner adds a cook", !r.err, r);
await q(`update profiles set tenant_id='${tA}' where id='${C}'`);
const mainBranch = (await q(`select id from branches where tenant_id='${tA}'`))[0].id;
const branchB = (await q(`select id from branches where tenant_id='${tB}'`))[0].id;
const branch = {};
for (const name of ["Nizami", "Nizami Mall", "Центр", "Şəki"]) {
  await q("select pg_sleep(0.002)");
  r = await as(A, `insert into branches(tenant_id, name) values ('${tA}','${name}') returning id`);
  ok(`seed branch ${name}`, !r.err, r);
  branch[name] = r.rows[0].id;
}
for (const name of ["Bar", "Mətbəx", "Desert"]) {
  await q("select pg_sleep(0.002)");
  r = await as(A, `insert into storage_locations(tenant_id, branch_id, name, type) values ('${tA}','${branch.Nizami}','${name}','soyuducu')`);
  ok(`seed legacy fridge ${name}`, !r.err, r);
}

failure = await applyTwice(migrationFiles.filter((f) => f >= NUMBERING));
ok(`${NUMBERING} and later apply, each twice`, !failure, failure);

// ---- branch codes
const codes = Object.fromEntries((await q(`select name, code from branches where tenant_id='${tA}'`)).map((row) => [row.name, row.code]));
ok("branch codes from the name, unique in the tenant", codes.Nizami === "NIZ" && codes["Nizami Mall"] === "NIZ2" && codes["Центр"] === "CEN" && codes["Şəki"] === "SEK", codes);
ok("every branch has a code", (await q("select count(*)::int c from branches where code is null or code !~ '^[A-Z0-9]{1,10}$'"))[0].c === 0);
r = await as(A, `insert into branches(tenant_id, name) values ('${tA}','Nizami 2') returning code`);
ok("a new branch gets the next free code", !r.err && r.rows[0].code === "NIZ3", r);
r = await as(A, `insert into branches(tenant_id, name, code) values ('${tA}','Gəncə','niz') returning code`);
ok("a taken code is rejected (case-insensitive)", /uniq_branch_code_per_tenant|duplicate/.test(r.err ?? ""), r);
r = await as(B, `insert into branches(tenant_id, name) values ('${tB}','Nizami') returning code`);
ok("another tenant may use the same code", !r.err && r.rows[0].code === "NIZ", r);

// ---- numbers and codes of existing places
const fridges = await q(`select name, number, code from storage_locations where branch_id='${branch.Nizami}' and type='soyuducu' order by number`);
ok("legacy places numbered by creation within branch and type (the branch's default fridge first, then 20261023 zones)",
  JSON.stringify(fridges.map((row) => [row.name, row.number])) ===
    JSON.stringify([["Soyuducu", 1], ["Bar", 2], ["Mətbəx", 3], ["Desert", 4], ["Ət soyuducusu", 5], ["Tərəvəz", 6]]), fridges);
ok("codes {TYPE}-{number}", JSON.stringify(fridges.map((row) => row.code)) === JSON.stringify(["SOY-1", "SOY-2", "SOY-3", "SOY-4", "SOY-5", "SOY-6"]), fridges);
ok("default places of a new branch are numbered too",
  (await q(`select count(*)::int c from storage_locations where branch_id='${branch["Şəki"]}' and code ~ '^[A-Z]+-1$'`))[0].c >= 1);
ok("no place without number or code", (await q("select count(*)::int c from storage_locations where number is null or code is null"))[0].c === 0);

// ---- bulk creation
const bulk = (uid, args) =>
  as(uid, "select name, number, code from public.create_storage_locations_bulk($1, $2, $3, $4, $5, $6)", [
    args.branch, args.type, args.count ?? 1, args.number ?? null, args.name ?? null, args.prefix ?? null,
  ]);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", prefix: "Soyuducu" });
ok("next number is MAX+1: Soyuducu #7", !r.err && r.rows[0].number === 7 && r.rows[0].name === "Soyuducu #7" && r.rows[0].code === "SOY-7", r);
r = await bulk(A, { branch: branch.Nizami, type: "dondurucu", count: 3, prefix: "Dondurucu" });
const freezers = r.rows ?? [];
ok("bulk: 3 freezers", !r.err && freezers.length === 3, r);
ok("bulk freezers continue after the default one", JSON.stringify(freezers.map((row) => row.number)) === JSON.stringify([2, 3, 4]) && freezers[2].name === "Dondurucu #4" && freezers[2].code === "DON-4", freezers);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", number: 2, name: "Extra" });
ok("an explicit taken number is rejected", /number_taken/.test(r.err ?? ""), r);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", number: 10, name: "Bar 10" });
ok("an explicit free number is used", !r.err && r.rows[0].number === 10 && r.rows[0].code === "SOY-10", r);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", prefix: "Soyuducu" });
ok("auto numbering continues after the highest", !r.err && r.rows[0].number === 11, r);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", name: "Bar" });
ok("duplicate name in the branch rejected", /duplicate_name/.test(r.err ?? ""), r);
r = await bulk(A, { branch: branch.Nizami, type: "soyuducu", count: 2, number: 20, prefix: "S" });
ok("an explicit number with count > 1 rejected", /invalid_input/.test(r.err ?? ""), r);
r = await bulk(A, { branch: branch.Nizami, type: "garage", prefix: "G" });
ok("unknown type rejected", /invalid_input/.test(r.err ?? ""), r);
r = await bulk(A, { branch: branch.Nizami, type: "quru" });
ok("a name or prefix is required", /invalid_input/.test(r.err ?? ""), r);
r = await bulk(A, { branch: branchB, type: "quru", prefix: "Anbar" });
ok("another tenant's branch rejected", /branch_not_found/.test(r.err ?? ""), r);
const before = (await q(`select count(*)::int c from storage_locations where branch_id='${branch.Nizami}'`))[0].c;
await q(`insert into storage_locations(tenant_id, branch_id, name, type, number) values ('${tA}','${branch.Nizami}','Blocker','quru', 2)`);
r = await bulk(A, { branch: branch.Nizami, type: "quru", count: 3, prefix: "Anbar" });
ok("bulk creation is all-or-nothing", !r.err && r.rows.length === 3 && JSON.stringify(r.rows.map((row) => row.number)) === JSON.stringify([3, 4, 5]), r);
ok("and created exactly those", (await q(`select count(*)::int c from storage_locations where branch_id='${branch.Nizami}'`))[0].c === before + 4);

// ---- direct writes keep the rules
r = await as(C, `insert into storage_locations(tenant_id, branch_id, name, type) values ('${tA}','${branch.Nizami}','Cook fridge','soyuducu') returning number, code`);
ok("a direct insert without number gets MAX+1", !r.err && r.rows[0].number === 12 && r.rows[0].code === "SOY-12", r);
r = await as(C, `insert into storage_locations(tenant_id, branch_id, name, type, number) values ('${tA}','${branch.Nizami}','Dup','soyuducu', 1)`);
ok("two Soyuducu #1 in one branch impossible", /uniq_location_number_per_branch|duplicate/.test(r.err ?? ""), r);
r = await as(C, `update storage_locations set code = 'HACK' where branch_id='${branch.Nizami}' and number = 1 and type = 'soyuducu' returning code`);
ok("the code cannot be set by hand", !r.err && r.rows[0].code === "SOY-1", r);
r = await as(A, `update storage_locations set type = 'dondurucu' where name = 'Cook fridge' returning number, code`);
ok("a type change takes the next number of the new type", !r.err && r.rows[0].number === 5 && r.rows[0].code === "DON-5", r);

// ---- branch code change: place codes do not carry the branch code
r = await as(A, `update branches set code = 'nzm' where id='${branch.Nizami}' returning code`);
ok("owner changes a branch code (uppercased)", !r.err && r.rows[0]?.code === "NZM", r);
ok("place codes stay {TYPE}-{number}", (await q(`select count(*)::int c from storage_locations where branch_id='${branch.Nizami}' and code !~ '^[A-Z]+-[0-9]+$'`))[0].c === 0);
r = await as(A, `update branches set code = 'N-1' where id='${branch.Nizami}'`);
ok("invalid branch code rejected", /branches_code_check/.test(r.err ?? ""), r);

// ---- overview: order, product counts, open counts
r = await as(C, "select type, number, code, product_count::int pc, open_count, open_status, open_counters from public.storage_locations_overview($1)", [branch.Nizami]);
const rows = r.rows ?? [];
const typeOrder = rows.map((row) => row.type).filter((type, i, all) => all.indexOf(type) === i);
ok("overview orders soyuducu, dondurucu, quru, custom", JSON.stringify(typeOrder) === JSON.stringify(["soyuducu", "dondurucu", "quru"].filter((t) => typeOrder.includes(t))) && typeOrder[0] === "soyuducu", typeOrder);
const sortedWithinType = rows.every((row, i) => i === 0 || rows[i - 1].type !== row.type || rows[i - 1].number < row.number);
ok("numbers ascending within a type", sortedWithinType, rows.map((row) => row.code));

const fridge1 = (await q(`select id from storage_locations where branch_id='${branch.Nizami}' and type='soyuducu' and number=1`))[0].id;
const fridge2 = (await q(`select id from storage_locations where branch_id='${branch.Nizami}' and type='soyuducu' and number=2`))[0].id;
r = await as(A, `insert into products(tenant_id, name, unit, storage_location_id) values ('${tA}','Milk','l','${fridge1}'),('${tA}','Cream','l',null) returning id, name`);
const prod = Object.fromEntries(r.rows.map((row) => [row.name, row.id]));
r = await sys(`insert into stock_movements(tenant_id, product_id, branch_id, to_location_id, quantity, movement_type, cost_per_unit, unit)
  values ('${tA}','${prod.Cream}','${branch.Nizami}','${fridge1}',2,'prihod',1,'l'),('${tA}','${prod.Milk}','${branch.Nizami}','${fridge2}',1,'prihod',1,'l')`);
ok("seed stock", !r.err, r);
const overview = async () =>
  Object.fromEntries(((await as(C, "select id, product_count::int pc, open_count, open_status, open_counters from public.storage_locations_overview($1)", [branch.Nizami])).rows ?? []).map((row) => [row.id, row]));
let view = await overview();
ok("product count: default place or a lot there", view[fridge1].pc === 2 && view[fridge2].pc === 1, [view[fridge1], view[fridge2]]);
ok("no open count yet", view[fridge1].open_count === 0 && view[fridge1].open_status === null && view[fridge1].open_counters === 0);

r = await as(C, "select public.start_stock_count($1) id", [fridge1]);
const countId = r.rows?.[0]?.id;
ok("cook starts a count on fridge #1", !r.err && countId, r);
r = await as(A, "select public.start_stock_count($1)", [fridge1]);
view = await overview();
ok("overview: count going on, 2 counters", view[fridge1].open_count === 1 && view[fridge1].open_status === "counting" && view[fridge1].open_counters === 2, view[fridge1]);

r = await as(A, `update storage_locations set is_active = false where id='${fridge1}'`);
ok("a place with an open count cannot be deactivated", /open_count/.test(r.err ?? ""), r);
r = await as(A, "select public.cancel_stock_count($1)", [countId]);
r = await as(A, `update storage_locations set is_active = false where id='${fridge1}' returning is_active`);
ok("after the count is closed it can (soft delete)", !r.err && r.rows[0].is_active === false, r);
ok("inactive places hidden unless asked", !(fridge1 in (await overview())) &&
  ((await as(C, "select id from public.storage_locations_overview($1, true)", [branch.Nizami])).rows ?? []).some((row) => row.id === fridge1));
r = await as(C, "select count(*)::int c from public.storage_locations_overview(null)");
ok("overview stays inside the tenant", !r.err && r.rows[0].c === (await q(`select count(*)::int c from storage_locations where tenant_id='${tA}' and is_active`))[0].c, r);

done();
