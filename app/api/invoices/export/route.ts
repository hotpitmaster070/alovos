import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const invoices = await current.supabase
    .from("invoices")
    .select("id, supplier_id, total, created_at")
    .eq("tenant_id", current.tenantId)
    .limit(500);
  if (invoices.error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return new NextResponse(JSON.stringify(invoices.data ?? []), {
    headers: {
      "content-type": "application/json",
      "content-disposition": "attachment; filename=invoices.json",
    },
  });
}
