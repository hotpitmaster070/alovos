/**
 * Suppliers, product limits, the stock forecast and purchase requests. Quantities are in the product's
 * own unit; every limit, delivery day and usage figure comes from the database.
 */

/** Weekday numbers as stored in suppliers.delivery_days (0 = Sunday .. 6 = Saturday), Monday first. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const FORECAST_STATUSES = ["critical", "order", "ok", "no_limits"] as const;
export type ForecastStatus = (typeof FORECAST_STATUSES)[number];

export const REQUEST_STATUSES = ["draft", "sent", "received"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const INVITE_ROLES = ["chef", "owner"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** Owners and chefs set limits, manage suppliers and approve orders (same rule as the database). */
export const canManagePurchasing = (role: string | null): boolean => role === "owner" || role === "chef";
export const canInvite = (role: string | null): boolean => role === "owner";

export const SUPPLIER_NAME_MAX = 120;
export const SUPPLIER_CONTACT_MAX = 200;
export const CODE_PATTERN = /^[A-Z0-9]{1,10}$/;
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
/** invitations.token: two uuids without dashes. */
export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type Supplier = {
  id: string;
  name: string;
  code: string;
  contact: string | null;
  deliveryDays: Weekday[];
  branchId: string | null;
  leadTimeDays: number | null;
  /** ISO code the supplier invoices in; null: the restaurant's currency. */
  currency: string | null;
  active: boolean;
};

export type ForecastRow = {
  productId: string;
  branchId: string | null;
  name: string;
  unit: string;
  currentStock: number;
  parLevel: number | null;
  minStock: number | null;
  supplierId: string | null;
  supplierName: string | null;
  deliveryDays: Weekday[];
  nextDeliveryDate: string | null;
  daysUntilDelivery: number | null;
  avgDailyUsage: number;
  projectedStock: number | null;
  needToOrder: number | null;
  onOrder: number;
  willRunOut: boolean;
  status: ForecastStatus;
};

export type RequestItem = { productId: string; qty: number; unit: string };

export type PurchaseRequest = {
  id: string;
  supplierId: string;
  branchId: string | null;
  status: RequestStatus;
  items: RequestItem[];
  autoCreated: boolean;
  requestDate: string;
  createdAt: string;
  sentAt: string | null;
};

export type StockValueByType = { type: string; value: number };

export type OwnerSummary = {
  stockValue: number;
  lowStockCount: number;
  criticalCount: number;
  autoRequestCount: number;
};

export type Invitation = {
  id: string;
  phone: string;
  role: InviteRole;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type InvitationPreview = {
  tenantName: string | null;
  role: InviteRole | null;
  /** joined: the signed-in user already used this link (for example when signing up with it). */
  state: InvitationState;
};

export const INVITATION_STATES = ["valid", "joined", "used", "expired", "not_found"] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];

// ---------------------------------------------------------------------------
// Parsing database rows
// ---------------------------------------------------------------------------
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const isWeekday = (value: unknown): value is Weekday => (WEEKDAYS as readonly unknown[]).includes(value);
const weekdays = (value: unknown): Weekday[] => (Array.isArray(value) ? value.map(Number).filter(isWeekday) : []);
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  (values as readonly unknown[]).includes(value) ? (value as T) : null;

export function parseSupplier(row: unknown): Supplier | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const name = text(row.name);
  const code = text(row.code);
  if (!id || !name || !code) return null;
  return {
    id,
    name,
    code,
    contact: text(row.contact),
    deliveryDays: weekdays(row.delivery_days),
    branchId: text(row.branch_id),
    leadTimeDays: num(row.lead_time_days),
    currency: text(row.default_currency),
    active: row.is_active !== false,
  };
}

export function parseForecastRow(row: unknown): ForecastRow | null {
  if (!isRecord(row)) return null;
  const productId = text(row.product_id);
  const status = oneOf(FORECAST_STATUSES, row.status);
  const currentStock = num(row.current_stock);
  if (!productId || !status || currentStock === null) return null;
  return {
    productId,
    branchId: text(row.branch_id),
    name: text(row.name) ?? "",
    unit: text(row.unit) ?? "",
    currentStock,
    parLevel: num(row.par_level),
    minStock: num(row.min_stock),
    supplierId: text(row.supplier_id),
    supplierName: text(row.supplier_name),
    deliveryDays: weekdays(row.delivery_days),
    nextDeliveryDate: text(row.next_delivery_date),
    daysUntilDelivery: num(row.days_until_delivery),
    avgDailyUsage: num(row.avg_daily_usage) ?? 0,
    projectedStock: num(row.projected_stock),
    needToOrder: num(row.need_to_order),
    onOrder: num(row.on_order) ?? 0,
    willRunOut: row.will_run_out === true,
    status,
  };
}

