import { formatQty } from "@/lib/purchasing/format";
import { isUuid } from "@/lib/purchasing/model";
import { LIMIT_SOURCES, type LimitSource } from "@/lib/smart-settings/model";

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

/** {ids?: uuid[]}: the drafts to send; without ids every draft of the restaurant. */
export function parseSendAllBody(body: unknown): { ids: string[] | null } | null {
  if (body === null || body === undefined || (isRecord(body) && body.ids === undefined)) return { ids: null };
  if (!isRecord(body) || !Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every(isUuid)) return null;
  return { ids: Array.from(new Set(body.ids as string[])) };
}
