import {
  BARCODE_MAX_LENGTH,
  CATEGORY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  SHELF_LIFE_MAX_DAYS,
  STORAGE_NAME_MAX_LENGTH,
} from "./constants";
import { productType, type ProductType } from "@/lib/labels/final";
import { isStorageType, isUnit, type StorageType, type Unit } from "./types";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const isRealDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const field = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const optionalNonNegative = (raw: string): number | null | undefined => {
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** A scanned or typed code: factory barcode or our internal code (ALO-1001). */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return code === "" || code.length > BARCODE_MAX_LENGTH ? null : code;
}

export type BarcodeProductInput = {
  name: string;
  barcode: string | null;
  category: string | null;
  unit: Unit;
  pricePerUnit: number | null;
  shelfLifeDays: number | null;
  minStock: number | null;
  expiryDate: string | null;
  branchId: string | null;
  storageLocationId: string | null;
  /** null: the column default. */
  productType: ProductType | null;
};

const optionalShelfLife = (raw: string): number | null | undefined => {
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= SHELF_LIFE_MAX_DAYS ? parsed : undefined;
};

export function validateBarcodeProductInput(
  data: FormData,
): { ok: true; value: BarcodeProductInput } | { ok: false; error: "invalidInput" } {
  const name = field(data, "name");
  const barcode = field(data, "barcode");
  const category = field(data, "category");
  const unit = field(data, "unit") || "kg";
  const expiryDate = field(data, "expiryDate");
  const branchId = field(data, "branchId");
  const storageLocationId = field(data, "storageLocationId");
  const pricePerUnit = optionalNonNegative(field(data, "pricePerUnit"));
  const shelfLifeDays = optionalShelfLife(field(data, "shelfLifeDays"));
  const minStock = optionalNonNegative(field(data, "minStock"));
  const typeText = field(data, "productType");
  const type = typeText === "" ? null : productType(typeText);

  if (
    (typeText !== "" && type === null) ||
    name === "" ||
    name.length > NAME_MAX_LENGTH ||
    barcode.length > BARCODE_MAX_LENGTH ||
    category.length > CATEGORY_MAX_LENGTH ||
    !isUnit(unit) ||
    (expiryDate !== "" && !isRealDate(expiryDate)) ||
    (branchId !== "" && !isUuid(branchId)) ||
    (storageLocationId !== "" && !isUuid(storageLocationId)) ||
    pricePerUnit === undefined ||
    shelfLifeDays === undefined ||
    minStock === undefined
  ) {
    return { ok: false, error: "invalidInput" };
  }

  return {
    ok: true,
    value: {
      name,
      barcode: barcode === "" ? null : barcode,
      category: category === "" ? null : category,
      unit,
      pricePerUnit,
      shelfLifeDays,
      minStock,
      expiryDate: expiryDate === "" ? null : expiryDate,
      branchId: branchId === "" ? null : branchId,
      storageLocationId: storageLocationId === "" ? null : storageLocationId,
      productType: type,
    },
  };
}

/** Places created at once; public.create_storage_locations_bulk() enforces the same bounds. */
export const STORAGE_BULK_MAX = 50;
export const STORAGE_NUMBER_MAX = 9999;

/**
 * New storage places of one type in a branch. number: a free number for a single place, else the
 * next ones (MAX+1). name: a single place's name; namePrefix: "<prefix> #<number>" for each place.
 */
export type StorageLocationInput = {
  type: StorageType;
  branchId: string;
  count: number;
  number: number | null;
  name: string | null;
  namePrefix: string | null;
};

const wholeInRange = (raw: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
};

/** Fields: type, branchId (or branch_id), name, name_prefix, count, number. */
export function validateStorageLocationInput(
  data: FormData,
): { ok: true; value: StorageLocationInput } | { ok: false; error: "invalidInput" } {
  const type = field(data, "type");
  const branchId = field(data, "branchId") || field(data, "branch_id");
  const name = field(data, "name").replace(/\s+/g, " ") || null;
  const namePrefix = field(data, "name_prefix").replace(/\s+/g, " ") || null;
  const rawCount = field(data, "count");
  const rawNumber = field(data, "number");
  const count = rawCount === "" ? 1 : wholeInRange(rawCount, 1, STORAGE_BULK_MAX);
  const number = rawNumber === "" ? null : wholeInRange(rawNumber, 1, STORAGE_NUMBER_MAX);
  if (
    !isStorageType(type) ||
    !isUuid(branchId) ||
    count === null ||
    (rawNumber !== "" && (number === null || count !== 1)) ||
    (name === null && namePrefix === null) ||
    (name !== null && (count !== 1 || name.length > STORAGE_NAME_MAX_LENGTH)) ||
    (namePrefix !== null && namePrefix.length > STORAGE_NAME_MAX_LENGTH - 6)
  ) {
    return { ok: false, error: "invalidInput" };
  }
  return { ok: true, value: { type, branchId, count, number, name, namePrefix } };
}

export function validateStorageLocationRename(
  data: FormData,
): { ok: true; value: { id: string; name: string } } | { ok: false; error: "invalidInput" } {
  const id = field(data, "id");
  const name = field(data, "name").replace(/\s+/g, " ");
  if (!isUuid(id) || name === "" || name.length > STORAGE_NAME_MAX_LENGTH) return { ok: false, error: "invalidInput" };
  return { ok: true, value: { id, name } };
}

export type ReceiptInput = {
  productId: string;
  locationId: string;
  qty: number;
  expiryDate: string | null;
  pricePerUnit: number | null;
};

export function validateReceiptInput(
  data: FormData,
): { ok: true; value: ReceiptInput } | { ok: false; error: "invalidInput" | "invalidQty" | "locationNotFound" } {
  const productId = field(data, "productId");
  const locationId = field(data, "locationId");
  const expiryDate = field(data, "expiryDate");
  const qty = Number(field(data, "qty"));
  const pricePerUnit = optionalNonNegative(field(data, "pricePerUnit"));

  if (!isUuid(productId)) return { ok: false, error: "invalidInput" };
  if (!isUuid(locationId)) return { ok: false, error: "locationNotFound" };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "invalidQty" };
  if ((expiryDate !== "" && !isRealDate(expiryDate)) || pricePerUnit === undefined) {
    return { ok: false, error: "invalidInput" };
  }

  return {
    ok: true,
    value: { productId, locationId, qty, expiryDate: expiryDate === "" ? null : expiryDate, pricePerUnit },
  };
}

export function validateExpiryInput(
  data: FormData,
): { ok: true; value: { productId: string; expiryDate: string | null } } | { ok: false; error: "invalidInput" } {
  const productId = field(data, "productId");
  const expiryDate = field(data, "expiryDate");
  if (!isUuid(productId) || (expiryDate !== "" && !isRealDate(expiryDate))) {
    return { ok: false, error: "invalidInput" };
  }
  return { ok: true, value: { productId, expiryDate: expiryDate === "" ? null : expiryDate } };
}
