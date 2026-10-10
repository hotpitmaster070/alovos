import type { TenantScope } from "@/lib/anbar/scope";
import type { ImportFileError } from "./parse";
import { IMPORT_FIELDS, isImportErrorCode, type ImportError, type ImportField, type ImportRow, type RawImportRow } from "./validation";

export const IMPORT_REQUEST_ERRORS = [
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "branch_not_found",
  "location_not_found",
  "conflict",
  "invalid_input",
  "save_failed",
] as const;
export type ImportRequestError = (typeof IMPORT_REQUEST_ERRORS)[number];

export type CatalogImportResult =
  | { ok: true; written: boolean; rows: number; stocked: number; errors: ImportError[] }
  | { ok: false; error: ImportRequestError; status: number };

const STATUS: Record<ImportRequestError, number> = {
  unauthenticated: 401,
  no_tenant: 403,
  forbidden: 403,
  branch_not_found: 404,
  location_not_found: 404,
  conflict: 409,
  invalid_input: 400,
  save_failed: 500,
};

export const importFailure = (error: ImportRequestError): CatalogImportResult => ({ ok: false, error, status: STATUS[error] });

/** Body of POST /api/anbar/import. */
export type CatalogImportResponse =
  | {
      ok: boolean;
      written: boolean;
      total: number;
      /** Rows that would be (or were) received with an initial stock. */
      stocked: number;
      columns: ImportField[];
      ignored: string[];
      /** File rows for the preview; empty after a write. */
      rows: RawImportRow[];
      errors: ImportError[];
    }
  | { ok: false; error: ImportFileError | ImportRequestError };

function requestError(message: string, code: string | undefined): ImportRequestError {
  if (code === "23505") return "conflict";
  const found = IMPORT_REQUEST_ERRORS.find((item) => item !== "save_failed" && message.includes(item));
  return found ?? "save_failed";
}

const isField = (value: unknown): value is ImportField | "row" =>
  value === "row" || (typeof value === "string" && (IMPORT_FIELDS as readonly string[]).includes(value));

/** Row errors returned by the database, with the cell text from the file. */
function databaseErrors(data: unknown, raw: Map<number, RawImportRow["values"]>): ImportError[] {
  const list = typeof data === "object" && data !== null ? (data as { errors?: unknown }).errors : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const row = Number(record.row);
    if (!Number.isInteger(row) || !isField(record.field)) return [];
    const field = record.field;
    return [
      {
        row,
        field,
        code: isImportErrorCode(record.code) ? record.code : "invalid",
        value: field === "row" ? null : raw.get(row)?.[field] ?? null,
      },
    ];
  });
}

const count = (data: unknown, key: string): number => {
  const value = typeof data === "object" && data !== null ? Number((data as Record<string, unknown>)[key]) : NaN;
  return Number.isFinite(value) ? value : 0;
};

/**
 * public.import_catalog(): checks every row against the restaurant's data and, unless dryRun, writes
 * products, stock movements and lots in one transaction. Nothing is written when any row has an error.
 */
export async function importCatalog(
  scope: TenantScope,
  input: { branchId: string | null; locationId: string | null; rows: ImportRow[]; raw: RawImportRow[]; dryRun: boolean },
): Promise<CatalogImportResult> {
  const { data, error } = await scope.client.rpc("import_catalog", {
    p_branch_id: input.branchId,
    p_location_id: input.locationId,
    p_rows: input.rows,
    p_dry_run: input.dryRun,
  });
  if (error) {
    const code = requestError(error.message ?? "", error.code);
    if (code === "save_failed") console.error("import_catalog failed", error.message);
    return importFailure(code);
  }
  const errors = databaseErrors(data, new Map(input.raw.map((row) => [row.row, row.values])));
  const result = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  return {
    ok: true,
    written: !input.dryRun && result.ok === true && result.dry_run === false,
    rows: count(data, "rows"),
    stocked: count(data, "stocked"),
    errors,
  };
}
