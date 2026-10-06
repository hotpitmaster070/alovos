import type { CatalogItem, Location, Product } from "./types";

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

export function parseCatalogItem(row: unknown): CatalogItem | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || name === null) return null;
  return {
    id,
    name,
    barcode: asString(row.barcode),
    expiryDate: asString(row.expiry_date),
    quantity: asNumber(row.quantity) ?? 0,
    branch: branchName(row.branch),
  };
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
