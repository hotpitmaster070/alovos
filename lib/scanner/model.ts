export type ScanItem = {
  name: string;
  qty: number;
  unit: string;
  /** Unit price; from total / qty when the invoice line has only the total. */
  price: number;
  total: number;
};

export type CatalogProduct = { id: string; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i;

export const SCAN_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const isUuid = (value: string): boolean => UUID.test(value);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isOwnPhoto(path: string, tenantId: string): boolean {
  return path.startsWith(`${tenantId}/`) && PHOTO.test(path);
}

/** Model output as JSON: strips a ```json fence the model may add despite the prompt. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Items from {items: [...]} or a bare array; qty or quantity; price, else total / qty. */
export function parseScanItems(value: unknown): ScanItem[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.items) ? value.items : null;
  if (!list) return [];
  const items: ScanItem[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const unit = typeof item.unit === "string" ? item.unit.trim() : "";
    const qty = asNumber(item.qty ?? item.quantity);
    const total = asNumber(item.total);
    if (!name || name.length > 200 || unit.length > 40) continue;
    if (qty === null || qty <= 0 || qty > 1_000_000) continue;
    const price = asNumber(item.price) ?? (total !== null ? Math.round((total / qty) * 10000) / 10000 : null);
    if (price === null || price < 0 || price > 1_000_000_000) continue;
    const lineTotal = total !== null && total >= 0 && total <= 1_000_000_000 ? total : Math.round(qty * price * 100) / 100;
    items.push({ name, qty, unit, price, total: lineTotal });
    if (items.length >= 80) break;
  }
  return items;
}

export function readModelText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) return null;
  const first = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  return typeof first.message.content === "string" ? first.message.content : null;
}

/** A recognized line as the browser gets it: price and total are absent for those who must not see them. */
export type ScanLine = { name: string; qty: number; unit: string; price: number | null; total: number | null };

export type ScanResponse = { items: ScanLine[]; scanId: string | null; isDelegated: boolean };

export function parseScanResponse(value: unknown): ScanResponse {
  const list = isRecord(value) && Array.isArray(value.items) ? value.items : [];
  const items: ScanLine[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const unit = typeof item.unit === "string" ? item.unit.trim() : "";
    const qty = asNumber(item.qty ?? item.quantity);
    if (!name || name.length > 200 || unit.length > 40 || qty === null || qty <= 0 || qty > 1_000_000) continue;
    const price = asNumber(item.price);
    const total = asNumber(item.total);
    items.push({ name, qty, unit, price: price !== null && price >= 0 ? price : null, total: total !== null && total >= 0 ? total : null });
    if (items.length >= 80) break;
  }
  const scanId = isRecord(value) && typeof value.scan_id === "string" ? value.scan_id : null;
  return { items, scanId, isDelegated: isRecord(value) && value.isDelegated === true };
}
