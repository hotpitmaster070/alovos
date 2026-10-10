import type { TenantScope } from "@/lib/anbar/scope";
import { failed, type Result } from "@/lib/purchasing/repository";
import {
  parseSmartSettings,
  parseStockLimitRow,
  SMART_SETTINGS_COLUMNS,
  type LimitChange,
  type SmartSettings,
  type SmartSettingsPatch,
  type StockLimitRow,
} from "./model";

/** null until 20261029000200 is applied (the columns are missing). */
export async function getSmartSettings(scope: TenantScope): Promise<SmartSettings | null> {
  const { data, error } = await scope.client.from("tenant_settings").select(SMART_SETTINGS_COLUMNS).eq("tenant_id", scope.tenantId).maybeSingle();
  if (error) {
    if (error.code === "42703") return null;
    throw new Error(`tenant_settings: ${error.message}`);
  }
  return parseSmartSettings(data);
}

/** Row-level security lets only the owner update; for anyone else no row comes back. */
export async function updateSmartSettings(scope: TenantScope, patch: SmartSettingsPatch): Promise<Result<SmartSettings>> {
  const { data, error } = await scope.client
    .from("tenant_settings")
    .update(patch)
    .eq("tenant_id", scope.tenantId)
    .select(SMART_SETTINGS_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { ok: false, error: "forbidden", status: 403 };
  const settings = parseSmartSettings(data);
  return settings ? { ok: true, value: settings } : failed({});
}

/** Every product with its stock in the branch (null: all of the caller's branches) and where its minimum comes from. */
export async function stockLimits(scope: TenantScope, branchId: string | null): Promise<Result<StockLimitRow[]>> {
  const { data, error } = await scope.client.rpc("stock_limits", { p_branch_id: branchId });
  if (error) return failed(error);
  return { ok: true, value: ((data ?? []) as unknown[]).flatMap((row) => parseStockLimitRow(row) ?? []) };
}

export async function saveStockLimits(scope: TenantScope, branchId: string | null, items: LimitChange[]): Promise<Result<number>> {
  const { data, error } = await scope.client.rpc("save_stock_limits", { p_branch_id: branchId, p_items: items });
  if (error) return failed(error);
  return { ok: true, value: typeof data === "number" ? data : Number(data ?? 0) };
}
