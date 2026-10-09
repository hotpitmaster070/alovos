export const COUNT_STATUSES = ["draft", "counting", "merging", "approved", "cancelled"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export const OPEN_COUNT_STATUSES: readonly CountStatus[] = ["draft", "counting", "merging"];

export const MERGE_MODES = ["last", "sum"] as const;
/** Two people counted one product: the latest entry wins, or the entries add up (shelves split). */
export type MergeMode = (typeof MERGE_MODES)[number];
export const isMergeMode = (value: unknown): value is MergeMode =>
  typeof value === "string" && (MERGE_MODES as readonly string[]).includes(value);

export const GROUP_KEY_MAX_LENGTH = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const COUNT_COLUMNS =
  "id, status, location_id, branch_id, group_key, user_id, counted_by, finished_by, merge_mode, created_at, merged_at, approved_at, approved_by";

export type StockCount = {
  id: string;
  status: CountStatus;
  locationId: string;
  branchId: string | null;
  groupKey: string | null;
  startedBy: string | null;
  /** Everybody counting this document (stock_counts.counted_by). */
  counters: string[];
  /** Counters who pressed "finish my count". */
  finishedBy: string[];
  /** Fixed when the count is created, from the tenant setting. */
  mergeMode: MergeMode;
  createdAt: string;
  mergedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
};

/** One product of a count. Expected quantity and differences are null while the count is blind. */
export type CountLine = {
  productId: string;
  name: string;
  unit: string;
  counted: number;
  /** People who entered this product. */
  counters: number;
  expected: number | null;
  difference: number | null;
  /** Difference in money; null when blind or the role may not see costs. */
  differenceValue: number | null;
};

export type CountProduct = { id: string; name: string; unit: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};
const isStatus = (value: unknown): value is CountStatus =>
  typeof value === "string" && (COUNT_STATUSES as readonly string[]).includes(value);

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function parseCount(row: unknown): StockCount | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const locationId = text(row.location_id);
  const createdAt = text(row.created_at);
  if (!id || !locationId || !createdAt || !isStatus(row.status) || !isMergeMode(row.merge_mode)) return null;
  return {
    id,
    status: row.status,
    locationId,
    branchId: text(row.branch_id),
    groupKey: text(row.group_key),
    startedBy: text(row.user_id),
    counters: ids(row.counted_by),
    finishedBy: ids(row.finished_by),
    mergeMode: row.merge_mode,
    createdAt,
    mergedAt: text(row.merged_at),
    approvedAt: text(row.approved_at),
    approvedBy: text(row.approved_by),
  };
}

/** A row of public.stock_count_lines(). */
export function parseCountLine(row: unknown): CountLine | null {
  if (!isRecord(row)) return null;
  const productId = text(row.product_id);
  const name = typeof row.product_name === "string" ? row.product_name : null;
  const counted = numeric(row.counted_quantity);
  if (!productId || name === null || counted === null) return null;
  return {
    productId,
    name,
    unit: typeof row.unit === "string" ? row.unit : "",
    counted,
    counters: numeric(row.counters) ?? 0,
    expected: numeric(row.expected_quantity),
    difference: numeric(row.difference),
    differenceValue: numeric(row.difference_value),
  };
}

/** Upper bound of one counted quantity; public.save_stock_count_items() enforces the same. */
export const COUNT_MAX_QUANTITY = 1_000_000;

/** A typed quantity: empty means "not counted", anything else must be 0..COUNT_MAX_QUANTITY. */
export function parseCountedQuantity(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (typeof raw !== "string") return { ok: true, value: null };
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= COUNT_MAX_QUANTITY ? { ok: true, value } : { ok: false };
}

export type CountErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "no_tenant"
  | "forbidden"
  | "count_not_found"
  | "location_not_found"
  | "location_required"
  | "product_not_found"
  | "invalid_status"
  | "already_finished"
  | "nothing_counted"
  | "insufficient_stock"
  | "save_failed"
  | "count_already_open"
  | "permission_denied";

const RAISED: Record<string, { code: CountErrorCode; status: number }> = {
  invalid_input: { code: "invalid_input", status: 400 },
  unauthenticated: { code: "unauthenticated", status: 401 },
  no_tenant: { code: "no_tenant", status: 403 },
  forbidden: { code: "forbidden", status: 403 },
  count_not_found: { code: "count_not_found", status: 404 },
  location_not_found: { code: "location_not_found", status: 404 },
  "location_id required": { code: "location_required", status: 400 },
  product_not_found: { code: "product_not_found", status: 404 },
  invalid_status: { code: "invalid_status", status: 409 },
  already_finished: { code: "already_finished", status: 409 },
  nothing_counted: { code: "nothing_counted", status: 409 },
  insufficient_stock: { code: "insufficient_stock", status: 409 },
};

/** Error raised by the stock count functions -> error code and HTTP status. */
export function mapCountError(message: string): { code: CountErrorCode; status: number } {
  const key = Object.keys(RAISED).find((name) => message.includes(name));
  return key ? RAISED[key] : { code: "save_failed", status: 500 };
}

const FORM_ONLY: readonly CountErrorCode[] = ["count_already_open", "permission_denied"];

export const isCountErrorCode = (value: unknown): value is CountErrorCode =>
  typeof value === "string" &&
  (value === "save_failed" ||
    (FORM_ONLY as readonly string[]).includes(value) ||
    Object.values(RAISED).some((raised) => raised.code === value));

const EXISTING_COUNT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * HTML-form failures. The page always receives a code it can translate.
 * "Open count exists" keeps the id named in the message when one is present.
 */
export function countFormError(message: string): { error: CountErrorCode; existingId: string | null } {
  const lower = message.toLowerCase();
  const existingId = message.match(EXISTING_COUNT_ID)?.[0] ?? null;
  if (
    lower.includes("open count exists") ||
    lower.includes("count_already_open") ||
    lower.includes("open_count") ||
    lower.includes("uniq_open_count_per_location")
  ) {
    return { error: "count_already_open", existingId };
  }
  if (lower.includes("permission denied") || lower.includes("permission_denied") || lower.includes("forbidden")) {
    return { error: "permission_denied", existingId: null };
  }
  if (lower.includes("count_not_found") || lower.includes("count not found")) {
    return { error: "count_not_found", existingId: null };
  }
  return { error: mapCountError(message).code, existingId: null };
}
