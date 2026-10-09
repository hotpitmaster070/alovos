import { isStorageType, type Branch, type CatalogProduct, type StorageLocation } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function branchName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return asString(value.name);
}

export function parseCatalogProduct(row: unknown): CatalogProduct | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || name === null) return null;
  return {
    id,
    name,
    barcode: asString(row.barcode),
    internalCode: asString(row.internal_code) ?? "",
    photoUrl: asString(row.photo_url),
    category: asString(row.category),
    unit: asString(row.unit) ?? "kg",
    pricePerUnit: asNumber(row.cost),
    shelfLifeDays: asNumber(row.shelf_life_days),
    minStock: asNumber(row.min_stock),
    expiryDate: asString(row.expiry_date),
    branchId: asString(row.branch_id),
    branchName: branchName(row.branch),
    storageLocationId: asString(row.storage_location_id),
  };
}

export function parseBranch(row: unknown): Branch | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const code = asString(row.code);
  return id && name !== null && code ? { id, name, code } : null;
}

export function parseStorageLocation(row: unknown): StorageLocation | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const type = asString(row.type) ?? "";
  const branchId = asString(row.branch_id);
  const number = asNumber(row.number);
  const code = asString(row.code);
  if (!id || name === null || !branchId || number === null || !code) return null;
  return { id, name, type: isStorageType(type) ? type : "custom", number, code, branchId, active: row.is_active !== false };
}

export type StockLot = { id: string; productId: string; quantity: number; expiryDate: string | null };

export function parseStockLot(row: unknown): StockLot | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const productId = asString(row.product_id);
  const quantity = asNumber(row.quantity);
  if (!id || !productId || quantity === null) return null;
  return { id, productId, quantity, expiryDate: asString(row.expiry_date) };
}

export function parseRows<T>(rows: unknown, parse: (row: unknown) => T | null): T[] {
  if (!Array.isArray(rows)) return [];
  const result: T[] = [];
  for (const row of rows) {
    const parsed = parse(row);
    if (parsed) result.push(parsed);
  }
  return result;
}
