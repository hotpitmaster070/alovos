export type ScanItem = {
  name: string;
  qty: number;
  unit: string;
  price: number;
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

export function parseScanItems(value: unknown): ScanItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  const items: ScanItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const unit = typeof item.unit === "string" ? item.unit.trim() : "";
    const qty = asNumber(item.qty);
    const price = asNumber(item.price);
    if (!name || name.length > 200 || unit.length > 40) continue;
    if (qty === null || qty <= 0 || qty > 1_000_000) continue;
    if (price === null || price < 0 || price > 1_000_000_000) continue;
    items.push({ name, qty, unit, price });
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
