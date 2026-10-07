import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import {
  fifoCost,
  isUuid,
  isWasteReason,
  stockAvailable,
  wasteMovement,
  type WasteLot,
} from "@/lib/wastage/model";

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

  const { supabase, tenantId, userId } = current;

  const location = await supabase
    .from("storage_locations")
    .select("id, branch_id")
    .eq("id", locationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (location.error) return fail("save_failed", 500);
  if (!location.data) return fail("location_not_found", 404);

  const product = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (product.error) return fail("save_failed", 500);
  if (!product.data) return fail("product_not_found", 404);

  const stocks = await supabase
    .from("product_stocks")
    .select("id, branch_id, quantity, cost_per_unit, expiry_date")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .eq("location_id", locationId);
  if (stocks.error) return fail("save_failed", 500);

  const lots: WasteLot[] = (stocks.data ?? []).flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const quantityValue = Number(row.quantity);
    if (!id || !Number.isFinite(quantityValue)) return [];
    const cost = row.cost_per_unit === null || row.cost_per_unit === undefined ? null : Number(row.cost_per_unit);
    return [
      {
        id,
        branchId: typeof row.branch_id === "string" ? row.branch_id : null,
        quantity: quantityValue,
        cost: cost !== null && Number.isFinite(cost) ? cost : null,
        expiry: typeof row.expiry_date === "string" ? row.expiry_date : null,
      },
    ];
  });

  const movement = wasteMovement({
    tenantId,
    productId,
    locationId,
    quantity,
    reason,
    userId,
    lots,
  });
  if (stockAvailable(lots, movement.branch_id) < quantity) return fail("insufficient_stock", 409);

  let photoPath: string | null = null;
  if (photo) {
    const ext = MIME[photo.type];
    photoPath = `${tenantId}/${crypto.randomUUID()}${ext}`;
    const uploaded = await supabase.storage.from(BUCKET).upload(photoPath, new Uint8Array(await photo.arrayBuffer()), {
      contentType: photo.type,
      upsert: false,
    });
    if (uploaded.error) return fail("save_failed", 500);
  }

  const branchId = typeof location.data.branch_id === "string" ? location.data.branch_id : null;
  const logged = await supabase
    .from("wastage_logs")
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      location_id: locationId,
      product_id: productId,
      quantity,
      reason,
      photo_url: photoPath,
      user_id: userId,
      cost: fifoCost(lots, quantity),
    })
    .select("id")
    .single();
  if (logged.error || !logged.data) {
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
    return fail("save_failed", 500);
  }

  const inserted = await supabase.from("stock_movements").insert(movement);
  if (inserted.error) {
    await supabase.from("wastage_logs").delete().eq("id", logged.data.id).eq("tenant_id", tenantId);
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
    const message = inserted.error.message ?? "";
    if (message.includes("insufficient_stock")) return fail("insufficient_stock", 409);
    return fail("save_failed", 500);
  }

  return NextResponse.json({ ok: true });
}
