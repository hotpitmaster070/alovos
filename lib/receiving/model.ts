/** A line is flagged when the delivered quantity differs from the expected one by more than this share. */
export const RECEIVING_VARIANCE_THRESHOLD = 0.05;
export const RECEIVING_MAX_QUANTITY = 1_000_000;
export const RECEIVING_MAX_LINES = 500;

export type ReceivingOrder = {
  id: string;
  supplierName: string | null;
  status: string;
  orderedAt: string;
  itemCount: number;
};

export type ReceivingProduct = {
  productId: string;
  name: string;
  unit: string;
  /** Expected quantity: from the order, or typed from the invoice when receiving without one. */
  expected: number | null;
  unitCost: number | null;
};

export type ReceiptLineInput = {
  productId: string;
  receivedQty: number;
  expectedQty: number | null;
  photoPath: string | null;
  /** Unit price confirmed by an owner/chef; ignored by the server for anyone who cannot see costs. */
  price: number | null;
  /** Rows of the invoice scan this line came from; the server prices them from its scan cache. */
  scanRows: number[];
};

export const SCAN_MAX_ROWS = 80;

export const RECEIVING_MAX_PRICE = 1_000_000_000;

/** total is null for a delegate, who does not see prices. */
export type ReceiptResult = { receiptId: string; lines: number; total: number | null };

/** Durations offered when handing receiving over; null = until the owner/chef ends it. */
export const DELEGATION_DURATIONS = [30, 120, 1440, null] as const;
export type DelegationDuration = (typeof DELEGATION_DURATIONS)[number];
export const DELEGATION_REASON_MAX = 200;

export type Delegation = {
  id: string;
  branchId: string;
  direction: "incoming" | "outgoing";
  fromUserId: string;
  fromEmail: string | null;
  toUserId: string;
  toEmail: string | null;
  reason: string | null;
  startAt: string;
  endAt: string | null;
};

export const RECEIVING_ERROR_CODES = [
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "branch_not_found",
  "location_not_found",
  "order_not_found",
  "order_closed",
  "product_not_found",
  "product_not_in_order",
  "invoice_photo_required",
  "invalid_photo",
  "nothing_received",
  "scan_expired",
  "delegate_not_found",
  "delegation_not_found",
  "invalid_input",
  "upload_failed",
  "save_failed",
] as const;
export type ReceivingErrorCode = (typeof RECEIVING_ERROR_CODES)[number];

export function mapReceivingError(message: string): ReceivingErrorCode {
  const found = RECEIVING_ERROR_CODES.find((code) => code !== "save_failed" && message.includes(code));
  return found ?? "save_failed";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const record = (row: unknown): Record<string, unknown> | null =>
  typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;

export function parseOrders(data: unknown): ReceivingOrder[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = record(row);
    if (!r || !isUuid(r.order_id)) return [];
    return [
      {
        id: r.order_id,
        supplierName: typeof r.supplier_name === "string" ? r.supplier_name : null,
        status: typeof r.order_status === "string" ? r.order_status : "",
        orderedAt: typeof r.ordered_at === "string" ? r.ordered_at : "",
        itemCount: num(r.item_count) ?? 0,
      },
    ];
  });
}

export function parseProducts(data: unknown): ReceivingProduct[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = record(row);
    if (!r || !isUuid(r.product_id)) return [];
    return [
      {
        productId: r.product_id,
        name: typeof r.product_name === "string" ? r.product_name : "",
        unit: typeof r.unit === "string" ? r.unit : "",
        expected: num(r.expected_qty),
        unitCost: num(r.unit_cost),
      },
    ];
  });
}

export function parseReceipt(data: unknown): ReceiptResult {
  const r = record(data);
  return {
    receiptId: r && typeof r.receipt_id === "string" ? r.receipt_id : "",
    lines: num(r?.lines) ?? 0,
    total: num(r?.total),
  };
}

/** Difference of a line: quantity, money at unit cost, and whether it is beyond the threshold. */
export function lineVariance(expected: number | null, received: number | null, unitCost: number | null) {
  if (expected === null || received === null) return { qty: null, money: null, flagged: false };
  const qty = received - expected;
  const money = unitCost === null ? null : qty * unitCost;
  const flagged = expected === 0 ? qty !== 0 : Math.abs(qty) / expected > RECEIVING_VARIANCE_THRESHOLD;
  return { qty, money, flagged };
}

/** Whole minutes left until endAt (0 once it has passed); null when open-ended. */
export function minutesLeft(endAt: string | null, now: number): number | null {
  if (!endAt) return null;
  const end = Date.parse(endAt);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 60000));
}

export function parseDelegations(data: unknown): Delegation[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = record(row);
    if (!r || !isUuid(r.delegation_id) || !isUuid(r.branch_id) || !isUuid(r.from_user_id) || !isUuid(r.to_user_id)) return [];
    return [
      {
        id: r.delegation_id,
        branchId: r.branch_id,
        direction: r.direction === "incoming" ? "incoming" : "outgoing",
        fromUserId: r.from_user_id,
        fromEmail: typeof r.from_email === "string" ? r.from_email : null,
        toUserId: r.to_user_id,
        toEmail: typeof r.to_email === "string" ? r.to_email : null,
        reason: typeof r.reason === "string" ? r.reason : null,
        startAt: typeof r.start_at === "string" ? r.start_at : "",
        endAt: typeof r.end_at === "string" ? r.end_at : null,
      } satisfies Delegation,
    ];
  });
}
