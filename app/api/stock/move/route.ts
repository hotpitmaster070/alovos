import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import type { TenantScope } from "@/lib/anbar/scope";
import { parseStockMove, type StockMoveInput } from "@/lib/anbar/stock-view";

export const dynamic = "force-dynamic";

/** Each board movement through its SECURITY DEFINER RPC; clients do not insert stock_movements. */
function call(supabase: TenantScope["client"], move: StockMoveInput) {
  switch (move.movementType) {
    case "prihod":
      return supabase.rpc("receive_stock_rpc", {
        p_product_id: move.productId,
        p_location_id: move.toLocationId,
        p_quantity: move.quantity,
        p_reason: move.reason,
      });
    case "peremeshchenie":
      return supabase.rpc("move_stock_rpc", {
        p_product_id: move.productId,
        p_from_location_id: move.fromLocationId,
        p_to_location_id: move.toLocationId,
        p_quantity: move.quantity,
        p_reason: move.reason,
      });
    default:
      return supabase.rpc("wastage_stock_rpc", {
        p_product_id: move.productId,
        p_location_id: move.fromLocationId,
        p_quantity: move.quantity,
        p_movement_type: move.movementType,
        p_reason: move.reason,
      });
  }
}

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const parsed = parseStockMove(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error } = await call(current.supabase, parsed.value);
  if (error) {
    const message = error.message ?? "";
    if (message.includes("insufficient_stock")) return NextResponse.json({ error: "insufficient_stock" }, { status: 409 });
    if (message.includes("product_not_found")) return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    if (message.includes("location_not_found")) return NextResponse.json({ error: "location_not_found" }, { status: 404 });
    if (message.includes("invalid_input")) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
