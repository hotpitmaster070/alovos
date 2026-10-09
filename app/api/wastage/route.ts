import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { invalidLabelsInput, labelsResponse, serializeWasteEntry } from "@/lib/labels/api";
import { validateWastageInput } from "@/lib/labels/model";
import { listWastage, logWastage } from "@/lib/labels/repository";
import { WASTE_DAYS_MAX } from "@/lib/labels/waste";
import { apiScope, jsonBody } from "@/lib/purchasing/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWasteAiCheck, wasteAiConfig } from "@/lib/waste/ai-check";
import { createWastage } from "@/lib/wastage/create";
import { isUuid, isWasteReason } from "@/lib/wastage/model";

export const dynamic = "force-dynamic";

const BUCKET = "wastage-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function asFile(value: FormDataEntryValue | null): Blob | null {
  if (!value || typeof value === "string" || value.size <= 0) return null;
  return value;
}

const DEFAULT_DAYS = 7;

/** ?days=N (1..WASTE_DAYS_MAX, default 7): the tenant's waste logs, newest first. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const raw = new URL(request.url).searchParams.get("days");
  const days = raw === null ? DEFAULT_DAYS : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > WASTE_DAYS_MAX) return invalidLabelsInput();
  const result = await listWastage(current.scope, days);
  return labelsResponse(result, (entries) => ({ wastage: entries.map(serializeWasteEntry) }));
}

/**
 * JSON {product_id, quantity, reason cutting|cooking|expired|other, reason_note?, parent_lot_id?,
 * preparation_id?, storage_location_id?}: a waste log and its stock write-off in one transaction; the
 * place is storage_location_id, else the place of parent_lot_id. Multipart is the waste board form.
 */
export async function POST(request: Request) {
  if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return logKitchenWaste(request);
  return logBoardWaste(request);
}

async function logKitchenWaste(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateWastageInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const result = await logWastage(current.scope, input.value);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, (id) => ({ ok: true, id }), 201);
}

async function logBoardWaste(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_input", 400);
  }

  const stock = String(form.get("stock") ?? "");
  const [productId, locationId] = stock.split("|");
  const quantity = Number(String(form.get("quantity") ?? "").trim());
  const reason = String(form.get("reason") ?? "").trim();
  const photo = asFile(form.get("photo"));

  if (!isUuid(productId) || !isUuid(locationId) || !isWasteReason(reason)) return fail("invalid_input", 400);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return fail("invalid_input", 400);
  if (reason === "theft" && !photo) return fail("photo_required", 400);
  if (photo && (!(photo.type in MIME) || photo.size > MAX_BYTES)) return fail("invalid_input", 400);

  const { supabase, tenantId } = current;

  let photoPath: string | null = null;
  let bytes: Uint8Array | null = null;
  if (photo) {
    bytes = new Uint8Array(await photo.arrayBuffer());
    photoPath = `${tenantId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${MIME[photo.type]}`;
    const uploaded = await supabase.storage.from(BUCKET).upload(photoPath, bytes, { contentType: photo.type, upsert: false });
    if (uploaded.error) return fail("save_failed", 500);
  }

  const created = await createWastage(supabase, { productId, locationId, quantity, reason, photoPath });
  if (!created.ok) {
    // The write-off left no rows; the upload is unreferenced and the uploader may remove it.
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail(created.error, created.status);
  }
  if (!photo || !bytes) return NextResponse.json({ ok: true, id: created.id, ai_status: null });

  // The write-off is committed; the AI check (add-on) never undoes it.
  const admin = createAdminClient();
  const aiStatus = admin
    ? await runWasteAiCheck(admin, tenantId, created.id, { bytes, mime: photo.type }, wasteAiConfig())
    : "not_checked";
  return NextResponse.json({ ok: true, id: created.id, ai_status: aiStatus });
}
