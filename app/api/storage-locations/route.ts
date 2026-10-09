import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { createStorageLocations, storageOverview, type StorageOverview } from "@/lib/anbar/repository";
import type { TenantScope } from "@/lib/anbar/scope";
import { isStorageType, type StorageLocation } from "@/lib/anbar/types";
import { validateStorageLocationInput } from "@/lib/anbar/validation";
import { isUuid } from "@/lib/count/model";
import { DEFAULT_LANG, dictionaries, isLang } from "@/lib/i18n/dictionaries";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";

const STATUS: Partial<Record<AnbarErrorCode, number>> = {
  invalidInput: 400,
  duplicateLocation: 409,
  numberTaken: 409,
  openCount: 409,
};

const errorResponse = (code: AnbarErrorCode) => NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });

const serialize = (location: StorageLocation) => ({
  id: location.id,
  name: location.name,
  type: location.type,
  number: location.number,
  code: location.code,
  branch_id: location.branchId,
  is_active: location.active,
});

const serializeOverview = (location: StorageOverview) => ({
  ...serialize(location),
  product_count: location.productCount,
  open_count: location.openCount ? 1 : 0,
  open_count_id: location.openCount?.id ?? null,
  open_status: location.openCount?.status ?? null,
  open_counters: location.openCount?.counters ?? 0,
});

/**
 * Storage places in display order (soyuducu, dondurucu, anbar, other; then number):
 * GET ?branch_id=<uuid>&include_inactive=1. Each place carries product_count (products kept there by
 * default or with a lot there) and open_count (1 while a stock count is draft, counting or merging).
 */
export async function GET(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const params = new URL(request.url).searchParams;
  const branchId = params.get("branch_id");
  if (branchId !== null && !isUuid(branchId)) return errorResponse("invalidInput");
  const includeInactive = params.get("include_inactive") === "1" || params.get("include_inactive") === "true";

  try {
    const locations = await storageOverview(scope, { branchId, includeInactive });
    return NextResponse.json({ locations: locations.map(serializeOverview) });
  } catch (error) {
    console.error("storage-locations GET failed", error instanceof Error ? error.message : "unknown");
    return errorResponse("saveFailed");
  }
}

async function readForm(request: Request): Promise<FormData | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return request.formData();
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" || typeof value === "number") form.set(key, String(value));
    else if (value !== null && value !== undefined) return null;
  }
  return form;
}

/**
 * Creates places through public.create_storage_locations_bulk(): JSON or form
 * {branch_id, type, number?, count?, name?, name_prefix?}. Without number the database takes
 * MAX(number)+1 for that branch and type; code is always <BRANCH>-<TYPE>-<number>. Without name and
 * name_prefix places are called "<type label> #<number>" in the tenant's language.
 */
export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const form = await readForm(request);
  if (!form) return errorResponse("invalidInput");
  const type = form.get("type");
  if (!form.get("name") && !form.get("name_prefix") && typeof type === "string" && isStorageType(type)) {
    let lang = DEFAULT_LANG;
    try {
      const language = (await getSettings(scope)).language;
      if (isLang(language)) lang = language;
    } catch (error) {
      console.error("storage-locations settings failed", error instanceof Error ? error.message : "unknown");
    }
    form.set("name_prefix", dictionaries[lang].anbar.storage.types[type]);
  }

  const parsed = validateStorageLocationInput(form);
  if (!parsed.ok) return errorResponse(parsed.error);
  const created = await createStorageLocations(scope, parsed.value);
  if (!created.ok) return errorResponse(created.error);
  return NextResponse.json({ locations: created.locations.map(serialize) }, { status: 201 });
}
