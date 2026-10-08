import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const barcode =
    typeof body === "object" && body !== null && "barcode" in body && typeof body.barcode === "string"
      ? body.barcode.trim()
      : "";
  if (!barcode) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const product = await current.supabase
    .from("products")
    .select("id, name, barcode, expiry_date")
    .eq("tenant_id", current.tenantId)
    .eq("barcode", barcode)
    .maybeSingle();
  if (product.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ product: product.data });
}
