/**
 * Freshness control (20261028001200_near_expiry_management.sql): the near-expiry list of a branch, the
 * chef's decision on each lot and the daily "expiring soon" notification. Nothing is written off
 * without a decision.
 */
import { isDateOnly } from "@/lib/tenant-settings/time";

/** What the chef (or owner) decides for a lot; same values as public.batch_review_action. */
export const ExpiryAction = {
  UseInProduction: "use_in_production",
  Discount: "discount",
  Staff: "staff",
  Extend: "extend",
  WriteOff: "write_off",
} as const;
export type ExpiryAction = (typeof ExpiryAction)[keyof typeof ExpiryAction];
export const EXPIRY_ACTIONS: readonly ExpiryAction[] = Object.values(ExpiryAction);
export const isExpiryAction = (value: unknown): value is ExpiryAction => (EXPIRY_ACTIONS as readonly unknown[]).includes(value);

/** Only writing off is allowed once a lot has expired (public.review_batch_action raises lot_expired). */
export const actionsFor = (daysLeft: number): readonly ExpiryAction[] =>
  daysLeft < 0 ? [ExpiryAction.WriteOff] : EXPIRY_ACTIONS;

/** Days left at which a lot is shown as "use first" (yellow); past expiry is red. */
export const EXPIRY_WARNING_DAYS = 1;
export type ExpiryTone = "expired" | "warning" | "ok";
export const expiryTone = (daysLeft: number): ExpiryTone =>
  daysLeft <= 0 ? "expired" : daysLeft <= EXPIRY_WARNING_DAYS ? "warning" : "ok";

/** Who reviews lots, sees the notifications and writes expired stock off (public.review_batch_action). */
export const canReviewExpiry = (role: string | null): boolean => role === "owner" || role === "chef";

export const EXPIRY_NOTE_MAX = 500;
/** Anchor of the near-expiry card on the storage page. */
export const NEAR_EXPIRY_ANCHOR = "near-expiry";
export const NOTIFICATION_EXPIRING = "expiring_soon";
/** Unread notifications the bell loads at most. */
export const NOTIFICATIONS_SHOWN = 20;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
/** One public.get_near_expiry_batches() row. */
export type NearExpiryLot = {
  lotId: string;
  productId: string;
  productName: string;
  internalCode: string | null;
  unit: string;
  lotNumber: string | null;
  expiryDate: string;
  daysLeft: number;
  quantity: number;
  locationId: string;
  locationName: string;
  locationType: string;
  /** null when the caller may not see costs. */
  cost: number | null;
  currency: string;
  lastAction: ExpiryAction | null;
  lastActionAt: string | null;
};

export function parseNearExpiryLot(row: unknown): NearExpiryLot | null {
  if (!isRecord(row)) return null;
  const lotId = text(row.lot_id);
  const productId = text(row.product_id);
  const expiryDate = text(row.expiry_date);
  const daysLeft = num(row.days_left);
  const quantity = num(row.quantity);
  const locationId = text(row.location_id);
  const currency = text(row.currency);
  if (!lotId || !productId || !expiryDate || daysLeft === null || quantity === null || !locationId || !currency) return null;
  return {
    lotId,
    productId,
    productName: text(row.product_name) ?? "",
    internalCode: text(row.internal_code),
    unit: text(row.unit) ?? "",
    lotNumber: text(row.lot_number),
    expiryDate: expiryDate.slice(0, 10),
    daysLeft,
    quantity,
    locationId,
    locationName: text(row.location_name) ?? "",
    locationType: text(row.location_type) ?? "",
    cost: num(row.cost),
    currency,
    lastAction: isExpiryAction(row.last_action) ? row.last_action : null,
    lastActionAt: text(row.last_action_at),
  };
}

/** Count and value of a near-expiry list (value null when no cost is visible). */
export function nearExpiryTotals(lots: readonly NearExpiryLot[]): { count: number; value: number | null } {
  const costs = lots.map((lot) => lot.cost).filter((cost): cost is number => cost !== null);
  return { count: lots.length, value: costs.length > 0 ? Math.round(costs.reduce((sum, cost) => sum + cost, 0) * 100) / 100 : null };
}

export type ReviewInput = { lotId: string; action: ExpiryAction; note: string | null; newExpiry: string | null };
export type ReviewInputError = "action" | "date" | "note";

/**
 * Checks a decision as public.review_batch_action() will: extend needs a valid date after the
 * restaurant's today and a note; notes are at most EXPIRY_NOTE_MAX characters.
 */
export function reviewInputError(input: ReviewInput, today: string): ReviewInputError | null {
  if (!isExpiryAction(input.action)) return "action";
  const note = input.note?.trim() ?? "";
  if (note.length > EXPIRY_NOTE_MAX) return "note";
  if (input.action !== ExpiryAction.Extend) return null;
  if (!input.newExpiry || !isDateOnly(input.newExpiry) || input.newExpiry <= today) return "date";
  return note ? null : "note";
}

/** Body of POST /api/expiry/review, or null when it is not a decision. */
export function parseReviewBody(body: Record<string, unknown>): ReviewInput | null {
  const lotId = text(body.lot_id);
  if (!lotId || !isExpiryAction(body.action)) return null;
  const note = body.note === undefined || body.note === null ? null : text(body.note);
  const newExpiry = body.new_expiry === undefined || body.new_expiry === null ? null : text(body.new_expiry);
  if ((body.note !== undefined && body.note !== null && note === null) || (body.new_expiry !== undefined && body.new_expiry !== null && newExpiry === null)) {
    return null;
  }
  return { lotId, action: body.action, note: note?.trim() || null, newExpiry };
}

/** An unread public.notifications row of type expiring_soon. */
export type ExpiringNotification = {
  id: string;
  branchId: string | null;
  notifyDate: string;
  count: number;
  totalValue: number | null;
  currency: string | null;
  days: number;
};

export function parseExpiringNotification(row: unknown): ExpiringNotification | null {
  if (!isRecord(row) || row.type !== NOTIFICATION_EXPIRING) return null;
  const id = text(row.id);
  const notifyDate = text(row.notify_date);
  const payload = isRecord(row.payload) ? row.payload : null;
  const count = num(payload?.count);
  if (!id || !notifyDate || !payload || count === null) return null;
  return {
    id,
    branchId: text(row.branch_id),
    notifyDate,
    count,
    totalValue: num(payload.total_value),
    currency: text(payload.currency),
    days: num(payload.days) ?? EXPIRY_WARNING_DAYS,
  };
}
