import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
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

export async function POST(request: Request) {
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
  if (photo) {
    photoPath = `${tenantId}/${crypto.randomUUID()}${MIME[photo.type]}`;
    const uploaded = await supabase.storage.from(BUCKET).upload(photoPath, new Uint8Array(await photo.arrayBuffer()), {
      contentType: photo.type,
      upsert: false,
    });
    if (uploaded.error) return fail("save_failed", 500);
  }

  const created = await createWastage(supabase, { productId, locationId, quantity, reason, photoPath });
  if (!created.ok) {
    // The write-off left no rows; the upload is unreferenced and the uploader may remove it.
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail(created.error, created.status);
  }
  return NextResponse.json({ ok: true, id: created.id });
}
