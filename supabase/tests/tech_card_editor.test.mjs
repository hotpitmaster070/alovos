// 20261028000600_tech_card_editor.sql: recipe cards saved through save_tech_card(), waste % computed,
// live cost from lot prices, food cost and margin for owners and chefs, write-off by brutto.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/tech_card_editor.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261028000600_tech_card_editor.sql";
const { ok, done } = reporter();
const { q, as, apply } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);
for (const run of [1, 2]) {
  failure = await apply(migrationFiles.filter((f) => f >= FILE));
  ok(`${FILE} and later apply (run ${run})`, !failure, failure);
}

const near = (a, b) => a !== null && a !== undefined && Math.abs(Number(a) - b) < 1e-6;
const [A, C, H, M] = [U("6a"), U("6c"), U("6f"), U("6d")];
await q(`insert into auth.users(id,email) values ('${A}','owner@a.io'),('${C}','cook@a.io'),('${H}','chef@a.io'),('${M}','owner@m.io')`);
const tenant = async (uid) => (await q(`select tenant_id t from memberships where user_id='${uid}' and role='owner'`))[0].t;
const [tA, tM] = [await tenant(A), await tenant(M)];
await as(A, `insert into memberships(user_id, tenant_id, role) values ('${C}','${tA}','cook'),('${H}','${tA}','chef')`);
await q(`update profiles set tenant_id='${tA}' where id in ('${C}','${H}')`);

const place = (await q(`select id, branch_id from storage_locations where tenant_id='${tA}' and type='soyuducu' order by number limit 1`))[0];
const product = async (uid, name, unit) => (await as(uid, "insert into products(name, unit) values ($1, $2) returning id", [name, unit])).rows[0].id;
const lamb = await product(A, "Baranina", "kg");
const onion = await product(A, "Sogan", "kg");
const salt = await product(A, "Duz", "kg");
const foreign = await product(M, "Other", "kg");
await q(`update products set cost = 2 where id='${onion}'`);
const receive = (price) => as(C, "select * from public.receive_stock_with_lot_fx($1, 1, $2, $3, null, null)", [lamb, place.id, price]);
const lot1 = (await receive(10)).rows?.[0];
await q(`update product_lots set created_at = now() - interval '1 day' where id='${lot1.id}'`);
const lot2 = (await receive(12)).rows?.[0];
ok("two lamb lots received at 10 and 12", lot1 && lot2);

const save = (uid, id, name, salePrice, ingredients, extra = {}) =>
  as(uid, "select public.save_tech_card($1, $2, $3, $4, $5, $6, $7) id", [
    id, name, extra.category ?? "Main", salePrice, extra.yieldQty ?? 0.35, extra.yieldUnit ?? "kg", JSON.stringify(ingredients),
  ]);

// ---- cook creates a card: no money
let r = await save(C, null, "  Lula   kebab ", 20, [
  { product_id: lamb, brutto: 0.25, netto: 0.2 },
  { product_id: onion, brutto: 0.05, netto: 0.04 },
  { product_id: salt, brutto: 0.005, netto: 0.005 },
]);
ok("cook creates a card", !r.err && r.rows[0].id, r);
const card = r.rows?.[0]?.id;
const row = (await q(`select name, category, sale_price, yield_qty, yield_unit from tech_cards where id='${card}'`))[0];
ok("name normalised, cook's sale price ignored", row.name === "Lula kebab" && row.sale_price === null && near(row.yield_qty, 0.35) && row.yield_unit === "kg", row);
const lines = await q(`select product_id, brutto, netto, waste_percent, sort from tech_card_ingredients where tech_card_id='${card}' order by sort`);
ok("waste % = (brutto - netto) / brutto", near(lines[0].waste_percent, 20) && near(lines[1].waste_percent, 20) && near(lines[2].waste_percent, 0) && lines[2].sort === 3, lines);

r = await as(C, `select sale_price from tech_cards where id='${card}'`);
ok("cook cannot read the sale price", /permission denied/.test(r.err ?? ""), r);
r = await as(C, `select id, name, category from tech_cards where id='${card}'`);
ok("cook reads the card itself", !r.err && r.rows.length === 1, r);
r = await as(A, `insert into tech_cards(tenant_id, name) values ('${tA}','Direct')`);
ok("no direct inserts", /permission denied/.test(r.err ?? ""), r);
r = await as(A, `update tech_card_ingredients set brutto = 9 where tech_card_id='${card}'`);
ok("no direct ingredient updates", /permission denied/.test(r.err ?? ""), r);
for (const fn of ["tech_card_economics($1)", "tech_card_cost_lines($1)", "calculate_tech_card_cost($1)"]) {
  r = await as(C, `select * from public.${fn}`, [card]);
  ok(`cook cannot call ${fn.split("(")[0]}`, /forbidden/.test(r.err ?? ""), r);
}
r = await as(C, "select * from public.ingredient_prices()");
ok("cook cannot read ingredient prices", /forbidden/.test(r.err ?? ""), r);

