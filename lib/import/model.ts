import type { Unit } from "@/lib/anbar/types";

/** Columns of a catalog file, in template order; public.import_catalog() reads the same keys. */
export const IMPORT_FIELDS = [
  "name",
  "unit",
  "barcode",
  "category",
  "price",
  "shelf_life_days",
  "min_stock",
  "initial_stock",
  "location",
  "expiry_date",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_NAME_MIN = 2;
export const IMPORT_MAX_QUANTITY = 1_000_000;
export const IMPORT_MAX_PRICE = 1_000_000_000;

/** Row-level codes; the same strings come back from public.import_catalog(). */
export const IMPORT_ERROR_CODES = [
  "required",
  "too_short",
  "too_long",
  "invalid_unit",
  "invalid_number",
  "not_integer",
  "negative",
  "too_large",
  "duplicate_in_file",
  "exists",
  "invalid_date",
  "expiry_past",
  "branch_required",
  "location_not_found",
  "invalid",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
export const isImportErrorCode = (value: unknown): value is ImportErrorCode =>
  typeof value === "string" && (IMPORT_ERROR_CODES as readonly string[]).includes(value);

/** row: line number in the file (the header is line 1). */
export type ImportError = { row: number; field: ImportField | "row"; code: ImportErrorCode; value: string | null };

/** Cell texts of one file line, keyed by column. */
export type RawImportRow = { row: number; values: Partial<Record<ImportField, string>> };

/** A row as public.import_catalog() takes it. */
export type ImportRow = {
  row: number;
  name: string;
  unit: Unit;
  barcode: string | null;
  category: string | null;
  price: number | null;
  shelf_life_days: number | null;
  min_stock: number | null;
  initial_stock: number | null;
  location: string | null;
  expiry_date: string | null;
};
