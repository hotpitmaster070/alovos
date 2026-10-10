import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const integrationId = typeof record.integration_id === "string" ? record.integration_id : "";
  const productId = typeof record.product_id === "string" ? record.product_id : "";
  const locationId = typeof record.location_id === "string" ? record.location_id : "";
  const quantity = Number(record.quantity);
  if (!UUID.test(integrationId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const integration = await current.supabase
    .from("pos_integrations")
    .select("id, type")
    .eq("tenant_id", current.tenantId)
    .eq("id", integrationId)
    .maybeSingle();
  if (integration.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  if (!integration.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (UUID.test(productId) && UUID.test(locationId) && Number.isFinite(quantity) && quantity > 0) {
    const movement = await current.supabase.rpc("wastage_stock_rpc", {
      p_product_id: productId,
      p_location_id: locationId,
      p_quantity: quantity,
      p_movement_type: "spisanie",
      p_reason: integration.data.type,
    });
    if (movement.error) {
      const message = movement.error.message ?? "";
      if (message.includes("insufficient_stock")) {
        return NextResponse.json({ error: "insufficient_stock" }, { status: 409 });
      }
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, type: integration.data.type });
}
