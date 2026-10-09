import { fetchAll } from "@/lib/supabase/fetch-all";
import type { TenantScope } from "./scope";

/**
 * products.cost and product_stocks.cost_per_unit are not readable directly. Owners and chefs get
 * them from the product_costs / product_stock_costs views; for other roles the views are empty, so
 * every cost resolves to null.
 */

function costMap(rows: unknown[], column: string): Map<string, number> {
  const costs = new Map<string, number>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const value = record[column];
    const cost = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (typeof record.id === "string" && Number.isFinite(cost)) costs.set(record.id, cost);
  }
  return costs;
}

/** Cost per unit by product_stocks.id for the in-stock lots of the given products. */
export async function lotCosts(
  scope: TenantScope,
  { productIds, branchId = null }: { productIds: string[]; branchId?: string | null },
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await fetchAll((from, to) => {
    let query = scope.client
      .from("product_stock_costs")
      .select("id, cost_per_unit")
      .eq("tenant_id", scope.tenantId)
      .in("product_id", productIds)
      .gt("quantity", 0);
    if (branchId) query = query.eq("branch_id", branchId);
    return query.order("id").range(from, to);
  });
  return costMap(rows, "cost_per_unit");
}

/** Price per unit by products.id. */
export async function productPrices(scope: TenantScope, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await fetchAll((from, to) =>
    scope.client
      .from("product_costs")
      .select("id, cost")
      .eq("tenant_id", scope.tenantId)
      .in("id", productIds)
      .order("id")
      .range(from, to),
  );
  return costMap(rows, "cost");
}
