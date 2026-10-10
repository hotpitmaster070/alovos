import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import { parseSaleRequest, SALE_ERROR_STATUS, saleErrorCode, toSaleResult } from "@/lib/recipes/sales";

export const dynamic = "force-dynamic";

/**
 * POST {branch_id, items: [{recipe_id, quantity}]} writes off the ingredients of the sold or cooked
 * portions in one transaction. The response carries only ids, numbers and message keys (no text, no
 * currency): {success, deductions: [...], warnings: [{message_key, product_id, recipe_id, meta}]}.
 */
export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;

  const body: unknown = await request.json().catch(() => null);
  const sale = parseSaleRequest(body);
  if (!sale) return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });

  const { supabase, tenantId } = current;
  const recipeIds = Array.from(new Set(sale.items.map((item) => item.recipe_id)));
  const [branch, recipes] = await Promise.all([
    supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("id", sale.branch_id).maybeSingle(),
    supabase.from("tech_cards").select("id").eq("tenant_id", tenantId).in("id", recipeIds),
  ]);
  if (branch.error || recipes.error) return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  if (!branch.data) return NextResponse.json({ success: false, error: "branch_not_found" }, { status: 404 });
  if ((recipes.data ?? []).length !== recipeIds.length) {
    return NextResponse.json({ success: false, error: "recipe_not_found" }, { status: 404 });
  }

  const { data, error } = await supabase.rpc("deduce_sale", { p_branch_id: sale.branch_id, p_items: sale.items });
  if (error) {
    const code = saleErrorCode(error.message ?? "");
    if (code === "save_failed") console.error("deduce_sale failed", error.message);
    return NextResponse.json({ success: false, error: code }, { status: SALE_ERROR_STATUS[code] });
  }

  return NextResponse.json({ success: true, ...toSaleResult(data) });
}
