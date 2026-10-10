import { z } from "zod";
import { BARCODE_MAX_LENGTH, CATEGORY_MAX_LENGTH, NAME_MAX_LENGTH, SHELF_LIFE_MAX_DAYS } from "@/lib/anbar/constants";
import { UNITS, type Unit } from "@/lib/anbar/types";
import { isDateOnly } from "@/lib/tenant-settings/time";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_PRICE,
  IMPORT_MAX_QUANTITY,
  IMPORT_NAME_MIN,
  isImportErrorCode,
  type ImportError,
  type ImportErrorCode,
  type ImportField,
  type ImportRow,
  type RawImportRow,
} from "./model";

export * from "./model";

const fail = (ctx: z.RefinementCtx, code: ImportErrorCode) => {
  ctx.addIssue({ code: "custom", message: code });
  return z.NEVER;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => (value === "" ? null : value.length > max ? fail(ctx, "too_long") : value));

/** A decimal ("1,5" or "1 500.25"); null when empty. */
const decimal = ({ max, integer = false }: { max: number; integer?: boolean }) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = Number(value.replace(/[\s\u00a0]/g, "").replace(",", "."));
      if (!Number.isFinite(parsed)) return fail(ctx, integer ? "not_integer" : "invalid_number");
      if (integer && !Number.isInteger(parsed)) return fail(ctx, "not_integer");
      if (parsed < 0) return fail(ctx, "negative");
      if (parsed > max) return fail(ctx, "too_large");
      return parsed;
    });

/** Words a file may use for a unit, in the three languages; the canonical code maps to itself. */
const UNIT_ALIASES: Record<string, Unit> = {
  kg: "kg", кг: "kg", kq: "kg", kilo: "kg",
  g: "g", г: "g", гр: "g", q: "g", qr: "g",
  l: "l", л: "l", lt: "l", litr: "l", литр: "l",
  ml: "ml", мл: "ml",
  pcs: "pcs", pc: "pcs", шт: "pcs", штук: "pcs", ədəd: "pcs", eded: "pcs", ed: "pcs", sht: "pcs",
  box: "box", кор: "box", коробка: "box", qutu: "box",
};
for (const unit of UNITS) UNIT_ALIASES[unit] = unit;

export const normalizeUnit = (raw: string): Unit | null => UNIT_ALIASES[raw.trim().toLowerCase().replace(/\.$/, "")] ?? null;

export const importRowSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .transform((value, ctx) =>
      value === ""
        ? fail(ctx, "required")
        : value.length < IMPORT_NAME_MIN
          ? fail(ctx, "too_short")
          : value.length > NAME_MAX_LENGTH
            ? fail(ctx, "too_long")
            : value,
    ),
  unit: z.string().transform((value, ctx) => {
    if (value.trim() === "") return fail(ctx, "required");
    return normalizeUnit(value) ?? fail(ctx, "invalid_unit");
  }),
  barcode: optionalText(BARCODE_MAX_LENGTH),
  category: optionalText(CATEGORY_MAX_LENGTH),
  price: decimal({ max: IMPORT_MAX_PRICE }),
  shelf_life_days: decimal({ max: SHELF_LIFE_MAX_DAYS, integer: true }),
  min_stock: decimal({ max: IMPORT_MAX_QUANTITY }),
  initial_stock: decimal({ max: IMPORT_MAX_QUANTITY }),
  location: optionalText(NAME_MAX_LENGTH),
  expiry_date: z
    .string()
    .trim()
    .transform((value, ctx) => (value === "" ? null : isDateOnly(value) ? value : fail(ctx, "invalid_date"))),
});

const isField = (value: unknown): value is ImportField =>
  typeof value === "string" && (IMPORT_FIELDS as readonly string[]).includes(value);

/**
 * Checks every row with the schema and for duplicates inside the file. Database checks (existing
 * barcodes and names, places, dates against the restaurant's today) run in public.import_catalog().
 */
export function validateRows(raw: RawImportRow[]): { valid: ImportRow[]; errors: ImportError[] } {
  const valid: ImportRow[] = [];
  const errors: ImportError[] = [];
  const names = new Set<string>();
  const barcodes = new Set<string>();

  for (const { row, values } of raw) {
    const input = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, values[field] ?? ""]));
    const parsed = importRowSchema.safeParse(input);
    const rowErrors: ImportError[] = parsed.success
      ? []
      : parsed.error.issues.map((issue) => {
          const field = isField(issue.path[0]) ? issue.path[0] : "row";
          return {
            row,
            field,
            code: isImportErrorCode(issue.message) ? issue.message : "invalid",
            value: field === "row" ? null : values[field] ?? null,
          };
        });
    const failed = new Set(rowErrors.map((error) => error.field));

    const name = (values.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (name !== "" && !failed.has("name")) {
      if (names.has(name)) rowErrors.push({ row, field: "name", code: "duplicate_in_file", value: values.name ?? null });
      names.add(name);
    }
    const barcode = (values.barcode ?? "").trim();
    if (barcode !== "" && !failed.has("barcode")) {
      if (barcodes.has(barcode)) rowErrors.push({ row, field: "barcode", code: "duplicate_in_file", value: barcode });
      barcodes.add(barcode);
    }

    if (parsed.success && rowErrors.length === 0) valid.push({ row, ...parsed.data });
    errors.push(...rowErrors);
  }
  return { valid, errors };
}
