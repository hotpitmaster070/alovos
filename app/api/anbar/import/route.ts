import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { importCatalog, type CatalogImportResponse } from "@/lib/import/catalog";
import { parseCatalogFile } from "@/lib/import/parse";
import { IMPORT_MAX_BYTES } from "@/lib/import/validation";
import { apiScope } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Failure = Extract<CatalogImportResponse, { error: unknown }>;

const failure = (error: Failure["error"], status: number) =>
  NextResponse.json({ ok: false, error } satisfies Failure, { status });

const optionalId = (value: FormDataEntryValue | null): string | null | undefined => {
  if (value === null || value === "") return null;
  return typeof value === "string" && UUID.test(value) ? value : undefined;
};

/**
 * multipart/form-data {file, branch_id?, location_id?, dry_run}: the file is parsed and checked here
 * and in public.import_catalog(); dry_run=1 is the preview, dry_run=0 writes everything in one
 * transaction or nothing. Owners and chefs only (enforced by the database).
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const branchId = optionalId(form?.get("branch_id") ?? null);
  const locationId = optionalId(form?.get("location_id") ?? null);
  const dryRun = form?.get("dry_run") !== "0";
  if (!form || !(file instanceof File) || branchId === undefined || locationId === undefined) {
    return failure("invalid_input", 400);
  }
  if (file.size > IMPORT_MAX_BYTES) return failure("too_large", 413);

  const parsed = await parseCatalogFile(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!parsed.ok) return failure(parsed.error, 422);

  let errors = parsed.errors;
  let written = false;
  let stocked = parsed.valid.filter((row) => (row.initial_stock ?? 0) > 0).length;
  if (parsed.valid.length > 0) {
    // With file errors the database still checks the valid rows, so the preview shows every problem.
    const result = await importCatalog(current.scope, {
      branchId,
      locationId,
      rows: parsed.valid,
      raw: parsed.rows,
      dryRun: dryRun || errors.length > 0,
    });
    if (!result.ok) return failure(result.error, result.status);
    errors = [...errors, ...result.errors].sort((a, b) => a.row - b.row);
    written = result.written;
    if (written) stocked = result.stocked;
  }
  if (written) revalidatePath(ANBAR_APP_PATH, "layout");

  const body: CatalogImportResponse = {
    ok: errors.length === 0,
    written,
    total: parsed.rows.length,
    stocked,
    columns: parsed.columns,
    ignored: parsed.ignored,
    rows: written ? [] : parsed.rows,
    errors,
  };
  return NextResponse.json(body, { status: written ? 201 : !dryRun ? 422 : 200 });
}
