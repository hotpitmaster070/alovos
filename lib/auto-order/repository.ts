import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/anbar/scope";
import { failed, type Result } from "@/lib/purchasing/repository";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { isAutoOrderNotify, type AutoOrderNotify } from "@/lib/smart-settings/model";
import { parseAutoOrderGroups, type AutoOrderGroup } from "./model";

/** What the branch needs, grouped by supplier (owners and chefs). */
export async function autoOrderPreview(scope: TenantScope, branchId: string): Promise<Result<AutoOrderGroup[]>> {
  const { data, error } = await scope.client.rpc("get_auto_order_items_grouped", { p_branch_id: branchId });
  if (error) return failed(error);
  return { ok: true, value: parseAutoOrderGroups(data) };
}

/** Today's draft per supplier, created or topped up; returns how many suppliers got one. */
export async function createAutoOrderDrafts(scope: TenantScope, branchId: string): Promise<Result<number>> {
  const { data, error } = await scope.client.rpc("create_auto_order_drafts", { p_branch_id: branchId });
  if (error) return failed(error);
  return { ok: true, value: typeof data === "number" ? data : Number(data ?? 0) };
}

/** Adds qty to the draft's line of the product, or a new line marked extra. */
export async function addPurchaseRequestExtra(scope: TenantScope, requestId: string, productId: string, qty: number): Promise<Result<null>> {
  const { error } = await scope.client.rpc("add_purchase_request_extra", { p_request_id: requestId, p_product_id: productId, p_qty: qty });
  return error ? failed(error) : { ok: true, value: null };
}

export type ProductOption = { id: string; name: string; unit: string };

/** Every product of the restaurant, by name, for the extra-item picker. */
export async function productOptions(scope: TenantScope): Promise<ProductOption[]> {
  const data = await fetchAll((from, to) =>
    scope.client.from("products").select("id, name, unit").eq("tenant_id", scope.tenantId).order("name").order("id").range(from, to),
  );
  return (data as Record<string, unknown>[]).flatMap((row) =>
    typeof row.id === "string" ? [{ id: row.id, name: typeof row.name === "string" ? row.name : "", unit: typeof row.unit === "string" ? row.unit : "" }] : [],
  );
}

export type AutoOrderRun = { tenantId: string; branchId: string; drafts: number; notify: AutoOrderNotify };

/** service_role only: every restaurant whose auto-order time has come today in its own timezone. */
export async function runDueAutoOrders(admin: SupabaseClient): Promise<AutoOrderRun[]> {
  const { data, error } = await admin.rpc("run_due_auto_orders");
  if (error) throw new Error(`run_due_auto_orders: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).flatMap((row) =>
    typeof row.tenant_id === "string" && typeof row.branch_id === "string"
      ? [{ tenantId: row.tenant_id, branchId: row.branch_id, drafts: Number(row.drafts ?? 0), notify: isAutoOrderNotify(row.notify) ? row.notify : "system" }]
      : [],
  );
}