// ---- owner sets the price; live cost from the latest lot
r = await save(A, card, "Lula kebab", 20, [
  { product_id: lamb, brutto: 0.25, netto: 0.2 },
  { product_id: onion, brutto: 0.05, netto: 0.04 },
  { product_id: salt, brutto: 0.005, netto: 0.005 },
]);
ok("owner saves the sale price", !r.err && r.rows[0].id === card, r);
r = await as(H, "select * from public.tech_card_cost_lines($1)", [card]);
const byProduct = Object.fromEntries((r.rows ?? []).map((l) => [l.product_id, l]));
ok("lamb priced from the latest lot (12)", near(byProduct[lamb]?.unit_cost, 12) && byProduct[lamb]?.price_source === "latest_lot" && byProduct[lamb]?.lot_id === lot2.id && near(byProduct[lamb]?.line_cost, 3), byProduct[lamb]);
ok("onion priced from products.cost", near(byProduct[onion]?.unit_cost, 2) && byProduct[onion]?.price_source === "product" && near(byProduct[onion]?.line_cost, 0.1), byProduct[onion]);
ok("salt has no price", byProduct[salt] && byProduct[salt].unit_cost === null && byProduct[salt].line_cost === null, byProduct[salt]);
r = await as(H, "select public.calculate_tech_card_cost($1) c", [card]);
ok("calculate_tech_card_cost = 3.1", !r.err && near(r.rows[0].c, 3.1), r);
r = await as(A, "select * from public.tech_card_economics($1)", [card]);
const eco = r.rows?.[0];
ok("economics: cost 3.1, food cost 15.5 %, margin 16.9, 2 of 3 priced", eco && near(eco.cost, 3.1) && near(eco.sale_price, 20) && near(eco.food_cost_percent, 15.5) && near(eco.margin, 16.9) && eco.ingredient_count === 3 && eco.priced_count === 2, eco);
r = await as(A, "select * from public.ingredient_prices()");
ok("ingredient prices: lamb 12, onion 2, no salt", !r.err && r.rows.length === 2 && near(r.rows.find((p) => p.product_id === lamb)?.unit_cost, 12), r);

// ---- price lot pins the older price; a cook's save keeps money untouched
r = await save(A, card, "Lula kebab", 20, [
  { product_id: lamb, brutto: 0.25, netto: 0.2, price_lot_id: lot1.id },
  { product_id: onion, brutto: 0.05, netto: 0.04 },
]);
r = await as(A, "select * from public.tech_card_economics($1)", [card]);
ok("pinned lot: lamb at 10 -> cost 2.6", near(r.rows?.[0]?.cost, 2.6), r);
r = await save(C, card, "Lula kebab XL", 999, [
  { product_id: lamb, brutto: 0.3, netto: 0.24, price_lot_id: lot2.id },
  { product_id: onion, brutto: 0.05, netto: 0.04 },
]);
ok("cook edits the card", !r.err, r);
const kept = (await q(`select t.name, t.sale_price, i.price_lot_id from tech_cards t join tech_card_ingredients i on i.tech_card_id = t.id and i.product_id = '${lamb}' where t.id='${card}'`))[0];
ok("cook's save keeps sale price and price lot", kept.name === "Lula kebab XL" && near(kept.sale_price, 20) && kept.price_lot_id === lot1.id, kept);

// ---- validation
for (const [label, ingredients, code] of [
  ["netto above brutto", [{ product_id: lamb, brutto: 0.1, netto: 0.2 }], /invalid_input/],
  ["zero brutto", [{ product_id: lamb, brutto: 0, netto: 0 }], /invalid_input/],
  ["text quantity", [{ product_id: lamb, brutto: "0.1", netto: 0.1 }], /invalid_input/],
  ["same product twice", [{ product_id: lamb, brutto: 0.1, netto: 0.1 }, { product_id: lamb, brutto: 0.2, netto: 0.2 }], /duplicate_product/],
  ["another restaurant's product", [{ product_id: foreign, brutto: 0.1, netto: 0.1 }], /product_not_found/],
  ["another product's price lot", [{ product_id: onion, brutto: 0.1, netto: 0.1, price_lot_id: lot1.id }], /invalid_input/],
]) {
  r = await save(A, null, "Bad", null, ingredients);
  ok(`rejected: ${label}`, code.test(r.err ?? ""), r);
}
r = await save(A, null, "   ", null, []);
ok("rejected: empty name", /invalid_input/.test(r.err ?? ""), r);
r = await save(M, card, "Steal", null, []);
ok("another restaurant cannot edit the card", /recipe_not_found/.test(r.err ?? ""), r);
r = await as(M, "select * from public.tech_card_economics()");
ok("another restaurant sees none of the economics", !r.err && r.rows.length === 0, r);
ok("failed saves leave nothing behind", Number((await q(`select count(*) n from tech_cards where name = 'Bad'`))[0].n) === 0);

// ---- sale write-off takes brutto
r = await as(C, "select * from public.deduce_sale($1, $2)", [place.branch_id, JSON.stringify([{ recipe_id: card, quantity: 2 }])]);
const lambOut = r.rows?.find((d) => d.product_id === lamb);
ok("2 portions write off 2 x brutto 0.3 = 0.6 kg lamb", !r.err && near(lambOut?.deducted, 0.6) && near(lambOut?.shortage, 0), r);
r = await as(A, "select public.tech_card_gross(0, 0.2, 20) g");
ok("gross without brutto: netto / (1 - waste)", near(r.rows?.[0]?.g, 0.25), r);

// ---- delete
r = await as(C, "select public.delete_tech_card($1)", [card]);
ok("cook cannot delete a card", /forbidden/.test(r.err ?? ""), r);
r = await as(A, "select public.delete_tech_card($1)", [card]);
ok("owner deletes the card and its ingredients", !r.err && Number((await q(`select count(*) n from tech_card_ingredients where tech_card_id='${card}'`))[0].n) === 0, r);

done();
