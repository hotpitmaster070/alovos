import { formatQty } from "@/lib/purchasing/format";
import { isUuid } from "@/lib/purchasing/model";
import { isAutoOrderNotify, LIMIT_SOURCES, type AutoOrderNotify, type LimitSource } from "@/lib/smart-settings/model";
import { DELIVERY_CHANNELS, DELIVERY_STATUSES, type DeliveryChannel, type DeliveryStatus } from "./delivery";

/** What get_auto_order_items_grouped() returns: per supplier what is below its minimum and how much to order. */
export type AutoOrderItem = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  min: number;
  target: number;
  onOrder: number;
  need: number;
  source: LimitSource;
};

/** supplierId null: products without a supplier; they get no draft until one is set. */
export type AutoOrderGroup = {
  supplierId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  items: AutoOrderItem[];
};

/** Upper bound for one extra line (any unit). */
export const EXTRA_QTY_MAX = 100000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function parseItem(value: unknown): AutoOrderItem | null {
  if (!isRecord(value) || typeof value.product_id !== "string") return null;
  const need = num(value.need);
  if (need === null || need <= 0) return null;
  return {
    productId: value.product_id,
    name: text(value.name) ?? "",
    unit: text(value.unit) ?? "",
    quantity: num(value.quantity) ?? 0,
    min: num(value.min_qty) ?? 0,
    target: num(value.target_qty) ?? 0,
    onOrder: num(value.on_order) ?? 0,
    need,
    source: (LIMIT_SOURCES as readonly unknown[]).includes(value.source) ? (value.source as LimitSource) : "off",
  };
}

/** Groups without items are dropped; the no-supplier group always comes last. */
export function parseAutoOrderGroups(value: unknown): AutoOrderGroup[] {
  if (!Array.isArray(value)) return [];
  const groups = value.flatMap((raw): AutoOrderGroup[] => {
    if (!isRecord(raw) || !Array.isArray(raw.items)) return [];
    const items = raw.items.flatMap((item) => parseItem(item) ?? []);
    if (items.length === 0) return [];
    return [{ supplierId: text(raw.supplier_id), name: text(raw.name), phone: text(raw.phone), email: text(raw.email), items }];
  });
  return [...groups.filter((group) => group.supplierId !== null), ...groups.filter((group) => group.supplierId === null)];
}

/** Suppliers that get a draft (the no-supplier group does not). */
export const supplierCount = (groups: AutoOrderGroup[]): number => groups.filter((group) => group.supplierId !== null).length;

export type OrderLine = { name: string; qty: number; unit: string };

/** "Toyuq 15kg" */
export const orderLineText = (line: OrderLine): string => `${line.name} ${formatQty(line.qty)}${line.unit}`;

/** "Salam! Sifariş: Toyuq 15kg, Et 10kg" with the greeting of the restaurant's language. */
export const orderMessage = (greeting: string, lines: OrderLine[]): string => `${greeting} ${lines.map(orderLineText).join(", ")}`;

/** wa.me link with the text filled in; null without a phone. */
export function whatsappLink(phone: string | null, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

export function mailtoLink(email: string | null, subject: string, message: string): string | null {
  return email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;
}

/** {product_id, qty}: a positive amount in the product's unit. */
export function parseExtraBody(body: unknown): { productId: string; qty: number } | null {
  if (!isRecord(body) || !isUuid(body.product_id)) return null;
  const qty = num(body.qty);
  return qty !== null && qty > 0 && qty <= EXTRA_QTY_MAX ? { productId: body.product_id, qty } : null;
}

/** {branch_id} for preview and drafts. */
export const parseBranchId = (value: unknown): string | null => (isUuid(value) ? value : null);

/** A request claim_due_auto_order_sends() took at the deadline, with what its message needs. */
export type AutoOrderClaim = {
  tenantId: string;
  requestId: string;
  restaurant: string;
  language: string | null;
  channel: AutoOrderNotify;
  supplierName: string;
  supplierPhone: string | null;
  supplierEmail: string | null;
  items: { name: string; qty: number; unit: string; extra: boolean }[];
};

export function parseAutoOrderClaim(row: unknown): AutoOrderClaim | null {
  if (!isRecord(row) || typeof row.tenant_id !== "string" || typeof row.request_id !== "string" || !Array.isArray(row.items)) return null;
  const items = row.items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const qty = num(item.qty);
    return qty !== null && qty > 0 ? [{ name: text(item.name) ?? "", qty, unit: text(item.unit) ?? "", extra: item.extra === true }] : [];
  });
  if (items.length === 0) return null;
  return {
    tenantId: row.tenant_id,
    requestId: row.request_id,
    restaurant: text(row.restaurant) ?? "",
    language: text(row.language),
    channel: isAutoOrderNotify(row.channel) ? row.channel : "system",
    supplierName: text(row.supplier_name) ?? "",
    supplierPhone: text(row.supplier_phone),
    supplierEmail: text(row.supplier_email),
    items,
  };
}

