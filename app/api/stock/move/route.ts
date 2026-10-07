import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseStockMove } from "@/lib/anbar/stock-view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { supabase, userId } = await createServerSupabase();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const parsed = parseStockMove(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const move = parsed.value;

  const profile = await supabase.from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (profile.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  const tenantId = typeof profile.data?.tenant_id === "string" ? profile.data.tenant_id : null;
  if (!tenantId) return NextResponse.json({ error: "no_tenant" }, { status: 403 });

  const product = await supabase
    .from("products")
    .select("id")
    .eq("id", move.productId)
    .eq("tenant_id", tenantId)
    .eq("organization_id", tenantId)
    .maybeSingle();
  if (product.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  if (!product.data) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  const locationIds = [move.fromLocationId, move.toLocationId].filter((id): id is string => id !== null);
  if (locationIds.length > 0) {
    const locations = await supabase
      .from("storage_locations")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", locationIds);
    if (locations.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    const found = new Set((locations.data ?? []).map((row) => row.id));
    if (locationIds.some((id) => !found.has(id))) {
      return NextResponse.json({ error: "location_not_found" }, { status: 404 });
    }
  }

  const inserted = await supabase.from("stock_movements").insert({
    tenant_id: tenantId,
    product_id: move.productId,
    from_location_id: move.fromLocationId,
    to_location_id: move.toLocationId,
    quantity: move.quantity,
    movement_type: move.movementType,
    reason: move.reason,
    user_id: userId,
  });
  if (inserted.error) {
    const message = inserted.error.message ?? "";
    if (message.includes("insufficient_stock")) {
      return NextResponse.json({ error: "insufficient_stock" }, { status: 409 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
