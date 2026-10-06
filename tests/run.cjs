// Plain-node test runner (vitest could not be installed offline). Run with `npm test`.
const Module = require("module");
const path = require("path");

const OUT = path.resolve(__dirname, "../.test-out");
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " -> " + JSON.stringify(extra)}`);
};

// "@/x" -> compiled output; "./scope" and next/cache are mocked for the actions test.
let scopeResult = { status: "unauthenticated" };
const revalidated = [];
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "next/cache") return { revalidatePath: (p) => revalidated.push(p) };
  if (request === "./scope" && parent && parent.filename.endsWith("actions.js")) {
    return { resolveScope: async () => scopeResult };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

const load = (p) => require(path.join(OUT, p));
const { getExpiryInfo, addDaysUtc } = load("lib/expiry.js");
const { validateMoveQty, roundQty } = load("lib/anbar/move.js");
const validation = load("lib/anbar/validation.js");
const { safeNextPath } = load("lib/auth-redirect.js");
const { mapAuthError } = load("lib/auth-errors.js");
const { mapRpcError } = load("lib/anbar/errors.js");
const codec = load("lib/supabase/cookie-codec.js");
const { getOrgId, OrgError } = load("lib/org.js");
const repo = load("lib/anbar/repository.js");
const actions = load("lib/anbar/actions.js");

const ORG = "11111111-1111-1111-1111-111111111111";
const L1 = "aaaaaaaa-0000-0000-0000-000000000001";
const L2 = "aaaaaaaa-0000-0000-0000-000000000002";
const P1 = "cccccccc-0000-0000-0000-000000000001";
const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, String(v));
  return f;
};

// ---- fake supabase client recording every statement
function makeClient({ rows = [], rpc = {} } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const state = { table, op: "select", filters: [], payload: null, range: null };
      const builder = {
        select() { return builder; },
        insert(p) { state.op = "insert"; state.payload = p; return builder; },
        update(p) { state.op = "update"; state.payload = p; return builder; },
        eq(c, v) { state.filters.push(["eq", c, v]); return builder; },
        lt(c, v) { state.filters.push(["lt", c, v]); return builder; },
        gte(c, v) { state.filters.push(["gte", c, v]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        range(a, b) { state.range = [a, b]; return builder; },
        maybeSingle() { state.single = true; return builder; },
        then(resolve, reject) {
          calls.push(state);
          const data = state.single ? (rows[0] ?? null) : rows;
          return Promise.resolve({ data, error: state.fail ? { message: "x" } : null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name, args) {
      calls.push({ rpc: name, args });
      const handler = rpc[name];
      return Promise.resolve(handler ? handler(args) : { data: null, error: null });
    },
  };
  return client;
}

(async () => {
  // ---- expiry
  const now = new Date("2026-10-06T10:00:00Z");
  const level = (d) => getExpiryInfo(d, now).level;
  ok("expiry: no date -> none", level(null) === "none");
  ok("expiry: yesterday -> expired", level("2026-10-05") === "expired");
  ok("expiry: today -> red", level("2026-10-06") === "red");
  ok("expiry: +6 days -> red", level("2026-10-12") === "red");
  ok("expiry: +7 days -> yellow", level("2026-10-13") === "yellow");
  ok("expiry: +29 days -> yellow", level("2026-11-04") === "yellow");
  ok("expiry: +30 days -> green", level("2026-11-05") === "green");
  ok("expiry: garbage -> none", level("nope") === "none");
  ok("expiry: addDaysUtc", addDaysUtc(now, 7) === "2026-10-13" && addDaysUtc(now, 30) === "2026-11-05");

  // ---- move quantity / input validation
  ok("qty: zero, negative, NaN, empty, Infinity invalid", ["0", -1, "abc", "", null, "Infinity"].every((v) => validateMoveQty(v, 5).error === "invalidQty"));
  ok("qty: more than available -> exceedsQty", validateMoveQty("5.001", 5).error === "exceedsQty");
  ok("qty: equal to available ok; float noise ok", validateMoveQty("5", 5).ok && validateMoveQty(0.1 + 0.2, 0.3).ok && roundQty(0.30000000000000004) === 0.3);
  const base = { productId: P1, fromLocationId: L1, toLocationId: L2, qty: 2 };
  ok("moveInput: valid", validation.validateMoveInput(fd(base), 5).ok === true);
  ok("moveInput: same location", validation.validateMoveInput(fd({ ...base, toLocationId: L1 }), 5).error === "sameLocation");
  ok("moveInput: bad uuid", validation.validateMoveInput(fd({ ...base, productId: "x" }), 5).error === "invalidInput");
  ok("moveInput: exceeds available", validation.validateMoveInput(fd({ ...base, qty: 9 }), 5).error === "exceedsQty");

  // ---- filters
  const f = validation.parseFilters({ barcode: "  123  ", location: L1, expired: "1", low: "1", expiry: "week", page: "3" });
  ok("filters: parsed", f.barcode === "123" && f.locationId === L1 && f.expiredOnly && f.lowStock && f.expiry === "week" && f.page === 3);
  const g = validation.parseFilters({ location: "not-a-uuid", expiry: "bogus", page: "-4", barcode: ["a", "b"], organization_id: ORG });
  ok("filters: junk sanitised, org id ignored", g.locationId === null && g.expiry === null && g.page === 1 && g.barcode === "a" && !("organization_id" in g));
  ok("filters: page capped", validation.parseFilters({ page: "99999999" }).page === 10000 && validation.parseFilters({ page: "1.5x" }).page === 1);
  ok("filtersToSearch roundtrip", validation.filtersToSearch(f) === `?barcode=123&location=${L1}&expired=1&low=1&expiry=week&page=3` && validation.filtersToSearch(g) === "?barcode=a");

  // ---- product / location input
  ok("productInput: ok", validation.validateProductInput(fd({ name: "Tea", barcode: "7", qty: "3", unit: "pcs", cost: "1.2", expiryDate: "2027-01-31", locationId: L1 })).ok);
  ok("productInput: invalid unit/date/qty/uuid", ["unit", "expiryDate", "qty", "locationId"].every((k) => {
    const bad = { unit: "bogus", expiryDate: "2027-02-31", qty: "-1", locationId: "zzz" }[k];
    return !validation.validateProductInput(fd({ name: "T", [k]: bad })).ok;
  }));
  ok("locationName: empty rejected", !validation.validateLocationName(fd({ name: "  " })).ok && validation.validateLocationName(fd({ name: " Bar " })).name === "Bar");

  // ---- safe next
  ok("next: relative ok", safeNextPath("/app/anbar?page=2") === "/app/anbar?page=2");
  ok("next: absolute / protocol-relative / backslash / scheme rejected", ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "/%0d%0a/x".replace("%0d%0a", "\r\n"), ""].every((v) => safeNextPath(v) === "/app/anbar"));
  ok("next: default and array input", safeNextPath(undefined) === "/app/anbar" && safeNextPath(["/app/dashboard", "/x"]) === "/app/dashboard");

  // ---- auth error mapping
  ok("authErr: mapped", mapAuthError({ code: "invalid_credentials" }) === "invalidCredentials" && mapAuthError({ code: "weak_password" }) === "weakPassword" && mapAuthError({ code: "user_already_exists" }) === "emailTaken" && mapAuthError({ code: "email_not_confirmed" }) === "emailNotConfirmed" && mapAuthError({ status: 429 }) === "rateLimited" && mapAuthError({ name: "AuthRetryableFetchError", status: 0 }) === "network" && mapAuthError(new TypeError("Failed to fetch")) === "network" && mapAuthError("x") === "unknown" && mapAuthError({ message: "Invalid login credentials" }) === "invalidCredentials");
  ok("rpcErr: mapped", mapRpcError({ message: "insufficient_stock" }) === "exceedsQty" && mapRpcError({ message: "same_location" }) === "sameLocation" && mapRpcError({ message: "product_not_found" }) === "productNotFound" && mapRpcError({ message: "location_not_found" }) === "locationNotFound" && mapRpcError({ message: "unit_mismatch" }) === "unitMismatch" && mapRpcError({ message: "product_location_mismatch" }) === "concurrent" && mapRpcError({ message: "not_authenticated" }) === "unauthenticated" && mapRpcError({ code: "23505", message: "dup" }) === "duplicateBarcode" && mapRpcError({ message: "boom" }) === "saveFailed");

  // ---- cookie codec
  const name = "sb-abc-auth-token";
  const session = { access_token: "a".repeat(1500), refresh_token: "r", expires_at: 2000, user: { email: "ünï@x.az", meta: "й".repeat(2500) } };
  const w = codec.writeSession(name, session, []);
  ok("codec: chunked + roundtrip (utf-8)", w.set.length > 1 && w.set.every((c) => c.value.length <= codec.MAX_CHUNK_SIZE) && JSON.stringify(codec.readSession(name, w.set)) === JSON.stringify(session));
  const small = codec.writeSession(name, { access_token: "x", refresh_token: "y" }, w.set);
  ok("codec: stale chunks removed, garbage -> null, stale detection", small.remove.length === w.set.length && codec.readSession(name, [{ name, value: "base64-!!!" }]) === null && codec.isSessionStale({ access_token: "a", refresh_token: "b", expires_at: 1000 }, 950) && !codec.isSessionStale({ access_token: "a", refresh_token: "b", expires_at: 1000 }, 900));

  // ---- getOrgId
  const orgClient = (current, ensure) => makeClient({ rpc: { current_org_id: () => current, ensure_my_organization: () => ensure } });
  let c = orgClient({ data: ORG, error: null }, { data: "other", error: null });
  ok("getOrgId: existing org, ensure not called", (await getOrgId(c)) === ORG && c.calls.length === 1);
  c = orgClient({ data: null, error: null }, { data: ORG, error: null });
  ok("getOrgId: null org -> ensure_my_organization", (await getOrgId(c)) === ORG && c.calls.map((x) => x.rpc).join() === "current_org_id,ensure_my_organization");
  c = orgClient({ data: null, error: { message: "boom" } }, null);
  ok("getOrgId: typed error on rpc failure", await getOrgId(c).then(() => false, (e) => e instanceof OrgError && e.code === "rpc_failed"));
  c = orgClient({ data: null, error: null }, { data: null, error: { message: "not authenticated" } });
  ok("getOrgId: not authenticated error code", await getOrgId(c).then(() => false, (e) => e instanceof OrgError && e.code === "not_authenticated"));
  c = orgClient({ data: null, error: null }, { data: null, error: null });
  ok("getOrgId: empty id -> no_organization", await getOrgId(c).then(() => false, (e) => e.code === "no_organization"));

  // ---- repository: org scope on every statement
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: `cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`, name: `P${i}`, qty: 1, unit: "kg" }));
  const client = makeClient({ rows });
  const scope = { client, orgId: ORG };
  const filters = validation.parseFilters({ barcode: "123", location: L1, expired: "1", low: "1", expiry: "month", page: "2" });
  const page = await repo.listProducts(scope, filters, now);
  const call = client.calls[0];
  const has = (op, col, val) => call.filters.some(([o, c2, v]) => o === op && c2 === col && (val === undefined || v === val));
  ok("repo.listProducts: organization_id eq first-class filter", has("eq", "organization_id", ORG));
  ok("repo.listProducts: barcode eq + location + low stock + expired + expiry range", has("eq", "barcode", "123") && has("eq", "location_id", L1) && has("lt", "qty", 5) && has("lt", "expiry_date", "2026-10-06") && has("lt", "expiry_date", "2026-11-05"));
  ok("repo.listProducts: page 2 -> range(50,100), 51 rows -> hasNext and 50 returned", call.range[0] === 50 && call.range[1] === 100 && page.hasNext && page.products.length === 50);
  const okOnly = validation.parseFilters({ expiry: "ok" });
  await repo.listProducts(scope, okOnly, now);
  ok("repo.listProducts: expiry=ok -> gte today+30", client.calls[1].filters.some(([o, c2, v]) => o === "gte" && c2 === "expiry_date" && v === "2026-11-05"));
  await repo.listLocations(scope);
  await repo.locationExists(scope, L1);
  ok("repo: locations queries scoped by organization_id", client.calls.slice(2).every((x) => x.filters.some(([o, c2, v]) => o === "eq" && c2 === "organization_id" && v === ORG)));
  await repo.insertLocation(scope, "Bar");
  await repo.insertProduct(scope, { name: "T", barcode: null, expiryDate: null, qty: 1, unit: "kg", cost: null, locationId: null });
  ok("repo: inserts carry organization_id from scope", client.calls.slice(-2).every((x) => x.op === "insert" && x.payload.organization_id === ORG));
  const mover = makeClient();
  await repo.moveStockRpc({ client: mover, orgId: ORG }, { productId: P1, fromLocationId: L1, toLocationId: L2, qty: 2 });
  ok("repo.moveStockRpc: calls move_stock with named args, no table writes", mover.calls.length === 1 && mover.calls[0].rpc === "move_stock" && mover.calls[0].args.p_product_id === P1 && mover.calls[0].args.p_from_location === L1 && mover.calls[0].args.p_to_location === L2 && mover.calls[0].args.p_qty === 2);

  // ---- actions
  const run = async (status, rpcResult, input) => {
    const cl = makeClient({ rpc: { move_stock: () => rpcResult } });
    scopeResult = status === "ok" ? { status, scope: { client: cl, orgId: ORG } } : { status };
    revalidated.length = 0;
    const result = await actions.moveStockAction(fd(input));
    return { result, cl };
  };
  let r = await run("ok", { data: null, error: null }, base);
  ok("action: success -> one RPC, revalidates /app/anbar", r.result.ok && r.cl.calls.length === 1 && revalidated.includes("/app/anbar"));
  ok("action: client-supplied org id is ignored (not forwarded anywhere)", !JSON.stringify(r.cl.calls).includes("evil"));
  r = await run("ok", { data: null, error: null }, { ...base, organization_id: "evil" });
  ok("action: extra organization_id field has no effect", r.result.ok && JSON.stringify(r.cl.calls[0].args).indexOf("evil") === -1);
  r = await run("ok", { data: null, error: null }, { ...base, qty: 0 });
  ok("action: invalid qty rejected before any RPC", r.result.error === "invalidQty" && r.cl.calls.length === 0);
  r = await run("ok", { data: null, error: null }, { ...base, toLocationId: L1 });
  ok("action: same location rejected before any RPC", r.result.error === "sameLocation" && r.cl.calls.length === 0);
  r = await run("unauthenticated", null, base);
  ok("action: unauthenticated", r.result.error === "unauthenticated");
  r = await run("error", null, base);
  ok("action: org resolution error -> saveFailed", r.result.error === "saveFailed");
  r = await run("ok", { data: null, error: { message: "insufficient_stock" } }, base);
  ok("action: rpc insufficient_stock -> exceedsQty, no revalidate", r.result.error === "exceedsQty" && revalidated.length === 0);
  r = await run("ok", { data: null, error: { message: "location_not_found" } }, base);
  ok("action: rpc location_not_found mapped", r.result.error === "locationNotFound");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
