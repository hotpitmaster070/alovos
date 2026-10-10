// 20261028001100_fix_zones_and_tests.sql: a new branch gets one dry, cold, frozen and receiving zone in the
// restaurant's language (tenant_settings.language, the currency locale only as a fallback), checked by type,
// so a legacy "Quru anbar" never gets a second "Dry store" next to it.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/default_zones.test.mjs
import { freshDb, migrationFiles, reporter, userId as U } from "./pglite.mjs";

const FILE = "20261028001100_fix_zones_and_tests.sql";
const { ok, done } = reporter();
const { q, as, apply, applyTwice } = await freshDb();

let failure = await apply(migrationFiles.filter((f) => f < FILE));
ok(`migrations before ${FILE} apply`, !failure, failure);

// A legacy branch, created while the old trigger still seeded Azerbaijani places.
const L = U("0f");
await q(`insert into auth.users(id,email) values ('${L}','legacy@acme.az')`);
const tL = (await q(`select tenant_id t from profiles where id='${L}'`))[0].t;
const legacyBranch = (await q(`select id from branches where tenant_id='${tL}'`))[0].id;
const placesOf = async (branchId) =>
  q(`select name, type from storage_locations where branch_id = $1 order by type, name`, [branchId]);
const legacyBefore = await placesOf(legacyBranch);

failure = await applyTwice([FILE]);
ok(`${FILE} applies twice`, !failure, failure);
ok("the legacy branch trigger is gone", (await q("select count(*)::int n from pg_trigger where tgname = 'trg_branch_default_storage'"))[0].n === 0);
ok("existing places are not touched by the migration", JSON.stringify(await placesOf(legacyBranch)) === JSON.stringify(legacyBefore), legacyBefore);

/** A restaurant with the given settings and a new branch; returns the places of that branch. */
let n = 0;
async function branchFor({ currency, language = null, locale = null, settings = true }) {
  const owner = U(String(10 + ++n));
  await q(`insert into auth.users(id,email) values ('${owner}','o${n}@test.az')`);
  const tenant = (await q(`select tenant_id t from profiles where id='${owner}'`))[0].t;
  if (settings) {
    await q(`update tenant_settings set currency = $2, language = $3 where tenant_id = $1`, [tenant, currency, language]);
    if (locale) await q(`update tenant_settings set locale = $2 where tenant_id = $1`, [tenant, locale]);
  } else {
    await q(`delete from tenant_settings where tenant_id = $1`, [tenant]);
  }
  const r = await as(owner, `insert into branches(tenant_id, name) values ('${tenant}','Filial ${n}') returning id`);
  if (r.err) throw new Error(r.err);
  return { owner, branch: r.rows[0].id, places: await placesOf(r.rows[0].id) };
}
const names = (places) => places.map((p) => p.name).sort().join(" | ");
const dryStores = (places) => places.filter((p) => p.type === "quru").length;

const ru = await branchFor({ currency: "USD", language: "ru" });
ok("RU + USD: Russian zones", names(ru.places) === "Зона приёмки | Морозильник | Сухой склад | Холодный склад", ru.places);
ok("RU + USD: one dry store, no 'Quru anbar', no 'Dry store'", dryStores(ru.places) === 1 && !/Quru anbar|Dry store/.test(names(ru.places)));

const az = await branchFor({ currency: "USD", language: "az" });
ok("AZ + USD: one 'Quru anbar' and Azerbaijani zones", dryStores(az.places) === 1 &&
  names(az.places) === "Dondurucu | Quru anbar | Qəbul zonası | Soyuducu", az.places);

const en = await branchFor({ currency: "USD", language: "en" });
ok("EN + USD: 'Dry store' and English zones", names(en.places) === "Cold store | Dry store | Freezer | Receiving", en.places);

const fallback = await branchFor({ currency: "USD", language: null, locale: "ru-RU" });
ok("no language: the locale decides (ru-RU -> Russian)", names(fallback.places) === names(ru.places), fallback.places);
const upper = await branchFor({ currency: "USD", language: "RU-ru" });
ok("language is read case-insensitively ('RU-ru' -> Russian)", names(upper.places) === names(ru.places), upper.places);
const bare = await branchFor({ currency: "USD", settings: false });
ok("no settings at all: English", names(bare.places) === names(en.places), bare.places);

// ensure_default_zones: by type, idempotent, never a second dry store next to a legacy one
let r = await as(ru.owner, `select public.ensure_default_zones('${ru.branch}') n`);
ok("ensure_default_zones on a seeded branch creates nothing", !r.err && r.rows[0].n === 0, r);
await q(`delete from storage_locations where branch_id = $1 and type = 'dondurucu'`, [ru.branch]);
r = await as(ru.owner, `select public.ensure_default_zones('${ru.branch}') n`);
ok("a deleted kind comes back, only that one", !r.err && r.rows[0].n === 1 && names(await placesOf(ru.branch)) === names(ru.places), r);

await q(`update tenant_settings set language = 'en' where tenant_id = $1`, [tL]);
r = await as(L, `select public.ensure_default_zones('${legacyBranch}') n`);
const legacyAfter = await placesOf(legacyBranch);
const ofType = (places, type) => places.filter((p) => p.type === type).length;
ok("legacy branch: the old 'Quru anbar' gets no extra dry store", !r.err && legacyAfter.some((p) => p.name === "Quru anbar") &&
  ofType(legacyAfter, "quru") === ofType(legacyBefore, "quru"), [legacyBefore, legacyAfter]);
ok("legacy branch: no extra fridge or freezer either", ["soyuducu", "dondurucu"].every((type) => ofType(legacyAfter, type) === ofType(legacyBefore, type)), legacyAfter);
r = await as(L, `select public.ensure_default_zones('${legacyBranch}') n`);
ok("legacy branch: a second run creates nothing", !r.err && r.rows[0].n === 0, r);

await q(`delete from storage_locations where branch_id = $1`, [en.branch]);
await q(`insert into storage_locations(tenant_id, branch_id, type, name) select tenant_id, id, 'quru', 'Quru anbar' from branches where id = $1`, [en.branch]);
r = await as(en.owner, `select public.ensure_default_zones('${en.branch}') n`);
ok("EN branch with only a legacy 'Quru anbar': no 'Dry store', the other three kinds added", !r.err && r.rows[0].n === 3 &&
  names(await placesOf(en.branch)) === "Cold store | Freezer | Quru anbar | Receiving", [r, await placesOf(en.branch)]);

r = await as(L, `select public.tenant_zone_language('${tL}')`);
ok("tenant_zone_language is not callable by clients", /permission denied/.test(r.err ?? ""), r);

done();
