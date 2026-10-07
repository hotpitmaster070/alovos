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
  const fromBranch = typeof record.from_branch_id === "string" ? record.from_branch_id : "";
  const toBranch = typeof record.to_branch_id === "string" ? record.to_branch_id : "";
  const productId = typeof record.product_id === "string" ? record.product_id : "";
  const fromLocation = typeof record.from_location_id === "string" ? record.from_location_id : "";
  const toLocation = typeof record.to_location_id === "string" ? record.to_location_id : "";
  const quantity = Number(record.quantity);
  if (![fromBranch, toBranch, productId, fromLocation, toLocation].every((id) => UUID.test(id))) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || fromBranch === toBranch) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const doc = await current.supabase
    .from("branch_transfers")
    .insert({
      tenant_id: current.tenantId,
      from_branch_id: fromBranch,
      to_branch_id: toBranch,
      status: "sent",
    })
    .select("id")
    .single();
  if (doc.error || !doc.data) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  const item = await current.supabase.from("branch_transfer_items").insert({
    tenant_id: current.tenantId,
    branch_transfer_id: doc.data.id,
    product_id: productId,
    quantity,
  });
  if (item.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  const movement = await current.supabase.from("stock_movements").insert({
    tenant_id: current.tenantId,
    product_id: productId,
    from_location_id: fromLocation,
    to_location_id: toLocation,
    quantity,
    movement_type: "transfer",
    user_id: current.userId,
  });
  if (movement.error) {
    const message = movement.error.message ?? "";
    if (message.includes("insufficient_stock")) {
      return NextResponse.json({ error: "insufficient_stock" }, { status: 409 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: doc.data.id });
}
