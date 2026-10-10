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
const { safeNextPath, loginPath, onboardingPath, registerPath } = load("lib/auth-redirect.js");
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
const numbers = load("lib/anbar/storage-numbers.js");
const storageTypes = load("lib/anbar/types.js");
const countModel = load("lib/count/model.js");
const countLoad = load("lib/count/load.js");
const { validateTenantSettingsInput } = load("lib/tenant-settings/validation.js");
const { parseTenantSettings } = load("lib/tenant-settings/parse.js");
const purchasing = load("lib/purchasing/model.js");
const purchasingFormat = load("lib/purchasing/format.js");
const qr = load("lib/qr.js");
const labels = load("lib/labels/model.js");

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
  const today = "2026-10-06";
  ok("expiryInput: today and empty are valid", validation.validateExpiryInput(fd({ productId: P1, expiryDate: today }), today).ok === true && validation.validateExpiryInput(fd({ productId: P1, expiryDate: "" }), today).ok === true);
  ok("expiryInput: before today or beyond five years rejected", validation.validateExpiryInput(fd({ productId: P1, expiryDate: "2026-10-05" }), today).error === "expiryOutOfRange" && validation.validateExpiryInput(fd({ productId: P1, expiryDate: "2031-10-07" }), today).error === "expiryOutOfRange" && validation.validateExpiryInput(fd({ productId: P1, expiryDate: "2031-10-06" }), today).ok === true);
  ok("expiryInput: leap day plus five years", validation.addCalendarYears("2024-02-29", 5) === "2029-02-28" && validation.validateExpiryInput(fd({ productId: P1, expiryDate: "2029-02-28" }), "2024-02-29").ok === true);
  ok("expiryInput: impossible date", validation.validateExpiryInput(fd({ productId: P1, expiryDate: "2026-02-31" }), today).error === "invalidInput");

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
  ok("rpcErr: mapped", mapRpcError({ message: "insufficient_stock" }) === "exceedsQty" && mapRpcError({ message: "same_location" }) === "sameLocation" && mapRpcError({ message: "product_not_found" }) === "productNotFound" && mapRpcError({ message: "location_not_found" }) === "locationNotFound" && mapRpcError({ message: "unit_mismatch" }) === "unitMismatch" && mapRpcError({ message: "product_location_mismatch" }) === "concurrent" && mapRpcError({ message: "not_authenticated" }) === "unauthenticated" && mapRpcError({ code: "23505", message: "dup" }) === "duplicateBarcode" && mapRpcError({ message: "boom" }) === "saveFailed" && mapRpcError({ message: "expiry_out_of_range" }) === "expiryOutOfRange");

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

  // ---- fixed storage numbering
  ok("storage: number ranges", numbers.formatNumberRanges([4, 1, 2, 3, 7, 9, 10]) === "#1–4, #7, #9–10" && numbers.formatNumberRanges([]) === "");
  ok("storage: next number is MAX+1, gaps are not reused", numbers.nextStorageNumber([]) === 1 && numbers.nextStorageNumber([1, 2, 4]) === 5);
  const places = [
    { id: "a", name: "x", type: "soyuducu", number: 3, code: "NIZ-SOY-3", branchId: B1, active: false },
    { id: "b", name: "y", type: "soyuducu", number: 1, code: "NIZ-SOY-1", branchId: B1, active: true },
    { id: "c", name: "z", type: "dondurucu", number: 1, code: "NIZ-DON-1", branchId: B1, active: true },
    { id: "d", name: "w", type: "soyuducu", number: 8, code: "CEN-SOY-8", branchId: L1, active: true },
  ];
  ok("storage: used numbers per branch and type, inactive included", JSON.stringify(numbers.usedStorageNumbers(places, B1, "soyuducu")) === "[1,3]");
  ok("storage: display order soyuducu, dondurucu, anbar, other; then number", JSON.stringify([...places, { ...places[2], id: "e", type: "quru" }, { ...places[2], id: "f", type: "custom" }].sort(storageTypes.compareStorageLocations).map((p) => p.id)) === '["b","a","d","c","e","f"]');
  ok("storage: code preview", storageTypes.storageLocationCode("quru", 2) === "ANB-2");
  const bulk = validation.validateStorageLocationInput(fd({ type: "dondurucu", branch_id: B1, count: "3", name_prefix: " Dondurucu " }));
  ok("storage input: bulk with prefix", bulk.ok && bulk.value.count === 3 && bulk.value.number === null && bulk.value.name === null && bulk.value.namePrefix === "Dondurucu");
  const fixed = validation.validateStorageLocationInput(fd({ type: "soyuducu", branchId: B1, number: "5", name: "Bar" }));
  ok("storage input: one place with a chosen number", fixed.ok && fixed.value.count === 1 && fixed.value.number === 5);
  ok(
    "storage input: rejected",
    [
      { type: "soyuducu", branch_id: B1 },
      { type: "soyuducu", branch_id: B1, name: "A", count: "2" },
      { type: "soyuducu", branch_id: B1, name_prefix: "A", count: "2", number: "4" },
      { type: "soyuducu", branch_id: B1, name: "A", number: "0" },
      { type: "soyuducu", branch_id: B1, name_prefix: "A", count: "51" },
      { type: "garage", branch_id: B1, name: "A" },
      { type: "soyuducu", branch_id: "x", name: "A" },
    ].every((input) => !validation.validateStorageLocationInput(fd(input)).ok),
  );
  ok("storage errors: number taken, open count", mapRpcError({ message: "number_taken" }) === "numberTaken" && mapRpcError({ message: 'duplicate key value violates unique constraint "uniq_location_number_per_branch"' }) === "numberTaken" && mapRpcError({ message: "open_count" }) === "openCount");

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
  const movement = r.cl.calls.find((x) => x.rpc === "receive_stock_rpc");
  ok("action.receive: one receive_stock_rpc call, no direct movement insert", r.result.ok && movement && movement.args.p_product_id === P1 &&
    movement.args.p_location_id === L1 && movement.args.p_cost_per_unit === 1.5 && movement.args.p_unit === "kg" &&
    !r.cl.calls.some((x) => x.table === "stock_movements"), r.cl.calls);
  ok("action.receive: client tenant fields ignored, revalidates /app/anbar", !JSON.stringify(r.cl.calls).includes("evil") && revalidated.includes("/app/anbar"));
  r = await receive("ok", { ...receiptTables, storage_locations: [] }, receipt);
  ok("action.receive: inactive or foreign location -> locationNotFound, nothing written", r.result.error === "locationNotFound" && !r.cl.calls.some((x) => x.op === "insert" || x.rpc));
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
      id, status, location_id: L1, branch_id: B1, group_key: "friday", user_id: S1, counted_by: [S1, S2], finished_by: [S2],
      merge_mode: "last", created_at: "2026-10-08T10:00:00Z", merged_at: null, approved_at: null, approved_by: null, ...extra,
    });
    const parsed = countModel.parseCount(countRow(C1, "counting"));
    ok("count: parses a stock_counts row", parsed && parsed.status === "counting" && parsed.locationId === L1 && parsed.counters.length === 2 && parsed.finishedBy[0] === S2 && parsed.mergeMode === "last", parsed);
    ok("count: unknown status rejected", countModel.parseCount(countRow(C1, "done")) === null);
    ok("count: merge mode is required", countModel.parseCount(countRow(C1, "counting", { merge_mode: null })) === null);
    ok("count: location_id required maps to its own code", countModel.mapCountError("location_id required").code === "location_required" && countModel.mapCountError("insufficient_stock for product Rice").code === "insufficient_stock");
    const line = countModel.parseCountLine({ product_id: P1, product_name: "Milk", unit: "l", counted_quantity: "8", counters: 2, expected_quantity: null, difference: null, difference_value: null });
    ok("count: blind line keeps expected/difference null", line && line.counted === 8 && line.counters === 2 && line.expected === null && line.difference === null, line);
    const revealed = countModel.parseCountLine({ product_id: P1, product_name: "Milk", unit: "l", counted_quantity: 8, counters: 2, expected_quantity: "10", difference: "-2", difference_value: "-4.4" });
    ok("count: revealed line", revealed.expected === 10 && revealed.difference === -2 && revealed.differenceValue === -4.4, revealed);
    const q = countModel.parseCountedQuantity;
    ok("count: quantity parsing", q("").ok && q("").value === null && q(" 2,5 ").value === 2.5 && q("0").value === 0 && !q("-1").ok && !q("abc").ok && !q("1000001").ok && q(null).value === null);
    ok("count: error mapping", countModel.mapCountError("invalid_status").code === "invalid_status" && countModel.mapCountError("x forbidden").status === 403 && countModel.mapCountError("boom").code === "save_failed");
    ok("count: error code guard", countModel.isCountErrorCode("already_finished") && countModel.isCountErrorCode("location_required") && countModel.isCountErrorCode("save_failed") && countModel.isCountErrorCode("count_already_open") && countModel.isCountErrorCode("permission_denied") && !countModel.isCountErrorCode("toString") && !countModel.isCountErrorCode("location_id required") && !countModel.isCountErrorCode("nope"));
    const openId = "11111111-1111-4111-8111-111111111111";
    const openCount = countModel.countFormError(`Open count exists ${openId}`);
    ok("count: open count redirects with the existing id", openCount.error === "count_already_open" && openCount.existingId === openId);
    ok("count: permission and missing count", countModel.countFormError("Permission denied").error === "permission_denied" && countModel.countFormError("forbidden").error === "permission_denied" && countModel.countFormError("count_not_found").error === "count_not_found" && countModel.countFormError("Count not found").existingId === null);

    const scope = (client) => ({ client, tenantId: TENANT });
    let client = makeClient({ tables: { stock_counts: [countRow(C2, "approved"), countRow(C1, "counting")] } });
    const byKey = await countLoad.countByGroupKey(scope(client), "friday");
    ok("count: group key prefers the open count", byKey && byKey.id === C1, byKey);
    ok("count: group key query is tenant-scoped", client.calls[0].filters.some(([op, c, v]) => op === "eq" && c === "tenant_id" && v === TENANT));

    client = makeClient({ tables: { stock_counts: [] } });
    ok("count: place without counts -> null", (await countLoad.countAtLocation(scope(client), L1)) === null && client.calls.length === 2);
    const closedQuery = client.calls[1];
    ok("count: closed fallback asks for approved/cancelled at the place",
      closedQuery.filters.some(([op, c, v]) => op === "in" && c === "status" && v.includes("approved") && v.includes("cancelled")) &&
      closedQuery.filters.some(([op, c, v]) => op === "eq" && c === "location_id" && v === L1), closedQuery.filters);

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

    const settingsForm = { currency: "AZN", timezone: "Asia/Baku", expiry_warn_days: 3, expiry_critical_days: 7, low_stock_default: 5, usage_window_days: 7, invite_ttl_days: 7, default_shelf_life_days: 3, prep_balance_tolerance: "0,3", prep_balance_tolerance_percent: 5, default_portion_weight_kg: "", default_density_kg_per_l: "", default_trim_value_percent: "100" };
    const withPortion = validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", default_portion_weight_kg: "0,25" }));
    ok(
      "settings: default portion weight optional, positive",
      validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last" })).default_portion_weight_kg === null &&
        withPortion.default_portion_weight_kg === 0.25 &&
        validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", default_portion_weight_kg: "0" })) === null,
      withPortion,
    );
    const withTolerance = validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last" }));
    ok("settings: prep balance tolerance saved", withTolerance.prep_balance_tolerance === 0.3 && withTolerance.prep_balance_tolerance_percent === 5, withTolerance);
    ok(
      "settings: prep balance tolerance checked",
      [{ prep_balance_tolerance: "-1" }, { prep_balance_tolerance: "" }, { prep_balance_tolerance_percent: "101" }].every(
        (bad) => validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", ...bad })) === null,
      ),
    );
    ok("settings: default shelf life saved", validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", default_shelf_life_days: 90 })).default_shelf_life_days === 90);
    ok(
      "settings: default shelf life stays within 0..3650",
      ["", "-1", "3651", "2.5"].every((bad) => validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", default_shelf_life_days: bad })) === null),
    );
    ok("settings: count_merge_mode saved", validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "sum" })).count_merge_mode === "sum");
    ok("settings: unknown count_merge_mode rejected", validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "max" })) === null);
    const saved = validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", usage_window_days: 14, invite_ttl_days: 3 }));
    ok("settings: usage window and invite ttl saved", saved && saved.usage_window_days === 14 && saved.invite_ttl_days === 3, saved);
    ok(
      "settings: usage window and invite ttl stay within 1..365",
      ["0", "366", "", "1.5"].every(
        (bad) =>
          validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", usage_window_days: bad })) === null &&
          validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", invite_ttl_days: bad })) === null,
      ),
    );
    const row = { currency: "AZN", timezone: "Asia/Baku", expiry_warn_days: 3, expiry_critical_days: 7, expiry_review_days: 1, low_stock_default: 5, usage_window_days: 7, invite_ttl_days: 7, default_shelf_life_days: 3, prep_balance_tolerance: "0.3", prep_balance_tolerance_percent: 5, default_portion_weight_kg: null, default_density_kg_per_l: null, default_trim_value_percent: "100" };
    ok("settings: count_merge_mode parsed", parseTenantSettings({ ...row, count_merge_mode: "last" }).countMergeMode === "last");
    let threw = false;
    try {
      parseTenantSettings(row);
    } catch {
      threw = true;
    }
    ok("settings: missing count_merge_mode is an error, not a default", threw);
    const fallback = parseTenantSettings({ ...row, count_merge_mode: "last", currency: " ", timezone: "Mars/Olympus" });
    ok("settings: empty currency and unknown timezone fall back to USD / UTC", fallback.currency === "USD" && fallback.timezone === "UTC", fallback);
    const stored = parseTenantSettings({ ...row, count_merge_mode: "last" });
    ok("settings: stored timezone and currency kept", stored.currency === row.currency && stored.timezone === row.timezone, stored);
    const parsedSettings = parseTenantSettings({ ...row, count_merge_mode: "last", usage_window_days: "10", invite_ttl_days: 2 });
    ok("settings: usage window and invite ttl parsed", parsedSettings.usageWindowDays === 10 && parsedSettings.inviteTtlDays === 2, parsedSettings);
    ok("settings: default shelf life parsed", parsedSettings.defaultShelfLifeDays === 3, parsedSettings);
    ok("settings: prep balance tolerance parsed", parsedSettings.prepBalanceTolerance === 0.3 && parsedSettings.prepBalanceTolerancePercent === 5, parsedSettings);
    ok("settings: no default portion weight parsed as null", parsedSettings.defaultPortionWeightKg === null, parsedSettings);
    ok(
      "settings: density and trim value parsed from the row",
      parsedSettings.defaultDensityKgPerL === null && parsedSettings.defaultTrimValuePercent === 100 &&
        parseTenantSettings({ ...row, count_merge_mode: "last", default_density_kg_per_l: "1.03" }).defaultDensityKgPerL === 1.03,
      parsedSettings,
    );
    let noTrimValue = false;
    try {
      parseTenantSettings({ ...row, count_merge_mode: "last", default_trim_value_percent: undefined });
    } catch {
      noTrimValue = true;
    }
    ok("settings: missing trim value is an error, not a default", noTrimValue);
    const withDensity = validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", default_density_kg_per_l: "0,92", default_trim_value_percent: "50" }));
    ok(
      "settings: density optional positive, trim value 0..100",
      withDensity.default_density_kg_per_l === 0.92 && withDensity.default_trim_value_percent === 50 &&
        validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last" })).default_density_kg_per_l === null &&
        [{ default_density_kg_per_l: "0" }, { default_trim_value_percent: "101" }, { default_trim_value_percent: "" }].every(
          (bad) => validateTenantSettingsInput(fd({ ...settingsForm, count_merge_mode: "last", ...bad })) === null,
        ),
      withDensity,
    );

    // Purchasing: limits, suppliers, invitations, forecast rows.
    const SUP = "eeeeeeee-0000-4000-8000-000000000001";
    const PRODUCT = "cccccccc-0000-4000-8000-000000000001";
    const supplierOk = purchasing.validateSupplierInput({ name: "  Bazar  MMC ", code: "baz1", delivery_days: ["4", 1, 1], lead_time_days: "2" });
    ok("purchasing: supplier input normalised", supplierOk.ok && supplierOk.value.name === "Bazar MMC" && supplierOk.value.code === "BAZ1" && supplierOk.value.deliveryDays.join() === "1,4" && supplierOk.value.leadTimeDays === 2, supplierOk);
    ok("purchasing: empty code is generated by the database", purchasing.validateSupplierInput({ name: "Bazar" }).value.code === null);
    ok(
      "purchasing: bad supplier input rejected",
      [{ name: "" }, { name: "X", delivery_days: [7] }, { name: "X", delivery_days: "1" }, { name: "X", code: "AB-1" }, { name: "X", branch_id: "nope" }, { name: "X", lead_time_days: "1.5" }].every(
        (body) => !purchasing.validateSupplierInput(body).ok,
      ),
    );
    const patch = purchasing.validateSupplierPatch({ is_active: false });
    ok("purchasing: supplier patch only touches given fields", patch.ok && patch.value.active === false && !("name" in patch.value) && !("deliveryDays" in patch.value), patch);
    ok("purchasing: empty supplier patch rejected", !purchasing.validateSupplierPatch({}).ok && !purchasing.validateSupplierPatch({ name: " " }).ok && !purchasing.validateSupplierPatch({ is_active: "no" }).ok);
    const limits = purchasing.validateLimitsInput({ par_level: "20,5", min_stock: "5", supplier_id: SUP });
    ok("purchasing: limits parsed in the product's unit", limits.ok && limits.value.parLevel === 20.5 && limits.value.minStock === 5 && limits.value.supplierId === SUP, limits);
    ok("purchasing: limits can be cleared", purchasing.validateLimitsInput({ par_level: "", min_stock: "", supplier_id: "" }).value.parLevel === null);
    ok(
      "purchasing: bad limits rejected",
      !purchasing.validateLimitsInput({ par_level: "0" }).ok && !purchasing.validateLimitsInput({ par_level: "5", min_stock: "6" }).ok && !purchasing.validateLimitsInput({ par_level: "-1" }).ok && !purchasing.validateLimitsInput({ supplier_id: "x" }).ok,
    );
    ok("purchasing: phone normalised", purchasing.normalizePhone("+994 (50) 123-45-67") === "+994501234567");
    const invite = purchasing.validateInvitationInput({ phone: "+994 50 123 45 67" });
    ok("purchasing: invitation defaults to chef", invite.ok && invite.value.role === "chef" && invite.value.phone === "+994501234567", invite);
    ok("purchasing: bad invitation rejected", !purchasing.validateInvitationInput({ phone: "123" }).ok && !purchasing.validateInvitationInput({ phone: "+994501234567", role: "cook" }).ok);
    const items = purchasing.validateRequestItems([{ product_id: PRODUCT, qty: "2.5" }]);
    ok("purchasing: request items", items.ok && items.value[0].qty === 2.5, items);
    ok(
      "purchasing: bad request items rejected",
      !purchasing.validateRequestItems([]).ok &&
        !purchasing.validateRequestItems([{ product_id: PRODUCT, qty: 0 }]).ok &&
        !purchasing.validateRequestItems([{ product_id: PRODUCT, qty: 1 }, { product_id: PRODUCT, qty: 2 }]).ok &&
        !purchasing.validateRequestItems([{ product_id: "x", qty: 1 }]).ok,
    );
    ok(
      "purchasing: database errors mapped",
      purchasing.mapPurchasingError({ message: "invitation_expired" }).status === 410 &&
        purchasing.mapPurchasingError({ message: 'duplicate key value violates unique constraint "uniq_supplier_code_per_tenant"' }).code === "duplicate_code" &&
        purchasing.mapPurchasingError({ message: "x", code: "42501" }).code === "forbidden" &&
        purchasing.mapPurchasingError({ message: "new row violates check constraint products_par_level_check" }).code === "invalid_input" &&
        purchasing.mapPurchasingError({ message: "boom" }).code === "save_failed",
    );
    const forecastRow = purchasing.parseForecastRow({
      product_id: P1, branch_id: B1, name: "Un", unit: "kg", current_stock: "8", par_level: "10", min_stock: "3", supplier_id: SUP, supplier_name: "Bazar",
      delivery_days: [1, 4], next_delivery_date: "2026-10-08", days_until_delivery: 3, avg_daily_usage: "2", projected_stock: "2",
      need_to_order: "8", on_order: "0", will_run_out: true, status: "order",
    });
    ok("purchasing: forecast row parsed", forecastRow && forecastRow.currentStock === 8 && forecastRow.projectedStock === 2 && forecastRow.needToOrder === 8 && forecastRow.willRunOut && forecastRow.deliveryDays.join() === "1,4", forecastRow);
    ok("purchasing: unknown forecast status rejected", purchasing.parseForecastRow({ product_id: P1, current_stock: 1, status: "panic" }) === null);
    ok("purchasing: roles", purchasing.canManagePurchasing("chef") && purchasing.canManagePurchasing("owner") && !purchasing.canManagePurchasing("cook") && purchasing.canInvite("owner") && !purchasing.canInvite("chef"));
    const inviteToken = "a".repeat(64);
    ok(
      "purchasing: register link carries the invitation token",
      registerPath(`/invite/${inviteToken}`, inviteToken) === `/register?next=${encodeURIComponent(`/invite/${inviteToken}`)}&invite=${inviteToken}` &&
        !registerPath("/app/anbar").includes("invite="),
    );
    ok(
      "purchasing: invitation preview states",
      purchasing.parseInvitationPreview({ tenant_name: "Acme", role: "chef", state: "joined" }).state === "joined" &&
        purchasing.parseInvitationPreview({ state: "weird" }) === null &&
        purchasing.INVITE_TOKEN_PATTERN.test(inviteToken) &&
        !purchasing.INVITE_TOKEN_PATTERN.test("A".repeat(64)),
    );
    ok("purchasing: qty format", purchasingFormat.formatQty(2.34567) === "2.346" && purchasingFormat.formatQty(8) === "8");
    ok(
      "purchasing: weekday names follow the stored numbers",
      purchasingFormat.weekdayName(1, "en", "long") === "Monday" && purchasingFormat.weekdayName(0, "en", "long") === "Sunday" && purchasingFormat.weekdayName(4, "en", "long") === "Thursday",
    );
  }

  // QR encoder (labels) and the labels model.
  {
    const ec = qr.reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10);
    ok("qr: Reed-Solomon matches the ISO 18004 example", ec.join() === "196,35,39,119,235,215,231,226,93,23", ec);
    ok("qr: format bits for level M, mask 0", qr.formatBits(0) === 0b101010000010010, qr.formatBits(0).toString(2));
    ok("qr: version 7 information bits", qr.versionBits(7) === 0x07c94, qr.versionBits(7).toString(16));
    ok("qr: smallest version that fits", qr.qrVersionFor(14) === 1 && qr.qrVersionFor(15) === 2 && qr.qrVersionFor(213) === 10 && qr.qrVersionFor(214) === null);
    const matrix = qr.encodeQr("NIZ-SOY1-1610-001");
    const finder = (x, y) => [0, 1, 2, 3, 4, 5, 6].every((i) => matrix[y][x + i] && matrix[y + 6][x + i] && matrix[y + i][x] && matrix[y + i][x + 6]);
    ok("qr: a lot number fits version 2 with three finder patterns", matrix.length === 25 && finder(0, 0) && finder(18, 0) && finder(0, 18) && matrix[17][8] === true);
    ok("qr: svg path covers the dark modules", /^M\d+ \d+h\d+v1h-\d+z/.test(qr.qrSvgPath(matrix, 2)));
    ok("qr: too long text is refused", qr.encodeQr("x".repeat(300)) === null);

    const P = "cccccccc-0000-4000-8000-000000000001";
    const P2 = "cccccccc-0000-4000-8000-000000000002";
    const P3 = "cccccccc-0000-4000-8000-000000000003";
    const L = "dddddddd-0000-4000-8000-000000000001";
    const L2 = "dddddddd-0000-4000-8000-000000000002";
    const info = { productId: P, productDays: 5, defaultDays: 3, rules: { [L]: 90 } };
    ok(
      "labels: shelf life = place rule, else product, else tenant default",
      labels.resolveShelfLife(info, L).days === 90 && labels.resolveShelfLife(info, L).source === "rule" &&
        labels.resolveShelfLife(info, L2).days === 5 && labels.resolveShelfLife({ ...info, productDays: null }, L2).source === "default" &&
        labels.resolveShelfLife({ ...info, productDays: null }, L2).days === 3,
    );
    ok("labels: expiry = production + shelf life", time.addDays("2026-10-16", labels.resolveShelfLife(info, L).days) === "2027-01-14");
    const parsedInfo = labels.parseShelfLifeInfo({ product_id: P, product_shelf_life_days: null, default_shelf_life_days: 3, rules: [{ storage_location_id: L, shelf_life_days: 90 }, { bad: 1 }] });
    ok("labels: shelf-life info parsed", parsedInfo && parsedInfo.productDays === null && parsedInfo.rules[L] === 90 && Object.keys(parsedInfo.rules).length === 1, parsedInfo);

    const recipe = labels.parsePreparation({
      id: P3,
      name: "Shashlik",
      inputs: [{ product_id: P, qty: "10" }],
      outputs: [{ product_id: P2, qty: 5 }, { product_id: P3, qty: 8, portions: 8, name: "Koreyka" }],
      is_active: true,
    });
    ok("labels: recipe parsed", recipe && recipe.inputs[0].qty === 10 && recipe.outputs[1].portions === 8 && recipe.outputs[1].name === "Koreyka", recipe);
    const scaled = labels.scalePreparation(recipe, 2);
    ok("labels: recipe scales with the source amount", scaled[0].qty === 1 && scaled[1].qty === 1.6 && scaled[1].portions === 2, scaled);
    ok("labels: portions follow the actual yield", labels.portionsFor(recipe.outputs[1], 4) === 4 && labels.portionsFor(recipe.outputs[0], 3) === null);

    const lot = labels.parseLot({
      id: P, lot_number: "NIZ-SOY1-1610-001", product_id: P2, branch_id: P3, production_date: "2026-10-16", expiry_date: "2026-10-19",
      quantity: "5.000", unit: "kg", portions: null, storage_location_id: L, lot_type: "semi", parent_lot_id: null,
      composition_json: [{ product_id: P, name: "Baranina", qty: 10, unit: "kg", lot_number: "NIZ-SOY1-1610-000" }, "junk"], preparation_id: P3,
    });
    ok("labels: lot parsed with its composition", lot && lot.quantity === 5 && lot.lotType === "semi" && lot.composition.length === 1 && lot.composition[0].lotNumber === "NIZ-SOY1-1610-000", lot);
    ok("labels: unknown lot type rejected", labels.parseLot({ ...lot, lot_type: "cooked" }) === null);

    const receive = labels.validateReceiveLotInput({ product_id: P, qty: "2,5", storage_location_id: L, price: "", shelf_life_days: "4", remember: true });
    ok("labels: receipt input", receive.ok && receive.value.qty === 2.5 && receive.value.price === null && receive.value.shelfLifeDays === 4 && receive.value.remember, receive);
    ok(
      "labels: bad receipt input rejected",
      [
        { product_id: P, qty: 0, storage_location_id: L },
        { product_id: "x", qty: 1, storage_location_id: L },
        { product_id: P, qty: 1, storage_location_id: L, shelf_life_days: 3651 },
        { product_id: P, qty: 1, storage_location_id: L, remember: true },
        { product_id: P, qty: 1, storage_location_id: L, production_date: "2026-02-30" },
      ].every((body) => !labels.validateReceiveLotInput(body).ok),
    );
    ok("labels: lot input defaults to raw", labels.validateLotInput({ product_id: P, qty: 1, storage_location_id: L }).value.lotType === "raw");
    const run = labels.validatePreparationRunInput({ preparation_id: P3, source_qty: "10", storage_location_id: L, outputs: [{ product_id: P2, qty: 5, storage_location_id: L2 }] });
    ok("labels: preparation run input", run.ok && run.value.sourceLocationId === null && run.value.outputs[0].storageLocationId === L2, run);
    ok("labels: empty yields rejected", !labels.validatePreparationRunInput({ preparation_id: P3, source_qty: 1, storage_location_id: L, outputs: [] }).ok);
    const print = labels.validatePrintInput({ lot_ids: [P, P], copies: "3" });
    ok("labels: print input deduplicates lots", print.ok && print.value.lotIds.length === 1 && print.value.copies === 3, print);
    ok(
      "labels: print limits",
      !labels.validatePrintInput({ lot_ids: [], copies: 1 }).ok && !labels.validatePrintInput({ lot_ids: [P], copies: 0 }).ok &&
        !labels.validatePrintInput({ lot_ids: [P], copies: labels.LABEL_COPIES_MAX + 1 }).ok,
    );
    const draft = labels.validatePreparationDraft({ name: "  Shashlik   kit ", inputs: [{ product_id: P, qty: "10" }], outputs: [{ product_id: P2, qty: 5, portions: "", name: " " }] });
    ok("labels: recipe draft normalised", draft.ok && draft.value.name === "Shashlik kit" && draft.value.outputs[0].portions === null && draft.value.outputs[0].name === null, draft);
    ok(
      "labels: recipe with a repeated product rejected",
      !labels.validatePreparationDraft({ name: "X", inputs: [{ product_id: P, qty: 1 }, { product_id: P, qty: 2 }], outputs: [{ product_id: P2, qty: 1 }] }).ok,
    );
    ok("labels: rule input; null removes the rule", labels.validateShelfLifeRuleInput({ product_id: P, storage_location_id: L, shelf_life_days: null }).value.days === null);
    ok(
      "labels: database errors mapped",
      labels.mapLabelsError({ message: "insufficient_stock" }).code === "insufficient_stock" && labels.mapLabelsError({ message: "insufficient_stock" }).status === 409 &&
        labels.mapLabelsError({ message: "preparation_not_found" }).status === 404 && labels.mapLabelsError({ code: "42501", message: "x" }).code === "forbidden" &&
        labels.mapLabelsError({ message: "boom" }).code === "save_failed",
    );
    ok("labels: roles", labels.canSetShelfLife("cook") && !labels.canSetShelfLife("staff") && labels.canEditPreparations("chef") && !labels.canEditPreparations("cook"));

    // Preparation waste: norm, balance and the waste API input (same rules as 20261018000001_wastage_in_prep.sql).
    ok("waste: old recipe draft keeps the stored norm and items", draft.value.wastageNormPercent === null && draft.value.wastageItems === null, draft);
    const withItems = labels.validatePreparationDraft({
      name: "Baranina",
      inputs: [{ product_id: P, qty: 10 }],
      outputs: [{ product_id: P2, qty: 5 }],
      wastage_norm_percent: "30",
      wastage_items: [{ name: " sümük ", norm_percent: "3" }, { name: "yağ", norm_percent: 2.5 }],
    });
    ok("waste: items set the norm to their sum", withItems.ok && withItems.value.wastageNormPercent === 5.5 && withItems.value.wastageItems[0].name === "sümük", withItems);
    const normOnly = labels.validatePreparationDraft({ name: "X", inputs: [{ product_id: P, qty: 1 }], outputs: [{ product_id: P2, qty: 1 }], wastage_norm_percent: "7,5", wastage_items: [] });
    ok("waste: norm without items", normOnly.ok && normOnly.value.wastageNormPercent === 7.5 && normOnly.value.wastageItems.length === 0, normOnly);
    ok(
      "waste: bad norm or items rejected",
      [
        { wastage_norm_percent: 101 },
        { wastage_norm_percent: -1 },
        { wastage_items: [{ name: "a", norm_percent: 60 }, { name: "b", norm_percent: 41 }] },
        { wastage_items: [{ name: "Sümük", norm_percent: 1 }, { name: "sümük", norm_percent: 1 }] },
        { wastage_items: [{ name: "", norm_percent: 1 }] },
        { wastage_items: [{ name: "x".repeat(labels.WASTE_ITEM_NAME_MAX + 1), norm_percent: 1 }] },
        { wastage_items: "sümük" },
      ].every((extra) => !labels.validatePreparationDraft({ name: "X", inputs: [{ product_id: P, qty: 1 }], outputs: [{ product_id: P2, qty: 1 }], ...extra }).ok),
    );
    const parsedPrep = labels.parsePreparation({
      id: P3, name: "Baranina", inputs: [{ product_id: P, qty: 10 }], outputs: [{ product_id: P2, qty: 5 }],
      wastage_norm_percent: "5", wastage_items: [{ name: "sümük", norm_percent: 5 }, { bad: true }],
    });
    ok("waste: recipe norm parsed", parsedPrep.wastageNormPercent === 5 && parsedPrep.wastageItems.length === 1, parsedPrep);

    const wasteRun = labels.validatePreparationRunInput({
      preparation_id: P3, source_qty: "10", storage_location_id: L, wastage: { qty: "0,5", reason: "cutting", note: " bony " }, confirm_loss: true,
    });
    ok("waste: run carries waste and the confirmation", wasteRun.ok && wasteRun.value.wastage.qty === 0.5 && wasteRun.value.wastage.note === "bony" && wasteRun.value.confirmLoss, wasteRun);
    ok("waste: zero waste is no waste", labels.validatePreparationRunInput({ preparation_id: P3, source_qty: 1, storage_location_id: L, wastage: { qty: 0 } }).value.wastage === null);
    ok(
      "waste: bad run waste rejected",
      [{ wastage: { qty: 11 } }, { wastage: { qty: 1, reason: "expired" } }, { wastage: { qty: -1 } }, { wastage: { qty: 1, note: "x".repeat(501) } }, { confirm_loss: "yes" }].every(
        (extra) => !labels.validatePreparationRunInput({ preparation_id: P3, source_qty: 10, storage_location_id: L, ...extra }).ok,
      ),
    );
    ok("waste: balance_mismatch mapped", labels.mapLabelsError({ message: "balance_mismatch" }).code === "balance_mismatch" && labels.mapLabelsError({ message: "balance_mismatch" }).status === 409);

    const trimRunInput = labels.validatePreparationRunInput({
      preparation_id: P3, source_qty: 10, storage_location_id: L, trims: [{ product_id: P2, qty: "2", note: " bulyon " }],
    });
    ok(
      "trim: run carries returned trim",
      trimRunInput.ok && trimRunInput.value.trims.length === 1 && trimRunInput.value.trims[0].qty === 2 && trimRunInput.value.trims[0].note === "bulyon" &&
        trimRunInput.value.trims[0].storageLocationId === null,
      trimRunInput,
    );
    ok("trim: no trim sent is no trim", labels.validatePreparationRunInput({ preparation_id: P3, source_qty: 1, storage_location_id: L }).value.trims.length === 0);
    ok(
      "trim: bad trim rejected",
      [
        { trims: [{ product_id: P2, qty: 0 }] },
        { trims: [{ product_id: "x", qty: 1 }] },
        { trims: [{ product_id: P2, qty: 1 }, { product_id: P2, qty: 1 }] },
        { trims: [{ product_id: P2, qty: 1, note: "x".repeat(501) }] },
        { trims: [{ product_id: P2, qty: 1, storage_location_id: "x" }] },
        { trims: "bones" },
      ].every((extra) => !labels.validatePreparationRunInput({ preparation_id: P3, source_qty: 10, storage_location_id: L, ...extra }).ok),
    );
    const trimDraft = labels.validatePreparationDraft({
      name: "Baranina",
      inputs: [{ product_id: P, qty: 10 }],
      outputs: [{ product_id: P2, qty: 5 }],
      wastage_items: [{ name: "sümük", norm_percent: 20, usable: true, product_id: P3 }, { name: "yağ", norm_percent: 10 }, { name: "damar", norm_percent: 2, product_id: P3 }],
      evaporation_percent: "5",
    });
    ok(
      "trim: draft items usable with their product, waste norm without them",
      trimDraft.ok && trimDraft.value.wastageNormPercent === 12 && trimDraft.value.evaporationPercent === 5 &&
        trimDraft.value.wastageItems[0].usable && trimDraft.value.wastageItems[0].productId === P3 && trimDraft.value.wastageItems[2].productId === null,
      trimDraft,
    );
    ok(
      "trim: draft norms plus evaporation stay within 100%",
      [
        { wastage_items: [{ name: "a", norm_percent: 60, usable: true }, { name: "b", norm_percent: 30 }], evaporation_percent: 11 },
        { evaporation_percent: 101 },
        { evaporation_percent: -1 },
        { wastage_items: [{ name: "a", norm_percent: 1, usable: "yes" }] },
        { wastage_items: [{ name: "a", norm_percent: 1, usable: true, product_id: "x" }] },
      ].every((extra) => !labels.validatePreparationDraft({ name: "X", inputs: [{ product_id: P, qty: 1 }], outputs: [{ product_id: P2, qty: 1 }], ...extra }).ok),
    );
    const trimPrep = labels.parsePreparation({
      id: P3, name: "Baranina", inputs: [{ product_id: P, qty: 10 }], outputs: [{ product_id: P2, qty: 5 }],
      wastage_norm_percent: 1, trim_norm_percent: "20", evaporation_percent: "5",
      wastage_items: [{ name: "sümük", norm_percent: 20, usable: true, product_id: P2 }, { name: "yağ", norm_percent: 1, product_id: P2 }],
    });
    ok(
      "trim: recipe parsed with trim norm, evaporation and usable items",
      trimPrep.trimNormPercent === 20 && trimPrep.evaporationPercent === 5 && trimPrep.wastageItems[0].usable && trimPrep.wastageItems[0].productId === P2 &&
        !trimPrep.wastageItems[1].usable && trimPrep.wastageItems[1].productId === null,
      trimPrep,
    );
    ok(
      "trim: trim lots exist, hand labels stay raw or semi",
      labels.LOT_TYPES.includes("trim") && labels.parseLot({ id: P, lot_number: "L-1", product_id: P2, branch_id: L, quantity: 2, unit: "kg", storage_location_id: L, lot_type: "trim", expiry_date: "2026-10-10", production_date: "2026-10-08" })?.lotType === "trim" &&
        !labels.validateLotInput({ product_id: P, qty: 1, storage_location_id: L, lot_type: "trim" }).ok,
    );

    // Final scheme: run cost, stock by kind, product economics (lib/labels/final.ts).
    const final = load("lib/labels/final.js");
    const lambCost = final.runCost({
      inputCost: 100,
      firstCostPerBase: 10,
      trims: [{ qty: 2, factor: 1, valuePercent: 100 }],
      outputs: [{ qty: 5, mass: 5 }, { qty: 2, mass: 2 }],
    });
    ok(
      "final: 100 gross - 20 trim = 80 net over 7 kg = 11.43 per kg",
      lambCost.trimCost === 20 && lambCost.netCost === 80 && lambCost.trimCostPerUnit[0] === 10 &&
        Math.abs(lambCost.outputCostPerUnit[0] - 80 / 7) < 1e-9 && Math.abs(lambCost.outputCostPerUnit[1] - 80 / 7) < 1e-9 &&
        Math.round(lambCost.outputCostPerUnit[0] * 100) / 100 === 11.43,
      lambCost,
    );
    const halfTrim = final.runCost({ inputCost: 100, firstCostPerBase: 10, trims: [{ qty: 2, factor: 1, valuePercent: 50 }], outputs: [{ qty: 7, mass: 7 }] });
    ok("final: trim value percent from the product or tenant", halfTrim.trimCost === 10 && halfTrim.netCost === 90, halfTrim);
    const byQty = final.runCost({ inputCost: 90, firstCostPerBase: 9, trims: [], outputs: [{ qty: 5, mass: 5 }, { qty: 4, mass: null }] });
    ok("final: without every weight the cost is shared by quantity", byQty.netCost === 90 && byQty.outputCostPerUnit.every((cost) => cost === 10), byQty);
    ok("final: no trim, the net cost is the input cost", final.runCost({ inputCost: 50, firstCostPerBase: 5, trims: [], outputs: [{ qty: 10, mass: 10 }] }).outputCostPerUnit[0] === 5);

    ok(
      "final: product types and stock kinds",
      final.stockKindOf("ready") === "semi" && final.stockKindOf("trim") === "trim" && final.stockKindOf("waste") === "raw" && final.productType("trim") === "trim" &&
        final.productType("meat") === null && final.stockFilter("semi") === "semi" && final.stockFilter("x") === "all",
    );
    ok("final: costs for owners and chefs only", final.canSeeCosts("owner") && final.canSeeCosts("chef") && !final.canSeeCosts("cook") && !final.canSeeCosts(null));
    ok(
      "final: stock links keep the branch",
      final.stockHref("/app/anbar/saxlama", L, "trim") === `/app/anbar/saxlama?branch=${L}&type=trim` && final.stockHref("/app/anbar/saxlama", null, "all") === "/app/anbar/saxlama",
    );
    const summaryRows = [
      final.parseStockSummary({ kind: "raw", lines: 3, kg: "10", liters: 0, pieces: 2, cost_value: "100", sale_value: "150", margin: "40", unpriced: 1 }),
      final.parseStockSummary({ kind: "trim", lines: 1, kg: 2, liters: 0, pieces: 0, cost_value: 20, sale_value: 0, margin: 0, unpriced: 1 }),
      final.parseStockSummary({ kind: "bad", lines: 1 }),
    ];
    const value = final.stockValue(summaryRows.filter(Boolean), 12, true);
    ok(
      "final: stock value by kind with totals and waste",
      summaryRows[2] === null && value.kinds.semi.lines === 0 && value.kinds.semi.costValue === 0 && value.kinds.raw.saleValue === 150 &&
        value.total.costValue === 120 && value.total.kg === 12 && value.total.margin === 40 && value.total.wasteCost === 12 && value.total.unpriced === 2,
      value,
    );
    const cookValue = final.stockValue(
      [final.parseStockSummary({ kind: "raw", lines: 3, kg: 10, liters: 0, pieces: 0, cost_value: null, sale_value: null, margin: null, unpriced: 3 })],
      null,
      false,
    );
    ok("final: no money for cooks", cookValue.total.costValue === null && cookValue.total.wasteCost === null && cookValue.kinds.trim.saleValue === null && cookValue.total.kg === 10, cookValue);
    const kitchenValue = final.stockValue(summaryRows.filter(Boolean), 12, false);
    ok("final: kitchen view drops money even when the rows carry it", kitchenValue.kinds.raw.costValue === null && kitchenValue.total.saleValue === null && kitchenValue.total.wasteCost === null, kitchenValue);
    const item = final.parseStockItem({
      stock_id: P, product_id: P2, product_name: "Sümük", unit: "kg", kind: "trim", quantity: "2", expiry_date: "2026-10-10", days_left: 2,
      location_name: "Soyuducu 1", lot_number: "L-7", cost_per_unit: null, sale_price: null,
    });
    ok("final: stock row parsed, prices null for cooks", item.kind === "trim" && item.quantity === 2 && item.lotNumber === "L-7" && item.costPerUnit === null, item);
    const eco = final.validateProductEconomics({ product_type: "trim", sale_price: "", density_kg_per_l: "1,03", trim_value_percent: "60" });
    ok("final: product economics validated", eco.ok && eco.value.salePrice === null && eco.value.densityKgPerL === 1.03 && eco.value.trimValuePercent === 60, eco);
    ok(
      "final: bad product economics rejected",
      [
        { product_type: "meat" },
        { product_type: "raw", sale_price: -1 },
        { product_type: "raw", density_kg_per_l: 0 },
        { product_type: "trim", trim_value_percent: 101 },
      ].every((body) => !final.validateProductEconomics(body).ok),
    );

    const logInput = labels.validateWastageInput({ product_id: P, quantity: "1,5", reason: "expired", parent_lot_id: P3 });
    ok("waste: log input from a lot", logInput.ok && logInput.value.quantity === 1.5 && logInput.value.storageLocationId === null && logInput.value.reasonNote === null, logInput);
    ok(
      "waste: bad log input rejected",
      [
        { product_id: P, quantity: 1, reason: "expired" },
        { product_id: P, quantity: 0, reason: "expired", storage_location_id: L },
        { product_id: P, quantity: 1, reason: "theft", storage_location_id: L },
        { product_id: P, quantity: 1, reason: "other", storage_location_id: "x" },
        { product_id: P, quantity: 1, reason: "other", storage_location_id: L, reason_note: 5 },
      ].every((body) => !labels.validateWastageInput(body).ok),
    );

    const weightDraft = (weights) =>
      labels.validatePreparationDraft({ name: "X", inputs: [{ product_id: P, qty: 10 }], outputs: [{ product_id: P2, qty: 8, portions: 8 }], portion_weights: weights });
    const withWeight = weightDraft([{ product_id: P2, portion_weight_kg: "0,25" }]);
    ok("waste: recipe carries portion weights", withWeight.ok && withWeight.value.portionWeights[0].kg === 0.25 && withWeight.value.portionWeights[0].productId === P2, withWeight);
    ok("waste: no portion weights sent", weightDraft(undefined).ok && weightDraft(undefined).value.portionWeights.length === 0);
    ok(
      "waste: bad portion weights rejected",
      [
        [{ product_id: P2, portion_weight_kg: 0 }],
        [{ product_id: P3, portion_weight_kg: 1 }],
        [{ product_id: "x", portion_weight_kg: 1 }],
        [{ product_id: P2, portion_weight_kg: 1 }, { product_id: P2, portion_weight_kg: 2 }],
        "0.25",
      ].every((weights) => !weightDraft(weights).ok),
    );

    const waste = load("lib/labels/waste.js");
    const tol = { prepBalanceTolerance: 0.3, prepBalanceTolerancePercent: 5 };
    const kg = (qty) => ({ qty, unit: "kg", portions: null, portionWeightKg: null, densityKgPerL: null });
    const lt = (qty, density = null) => ({ qty, unit: "l", portions: null, portionWeightKg: null, densityKgPerL: density });
    const por = (qty, weight) => ({ qty, unit: "pcs", portions: qty, portionWeightKg: weight, densityKgPerL: null });
    const balance = (inputs, outputs, actual, wasteQty, extra = {}) =>
      waste.calculateBalance({
        inputs, outputs, trims: [], normPercent: 0, trimNormPercent: 0, evaporationPercent: 0, scale: 1, actual, waste: wasteQty, tolerance: tol, ...extra,
      });
    const even = balance([kg(10)], [kg(5), kg(2), { ...kg(2500), unit: "g" }], [5, 2, 2500], 0.5);
    ok("waste: balanced run", even && even.difference === 0 && !even.exceeds && even.baseUnit === "kg", even);
    const short = balance([kg(10)], [kg(5), kg(2)], [5, 2], 0.7);
    ok("waste: 2.3 kg missing exceeds", short.difference === 2.3 && short.exceeds, short);
    ok("waste: within the absolute tolerance", !balance([kg(10)], [kg(9.8)], [9.8], 0).exceeds);
    ok("waste: percent tolerance on small runs", balance([kg(2)], [kg(1.75)], [1.75], 0).exceeds);
    ok("waste: surplus also exceeds", balance([kg(10)], [kg(11)], [11], 0).exceeds);
    ok("waste: tenant tolerance used", !balance([kg(10)], [kg(8)], [8], 0, { tolerance: { prepBalanceTolerance: 3, prepBalanceTolerancePercent: 30 } }).exceeds);
    ok("waste: taken amount scales the input", balance([kg(10)], [kg(5)], [10], 0, { scale: 2 }).difference === 10);

    const mixed = balance([kg(10)], [kg(5), por(8, 0.25)], [5, 8], 3, { normPercent: 5 });
    ok("waste: kg + portions balance by portion weight", mixed && mixed.difference === 0 && !mixed.exceeds && mixed.outputs[1].mass === 2 && !mixed.outputs[1].estimated, mixed);
    const lostPortions = balance([kg(10)], [kg(5), por(8, 0.25)], [5, 6], 3, { normPercent: 5 });
    ok("waste: missing portions exceed", lostPortions.difference === 0.5 && lostPortions.exceeds, lostPortions);
    const unknown = balance([kg(10)], [kg(5), por(8, null)], [5, 8], 0.5, { normPercent: 5 });
    ok(
      "waste: output without weight estimated, balance still counted",
      unknown && unknown.difference === 0 && !unknown.exceeds && unknown.outputs[1].estimated && unknown.outputs[1].mass === 4.5 && !unknown.outputs[0].estimated,
      unknown,
    );
    ok("waste: missing unweighed portions still exceed", balance([kg(10)], [kg(5), por(8, null)], [5, 6], 0.5, { normPercent: 5 }).exceeds);
    const noRoom = balance([kg(10)], [kg(10), por(8, null)], [10, 8], 0, { normPercent: 5 });
    ok("waste: no recipe room, unweighed output skipped", noRoom && noRoom.outputs[1].mass === null && noRoom.difference === 0, noRoom);
    ok(
      "waste: no balance without input weight or across kg and l inputs",
      balance([por(8, null)], [kg(2)], [2], 0) === null && balance([kg(1)], [lt(1)], [1], 0).outputs[0].estimated &&
        balance([kg(1), lt(1)], [kg(2)], [2], 0) === null,
    );
    const fromPortions = balance([por(40, 0.25)], [kg(9.5)], [9.5], 2);
    ok("waste: input in portions, waste in portions", fromPortions.input === 10 && fromPortions.waste === 0.5 && fromPortions.difference === 0, fromPortions);
    ok(
      "waste: line factor by portions per unit, by density across kg and l",
      waste.lineFactor({ qty: 2, unit: "pcs", portions: 8, portionWeightKg: 0.25, densityKgPerL: null }, "kg") === 1 &&
        waste.lineFactor(por(8, null), "kg") === null && waste.lineFactor(lt(1, 0.92), "kg") === 0.92 &&
        Math.abs(waste.lineFactor({ ...kg(1), densityKgPerL: 0.8 }, "l") - 1.25) < 1e-9 && waste.lineFactor(lt(1), "kg") === null,
    );
    ok(
      "waste: balance base kg when every line converts, else l",
      waste.massBase([kg(1), lt(1, 1.03)]) === "kg" && waste.massBase([lt(1), lt(2)]) === "l" && waste.massBase([kg(1), lt(1)]) === null && waste.massBase([]) === null,
    );
    const dense = balance([kg(5), lt(5, 1.06)], [kg(10)], [10], 0.3);
    ok("waste: density from the product puts litres into the kg balance", dense && dense.baseUnit === "kg" && dense.input === 10.3 && dense.difference === 0, dense);

    // Trim: 10 kg lamb, 2 kg bones back, net 8 = 5 shashlik + 2 farsh + 1 waste.
    const lamb = { inputs: [kg(10)], outputs: [kg(5), kg(2)], actual: [5, 2] };
    const bones = (qty) => ({ ...kg(qty) });
    const trimRun = balance(lamb.inputs, lamb.outputs, lamb.actual, 1, { trims: [bones(2)] });
    ok(
      "trim: net use is gross minus returned trim and balances",
      trimRun && trimRun.input === 10 && trimRun.trim === 2 && trimRun.net === 8 && trimRun.output === 7 && trimRun.waste === 1 && trimRun.difference === 0 && !trimRun.exceeds,
      trimRun,
    );
    const trimOnly = balance(lamb.inputs, lamb.outputs, lamb.actual, 0, { trims: [bones(2)] });
    ok("trim: trim without the waste is 1 kg missing", trimOnly.difference === 1 && trimOnly.exceeds, trimOnly);
    const noTrim = balance(lamb.inputs, [kg(5), kg(2)], [5, 2], 3);
    ok("trim: without trim net = gross", noTrim.trim === 0 && noTrim.net === noTrim.input && noTrim.difference === 0, noTrim);
    ok("trim: tolerance percent is of the net use", balance([kg(2)], [kg(1)], [1], 0, { trims: [bones(0.8)] }).exceeds && !balance([kg(10)], [kg(7.9)], [7.9], 0, { trims: [bones(2)] }).exceeds);
    ok("trim: trim in grams converts", balance(lamb.inputs, lamb.outputs, lamb.actual, 1, { trims: [{ ...kg(2000), unit: "g" }] }).net === 8);
    ok("trim: trim without a weight gives no balance", balance(lamb.inputs, lamb.outputs, lamb.actual, 1, { trims: [por(3, null)] }) === null);
    const evap = balance([kg(10)], [kg(7)], [7], 0, { evaporationPercent: 30 });
    ok("trim: evaporation of the gross input balances the yield", evap.evaporation === 3 && evap.difference === 0 && !evap.exceeds, evap);
    const implied = balance([kg(10)], [kg(5), por(8, null)], [5, 8], 0, { trims: [bones(2)], trimNormPercent: 20, normPercent: 10 });
    ok("trim: unweighed output implied after norms and trim", implied.outputs[1].estimated && implied.outputs[1].mass === 2 && implied.difference === 1, implied);

    const items = [
      { name: "sümük", normPercent: 20, usable: true, productId: P2 },
      { name: "yağ", normPercent: 3, usable: false, productId: null },
      { name: "damar", normPercent: 2, usable: false, productId: null },
    ];
    ok("trim: waste norm sums only waste items, trim norm the usable ones", waste.wasteNormOf(9, items) === 5 && waste.trimNormOf(items) === 20 && waste.wasteNormOf(9, []) === 9);
    const plannedTrim = waste.trimPlan([kg(10)], items);
    ok("trim: planned trim per usable item", plannedTrim.length === 1 && plannedTrim[0].qty === 2 && plannedTrim[0].productId === P2, plannedTrim);
    ok(
      "trim: items serialized with usable and the trim product",
      JSON.stringify(waste.serializeWasteItem(items[0])) === JSON.stringify({ name: "sümük", norm_percent: 20, usable: true, product_id: P2 }) &&
        !("product_id" in waste.serializeWasteItem(items[1])),
    );

    const norm = waste.wasteNorm([kg(10)], 5, [{ name: "sümük", normPercent: 3, usable: false, productId: null }, { name: "yağ", normPercent: 2, usable: false, productId: null }]);
    ok("waste: plan norm in the input unit", norm.qty === 0.5 && norm.items[0].qty === 0.3 && norm.items[1].qty === 0.2, norm);
    ok("waste: plan norm in grams", waste.wasteNorm([{ ...kg(2000), unit: "g" }, kg(1)], 10, []).qty === 300);
    ok("trim: usable items are not waste in the plan", waste.wasteNorm([kg(10)], 5, items).items.length === 2);
    ok(
      "waste: journal reads causes and notes",
      waste.describeWaste("cutting", "bony").cause === "bony" && waste.describeWaste("cutting", "fatty").note === null &&
        waste.describeWaste("cutting", null).cause === "norm" && waste.describeWaste("other", "balance").cause === "balance" &&
        waste.describeWaste("other", "çürük").cause === "other" && waste.describeWaste("other", "çürük").note === "çürük" &&
        waste.describeWaste("spoiled", "soyuducu xarab").cause === null && waste.describeWaste("spoiled", "soyuducu xarab").note === "soyuducu xarab",
    );
    ok(
      "waste: causes map to reasons and note codes",
      waste.causeToWaste("norm", "x").reason === "cutting" && waste.causeToWaste("norm", "x").note === null &&
        waste.causeToWaste("bony", "").note === "bony" && waste.causeToWaste("other", " çürük ").reason === "other" &&
        waste.causeToWaste("other", " çürük ").note === "çürük" && waste.causeToWaste("other", "  ").note === null,
    );
    const summary = waste.parseWasteSummary({ day: "2026-10-08", waste_kg: "3.2", waste_cost: null, runs: 2, input_kg: 40, norm_kg: 2, prep_waste_kg: 2.8 });
    const pct = waste.wastePercents(summary);
    ok("waste: owner percents", summary.wasteCost === null && pct.norm === 5 && pct.actual === 7 && pct.over === 2, { summary, pct });
    ok("waste: no runs, no percents", waste.wastePercents({ ...summary, runs: 0, inputKg: 0 }) === null);
    const expiredRow = waste.parseExpiredStockRow({
      stock_id: P, product_id: P2, product_name: "Toyuq", unit: "kg", quantity: "2", expiry_date: "2026-10-07", days_left: -1, location_id: L, location_name: "Soyuducu", lot_number: null,
    });
    ok("waste: expired stock row parsed", expiredRow.quantity === 2 && expiredRow.daysLeft === -1 && expiredRow.lotNumber === null, expiredRow);
    ok("waste: writers", waste.canWriteOffWaste("cook") && !waste.canWriteOffWaste("staff"));
  }

  // ---- waste photo AI add-on: verdict, model call, reserve / record flow, plans
  {
    const ai = load("lib/waste/ai-check.js");
    const plan = load("lib/waste/plan.js");
    const reservation = ai.parseReservation({
      status: "pending", photo_path: `${TENANT}/2026-10-09/x.jpg`, product_name: "Süd", quantity: "2", unit: "l",
      logged_kg: "2.06", reason: "spoiled", tolerance_percent: "50",
    });
    ok("ai: reservation parsed", reservation && reservation.loggedKg === 2.06 && reservation.tolerancePercent === 50 && reservation.quantity === 2, reservation);
    ok("ai: bad reservation rejected", ai.parseReservation({ status: "approved", quantity: 1, tolerance_percent: 50 }) === null);
    ok("ai: prompt carries the logged amount and reason", /2 l of "Süd" \(= 2\.06 kg\), reason "spoiled"/.test(ai.wastePrompt(reservation)));
    ok("ai: no config without key or model", ai.wasteAiConfig({ OPENAI_API_KEY: "k" }) === null && ai.wasteAiConfig({ WASTE_AI_MODEL: "m" }) === null);
    const config = ai.wasteAiConfig({ OPENAI_API_KEY: "k", WASTE_AI_MODEL: "m", WASTE_AI_INPUT_USD_PER_1M: "0.15", WASTE_AI_OUTPUT_USD_PER_1M: "0.6" });
    ok("ai: config with token prices", config && config.model === "m" && config.inputUsdPer1M === 0.15 && config.outputUsdPer1M === 0.6, config);
    const model = (o) => ai.parseModelAnalysis({ detected: "milk", estimated_kg: 2, reason_match: true, suspicious: false, confidence: 95, notes: "", ...o });
    ok("ai: model answer parsed, 0..1 confidence scaled", model({}).confidence === 95 && model({ confidence: 0.9 }).confidence === 90);
    ok("ai: model answer without booleans rejected", ai.parseModelAnalysis({ confidence: 90 }) === null);
    ok("ai: weight diff", ai.weightDiffPercent(2, 3) === 50 && ai.weightDiffPercent(null, 3) === null && ai.weightDiffPercent(2, null) === null);
    ok("ai: approved within tolerance", ai.decideVerdict(reservation, model({ estimated_kg: 2.5 }), null).status === "approved");
    const far = ai.decideVerdict(reservation, model({ estimated_kg: 5 }), 0.001);
    ok("ai: weight above tolerance -> suspicious", far.status === "suspicious" && far.analysis.suspicious && far.analysis.diff_percent > 50 && far.analysis.cost_usd === 0.001, far);
    ok("ai: reason mismatch -> suspicious", ai.decideVerdict(reservation, model({ reason_match: false }), null).status === "suspicious");
    ok("ai: model flag -> suspicious", ai.decideVerdict(reservation, model({ suspicious: true }), null).status === "suspicious");
    ok("ai: unknown weight judged by the photo only", ai.decideVerdict({ ...reservation, loggedKg: null }, model({ estimated_kg: 50 }), null).status === "approved");
    ok("ai: tolerance from the tenant", ai.decideVerdict({ ...reservation, tolerancePercent: 200 }, model({ estimated_kg: 5 }), null).status === "approved");
    ok("ai: cost from usage", Math.abs(ai.aiCostUsd({ usage: { prompt_tokens: 1000000, completion_tokens: 1000000 } }, config) - 0.75) < 1e-12);

    const answer = (content, okStatus = true) => async () => ({
      ok: okStatus,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }),
    });
    const photo = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" };
    let sent = null;
    const verdict = await ai.analyzeWastePhoto(reservation, photo, config, async (url, init) => {
      sent = JSON.parse(init.body);
      return answer({ detected: "milk", estimated_kg: 2, reason_match: true, suspicious: false, confidence: 95, notes: "" })();
    });
    ok("ai: approved 95% from the model", verdict && verdict.status === "approved" && verdict.confidence === 95, verdict);
    ok("ai: model from env, photo as data url", sent.model === "m" && sent.messages[0].content[1].image_url.url.startsWith("data:image/jpeg;base64,"));
    ok("ai: http failure -> null", (await ai.analyzeWastePhoto(reservation, photo, config, answer({}, false))) === null);
    ok("ai: garbage answer -> null", (await ai.analyzeWastePhoto(reservation, photo, config, answer({ hello: 1 }))) === null);

    const rpcClient = (reserveData) => {
      const calls = [];
      return {
        calls,
        rpc: async (fn, args) => {
          calls.push({ fn, args });
          return fn === "waste_ai_reserve" ? { data: reserveData, error: null } : { data: {}, error: null };
        },
      };
    };
    const raw = { status: "pending", photo_path: "p", product_name: "Süd", quantity: 2, unit: "l", logged_kg: 2, reason: "spoiled", tolerance_percent: 50 };
    let client = rpcClient({ ...raw, status: "not_checked" });
    let status = await ai.runWasteAiCheck(client, TENANT, P1, photo, config, async () => { throw new Error("must not call AI"); });
    ok("ai flow: AI off -> not_checked, no model call, no record", status === "not_checked" && client.calls.length === 1, client.calls);
    client = rpcClient({ ...raw, status: "limit_reached" });
    status = await ai.runWasteAiCheck(client, TENANT, P1, photo, config, async () => { throw new Error("must not call AI"); });
    ok("ai flow: over the limit -> limit_reached, no model call", status === "limit_reached" && client.calls.length === 1);
    client = rpcClient(raw);
    status = await ai.runWasteAiCheck(client, TENANT, P1, photo, config,
      answer({ detected: "milk", estimated_kg: 2, reason_match: true, suspicious: false, confidence: 95, notes: "" }));
    ok("ai flow: approved recorded", status === "approved" && client.calls[1].fn === "waste_ai_record" && client.calls[1].args.p_status === "approved" &&
      client.calls[1].args.p_confidence === 95, client.calls);
    client = rpcClient(raw);
    status = await ai.runWasteAiCheck(client, TENANT, P1, photo, config,
      answer({ detected: "bread", estimated_kg: 6, reason_match: true, suspicious: false, confidence: 80, notes: "" }));
    ok("ai flow: 6 kg seen for 2 kg logged -> suspicious recorded", status === "suspicious" && client.calls[1].args.p_status === "suspicious");
    client = rpcClient(raw);
    status = await ai.runWasteAiCheck(client, TENANT, P1, photo, null);
    ok("ai flow: no model configured -> check given back as not_checked", status === "not_checked" && client.calls[1].args.p_status === "not_checked");
    client = rpcClient(raw);
    status = await ai.runWasteAiCheck(client, TENANT, P1, photo, config, answer({}, false));
    ok("ai flow: AI failure -> not_checked recorded", status === "not_checked" && client.calls[1].args.p_status === "not_checked");

    const plans = [
      { code: "base", kind: "base", price: "79", currency: "AZN", period_days: 30, trial_days: 14, ai_photos: 0 },
      { code: "waste_ai", kind: "addon", price: 19, currency: "AZN", period_days: 30, trial_days: 0, ai_photos: 500 },
      { code: "bad", kind: "x", price: 1, currency: "AZN", period_days: 30 },
    ].map(plan.parseBillingPlan).filter(Boolean);
    ok("plans: parsed from rows, bad kind dropped", plans.length === 2 && plan.basePlan(plans).price === 79 && plan.basePlan(plans).trialDays === 14);
    ok("plans: AI add-on found", plan.aiAddon(plans).code === "waste_ai" && plan.aiAddon(plans).aiPhotos === 500);
    const state = plan.parseWasteAiState([{ photo_enabled: true, ai_enabled: false, plan: "free", used: 0, ai_limit: 50, free_photos: 50,
      included_photos: 500, tolerance_percent: "50", photos_this_month: 23, requested_plan: null }]);
    ok("plans: AI state parsed", state && state.limit === 50 && state.photosThisMonth === 23 && state.requestedPlan === null, state);
    const summary = plan.parseWastePhotoSummary([{ logs: 5, with_photo: 3, approved: 1, suspicious: 1, needs_review: 1, limit_reached: 0 }]);
    ok("plans: photo summary parsed", summary && summary.withPhoto === 3 && summary.needsReview === 1, summary);
    const check = (status) => ({ status, confidence: 95, detected: null, notes: null, requiresReview: false });
    ok("plans: badges", plan.aiBadge(check("approved")) === "approved" && plan.aiBadge(check("not_checked")) === "noAi" &&
      plan.aiBadge(check("limit_reached")) === "limitReached" && plan.aiBadge(null) === null);
    ok("plans: roles", plan.canReviewWaste("chef") && !plan.canReviewWaste("cook") && plan.canManageBilling("owner") && !plan.canManageBilling("chef"));
    ok("plans: settings body", JSON.stringify(plan.validateWasteSettings({ ai_enabled: true })) === JSON.stringify({ photoEnabled: null, aiEnabled: true, tolerancePercent: null }) &&
      plan.validateWasteSettings({}) === null && plan.validateWasteSettings({ ai_enabled: "yes" }) === null && plan.validateWasteSettings({ tolerance_percent: 0 }) === null);
  }

  {
    const money = load("lib/money.js");
    const currency = load("lib/currency/model.js");
    const spaces = (text) => text.replace(/[\u00a0\u202f]/g, " ");
    const RUB = { code: "RUB", symbol: "₽", locale: "ru-RU" };
    const AZN = { code: "AZN", symbol: "₼", locale: "az-AZ" };
    ok("money: Moscow 1234.5 RUB -> 1 234,50 ₽", spaces(money.formatMoney(1234.5, RUB)) === "1 234,50 ₽", money.formatMoney(1234.5, RUB));
    ok("money: Baku shows ₼, never the AZN code", money.formatMoney(1234.5, AZN).includes("₼") && !money.formatMoney(1234.5, AZN).includes("AZN") &&
      money.formatMoney(1234.5, AZN).includes("234,50"), money.formatMoney(1234.5, AZN));
    ok("money: no amount -> dash", money.formatMoney(null, RUB) === "—" && money.formatMoney(Number.NaN, RUB) === "—");
    const odd = money.formatMoney(5, { code: "xx", symbol: "§", locale: "ru-RU" });
    ok("money: unknown code falls back to amount + symbol", spaces(odd) === "5,00 §", odd);
    ok("money: settings -> currency", JSON.stringify(money.currencyOf({ currency: " rub ", currencySymbol: "₽", locale: "ru-RU" })) === JSON.stringify(RUB));
    ok("money: rate keeps 4 digits", spaces(money.formatRate(0.1734, { code: "TRY", symbol: "₺", locale: "tr-TR" })).includes("0,1734"));

    const list = [
      { code: "AZN", symbol: "₼", locale: "az-AZ", name_az: "Azərbaycan manatı", name_ru: "Азербайджанский манат", name_en: "Azerbaijani manat" },
      { code: "RUB", symbol: "₽", locale: "ru-RU", name_az: "Rusiya rublu", name_ru: "Российский рубль", name_en: "Russian ruble" },
      { code: "bad", symbol: "?", locale: "x" },
    ].map(currency.parseCurrency).filter(Boolean);
    ok("currency: rows parsed, bad code dropped", list.length === 2);
    ok("currency: name in UI language", currency.currencyName(list[1], "RU") === "RUB - Российский рубль (₽)");
    ok("currency: Moscow browser -> RUB, unknown -> first", currency.guessCurrency(list, ["ru-RU", "en"]).code === "RUB" &&
      currency.guessCurrency(list, ["fr-FR"]).code === "AZN" && currency.guessCurrency([], ["ru-RU"]) === null);
    ok("currency: 100 TRY at 0.17 -> 17", currency.convertPrice(100, 0.17) === 17);

    const P = "11111111-1111-4111-8111-111111111111";
    const L = "22222222-2222-4222-8222-222222222222";
    const fx = labels.validateReceiveLotInput({ product_id: P, qty: 1, storage_location_id: L, price: "100", currency: "try", fx_rate: "0,17" });
    ok("currency: receipt in supplier currency", fx.ok && fx.value.currency === "TRY" && fx.value.fxRate === 0.17 && fx.value.price === 100, fx);
    ok("currency: bad receipt currency rejected", [
      { product_id: P, qty: 1, storage_location_id: L, price: 100, currency: "TRY" },
      { product_id: P, qty: 1, storage_location_id: L, currency: "TRY", fx_rate: 0.17 },
      { product_id: P, qty: 1, storage_location_id: L, price: 100, currency: "TRY", fx_rate: 0 },
      { product_id: P, qty: 1, storage_location_id: L, price: 100, currency: "LIRA", fx_rate: 1 },
    ].every((body) => !labels.validateReceiveLotInput(body).ok));
    const refused = labels.mapLabelsError({ message: "stock_exists", code: "P0001" });
    ok("currency: change with stock on hand -> stock_exists 409", refused.code === "stock_exists" && refused.status === 409, refused);
    const supplier = purchasing.validateSupplierInput({ name: "Istanbul", default_currency: "try" });
    ok("currency: supplier currency", supplier.ok && supplier.value.currency === "TRY" &&
      purchasing.validateSupplierInput({ name: "Bazar" }).value.currency === null &&
      !purchasing.validateSupplierInput({ name: "Bazar", default_currency: "lira" }).ok, supplier);
  }

  {
    // Moving a lot to another place (lib/labels/model.ts, public.move_stock_lot).
    const S = "33333333-3333-4333-8333-333333333333";
    const L = "22222222-2222-4222-8222-222222222222";
    const whole = labels.validateMoveLotInput({ stock_id: S, to_location_id: L });
    ok("move: whole lot, norm of the target", whole.ok && whole.value.qty === null && whole.value.shelfLifeDays === null &&
      whole.value.remember === false && whole.value.reason === null, whole);
    const part = labels.validateMoveLotInput({ stock_id: S, to_location_id: L, qty: "2,5", shelf_life_days: "60", remember: true, reason: "  to   the freezer " });
    ok("move: part with an override remembered", part.ok && part.value.qty === 2.5 && part.value.shelfLifeDays === 60 &&
      part.value.remember && part.value.reason === "to the freezer", part);
    ok("move: bad input rejected", [
      { stock_id: "x", to_location_id: L },
      { stock_id: S, to_location_id: "" },
      { stock_id: S, to_location_id: L, qty: 0 },
      { stock_id: S, to_location_id: L, qty: "-1" },
      { stock_id: S, to_location_id: L, shelf_life_days: 3651 },
      { stock_id: S, to_location_id: L, shelf_life_days: "1.5" },
      { stock_id: S, to_location_id: L, remember: true },
      { stock_id: S, to_location_id: L, remember: "yes", shelf_life_days: 5 },
      { stock_id: S, to_location_id: L, reason: 42 },
      { stock_id: S, to_location_id: L, reason: "x".repeat(labels.MOVE_REASON_MAX + 1) },
    ].every((body) => !labels.validateMoveLotInput(body).ok));
    ok("move: clock restarts only into another kind of place or a custom one",
      labels.moveRestartsClock("soyuducu", "dondurucu") && !labels.moveRestartsClock("soyuducu", "soyuducu") &&
      labels.moveRestartsClock("custom", "custom") && !labels.moveRestartsClock("dondurucu", "dondurucu"));
    const expired = labels.mapLabelsError({ message: "lot_expired", code: "55000" });
    const counting = labels.mapLabelsError({ message: "open_count", code: "55000" });
    ok("move: expired lot and open count -> 409", expired.code === "lot_expired" && expired.status === 409 &&
      counting.code === "open_count" && counting.status === 409, { expired, counting });
    const item = load("lib/labels/final.js").parseStockItem({ stock_id: S, product_id: L, product_name: "Toyuq", kind: "raw", quantity: "4", location_id: L });
    ok("move: stock rows carry their place", item && item.locationId === L, item);
  }

  {
    const recipes = load("lib/recipes/model.js");
    const { grossPerPortion } = load("lib/recipes/sales.js");
    const P1 = "33333333-3333-4333-8333-333333333333";
    const P2 = "22222222-2222-4222-8222-222222222222";
    ok("tech card: waste % = (brutto - netto) / brutto", recipes.wastePercent(0.25, 0.2) === 20 && recipes.wastePercent(1, 1) === 0 &&
      recipes.wastePercent(0.3, 0.1) === 66.67);
    ok("tech card: no waste % when netto > brutto or empty", recipes.wastePercent(0.1, 0.2) === null && recipes.wastePercent(0, 0) === null &&
      recipes.wastePercent(NaN, 0.1) === null);
    const fc = recipes.foodCost(3.1, 20);
    ok("tech card: food cost 15.5 %, margin 16.9", fc.foodCostPercent === 15.5 && fc.margin === 16.9, fc);
    const noPrice = recipes.foodCost(3, null);
    const noCost = recipes.foodCost(null, 20);
    ok("tech card: no food cost without price or cost", noPrice.foodCostPercent === null && noPrice.margin === null &&
      noCost.foodCostPercent === null && recipes.foodCost(3, 0).foodCostPercent === null, { noPrice, noCost });
    ok("tech card: gross = brutto; netto grossed up by the waste without it", grossPerPortion({ brutto: 0.3, netto: 0.24, wastePercent: 20 }) === 0.3 &&
      Math.abs(grossPerPortion({ brutto: 0, netto: 0.2, wastePercent: 20 }) - 0.25) < 1e-9 && grossPerPortion({ brutto: 0, netto: 0, wastePercent: 0 }) === 0);
    const input = recipes.parseTechCardInput({
      id: null, name: "  Lula   kebab ", category: "", salePrice: 20, yieldQty: 0.35, yieldUnit: "kg",
      ingredients: [{ productId: P1, brutto: 0.25, netto: 0.2, priceLotId: "" }, { productId: P2, brutto: 0.05, netto: 0.05, priceLotId: P1 }],
    });
    ok("tech card input: normalised", input && input.name === "Lula kebab" && input.category === null && input.ingredients.length === 2 &&
      input.ingredients[0].priceLotId === null && input.ingredients[1].priceLotId === P1, input);
    const base = { id: null, name: "X", category: null, salePrice: null, yieldQty: null, yieldUnit: null, ingredients: [] };
    ok("tech card input: rejected", [
      { ...base, name: "  " },
      { ...base, id: "nope" },
      { ...base, salePrice: -1 },
      { ...base, yieldQty: 0 },
      { ...base, ingredients: [{ productId: P1, brutto: 0.1, netto: 0.2 }] },
      { ...base, ingredients: [{ productId: P1, brutto: 0.1, netto: 0.1 }, { productId: P1, brutto: 0.2, netto: 0.2 }] },
      { ...base, ingredients: [{ productId: P1, brutto: "0.1", netto: 0.1 }] },
      { ...base, ingredients: [{ productId: P1, brutto: 0.1, netto: 0.1, priceLotId: "lot" }] },
    ].every((body) => recipes.parseTechCardInput(body) === null));
    ok("tech card: decimal comma", recipes.parseDecimal("0,25") === 0.25 && Number.isNaN(recipes.parseDecimal("")));
    ok("tech card: errors mapped", recipes.mapTechCardError("duplicate_product") === "duplicate_product" &&
      recipes.mapTechCardError("boom") === "save_failed");
  }

  // ---- catalog import: file parsing, row checks, RPC mapping
  {
    const fs = require("fs");
    const ExcelJS = require("exceljs");
    const { parseCatalogFile, readLines, headerField } = load("lib/import/parse.js");
    const { validateRows, normalizeUnit, IMPORT_MAX_ROWS } = load("lib/import/validation.js");
    const { importCatalog } = load("lib/import/catalog.js");
    const bytes = (text) => new TextEncoder().encode(text);

    const fixture = await parseCatalogFile(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures/catalog-100.csv"))), "catalog-100.csv");
    ok("import: fixture -> 100 valid rows, no errors", fixture.ok && fixture.rows.length === 100 && fixture.valid.length === 100 &&
      fixture.errors.length === 0 && fixture.columns.length === 10, fixture.ok ? fixture.errors.slice(0, 3) : fixture);
    const second = fixture.ok && fixture.valid[1];
    ok("import: fixture row typed", second && second.row === 3 && second.barcode === "4600000000002" && typeof second.initial_stock === "number", second);

    ok("import: header aliases in three languages", headerField("Название") === "name" && headerField("Ölçü vahidi") === "unit" &&
      headerField(" Barcode ") === "barcode" && headerField("Годен до") === "expiry_date" && headerField("qalıq") === "initial_stock" &&
      headerField("whatever") === null);
    ok("import: unit aliases", normalizeUnit("кг") === "kg" && normalizeUnit("Шт.") === "pcs" && normalizeUnit("ədəd") === "pcs" &&
      normalizeUnit("qutu") === "box" && normalizeUnit("bucket") === null);

    const semi = await parseCatalogFile(bytes("\ufeffНазвание;Ед.;Цена;Остаток;Мусор\nМука;кг;1,5;10;x\n\n;;;;\nСоль;г;;;\n"), "ru.csv");
    ok("import: semicolon CSV with BOM, decimal comma, blank lines skipped", semi.ok && semi.valid.length === 2 &&
      semi.valid[0].price === 1.5 && semi.valid[0].unit === "kg" && semi.valid[1].row === 5 && semi.ignored.join() === "Мусор", semi);

    const checked = validateRows([
      { row: 2, values: { name: "", unit: "kg" } },
      { row: 3, values: { name: "A", unit: "kg" } },
      { row: 4, values: { name: "Milk", unit: "bucket", initial_stock: "-1" } },
      { row: 5, values: { name: "Eggs", unit: "pcs", barcode: "123", shelf_life_days: "1.5" } },
      { row: 6, values: { name: "eggs ", unit: "pcs", barcode: "123", expiry_date: "31.12.2026" } },
      { row: 7, values: { name: "Rice", unit: "kg", price: "abc", min_stock: "2000000" } },
      { row: 8, values: { name: "Oil", unit: "l", initial_stock: "0" } },
    ]);
    const codes = checked.errors.map((e) => `${e.row}:${e.field}:${e.code}`).sort();
    ok("import: row errors with row, field, code and value", JSON.stringify(codes) === JSON.stringify([
      "2:name:required", "3:name:too_short", "4:initial_stock:negative", "4:unit:invalid_unit",
      "5:shelf_life_days:not_integer", "6:barcode:duplicate_in_file", "6:expiry_date:invalid_date", "6:name:duplicate_in_file",
      "7:min_stock:too_large", "7:price:invalid_number",
    ]) && checked.errors.find((e) => e.row === 4 && e.field === "unit").value === "bucket", codes);
    ok("import: only clean rows are valid", checked.valid.length === 1 && checked.valid[0].name === "Oil" && checked.valid[0].initial_stock === 0, checked.valid);

    ok("import: file errors", (await parseCatalogFile(new Uint8Array(), "a.csv")).error === "empty" &&
      (await parseCatalogFile(bytes("x"), "a.pdf")).error === "unsupported" &&
      (await parseCatalogFile(bytes("price,unit\n1,kg\n"), "a.csv")).error === "no_name_column" &&
      (await parseCatalogFile(bytes("name\n"), "a.csv")).error === "empty" &&
      (await parseCatalogFile(bytes("not a zip"), "a.xlsx")).error === "unreadable");
    const many = readLines([["name"], ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => [`P${i}`])]);
    ok("import: row limit", many.ok === false && many.error === "too_many_rows");

    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Catalog");
    sheet.addRow([]);
    sheet.addRow(["Product name", "UOM", "Barcode", "Expiry date", "Qty"]);
    sheet.addRow(["Tomatoes", "kg", 4600000000099, new Date(Date.UTC(2030, 0, 15)), { formula: "2*3", result: 6 }]);
    sheet.addRow([{ richText: [{ text: "Che" }, { text: "ese" }] }, "г", "", "", ""]);
    const xlsx = await parseCatalogFile(new Uint8Array(await book.xlsx.writeBuffer()), "catalog.XLSX");
    ok("import: xlsx round trip (header after a blank line, dates, formulas, rich text)", xlsx.ok && xlsx.valid.length === 2 &&
      xlsx.valid[0].row === 3 && xlsx.valid[0].barcode === "4600000000099" && xlsx.valid[0].expiry_date === "2030-01-15" &&
      xlsx.valid[0].initial_stock === 6 && xlsx.valid[1].name === "Cheese" && xlsx.valid[1].unit === "g", xlsx);

    const rpcClient = (reply) => {
      const calls = [];
      return { calls, rpc: async (fn, args) => { calls.push({ fn, args }); return reply; } };
    };
    const raw = [{ row: 2, values: { name: "Milk", barcode: "777" } }];
    const rows = [{ row: 2, name: "Milk", unit: "l", barcode: "777", category: null, price: null, shelf_life_days: null, min_stock: null, initial_stock: 3, location: null, expiry_date: null }];
    let c = rpcClient({ data: { ok: true, dry_run: false, rows: 1, stocked: 1, errors: [] }, error: null });
    let res = await importCatalog({ client: c, tenantId: TENANT }, { branchId: B1, locationId: L1, rows, raw, dryRun: false });
    ok("import rpc: one call, tenant not sent, written", res.ok && res.written && res.rows === 1 && res.stocked === 1 &&
      c.calls.length === 1 && c.calls[0].fn === "import_catalog" && !("p_tenant_id" in c.calls[0].args) && c.calls[0].args.p_dry_run === false, res);
    c = rpcClient({ data: { ok: false, dry_run: false, rows: 1, stocked: 1, errors: [{ row: 2, field: "barcode", code: "exists" }, { row: "x" }] }, error: null });
    res = await importCatalog({ client: c, tenantId: TENANT }, { branchId: B1, locationId: L1, rows, raw, dryRun: false });
    ok("import rpc: database row errors carry the cell value, nothing written", res.ok && !res.written && res.errors.length === 1 &&
      res.errors[0].value === "777" && res.errors[0].code === "exists", res);
    c = rpcClient({ data: null, error: { message: "branch_not_found", code: "P0001" } });
    res = await importCatalog({ client: c, tenantId: TENANT }, { branchId: B1, locationId: null, rows, raw, dryRun: true });
    ok("import rpc: database refusals mapped", !res.ok && res.error === "branch_not_found" && res.status === 404, res);
    c = rpcClient({ data: null, error: { message: "duplicate key", code: "23505" } });
    res = await importCatalog({ client: c, tenantId: TENANT }, { branchId: B1, locationId: null, rows, raw, dryRun: false });
    ok("import rpc: unique violation -> conflict", !res.ok && res.error === "conflict" && res.status === 409, res);
  }

  // ---- branch transfer: request shape, errors, texts
  {
    const transfer = load("lib/transfer/model.js");
    const P = "cccccccc-0000-0000-0000-000000000001";
    const B2 = "bbbbbbbb-0000-0000-0000-000000000002";
    const input = transfer.parseTransferInput({
      from_branch_id: B1, to_branch_id: B2, tenant_id: "evil", note: "  weekly  ",
      items: [{ product_id: P.toUpperCase(), quantity: 2.5 }, { product_id: P, quantity: 1, from_location_id: L1 }],
    });
    ok("transfer input: items normalised, tenant ignored", input && input.items.length === 2 && input.items[0].productId === P &&
      input.items[0].fromLocationId === null && input.items[1].fromLocationId === L1 && input.note === "weekly" && !("tenantId" in input), input);
    ok("transfer input: rpc items without tenant", JSON.stringify(transfer.rpcItems(input.items)[1]) ===
      JSON.stringify({ product_id: P, quantity: 1, from_location_id: L1, to_location_id: null }));
    const legacy = transfer.parseTransferInput({ from_branch_id: B1, to_branch_id: B2, product_id: P, quantity: 3, from_location_id: L1, to_location_id: L1 });
    ok("transfer input: single-product body still accepted", legacy && legacy.items.length === 1 && legacy.items[0].quantity === 3, legacy);
    const base = { from_branch_id: B1, to_branch_id: B2 };
    ok("transfer input: rejected", [
      null, {}, { ...base }, { ...base, items: [] },
      { ...base, from_branch_id: "x", items: [{ product_id: P, quantity: 1 }] },
      { ...base, items: [{ product_id: P, quantity: 0 }] },
      { ...base, items: [{ product_id: P, quantity: "1" }] },
      { ...base, items: [{ product_id: P, quantity: 2e6 }] },
      { ...base, items: [{ product_id: P, quantity: 1, to_location_id: "nope" }] },
      { ...base, items: [{ product_id: P, quantity: 1 }, { product_id: P, quantity: 2 }] },
      { ...base, items: Array.from({ length: transfer.TRANSFER_MAX_ITEMS + 1 }, () => ({ product_id: P, quantity: 1 })) },
      { ...base, items: [{ product_id: P, quantity: 1 }], note: 5 },
    ].every((body) => transfer.parseTransferInput(body) === null));
    ok("transfer errors: database codes mapped", transfer.mapTransferError("insufficient_stock") === "insufficient_stock" &&
      transfer.mapTransferError("to_branch_not_found") === "to_branch_not_found" && transfer.mapTransferError("boom") === "save_failed" &&
      transfer.TRANSFER_STATUS.insufficient_stock === 400 && transfer.TRANSFER_STATUS.forbidden === 403);
    const shortages = transfer.parseShortages(JSON.stringify([{ product_id: P, requested: 100, available: 3 }, { nope: 1 }]));
    ok("transfer errors: shortage detail parsed", shortages.length === 1 && shortages[0].available === 3 &&
      transfer.parseShortages("not json").length === 0 && transfer.parseShortages(null).length === 0, shortages);
    ok("transfer texts: language from ?lang, then Accept-Language, default az",
      transfer.pickTransferLang("RU", "en-US") === "ru" && transfer.pickTransferLang(null, "de-DE,en;q=0.8") === "en" &&
      transfer.pickTransferLang(null, null) === "az");
    ok("transfer texts: every error in three languages", transfer.TRANSFER_LANGS.every((lang) =>
      transfer.TRANSFER_ERRORS.every((code) => typeof transfer.TRANSFER_MESSAGES[lang][code] === "string" && transfer.TRANSFER_MESSAGES[lang][code].length > 0)) &&
      transfer.TRANSFER_MESSAGES.ru.shortageLine("Молоко (l)", "100", "3") === "Молоко (l): нужно 100, есть 3");
    const P2 = "cccccccc-0000-0000-0000-000000000002";
    const L2 = "aaaaaaaa-0000-0000-0000-000000000002";
    const placed = transfer.parseTransferInput({ ...base, from_location_id: L1, to_location_id: L2, items: [{ product_id: P, quantity: 1 }, { product_id: P2, quantity: 2, to_location_id: L1 }] });
    ok("transfer input: top-level places are item defaults, item places win", placed && placed.items[0].fromLocationId === L1 &&
      placed.items[0].toLocationId === L2 && placed.items[1].toLocationId === L1, placed);
    ok("transfer input: bad top-level place rejected", transfer.parseTransferInput({ ...base, to_location_id: "nope", items: [{ product_id: P, quantity: 1 }] }) === null);
  }

  // ---- transfer screen: cart, quantities, request body, texts
  {
    const transfer = load("lib/transfer/model.js");
    const cart = load("lib/transfer/cart.js");
    const { TRANSFERS_AZ, TRANSFERS_RU, TRANSFERS_EN } = load("lib/i18n/transfers.js");
    const B2 = "bbbbbbbb-0000-0000-0000-000000000002";
    const P2 = "cccccccc-0000-0000-0000-000000000002";
    const milk = { productId: P1, name: "Süd", internalCode: "ALO-0001", barcode: "4760000000017", unit: "l", available: 3, nearestExpiry: "2026-10-12" };
    const salt = { productId: P2, name: "Duz", internalCode: "ALO-0002", barcode: null, unit: "kg", available: 10, nearestExpiry: null };

    ok("transfer ui: number format TRF-YYYYMMDD-NNNN", cart.isTransferNumber("TRF-20261010-0001") && cart.isTransferNumber("TRF-20261010-12345") &&
      !cart.isTransferNumber("TRF-2026101-0001") && !cart.isTransferNumber("trf-20261010-0001") && !cart.isTransferNumber(null));
    ok("transfer ui: quantity accepts comma and spaces", cart.parseQuantity("1,5") === 1.5 && cart.parseQuantity(" 1 500.25 ") === 1500.25 &&
      cart.parseQuantity("2") === 2 && cart.parseQuantity(".5") === 0.5);
    ok("transfer ui: quantity rejects empty, zero, negative, text", ["", "0", "-1", "abc", "1.2.3", "1e3"].every((text) => cart.parseQuantity(text) === null));

    const one = cart.addLine([], milk);
    const twice = cart.addLine(cart.setQuantity(one.lines, P1, "2"), milk);
    ok("transfer ui: product added once, quantity kept", one.added && !twice.added && twice.lines.length === 1 && twice.lines[0].quantity === "2");
    const full = Array.from({ length: transfer.TRANSFER_MAX_ITEMS }, (_, i) => ({ ...salt, productId: `p${i}`, quantity: "1" }));
    ok("transfer ui: no more than 200 lines", !cart.addLine(full, milk).added && cart.addLine(full, milk).lines.length === transfer.TRANSFER_MAX_ITEMS);

    let lines = cart.addLine(one.lines, salt).lines;
    ok("transfer ui: empty quantity is a problem", cart.lineProblem(lines[0]) === "quantity");
    lines = cart.setQuantity(lines, P1, "4");
    ok("transfer ui: more than available is a problem ('есть 3')", cart.lineProblem(lines[0]) === "exceeds" && TRANSFERS_RU.available("3", "л") === "есть 3 л");
    lines = cart.setQuantity(cart.setQuantity(lines, P1, "2,5"), P2, "1");
    ok("transfer ui: valid lines can be sent", lines.every((line) => cart.lineProblem(line) === null) &&
      cart.canSubmit({ fromBranchId: B1, toBranchId: B2, fromLocationId: null, toLocationId: null, lines, note: "" }));
    ok("transfer ui: same branch, no branch or empty cart cannot be sent", [
      { fromBranchId: B1, toBranchId: B1, lines },
      { fromBranchId: "", toBranchId: B2, lines },
      { fromBranchId: B1, toBranchId: B2, lines: [] },
    ].every((draft) => !cart.canSubmit({ fromLocationId: null, toLocationId: null, note: "", ...draft })));

    const body = cart.buildTransferRequest({ fromBranchId: B1, toBranchId: B2, fromLocationId: L1, toLocationId: null, lines, note: "  weekly  " });
    ok("transfer ui: request body for /api/transfer", body && body.from_branch_id === B1 && body.to_branch_id === B2 && body.note === "weekly" &&
      body.items.length === 2 && body.items[0].product_id === P1 && body.items[0].quantity === 2.5 &&
      body.items[0].from_location_id === L1 && body.items[0].to_location_id === null, body);
    const parsedBody = transfer.parseTransferInput(body);
    ok("transfer ui: the API accepts what the screen sends", parsedBody && parsedBody.items.length === 2 && parsedBody.items[1].quantity === 1, parsedBody);
    ok("transfer ui: nothing to send while a line is wrong", cart.buildTransferRequest({ fromBranchId: B1, toBranchId: B2, fromLocationId: null, toLocationId: null,
      lines: cart.setQuantity(lines, P2, "0"), note: "" }) === null);

    const moved = cart.refreshAvailability(lines, [{ ...milk, available: 1, nearestExpiry: "2026-10-20" }]);
    ok("transfer ui: new source refreshes stock, missing product has none", moved[0].available === 1 && moved[0].nearestExpiry === "2026-10-20" &&
      moved[1].available === 0 && moved[1].nearestExpiry === null && moved[0].quantity === "2,5");
    const short = cart.applyShortages(lines, [{ product_id: P1, available: 1 }]);
    ok("transfer ui: refused transfer marks the short line", cart.lineProblem(short[0]) === "exceeds" && cart.lineProblem(short[1]) === null &&
      cart.removeLine(short, P1).length === 1);

    const shape = (value) => (typeof value === "function" ? "fn" : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value);
    ok("transfer ui: AZ/RU/EN have the same texts", JSON.stringify(shape(TRANSFERS_AZ)) === JSON.stringify(shape(TRANSFERS_RU)) &&
      JSON.stringify(shape(TRANSFERS_RU)) === JSON.stringify(shape(TRANSFERS_EN)) &&
      [TRANSFERS_AZ, TRANSFERS_RU, TRANSFERS_EN].every((d) => d.submit(2).includes("2") && d.success.number("TRF-20261010-0001").includes("TRF-20261010-0001")));
    ok("transfer ui: invoice path", load("lib/auth-redirect.js").transferInvoicePath(P1) === `/app/anbar/transfers/${P1}`);
  }

  // ---- freshness control: actions, tones, decisions, rows, texts
  {
    const expiry = load("lib/labels/expiry.js");
    const { EXPIRY_AZ, EXPIRY_RU, EXPIRY_EN } = load("lib/i18n/expiry.js");
    const { ExpiryAction } = expiry;
    ok("expiry: actions are the database enum", JSON.stringify(expiry.EXPIRY_ACTIONS) === JSON.stringify(["use_in_production", "discount", "staff", "extend", "write_off"]) &&
      expiry.isExpiryAction("extend") && !expiry.isExpiryAction("freeze"));
    ok("expiry: an expired lot can only be written off", JSON.stringify(expiry.actionsFor(-1)) === JSON.stringify([ExpiryAction.WriteOff]) &&
      expiry.actionsFor(0).length === 5 && expiry.actionsFor(1).includes(ExpiryAction.Extend));
    ok("expiry: warning window is one day", expiry.EXPIRY_WARNING_DAYS === 1);
    ok("expiry: past expiry only below today (the expiry day itself still sells)",
      expiry.isPastExpiry(-1) && !expiry.isPastExpiry(0) && !expiry.isPastExpiry(1));
    ok("expiry: badge red at 0 or less, yellow at 1, plain later",
      expiry.expiryTone(-2) === "expired" && expiry.expiryTone(0) === "expired" && expiry.expiryTone(1) === "warning" && expiry.expiryTone(2) === "ok");
    ok("expiry: only owners and chefs review", expiry.canReviewExpiry("owner") && expiry.canReviewExpiry("chef") &&
      !expiry.canReviewExpiry("cook") && !expiry.canReviewExpiry("staff") && !expiry.canReviewExpiry(null));

    const extend = (newExpiry, note) => expiry.reviewInputError({ lotId: P1, action: ExpiryAction.Extend, note, newExpiry }, "2026-10-10");
    ok("expiry: extend needs a date after today", extend("2026-10-10", "ok") === "date" && extend("2026-10-09", "ok") === "date" &&
      extend("2026-13-01", "ok") === "date" && extend(null, "ok") === "date");
    ok("expiry: extend needs a note", extend("2026-10-11", "  ") === "note" && extend("2026-10-11", null) === "note" && extend("2026-10-11", "sealed") === null);
    ok("expiry: other actions need neither", expiry.reviewInputError({ lotId: P1, action: ExpiryAction.Discount, note: null, newExpiry: null }, "2026-10-10") === null &&
      expiry.reviewInputError({ lotId: P1, action: ExpiryAction.WriteOff, note: "x".repeat(501), newExpiry: null }, "2026-10-10") === "note");

    ok("expiry: review body parsed", JSON.stringify(expiry.parseReviewBody({ lot_id: P1, action: "extend", note: " sealed ", new_expiry: "2026-10-12" })) ===
      JSON.stringify({ lotId: P1, action: "extend", note: "sealed", newExpiry: "2026-10-12" }));
    ok("expiry: bad review bodies rejected", [{ lot_id: P1, action: "freeze" }, { action: "discount" }, { lot_id: P1, action: "extend", note: 5 }, { lot_id: P1, action: "extend", new_expiry: 20261012 }]
      .every((body) => expiry.parseReviewBody(body) === null));

    const lot = expiry.parseNearExpiryLot({ lot_id: P1, product_id: P1, product_name: "Süd", internal_code: "MLK-1", unit: "l", lot_number: "LOT-20261010-0001",
      expiry_date: "2026-10-11", days_left: 1, quantity: "3", location_id: L1, location_name: "Soyuducu", location_type: "soyuducu", cost: "9.5", currency: "AZN",
      last_action: "discount", last_action_at: "2026-10-10T08:00:00Z" });
    ok("expiry: near-expiry row parsed", lot && lot.quantity === 3 && lot.cost === 9.5 && lot.locationType === "soyuducu" && lot.lastAction === "discount", lot);
    ok("expiry: hidden cost stays null, broken rows dropped", expiry.parseNearExpiryLot({ ...lot, lot_id: P1, product_id: P1, expiry_date: "2026-10-11", days_left: 1,
      quantity: 1, location_id: L1, currency: "AZN", cost: null }).cost === null && expiry.parseNearExpiryLot({ lot_id: P1 }) === null);
    ok("expiry: totals count lots and sum visible costs", JSON.stringify(expiry.nearExpiryTotals([lot, { ...lot, cost: 0.5 }])) === JSON.stringify({ count: 2, value: 10 }) &&
      expiry.nearExpiryTotals([{ ...lot, cost: null }]).value === null);

    const note = expiry.parseExpiringNotification({ id: P1, branch_id: B1, type: "expiring_soon", notify_date: "2026-10-10",
      payload: { count: 2, total_value: 12.5, currency: "AZN", days: 1, lots: [] } });
    ok("expiry: notification parsed", note && note.count === 2 && note.totalValue === 12.5 && note.currency === "AZN" && note.branchId === B1, note);
    ok("expiry: other notification types ignored", expiry.parseExpiringNotification({ id: P1, type: "other", notify_date: "2026-10-10", payload: { count: 1 } }) === null);

    const shape = (value) => (typeof value === "function" ? "fn" : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value);
    ok("expiry: AZ/RU/EN have the same texts", JSON.stringify(shape(EXPIRY_AZ)) === JSON.stringify(shape(EXPIRY_RU)) &&
      JSON.stringify(shape(EXPIRY_RU)) === JSON.stringify(shape(EXPIRY_EN)));
    ok("expiry: every action has a label and a done text in every language", [EXPIRY_AZ, EXPIRY_RU, EXPIRY_EN].every((d) =>
      expiry.EXPIRY_ACTIONS.every((action) => d.actions[action] && d.done[action]("Süd").includes("Süd"))));
    ok("expiry: day texts", EXPIRY_RU.days(0) === "сегодня" && EXPIRY_RU.days(1) === "завтра" && EXPIRY_RU.days(-2) === "просрочено 2 дня" &&
      EXPIRY_EN.days(3) === "3 days" && EXPIRY_AZ.days(1) === "sabah");
    ok("expiry: yellow block title follows the review window", EXPIRY_RU.card.title(1) === "Завтра истекает" &&
      EXPIRY_RU.card.title(3) === "Истекает в ближайшие 3 дня" && EXPIRY_EN.card.title(1) === "Expires tomorrow" && EXPIRY_AZ.card.title(1) === "Sabah vaxtı bitir");
    ok("expiry: red block is the already expired stock", load("lib/i18n/labels.js").LABELS_RU.waste.expiredTitle === "Уже просрочено");
    ok("expiry: chef dashboard path", load("lib/auth-redirect.js").CHEF_DASHBOARD_PATH === "/app/chef/dashboard");
  }

  {
    const { parMarks } = load("lib/anbar/par.js");
    const { OWNER_AZ, OWNER_RU, OWNER_EN } = load("lib/i18n/owner.js");
    const B2 = "bbbbbbbb-0000-0000-0000-000000000002";
    const alert = (branchId, productId, quantity, min) => ({ branchId, branchName: "", productId, productName: "", unit: "kg", quantity, min, max: null, toOrder: min - quantity });
    const alerts = [alert(B2, "p-meat", 0, 20), alert(B1, "p-meat", 12, 20), alert(B1, "p-milk", 1, 5)];
    const one = parMarks(alerts, B1);
    ok("par: branch keeps only its rows", one["p-meat"].quantity === 12 && one["p-meat"].min === 20 && one["p-milk"].min === 5 && Object.keys(one).length === 2, one);
    ok("par: all branches take the first (emptiest) row", parMarks(alerts, null)["p-meat"].quantity === 0);
    ok("par: product without an alert gets no badge", parMarks(alerts, B2)["p-milk"] === undefined && Object.keys(parMarks([], B1)).length === 0);
    ok("par: short badge text in every language", OWNER_RU.par.orderNow === "Закажи сейчас" && OWNER_EN.par.orderNow === "Order now" && OWNER_AZ.par.orderNow.length > 0);
  }

  {
    const losses = load("lib/losses/model.js");
    const { OWNER_AZ, OWNER_RU, OWNER_EN } = load("lib/i18n/owner.js");
    ok("losses: period from the query, week by default", losses.parseLossPeriod("month") === "month" && losses.parseLossPeriod(["week"]) === "week" &&
      losses.parseLossPeriod("year") === "week" && losses.parseLossPeriod(undefined) === "week");
    ok("losses: week is 7 days and month 30, ending on the restaurant's today",
      JSON.stringify(losses.lossRange("week", "2026-10-10")) === JSON.stringify({ start: "2026-10-04", end: "2026-10-10" }) &&
      JSON.stringify(losses.lossRange("month", "2026-03-01")) === JSON.stringify({ start: "2026-01-31", end: "2026-03-01" }));

    const rice = losses.parseLossRow({ product_id: P1, product_name: "Düyü", unit: "kg", theoretical_qty: "2", actual_qty: "3", loss_qty: "1",
      loss_pct: "50", written_off_qty: "0", count_loss_qty: "1", unit_cost: "2", loss_value: "2", currency: "AZN", over_limit: true });
    ok("losses: row parsed (10 plov x 200 g: expected 2, actual 3, lost 1)", rice && rice.theoretical === 2 && rice.actual === 3 && rice.loss === 1 &&
      rice.lossPercent === 50 && rice.countLoss === 1 && rice.lossValue === 2 && rice.overLimit === true, rice);
    const unsold = losses.parseLossRow({ product_id: P1, theoretical_qty: 0, actual_qty: 0.4, loss_qty: 0.4, loss_pct: null, loss_value: null, over_limit: false });
    ok("losses: no sales -> no percent; hidden money stays null", unsold && unsold.lossPercent === null && unsold.lossValue === null && unsold.writtenOff === 0, unsold);
    ok("losses: broken rows dropped", losses.parseLossRow({ product_id: P1, theoretical_qty: "x" }) === null && losses.parseLossRow(null) === null);
    ok("losses: totals net out surpluses and count red rows",
      JSON.stringify(losses.lossTotals([rice, { ...rice, lossValue: -0.5, overLimit: false }, unsold])) === JSON.stringify({ value: 1.5, overLimit: 1 }));
    const shape = (value) => (typeof value === "function" ? "fn" : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value);
    ok("losses: AZ/RU/EN have the same texts", JSON.stringify(shape(OWNER_AZ)) === JSON.stringify(shape(OWNER_RU)) && JSON.stringify(shape(OWNER_RU)) === JSON.stringify(shape(OWNER_EN)));
    ok("losses: column titles", OWNER_RU.losses.expected === "Ожидалось" && OWNER_RU.losses.actual === "Факт" && OWNER_RU.losses.lossPercent === "% потерь" &&
      OWNER_RU.losses.breakdown("1 кг", "2 кг").includes("2 кг"));
    ok("losses: owner path", load("lib/auth-redirect.js").OWNER_LOSSES_PATH === "/app/owner/losses");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
