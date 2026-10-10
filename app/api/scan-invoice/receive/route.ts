import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { asNumber, isOwnPhoto, isRecord, isUuid } from "@/lib/scanner/model";

export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

type Line = {
  name: string;
  qty: number;
  unit: string;
  price: number;
  productId: string | null;
};

function parseLine(value: unknown): Line | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const unit = typeof value.unit === "string" ? value.unit.trim() : "";
  const qty = asNumber(value.qty);
  const price = asNumber(value.price);
  const rawProduct = value.product_id;
  const productId = typeof rawProduct === "string" && rawProduct !== "" ? rawProduct : null;
  if (!name || name.length > 200 || unit.length > 40) return null;
  if (qty === null || qty <= 0 || qty > 1_000_000) return null;
  if (price === null || price < 0 || price > 1_000_000_000) return null;
  if (productId !== null && !isUuid(productId)) return null;
  return { name, qty, unit, price, productId };
}

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_input", 400);
  }
  if (!isRecord(body)) return fail("invalid_input", 400);

  const locationId = typeof body.location_id === "string" ? body.location_id : "";
  const photoPath = typeof body.photo_path === "string" ? body.photo_path : "";
  if (!isUuid(locationId) || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 80) {
    return fail("invalid_input", 400);
  }

  const { supabase, tenantId, userId } = current;
  if (!isOwnPhoto(photoPath, tenantId)) return fail("invalid_input", 400);

  const lines = body.items.map(parseLine);
  if (lines.some((line) => line === null)) return fail("invalid_input", 400);
  const ready = lines.filter((line): line is Line => line !== null);

  const location = await supabase
    .from("storage_locations")
    .select("id, branch_id")
    .eq("id", locationId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (location.error) return fail("save_failed", 500);
  if (!location.data) return fail("location_not_found", 404);
  const branchId = typeof location.data.branch_id === "string" ? location.data.branch_id : null;

  const productIds = Array.from(
    new Set(ready.flatMap((line) => (typeof line.productId === "string" && !!line.productId ? [line.productId] : []))),
  );
  if (productIds.length > 0) {
    const found = await supabase.from("products").select("id").eq("tenant_id", tenantId).in("id", productIds);
    if (found.error) return fail("save_failed", 500);
    const ids = new Set(
      (found.data ?? []).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [row.id] : [])),
    );
    if (productIds.some((id) => !ids.has(id))) return fail("invalid_input", 400);
  }

  const scan = await supabase
    .from("invoice_scans")
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      location_id: locationId,
      photo_url: photoPath,
      parsed_json: ready.map((line) => ({
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        price: line.price,
      })),
      user_id: userId,
    })
    .select("id")
    .single();
  if (scan.error || !scan.data || typeof scan.data.id !== "string") return fail("save_failed", 500);

  for (const line of ready) {
    let productId = line.productId;
    if (!productId) {
      const created = await supabase
        .from("products")
        .insert({
          tenant_id: tenantId,
          name: line.name,
          unit: line.unit || "unit",
          qty: 0,
          cost: line.price,
        })
        .select("id")
        .single();
      if (created.error || !created.data || typeof created.data.id !== "string") return fail("save_failed", 500);
      productId = created.data.id;
    }

    const movement = await supabase.rpc("receive_stock_rpc", {
      p_product_id: productId,
      p_location_id: locationId,
      p_quantity: line.qty,
      p_cost_per_unit: line.price,
      p_unit: line.unit || null,
      p_reason: "invoice",
    });
    if (movement.error) return fail("save_failed", 500);

    const booked = await supabase.from("inventory_transaction").insert({
      tenant_id: tenantId,
      branch_id: branchId,
      location_id: locationId,
      product_id: productId,
      invoice_scan_id: scan.data.id,
      quantity: line.qty,
      unit: line.unit || null,
      price: line.price,
      type: "IN",
      user_id: userId,
    });
    if (booked.error) return fail("save_failed", 500);
  }

  return NextResponse.json({ ok: true });
}
