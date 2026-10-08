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
const { getExpiryInfo } = load("lib/expiry.js");
const time = load("lib/tenant-settings/time.js");
const validation = load("lib/anbar/validation.js");
const status = load("lib/anbar/catalog-status.js");
const { safeNextPath, loginPath, onboardingPath } = load("lib/auth-redirect.js");
const { getSupabaseConfig, SupabaseConfigError } = load("lib/supabase/config.js");
const { mapAuthError } = load("lib/auth-errors.js");
const { mapRpcError } = load("lib/anbar/errors.js");
const codec = load("lib/supabase/cookie-codec.js");
const { getTenantId, OrgError } = load("lib/org.js");
const repo = load("lib/anbar/repository.js");
const actions = load("lib/anbar/actions.js");
const { createWastage, mapWasteError } = load("lib/wastage/create.js");
const { fetchAll } = load("lib/supabase/fetch-all.js");
const pagination = load("lib/pagination.js");
const countModel = load("lib/count/model.js");
const countLoad = load("lib/count/load.js");
const { validateTenantSettingsInput } = load("lib/tenant-settings/validation.js");
const { parseTenantSettings } = load("lib/tenant-settings/parse.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const B1 = "bbbbbbbb-0000-0000-0000-000000000001";
const L1 = "aaaaaaaa-0000-0000-0000-000000000001";
const P1 = "cccccccc-0000-0000-0000-000000000001";
const S1 = "dddddddd-0000-0000-0000-000000000001";
const S2 = "dddddddd-0000-0000-0000-000000000002";
const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, String(v));
  return f;
};

