import { BARCODE_MAX_LENGTH, EXPIRY_FILTERS, MAX_PAGE, NAME_MAX_LENGTH, type ExpiryFilter } from "./constants";
import { validateMoveQty, type MoveQtyError } from "./move";
import { isUnit, type Unit } from "./types";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

const first = (raw: string | string[] | undefined): string => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
};

export const isRealDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export type ProductFilters = {
  barcode: string;
  locationId: string | null;
  expiredOnly: boolean;
  lowStock: boolean;
  expiry: ExpiryFilter | null;
  page: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Sanitises URL search params. Nothing here ever carries the organization id. */
export function parseFilters(params: RawSearchParams): ProductFilters {
  const location = first(params.location);
  const expiry = first(params.expiry);
  const page = Number.parseInt(first(params.page), 10);

  return {
    barcode: first(params.barcode).slice(0, BARCODE_MAX_LENGTH),
    locationId: isUuid(location) ? location : null,
    expiredOnly: first(params.expired) === "1",
    lowStock: first(params.low) === "1",
    expiry: (EXPIRY_FILTERS as readonly string[]).includes(expiry) ? (expiry as ExpiryFilter) : null,
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** Builds the query string for the list page from sanitised filters (page 1 omitted). */
export function filtersToSearch(filters: ProductFilters, page = filters.page): string {
  const search = new URLSearchParams();
  if (filters.barcode) search.set("barcode", filters.barcode);
  if (filters.locationId) search.set("location", filters.locationId);
  if (filters.expiredOnly) search.set("expired", "1");
  if (filters.lowStock) search.set("low", "1");
  if (filters.expiry) search.set("expiry", filters.expiry);
  if (page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export type ValidationFailure = { ok: false; error: "invalidInput" | "locationNotFound" | MoveQtyError | "sameLocation" };

const field = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const optionalNonNegative = (raw: string): number | null | undefined => {
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export type ProductInput = {
  name: string;
  barcode: string | null;
  expiryDate: string | null;
  qty: number;
  unit: Unit;
  cost: number | null;
  locationId: string | null;
};

export function validateProductInput(
  data: FormData,
): { ok: true; value: ProductInput } | { ok: false; error: "invalidInput" } {
  const name = field(data, "name");
  const barcode = field(data, "barcode");
  const unit = field(data, "unit") || "kg";
  const expiryDate = field(data, "expiryDate");
  const locationId = field(data, "locationId");
  const qty = optionalNonNegative(field(data, "qty"));
  const cost = optionalNonNegative(field(data, "cost"));

  if (
    name === "" ||
    name.length > NAME_MAX_LENGTH ||
    barcode.length > BARCODE_MAX_LENGTH ||
    !isUnit(unit) ||
    (expiryDate !== "" && !isRealDate(expiryDate)) ||
    (locationId !== "" && !isUuid(locationId)) ||
    qty === undefined ||
    cost === undefined
  ) {
    return { ok: false, error: "invalidInput" };
  }

  return {
    ok: true,
    value: {
      name,
      barcode: barcode === "" ? null : barcode,
      expiryDate: expiryDate === "" ? null : expiryDate,
      qty: qty ?? 0,
      unit,
      cost,
      locationId: locationId === "" ? null : locationId,
    },
  };
}

/** A scanned or typed code: factory barcode or our internal code (ALO-1001). */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return code === "" || code.length > BARCODE_MAX_LENGTH ? null : code;
}

export type BarcodeProductInput = {
  name: string;
  barcode: string | null;
  unit: Unit;
  pricePerUnit: number | null;
  expiryDate: string | null;
  branchId: string | null;
};

export function validateBarcodeProductInput(
  data: FormData,
): { ok: true; value: BarcodeProductInput } | { ok: false; error: "invalidInput" } {
  const name = field(data, "name");
  const barcode = field(data, "barcode");
  const unit = field(data, "unit") || "kg";
  const expiryDate = field(data, "expiryDate");
  const branchId = field(data, "branchId");
  const pricePerUnit = optionalNonNegative(field(data, "pricePerUnit"));

  if (
    name === "" ||
    name.length > NAME_MAX_LENGTH ||
    barcode.length > BARCODE_MAX_LENGTH ||
    !isUnit(unit) ||
    (expiryDate !== "" && !isRealDate(expiryDate)) ||
    (branchId !== "" && !isUuid(branchId)) ||
    pricePerUnit === undefined
  ) {
    return { ok: false, error: "invalidInput" };
  }

  return {
    ok: true,
    value: {
      name,
      barcode: barcode === "" ? null : barcode,
      unit,
      pricePerUnit,
      expiryDate: expiryDate === "" ? null : expiryDate,
      branchId: branchId === "" ? null : branchId,
    },
  };
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

export function validateLocationName(
  data: FormData,
): { ok: true; name: string } | { ok: false; error: "invalidInput" } {
  const name = field(data, "name");
  return name === "" || name.length > NAME_MAX_LENGTH
    ? { ok: false, error: "invalidInput" }
    : { ok: true, name };
}

export type MoveInput = { productId: string; fromLocationId: string; toLocationId: string; qty: number };

/** Client-side-checkable part of a move; availability is enforced again inside the RPC. */
export function validateMoveInput(
  data: FormData,
  available?: number,
): { ok: true; value: MoveInput } | ValidationFailure {
  const productId = field(data, "productId");
  const fromLocationId = field(data, "fromLocationId");
  const toLocationId = field(data, "toLocationId");
  if (!isUuid(productId) || !isUuid(fromLocationId) || !isUuid(toLocationId)) {
    return { ok: false, error: "invalidInput" };
  }
  if (fromLocationId === toLocationId) return { ok: false, error: "sameLocation" };

  const qty = validateMoveQty(data.get("qty"), available ?? Number.MAX_SAFE_INTEGER);
  if (!qty.ok) return { ok: false, error: qty.error };

  return { ok: true, value: { productId, fromLocationId, toLocationId, qty: qty.qty } };
}