function parseItem(value: unknown): RequestItem | null {
  if (!isRecord(value)) return null;
  const productId = text(value.product_id);
  const qty = num(value.qty);
  return productId && qty !== null ? { productId, qty, unit: text(value.unit) ?? "" } : null;
}

export function parsePurchaseRequest(row: unknown): PurchaseRequest | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const supplierId = text(row.supplier_id);
  const status = oneOf(REQUEST_STATUSES, row.status);
  const requestDate = text(row.request_date);
  const createdAt = text(row.created_at);
  if (!id || !supplierId || !status || !requestDate || !createdAt || !Array.isArray(row.items)) return null;
  return {
    id,
    supplierId,
    branchId: text(row.branch_id),
    status,
    items: row.items.flatMap((item) => parseItem(item) ?? []),
    autoCreated: row.auto_created === true,
    requestDate,
    createdAt,
    sentAt: text(row.sent_at),
  };
}

export function parseStockValueByType(row: unknown): StockValueByType | null {
  if (!isRecord(row)) return null;
  const type = text(row.type);
  const value = num(row.value);
  return type && value !== null ? { type, value } : null;
}

export function parseOwnerSummary(row: unknown): OwnerSummary | null {
  if (!isRecord(row)) return null;
  const stockValue = num(row.stock_value);
  const lowStockCount = num(row.low_stock_count);
  const criticalCount = num(row.critical_count);
  const autoRequestCount = num(row.auto_request_count);
  if (stockValue === null || lowStockCount === null || criticalCount === null || autoRequestCount === null) return null;
  return { stockValue, lowStockCount, criticalCount, autoRequestCount };
}

export function parseInvitation(row: unknown): Invitation | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const phone = text(row.phone);
  const role = oneOf(INVITE_ROLES, row.role);
  const token = text(row.token);
  const expiresAt = text(row.expires_at);
  const createdAt = text(row.created_at);
  if (!id || !phone || !role || !token || !expiresAt || !createdAt) return null;
  return { id, phone, role, token, expiresAt, usedAt: text(row.used_at), createdAt };
}

export function parseInvitationPreview(row: unknown): InvitationPreview | null {
  if (!isRecord(row)) return null;
  const state = oneOf(INVITATION_STATES, row.state);
  if (!state) return null;
  return { tenantName: text(row.tenant_name), role: oneOf(INVITE_ROLES, row.role), state };
}

// ---------------------------------------------------------------------------
// Input validation (same rules as the database checks)
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type Body = Record<string, unknown>;
type Invalid = { ok: false; error: "invalid_input" };
const invalid: Invalid = { ok: false, error: "invalid_input" };

const trimmed = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** null for empty, undefined for anything that is not a non-negative number. */
function optionalAmount(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return isUuid(value) ? value : undefined;
}

function parseWeekdays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value)) return null;
  const days = value.map((day) => (typeof day === "string" && day.trim() !== "" ? Number(day) : day));
  if (!days.every(isWeekday)) return null;
  return Array.from(new Set(days as Weekday[])).sort((a, b) => a - b);
}

export type SupplierInput = {
  name: string;
  code: string | null;
  contact: string | null;
  deliveryDays: Weekday[];
  branchId: string | null;
  leadTimeDays: number | null;
  currency: string | null;
};

/** For creation every field is read; for a patch only the fields present are. */
export function validateSupplierInput(body: Body): { ok: true; value: SupplierInput } | Invalid {
  const name = trimmed(body.name);
  const code = trimmed(body.code).toUpperCase() || null;
  const contact = trimmed(body.contact) || null;
  const deliveryDays = parseWeekdays(body.delivery_days ?? []);
  const branchId = optionalUuid(body.branch_id);
  const lead = optionalAmount(body.lead_time_days);
  const currency = trimmed(body.default_currency).toUpperCase() || null;
  if (
    (currency !== null && !/^[A-Z]{3}$/.test(currency)) ||
    name === "" ||
    name.length > SUPPLIER_NAME_MAX ||
    (code !== null && !CODE_PATTERN.test(code)) ||
    (contact !== null && contact.length > SUPPLIER_CONTACT_MAX) ||
    deliveryDays === null ||
    branchId === undefined ||
    lead === undefined ||
    (lead !== null && !Number.isInteger(lead))
  ) {
    return invalid;
  }
  return { ok: true, value: { name, code, contact, deliveryDays, branchId, leadTimeDays: lead, currency } };
}

export type SupplierPatch = Partial<SupplierInput> & { active?: boolean };