// ---- fake supabase client recording every statement; rows per table, .range() slices them
function makeClient({ tables = {}, rpc = {} } = {}) {
  const calls = [];
  const sliced = (rows, state) => (state.range ? rows.slice(state.range[0], state.range[1] + 1) : rows);
  const client = {
    calls,
    from(table) {
      const state = { table, op: "select", columns: "", filters: [], payload: null };
      const builder = {
        select(columns = "") { if (state.op === "select") state.columns = columns; return builder; },
        insert(p) { state.op = "insert"; state.payload = p; return builder; },
        update(p) { state.op = "update"; state.payload = p; return builder; },
        delete() { state.op = "delete"; return builder; },
        eq(c, v) { state.filters.push(["eq", c, v]); return builder; },
        gt(c, v) { state.filters.push(["gt", c, v]); return builder; },
        in(c, v) { state.filters.push(["in", c, v]); return builder; },
        or(v) { state.filters.push(["or", v]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        range(from, to) { state.range = [from, to]; return builder; },
        maybeSingle() { state.single = true; return builder; },
        single() { state.single = true; return builder; },
        then(resolve, reject) {
          calls.push(state);
          const rows = sliced(tables[table] ?? [], state);
          const data = state.single ? (rows[0] ?? null) : rows;
          return Promise.resolve({ data, error: state.fail ? { message: "x" } : null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name, args) {
      const state = { rpc: name, args };
      const builder = {
        order() { return builder; },
        range(from, to) { state.range = [from, to]; return builder; },
        then(resolve, reject) {
          calls.push(state);
          const handler = rpc[name];
          const result = handler ? handler(args) : { data: null, error: null };
          const data = Array.isArray(result.data) ? sliced(result.data, state) : result.data;
          return Promise.resolve({ ...result, data }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

(async () => {
  // ---- expiry (thresholds and "today" come from the tenant settings passed in)
  const now = new Date("2026-10-06T10:00:00Z");
  const settings = { timezone: "Asia/Baku", expiryWarnDays: 7, expiryCriticalDays: 30, lowStockDefault: 5 };
  const level = (d) => getExpiryInfo(d, now, settings).level;
  ok("expiry: no date -> none", level(null) === "none");
  ok("expiry: yesterday -> expired", level("2026-10-05") === "expired");
  ok("expiry: today -> red", level("2026-10-06") === "red");
  ok("expiry: under warn days -> red", level("2026-10-12") === "red");
  ok("expiry: warn days -> yellow", level("2026-10-13") === "yellow");
  ok("expiry: under critical days -> yellow", level("2026-11-04") === "yellow");
  ok("expiry: critical days -> green", level("2026-11-05") === "green");
  ok("expiry: garbage -> none", level("nope") === "none");
  const late = new Date("2026-10-06T21:30:00Z");
  ok("expiry: today is the tenant's date", getExpiryInfo("2026-10-07", late, settings).daysLeft === 0 && getExpiryInfo("2026-10-07", late, { ...settings, timezone: "UTC" }).daysLeft === 1);
  ok("time: addDays", time.addDays("2026-10-06", 7) === "2026-10-13" && time.addDays("2026-12-31", 1) === "2027-01-01");

  // ---- receipt input
  const receipt = { productId: P1, locationId: L1, qty: "2", expiryDate: "2027-01-31", pricePerUnit: "1.5" };
  ok("receiptInput: valid", validation.validateReceiptInput(fd(receipt)).ok === true);
  ok("receiptInput: bad product / location / qty", validation.validateReceiptInput(fd({ ...receipt, productId: "x" })).error === "invalidInput" && validation.validateReceiptInput(fd({ ...receipt, locationId: "x" })).error === "locationNotFound" && validation.validateReceiptInput(fd({ ...receipt, qty: "0" })).error === "invalidQty");

  // ---- catalog product input (block 1.1)
  const cp = validation.validateBarcodeProductInput(fd({ name: " Milk ", barcode: "4600000000001", category: " Dairy ", unit: "l", pricePerUnit: "2.5", shelfLifeDays: "7", minStock: "10" }));
  ok("catalogInput: new fields parsed", cp.ok && cp.value.category === "Dairy" && cp.value.shelfLifeDays === 7 && cp.value.minStock === 10 && cp.value.name === "Milk");
  const cpEmpty = validation.validateBarcodeProductInput(fd({ name: "Beef" }));
  ok("catalogInput: optional fields default to null", cpEmpty.ok && cpEmpty.value.category === null && cpEmpty.value.shelfLifeDays === null && cpEmpty.value.minStock === null && cpEmpty.value.barcode === null);
  ok("catalogInput: bad shelf life / min stock / long category rejected", [{ shelfLifeDays: "1.5" }, { shelfLifeDays: "-1" }, { shelfLifeDays: "3651" }, { minStock: "-2" }, { minStock: "abc" }, { category: "x".repeat(61) }].every((bad) => !validation.validateBarcodeProductInput(fd({ name: "T", ...bad })).ok));

  // ---- catalog status dots
  const dot = (d) => status.expiryStatus(d, now, settings).dot;
  ok("status: red for expired and under warn days", dot("2026-10-05") === "red" && dot("2026-10-12") === "red");
  ok("status: yellow under critical days, green later, none without date", dot("2026-10-13") === "yellow" && dot("2026-11-05") === "green" && dot(null) === null);
  ok("status: daysLeft kept for the label", status.expiryStatus("2026-10-05", now, settings).daysLeft === -1 && status.expiryStatus("2026-10-06", now, settings).daysLeft === 0);
  ok("status: low stock below min_stock", status.isLowStock(3, 5, settings) && !status.isLowStock(5, 5, settings) && !status.isLowStock(0, 0, settings));
  ok("status: low stock falls back to low_stock_default", status.isLowStock(4, null, settings) && !status.isLowStock(5, null, settings) && !status.isLowStock(0, null, { lowStockDefault: 0 }));
  ok("status: getLowStockThreshold", status.getLowStockThreshold(settings) === 5 && status.getLowStockThreshold(settings, 12) === 12 && status.getLowStockThreshold({ lowStockDefault: 2 }, null) === 2);
  ok("status: receipt expiry from shelf life, else product date", status.receiptExpiryDefault({ shelfLifeDays: 7, expiryDate: "2027-01-01" }, now, settings) === "2026-10-13" && status.receiptExpiryDefault({ shelfLifeDays: null, expiryDate: "2027-01-01" }, now, settings) === "2027-01-01");

  // ---- safe next
  ok("next: relative ok", safeNextPath("/app/anbar?page=2") === "/app/anbar?page=2");
  ok("next: absolute / protocol-relative / backslash / scheme rejected", ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "/%0d%0a/x".replace("%0d%0a", "\r\n"), ""].every((v) => safeNextPath(v) === "/app/anbar/kataloq"));
  ok("next: login and onboarding are not return targets", safeNextPath("/login") === "/app/anbar/kataloq" && safeNextPath("/onboarding?next=/app/dashboard") === "/app/anbar/kataloq");
  ok("next: default and array input", safeNextPath(undefined) === "/app/anbar/kataloq" && safeNextPath(["/app/dashboard", "/x"]) === "/app/dashboard");
  ok("next: catalog with query survives the login round trip", loginPath("/app/anbar/kataloq?branch=b1") === "/login?next=" + encodeURIComponent("/app/anbar/kataloq?branch=b1"));
  ok("next: login and onboarding paths", loginPath("/app/dashboard") === "/login?next=" + encodeURIComponent("/app/dashboard") && onboardingPath("/app/anbar?page=2") === "/onboarding?next=" + encodeURIComponent("/app/anbar?page=2"));

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

  // ---- getTenantId
  const tenantClient = (current, ensure) => makeClient({ rpc: { current_tenant_id: () => current, ensure_my_tenant: () => ensure } });
  let c = tenantClient({ data: TENANT, error: null }, { data: "other", error: null });
  ok("getTenantId: existing tenant, ensure not called", (await getTenantId(c)) === TENANT && c.calls.length === 1);
  c = tenantClient({ data: null, error: null }, { data: TENANT, error: null });
  ok("getTenantId: null tenant -> ensure_my_tenant", (await getTenantId(c)) === TENANT && c.calls.map((x) => x.rpc).join() === "current_tenant_id,ensure_my_tenant");
  c = tenantClient({ data: null, error: { message: "boom" } }, null);
  ok("getTenantId: typed error on rpc failure", await getTenantId(c).then(() => false, (e) => e instanceof OrgError && e.code === "rpc_failed"));
  c = tenantClient({ data: null, error: null }, { data: null, error: { message: "not authenticated" } });
  ok("getTenantId: not authenticated error code", await getTenantId(c).then(() => false, (e) => e instanceof OrgError && e.code === "not_authenticated"));
  c = tenantClient({ data: null, error: null }, { data: null, error: null });
  ok("getTenantId: empty id -> no_organization", await getTenantId(c).then(() => false, (e) => e.code === "no_organization"));

  // ---- repository: tenant scope on every statement, costs only through the cost views
  const catalogTables = {
    products: [{ id: P1, name: "Milk", unit: "l", internal_code: "ALO-1001", expiry_date: null }],
    product_stocks: [
      { id: S1, product_id: P1, quantity: 2, expiry_date: "2026-10-10" },
      { id: S2, product_id: P1, quantity: 3, expiry_date: null },
    ],
    product_costs: [{ id: P1, cost: 1.75 }],
    product_stock_costs: [{ id: S1, cost_per_unit: 1.5 }, { id: S2, cost_per_unit: "2" }],
  };
  const pageRpc = { catalog_page: () => ({ data: [{ id: P1, stock: "5", nearest_expiry: "2026-10-10", total_count: 1247 }], error: null }) };
  const filters = { branchId: B1, search: "mi%", category: "Dairy", lowOnly: true };
  const client = makeClient({ tables: catalogTables, rpc: pageRpc });
  const catalog = await repo.listCatalog({ client, tenantId: TENANT }, filters, 3);
  const [line] = catalog.lines;
  const tableCalls = client.calls.filter((x) => x.table);
  const tables = tableCalls.map((x) => x.table);
  const pageCall = client.calls.find((x) => x.rpc === "catalog_page");
  ok("repo.listCatalog: filters, offset and page size go to catalog_page", pageCall && pageCall.args.p_branch_id === B1 && pageCall.args.p_search === "mi%" && pageCall.args.p_category === "Dairy" && pageCall.args.p_low_only === true && pageCall.args.p_offset === 100 && pageCall.args.p_limit === pagination.PAGE_SIZE);
  ok("repo.listCatalog: total of all pages from the database", catalog.total === 1247);
  ok("repo.listCatalog: every query filtered by tenant_id", tableCalls.every((x) => x.filters.some(([o, c2, v]) => o === "eq" && c2 === "tenant_id" && v === TENANT)));
  ok("repo.listCatalog: details only for the ids of the page", tableCalls.every((x) => x.filters.some(([o, , v]) => o === "in" && Array.isArray(v) && v.length === 1 && v[0] === P1)));
  ok("repo.listCatalog: no organization_id anywhere", !JSON.stringify(client.calls).includes("organization_id"));
  ok("repo.listCatalog: cost columns never read from the base tables", tableCalls.filter((x) => x.table === "products" || x.table === "product_stocks").every((x) => !/\bcost/.test(x.columns)) && tables.includes("product_costs") && tables.includes("product_stock_costs"));
  ok("repo.listCatalog: branch filter applied to lots and lot costs", tableCalls.filter((x) => x.table === "product_stocks" || x.table === "product_stock_costs").every((x) => x.filters.some(([o, c2, v]) => o === "eq" && c2 === "branch_id" && v === B1)));
  ok("repo.listCatalog: owner sees price, stock value from lot costs, nearest expiry", line && line.pricePerUnit === 1.75 && line.stock === 5 && line.value === 9 && line.nearestExpiry === "2026-10-10");
  const cookClient = makeClient({ tables: { ...catalogTables, product_costs: [], product_stock_costs: [] }, rpc: pageRpc });
  const [cookLine] = (await repo.listCatalog({ client: cookClient, tenantId: TENANT }, repo.NO_CATALOG_FILTERS, 1)).lines;
  ok("repo.listCatalog: cook (empty cost views) gets no price and no value", cookLine && cookLine.pricePerUnit === null && cookLine.value === 0 && cookLine.stock === 5);
  const past = makeClient({ tables: catalogTables, rpc: { catalog_page: (a) => ({ data: a.p_offset === 0 ? [{ id: P1, stock: 5, nearest_expiry: null, total_count: 7 }] : [], error: null }) } });
  const beyond = await repo.listCatalog({ client: past, tenantId: TENANT }, repo.NO_CATALOG_FILTERS, 9);
  ok("repo.listCatalog: page past the end -> no lines, total still known", beyond.lines.length === 0 && beyond.total === 7);

  // ---- pagination helpers
  ok("pagination: page param", pagination.parsePage("3") === 3 && pagination.parsePage("0") === 1 && pagination.parsePage("x") === 1 && pagination.parsePage(["2"]) === 2 && pagination.parsePage(undefined) === 1);
  ok("pagination: range of page 2", pagination.pageRange(2).from === 50 && pagination.pageRange(2).to === 99);
  ok("pagination: search text", pagination.parseSearch("  milk ") === "milk" && pagination.parseSearch("   ") === null && pagination.parseSearch("x".repeat(500)).length === pagination.SEARCH_MAX_LENGTH);
  const chunks = [];
  const rows2500 = Array.from({ length: 2500 }, (_, i) => i);
  const all = await fetchAll(async (from, to) => { chunks.push([from, to]); return { data: rows2500.slice(from, Math.min(to + 1, from + 900)), error: null }; });
  ok("fetchAll: every row even when the server caps a response below the chunk", all.length === 2500 && all[2499] === 2499 && chunks[1][0] === 900);
  const failed = await fetchAll(async () => ({ data: null, error: { message: "boom" } })).then(() => null, (e) => e);
  ok("fetchAll: error is thrown, not an empty list", failed instanceof Error && failed.message === "boom");

  // ---- waste write-off: one RPC, nothing to clean up
  const wasteInput = { productId: P1, locationId: L1, quantity: 2, reason: "spoiled", photoPath: null };
  let wc = makeClient({ rpc: { create_wastage_with_movement: () => ({ data: "log-1", error: null }) } });
  let wr = await createWastage(wc, wasteInput);
  ok("waste: one create_wastage_with_movement call, no table statements", wr.ok && wr.id === "log-1" && wc.calls.length === 1 && wc.calls[0].rpc === "create_wastage_with_movement" && wc.calls[0].args.p_storage_location_id === L1 && wc.calls[0].args.p_quantity === 2);
  wc = makeClient({ rpc: { create_wastage_with_movement: () => ({ data: null, error: { message: "insufficient_stock" } }) } });
  wr = await createWastage(wc, wasteInput);
  ok("waste: failed write-off -> 409, and no delete is attempted", !wr.ok && wr.error === "insufficient_stock" && wr.status === 409 && !wc.calls.some((x) => x.op === "delete" || x.table === "wastage_logs"));
  ok("waste: database errors mapped", mapWasteError("forbidden").status === 403 && mapWasteError("product_not_found").status === 404 && mapWasteError("photo_required").code === "photo_required" && mapWasteError("no_tenant").code === "no_tenant" && mapWasteError("deadlock").code === "save_failed");

  // ---- actions
  const receive = async (status, tables, input) => {
    const cl = makeClient({ tables });
    scopeResult = status === "ok" ? { status, scope: { client: cl, tenantId: TENANT } } : { status };
    revalidated.length = 0;
    const result = await actions.receiveStockAction(fd(input));
    return { result, cl };
  };
  const receiptTables = { storage_locations: [{ id: L1, branch_id: B1 }], products: [{ id: P1, unit: "kg" }] };
  let r = await receive("ok", receiptTables, { ...receipt, tenant_id: "evil", organization_id: "evil" });
  const movement = r.cl.calls.find((x) => x.table === "stock_movements");
  ok("action.receive: one prihod movement stamped with the scope tenant", r.result.ok && movement && movement.op === "insert" && movement.payload.tenant_id === TENANT && movement.payload.movement_type === "prihod" && movement.payload.branch_id === B1 && movement.payload.cost_per_unit === 1.5);
  ok("action.receive: client tenant fields ignored, revalidates /app/anbar", !JSON.stringify(r.cl.calls).includes("evil") && revalidated.includes("/app/anbar"));
  r = await receive("ok", { ...receiptTables, storage_locations: [] }, receipt);
  ok("action.receive: inactive or foreign location -> locationNotFound, nothing written", r.result.error === "locationNotFound" && !r.cl.calls.some((x) => x.op === "insert"));
  r = await receive("ok", receiptTables, { ...receipt, qty: "0" });
  ok("action.receive: invalid qty rejected before any query", r.result.error === "invalidQty" && r.cl.calls.length === 0);
  r = await receive("unauthenticated", receiptTables, receipt);
  ok("action.receive: unauthenticated", r.result.error === "unauthenticated");
  r = await receive("no_organization", receiptTables, receipt);
  ok("action.receive: no tenant -> unauthenticated", r.result.error === "unauthenticated");
  r = await receive("error", receiptTables, receipt);
  ok("action.receive: tenant resolution error -> saveFailed", r.result.error === "saveFailed");

  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const throwsConfig = () => {
    try {
      getSupabaseConfig();
      return null;
    } catch (error) {
      return error;
    }
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let configError = throwsConfig();
  ok(
    "config: missing keys",
    configError instanceof SupabaseConfigError &&
      configError.missing.includes("NEXT_PUBLIC_SUPABASE_URL") &&
      configError.missing.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
      configError.message.includes(".env.local"),
  );
  process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key";
  configError = throwsConfig();
  ok("config: blank url is missing", configError instanceof SupabaseConfigError && configError.missing.includes("NEXT_PUBLIC_SUPABASE_URL"));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
  configError = throwsConfig();
  ok("config: non-http url rejected", configError instanceof SupabaseConfigError && configError.message.includes("http"));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  const config = getSupabaseConfig();
  ok("config: valid env", config.url === "https://example.supabase.co" && config.anonKey === "key" && config.storageKey === "sb-example-auth-token");
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;

  // ---- stock count (lib/count)
  {
    const C1 = "eeeeeeee-0000-4000-8000-000000000001";
    const C2 = "eeeeeeee-0000-4000-8000-000000000002";
    const countRow = (id, status, extra = {}) => ({
      id, status, location_id: L1, branch_id: B1, group_key: "friday", user_id: S1, counted_by: [S2],
      merge_mode: null, created_at: "2026-10-08T10:00:00Z", merged_at: null, approved_at: null, approved_by: null, ...extra,
    });
    const parsed = countModel.parseCount(countRow(C1, "counting"));
    ok("count: parses a stock_counts row", parsed && parsed.status === "counting" && parsed.locationId === L1 && parsed.finishedBy[0] === S2 && parsed.mergeMode === null, parsed);
    ok("count: unknown status rejected", countModel.parseCount(countRow(C1, "done")) === null);
    const line = countModel.parseCountLine({ product_id: P1, product_name: "Milk", unit: "l", counted_quantity: "8", counters: 2, expected_quantity: null, difference: null, difference_value: null });
    ok("count: blind line keeps expected/difference null", line && line.counted === 8 && line.counters === 2 && line.expected === null && line.difference === null, line);
    const revealed = countModel.parseCountLine({ product_id: P1, product_name: "Milk", unit: "l", counted_quantity: 8, counters: 2, expected_quantity: "10", difference: "-2", difference_value: "-4.4" });
    ok("count: revealed line", revealed.expected === 10 && revealed.difference === -2 && revealed.differenceValue === -4.4, revealed);
    const q = countModel.parseCountedQuantity;
    ok("count: quantity parsing", q("").ok && q("").value === null && q(" 2,5 ").value === 2.5 && q("0").value === 0 && !q("-1").ok && !q("abc").ok && !q("1000001").ok && q(null).value === null);
    ok("count: error mapping", countModel.mapCountError("invalid_status").code === "invalid_status" && countModel.mapCountError("x forbidden").status === 403 && countModel.mapCountError("boom").code === "save_failed");
    ok("count: error code guard", countModel.isCountErrorCode("already_finished") && countModel.isCountErrorCode("save_failed") && !countModel.isCountErrorCode("toString") && !countModel.isCountErrorCode("nope"));

    const scope = (client) => ({ client, tenantId: TENANT });
    let client = makeClient({ tables: { stock_counts: [countRow(C2, "approved"), countRow(C1, "counting")] } });
    const byKey = await countLoad.countByGroupKey(scope(client), "friday");
    ok("count: group key prefers the open count", byKey && byKey.id === C1, byKey);
    ok("count: group key query is tenant-scoped", client.calls[0].filters.some(([op, c, v]) => op === "eq" && c === "tenant_id" && v === TENANT));

    const many = Array.from({ length: 1500 }, (_, i) => ({ product_id: `${P1.slice(0, -4)}${String(i).padStart(4, "0")}`, product_name: `P${i}`, unit: "kg", counted_quantity: i, counters: 1 }));
    client = makeClient({ rpc: { stock_count_lines: () => ({ data: many, error: null }) } });
    const lines = await countLoad.countLines(scope(client), C1);
    ok("count: merged list is read past the 1000-row cap", lines.length === 1500 && client.calls.length >= 2, lines.length);

    client = makeClient({ rpc: { count_products_page: (args) => ({ data: [{ id: P1, name: "Milk", unit: "l", total_count: 71 }], error: null, args }) } });
    const products = await countLoad.countProducts(scope(client), L1, 2);
    ok("count: products of a place, paged", products.total === 71 && products.products[0].id === P1 && client.calls[0].args.p_location_id === L1 && client.calls[0].args.p_offset === pagination.PAGE_SIZE, client.calls[0].args);

    client = makeClient({ rpc: { my_stock_count_items: () => ({ data: [{ product_id: P1, counted_quantity: "3.5" }], error: null }) } });
    const mine = await countLoad.myCountEntries(scope(client), C1);
    ok("count: own entries by product", mine[P1] === 3.5, mine);
    ok("count: roles", countLoad.canApproveCounts("chef") && countLoad.canApproveCounts("owner") && !countLoad.canApproveCounts("cook") && countLoad.canCount("cook") && !countLoad.canCount("staff"));

    const settingsForm = { currency: "AZN", timezone: "Asia/Baku", expiry_warn_days: 3, expiry_critical_days: 7, low_stock_default: 5 };
    ok("settings: count_merge_mode saved", validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "sum" })).count_merge_mode === "sum");
    ok("settings: unknown count_merge_mode rejected", validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "max" })) === null);
    const row = { currency: "AZN", timezone: "Asia/Baku", expiry_warn_days: 3, expiry_critical_days: 7, low_stock_default: 5 };
    ok("settings: count_merge_mode parsed", parseTenantSettings({ ...row, count_merge_mode: "last" }).countMergeMode === "last");
    let threw = false;
    try {
      parseTenantSettings(row);
    } catch {
      threw = true;
    }
    ok("settings: missing count_merge_mode is an error, not a default", threw);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
