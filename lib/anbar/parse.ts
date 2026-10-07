import type { Branch, CatalogProduct, Location, Product, StorageLocation } from "./types";

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

export function parseLocation(row: unknown): Location | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  return id && name !== null ? { id, name } : null;
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
  };
}

export function parseBranch(row: unknown): Branch | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  return id && name !== null ? { id, name } : null;
}

export function parseStorageLocation(row: unknown): StorageLocation | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const type = asString(row.type);
  return id && name !== null && type !== null ? { id, name, type, branchId: asString(row.branch_id) } : null;
}

export type StockLot = { productId: string; quantity: number; expiryDate: string | null; costPerUnit: number | null };

export function parseStockLot(row: unknown): StockLot | null {
  if (!isRecord(row)) return null;
  const productId = asString(row.product_id);
  const quantity = asNumber(row.quantity);
  if (!productId || quantity === null) return null;
  return { productId, quantity, expiryDate: asString(row.expiry_date), costPerUnit: asNumber(row.cost_per_unit) };
}

export function parseProduct(row: unknown): Product | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || name === null) return null;

  return {
    id,
    name,
    barcode: asString(row.barcode),
    expiryDate: asString(row.expiry_date),
    qty: asNumber(row.qty) ?? 0,
    unit: asString(row.unit) ?? "kg",
    cost: asNumber(row.cost),
    locationId: asString(row.location_id),
  };
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