export function validateSupplierPatch(body: Body): { ok: true; value: SupplierPatch } | Invalid {
  const patch: SupplierPatch = {};
  if ("name" in body || "delivery_days" in body || "code" in body || "contact" in body || "branch_id" in body || "lead_time_days" in body || "default_currency" in body) {
    const full = validateSupplierInput({ name: "-", ...body });
    if (!full.ok || ("name" in body && trimmed(body.name) === "")) return invalid;
    for (const [key, field] of [
      ["name", "name"],
      ["code", "code"],
      ["contact", "contact"],
      ["delivery_days", "deliveryDays"],
      ["branch_id", "branchId"],
      ["lead_time_days", "leadTimeDays"],
      ["default_currency", "currency"],
    ] as const) {
      if (key in body) Object.assign(patch, { [field]: full.value[field] });
    }
  }
  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return invalid;
    patch.active = body.is_active;
  }
  return Object.keys(patch).length > 0 ? { ok: true, value: patch } : invalid;
}

export type LimitsInput = { parLevel: number | null; minStock: number | null; supplierId: string | null };

export function validateLimitsInput(body: Body): { ok: true; value: LimitsInput } | Invalid {
  const parLevel = optionalAmount(body.par_level);
  const minStock = optionalAmount(body.min_stock);
  const supplierId = optionalUuid(body.supplier_id);
  if (parLevel === undefined || minStock === undefined || supplierId === undefined) return invalid;
  if (parLevel === 0) return invalid;
  if (parLevel !== null && minStock !== null && minStock > parLevel) return invalid;
  return { ok: true, value: { parLevel, minStock, supplierId } };
}

/** Spaces, dashes, dots and brackets are dropped: "+994 (50) 123-45-67" -> "+994501234567". */
export const normalizePhone = (value: unknown): string => (typeof value === "string" ? value.replace(/[\s().-]/g, "") : "");

export function validateInvitationInput(body: Body): { ok: true; value: { phone: string; role: InviteRole } } | Invalid {
  const phone = normalizePhone(body.phone);
  const role = oneOf(INVITE_ROLES, body.role ?? "chef");
  return PHONE_PATTERN.test(phone) && role ? { ok: true, value: { phone, role } } : invalid;
}

export function validateRequestItems(value: unknown): { ok: true; value: { product_id: string; qty: number }[] } | Invalid {
  if (!Array.isArray(value) || value.length === 0) return invalid;
  const items: { product_id: string; qty: number }[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isUuid(item.product_id)) return invalid;
    const qty = optionalAmount(item.qty);
    if (qty === null || qty === undefined || qty <= 0) return invalid;
    if (items.some((other) => other.product_id === item.product_id)) return invalid;
    items.push({ product_id: item.product_id, qty });
  }
  return { ok: true, value: items };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const PURCHASING_ERROR_CODES = [
  "invalid_input",
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "product_not_found",
  "supplier_not_found",
  "branch_not_found",
  "request_not_found",
  "invalid_status",
  "duplicate_code",
  "invitation_not_found",
  "invitation_used",
  "invitation_expired",
  "save_failed",
] as const;
export type PurchasingErrorCode = (typeof PURCHASING_ERROR_CODES)[number];

export const isPurchasingErrorCode = (value: unknown): value is PurchasingErrorCode =>
  (PURCHASING_ERROR_CODES as readonly unknown[]).includes(value);

const STATUS: Record<PurchasingErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  no_tenant: 403,
  forbidden: 403,
  product_not_found: 404,
  supplier_not_found: 404,
  branch_not_found: 404,
  request_not_found: 404,
  invalid_status: 409,
  duplicate_code: 409,
  invitation_not_found: 404,
  invitation_used: 409,
  invitation_expired: 410,
  save_failed: 500,
};

/** Maps the stable messages raised by the 20261016 functions (and Postgres errors) to error codes. */
export function mapPurchasingError(error: { message?: unknown; code?: unknown }): { code: PurchasingErrorCode; status: number } {
  const message = typeof error.message === "string" ? error.message : "";
  const pgCode = typeof error.code === "string" ? error.code : "";
  const found =
    PURCHASING_ERROR_CODES.find((code) => code !== "save_failed" && new RegExp(`\\b${code}\\b`).test(message)) ??
    (/uniq_supplier_code_per_tenant/.test(message)
      ? "duplicate_code"
      : /row-level security|permission denied/.test(message) || pgCode === "42501"
        ? "forbidden"
        : /_check|invalid input syntax/.test(message) || pgCode === "22023" || pgCode === "23514" || pgCode === "22P02"
          ? "invalid_input"
          : "save_failed");
  return { code: found, status: STATUS[found] };
}
