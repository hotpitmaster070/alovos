/** tenant_settings columns of 20261029000200 (owner-editable) and the per-product limits behind them. */

export const LOSS_ALERT_MIN = 1;
export const LOSS_ALERT_MAX = 30;
/** Restaurant-wide low stock default is a whole number (tenant_settings.low_stock_default). */
export const LOW_STOCK_DEFAULT_MAX = 100000;
export const AUTO_ORDER_NOTIFY = ["system", "whatsapp", "email"] as const;
export type AutoOrderNotify = (typeof AUTO_ORDER_NOTIFY)[number];
/** save_stock_limits() takes at most this many rows per call. */
export const LIMITS_BATCH_MAX = 1000;

export const SMART_SETTINGS_COLUMNS =
  "timezone, low_stock_default, loss_alert_percent, loss_alert_enabled, auto_order_enabled, auto_order_time, auto_order_notify";

export type SmartSettings = {
  timezone: string;
  lowStockDefault: number;
  lossAlertPercent: number;
  lossAlertEnabled: boolean;
  autoOrderEnabled: boolean;
  /** HH:MM in the restaurant's timezone. */
  autoOrderTime: string;
  autoOrderNotify: AutoOrderNotify;
};

/** Column names and values to write; only the fields present in the body. */
export type SmartSettingsPatch = Partial<{
  low_stock_default: number;
  loss_alert_percent: number;
  loss_alert_enabled: boolean;
  auto_order_enabled: boolean;
  auto_order_time: string;
  auto_order_notify: AutoOrderNotify;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])(:[0-5][0-9])?$/;

export const isAutoOrderNotify = (value: unknown): value is AutoOrderNotify => (AUTO_ORDER_NOTIFY as readonly unknown[]).includes(value);

/** "6:00", "06:00:00" -> "06:00"; null for anything else. */
export function parseClockTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const padded = /^\d:/.test(value.trim()) ? `0${value.trim()}` : value.trim();
  const match = TIME.exec(padded);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** A tenant_settings row with the smart columns; null when they are missing (migration not applied yet). */
export function parseSmartSettings(row: unknown): SmartSettings | null {
  if (!isRecord(row)) return null;
  const lowStockDefault = num(row.low_stock_default);
  const lossAlertPercent = num(row.loss_alert_percent);
  const autoOrderTime = parseClockTime(row.auto_order_time);
  if (lowStockDefault === null || lossAlertPercent === null || autoOrderTime === null || !isAutoOrderNotify(row.auto_order_notify)) return null;
  return {
    timezone: typeof row.timezone === "string" && row.timezone !== "" ? row.timezone : "UTC",
    lowStockDefault,
    lossAlertPercent,
    lossAlertEnabled: row.loss_alert_enabled !== false,
    autoOrderEnabled: row.auto_order_enabled === true,
    autoOrderTime,
    autoOrderNotify: row.auto_order_notify,
  };
}

