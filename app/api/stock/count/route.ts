import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  const form = await request.formData();
  const locationId = String(form.get("location_id") ?? "");
  const groupKey = String(form.get("group_key") ?? "").trim();
  if (!UUID.test(locationId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const counted: { productId: string; quantity: number }[] = [];
  for (const [key, value] of Array.from(form.entries())) {
    if (!key.startsWith("qty_")) continue;
    const productId = key.slice(4);
    const text = String(value).trim();
    if (!UUID.test(productId) || text === "") continue;
    const quantity = Number(text);
    if (!Number.isFinite(quantity) || quantity < 0) continue;
    counted.push({ productId, quantity });
  }

  const created = await current.supabase
    .from("stock_counts")
    .insert({
      tenant_id: current.tenantId,
      location_id: locationId,
      group_key: groupKey || null,
      user_id: current.userId,
    })
    .select("id")
    .single();
  if (created.error || !created.data) return NextResponse.json({ error: "save_failed" }, { status: 500 });

  if (counted.length > 0) {
    const items = await current.supabase.from("stock_count_items").insert(
      counted.map((row) => ({
        tenant_id: current.tenantId,
        stock_count_id: created.data.id,
        product_id: row.productId,
        counted_quantity: row.quantity,
      })),
    );
    if (items.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  let moved = false;
  for (const row of counted) {
    const stock = await current.supabase
      .from("product_stocks")
      .select("quantity")
      .eq("tenant_id", current.tenantId)
      .eq("product_id", row.productId)
      .eq("location_id", locationId);
    if (stock.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    const system = (stock.data ?? []).reduce((sum, item) => sum + Number(item.quantity), 0);
    const delta = row.quantity - system;
    if (delta === 0) continue;
    const movement = await current.supabase.from("stock_movements").insert({
      tenant_id: current.tenantId,
      product_id: row.productId,
      from_location_id: delta < 0 ? locationId : null,
      to_location_id: delta > 0 ? locationId : null,
      quantity: Math.abs(delta),
      movement_type: "count",
      user_id: current.userId,
    });
    if (movement.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    moved = true;
  }

  const next = new URL("/app/anbar", request.url);
  if (moved) next.searchParams.set("notice", "1");
  return NextResponse.redirect(next, 303);
}