/**
 * One delivery of auto_order_send_log(). estimated: at the latest purchase prices when sent; actual: its
 * receipts at invoice prices, null until received. Both null for roles that do not see costs.
 */
export type SendLogEntry = {
  requestId: string;
  supplierName: string;
  trigger: "chef" | "auto";
  channel: DeliveryChannel;
  status: DeliveryStatus;
  error: string | null;
  sentAt: string;
  lines: number;
  linesReceived: number;
  estimated: number | null;
  actual: number | null;
  currency: string | null;
};

export function parseSendLogEntry(row: unknown): SendLogEntry | null {
  if (!isRecord(row) || typeof row.request_id !== "string" || typeof row.sent_at !== "string") return null;
  const trigger = row.trigger === "chef" || row.trigger === "auto" ? row.trigger : null;
  const channel = (DELIVERY_CHANNELS as readonly unknown[]).includes(row.channel) ? (row.channel as DeliveryChannel) : null;
  const status = (DELIVERY_STATUSES as readonly unknown[]).includes(row.status) ? (row.status as DeliveryStatus) : null;
  if (!trigger || !channel || !status) return null;
  return {
    requestId: row.request_id,
    supplierName: text(row.supplier_name) ?? "",
    trigger,
    channel,
    status,
    error: text(row.error),
    sentAt: row.sent_at,
    lines: num(row.lines) ?? 0,
    linesReceived: num(row.lines_received) ?? 0,
    estimated: num(row.estimated_amount),
    actual: num(row.actual_amount),
    currency: text(row.currency),
  };
}

export type SendSummary = {
  orders: number;
  chef: number;
  auto: number;
  failed: number;
  /** Orders with at least one receipt. */
  received: number;
  /** Phase 1: everything that went out at the latest purchase prices; null when costs are hidden. */
  estimated: number | null;
  /** Phase 2: the received orders at invoice prices; null when nothing is received or costs are hidden. */
  actual: number | null;
  /** The estimate of the received orders only, to compare with actual. */
  estimatedReceived: number | null;
  /** actual - estimatedReceived: what the invoices cost more (+) or less (-) than expected. */
  delta: number | null;
  currency: string | null;
};

const money = (value: number) => Math.round(value * 100) / 100;

/**
 * A request counts once, by its last delivery: sent if it reached the supplier (or was sent without a message),
 * failed if it did not.
 */
export function summarizeSendLog(entries: SendLogEntry[]): SendSummary {
  const last = new Map<string, SendLogEntry>();
  for (const entry of entries) last.set(entry.requestId, entry);
  const rows = Array.from(last.values());
  const out = rows.filter((row) => row.status !== "failed" && !(row.trigger === "auto" && row.status === "skipped"));
  const hidden = out.some((row) => row.estimated === null);
  const received = out.filter((row) => row.actual !== null);
  const actual = hidden || received.length === 0 ? null : money(received.reduce((sum, row) => sum + (row.actual ?? 0), 0));
  const estimatedReceived = hidden || received.length === 0 ? null : money(received.reduce((sum, row) => sum + (row.estimated ?? 0), 0));
  return {
    orders: out.length,
    chef: out.filter((row) => row.trigger === "chef").length,
    auto: out.filter((row) => row.trigger === "auto").length,
    failed: rows.length - out.length,
    received: received.length,
    estimated: hidden ? null : money(out.reduce((sum, row) => sum + (row.estimated ?? 0), 0)),
    actual,
    estimatedReceived,
    delta: actual === null || estimatedReceived === null ? null : money(actual - estimatedReceived),
    currency: rows.find((row) => row.currency)?.currency ?? null,
  };
}

/** {ids?: uuid[]}: the drafts to send; without ids every draft of the restaurant. */
export function parseSendAllBody(body: unknown): { ids: string[] | null } | null {
  if (body === null || body === undefined || (isRecord(body) && body.ids === undefined)) return { ids: null };
  if (!isRecord(body) || !Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every(isUuid)) return null;
  return { ids: Array.from(new Set(body.ids as string[])) };
}
