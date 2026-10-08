import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { fetchAll } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

export async function GET() {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  let invoices: unknown[];
  try {
    invoices = await fetchAll((from, to) =>
      current.supabase
        .from("invoices")
        .select("id, supplier_id, total, created_at")
        .eq("tenant_id", current.tenantId)
        .order("created_at")
        .order("id")
        .range(from, to),
    );
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return new NextResponse(JSON.stringify(invoices), {
    headers: {
      "content-type": "application/json",
      "content-disposition": "attachment; filename=invoices.json",
    },
  });
}