/** Same rules as the tenant_settings checks; null when a present field is off or nothing is given. */
export function parseSmartSettingsPatch(body: unknown): SmartSettingsPatch | null {
  if (!isRecord(body)) return null;
  const patch: SmartSettingsPatch = {};
  if ("low_stock_default" in body) {
    const value = num(body.low_stock_default);
    if (value === null || !Number.isInteger(value) || value < 0 || value > LOW_STOCK_DEFAULT_MAX) return null;
    patch.low_stock_default = value;
  }
  if ("loss_alert_percent" in body) {
    const value = num(body.loss_alert_percent);
    if (value === null || value < LOSS_ALERT_MIN || value > LOSS_ALERT_MAX) return null;
    patch.loss_alert_percent = value;
  }
  for (const key of ["loss_alert_enabled", "auto_order_enabled"] as const) {
    if (key in body) {
      if (typeof body[key] !== "boolean") return null;
      patch[key] = body[key] as boolean;
    }
  }
  if ("auto_order_time" in body) {
    const value = parseClockTime(body.auto_order_time);
    if (value === null) return null;
    patch.auto_order_time = value;
  }
  if ("auto_order_notify" in body) {
    if (!isAutoOrderNotify(body.auto_order_notify)) return null;
    patch.auto_order_notify = body.auto_order_notify;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------
// Limits: branch row -> product min_stock -> restaurant default -> 0 (not tracked)
// ---------------------------------------------------------------------------
export const LIMIT_SOURCES = ["branch", "product", "tenant", "off"] as const;
export type LimitSource = (typeof LIMIT_SOURCES)[number];

/** Mirror of effective_stock_limits(): the first value set wins; a minimum of 0 means not tracked. */
export function effectiveMin(branchMin: number | null, productMin: number | null, tenantDefault: number | null): { min: number; source: LimitSource } {
  if (branchMin !== null) return { min: branchMin, source: "branch" };
  if (productMin !== null) return { min: productMin, source: "product" };
  return tenantDefault !== null && tenantDefault > 0 ? { min: tenantDefault, source: "tenant" } : { min: 0, source: "off" };
}

export type StockLimitRow = {
  productId: string;
  name: string;
  unit: string;
  category: string | null;
  supplierId: string | null;
  quantity: number;
  branchMin: number | null;
  productMin: number | null;
  tenantDefault: number;
  min: number;
  target: number;
  source: LimitSource;
};

export function parseStockLimitRow(row: unknown): StockLimitRow | null {
  if (!isRecord(row) || typeof row.product_id !== "string") return null;
  const source = (LIMIT_SOURCES as readonly unknown[]).includes(row.source) ? (row.source as LimitSource) : null;
  const min = num(row.min_qty);
  if (!source || min === null) return null;
  return {
    productId: row.product_id,
    name: typeof row.product_name === "string" ? row.product_name : "",
    unit: typeof row.unit === "string" ? row.unit : "",
    category: typeof row.category === "string" && row.category !== "" ? row.category : null,
    supplierId: typeof row.supplier_id === "string" ? row.supplier_id : null,
    quantity: num(row.quantity) ?? 0,
    branchMin: num(row.branch_min),
    productMin: num(row.product_min),
    tenantDefault: num(row.tenant_default) ?? 0,
    min,
    target: num(row.target_qty) ?? min,
    source,
  };
}

export type LimitChange = { product_id: string; min_stock?: number | null; branch_min?: number | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** {branch_id?, items: [{product_id, min_stock?, branch_min?}]}: empty strings clear, negatives refused. */
export function parseLimitChanges(body: unknown): { branchId: string | null; items: LimitChange[] } | null {
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > LIMITS_BATCH_MAX) return null;
  const branchId = body.branch_id === undefined || body.branch_id === null || body.branch_id === "" ? null : body.branch_id;
  if (branchId !== null && (typeof branchId !== "string" || !UUID.test(branchId))) return null;
  const items: LimitChange[] = [];
  for (const raw of body.items) {
    if (!isRecord(raw) || typeof raw.product_id !== "string" || !UUID.test(raw.product_id)) return null;
    if (items.some((item) => item.product_id === raw.product_id)) return null;
    const item: LimitChange = { product_id: raw.product_id };
    for (const key of ["min_stock", "branch_min"] as const) {
      if (!(key in raw)) continue;
      if (raw[key] === null || raw[key] === "") {
        item[key] = null;
        continue;
      }
      const value = num(raw[key]);
      if (value === null || value < 0) return null;
      item[key] = value;
    }
    if (!("min_stock" in item) && !("branch_min" in item)) return null;
    if ("branch_min" in item && branchId === null) return null;
    items.push(item);
  }
  return { branchId, items };
}

/** Colour of a loss percentage against the restaurant's line: green under half of it, red over it. */
export function lossTone(percent: number, limit: number, enabled: boolean): "ok" | "watch" | "over" {
  if (!enabled) return "ok";
  if (percent > limit) return "over";
  return percent > limit / 2 ? "watch" : "ok";
}
