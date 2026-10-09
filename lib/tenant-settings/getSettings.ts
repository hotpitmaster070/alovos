import type { TenantScope } from "@/lib/anbar/scope";
import { parseTenantSettings, TENANT_SETTINGS_COLUMNS, type TenantSettings } from "./parse";

/** Settings of the caller's tenant; scope.tenantId comes from current_tenant_id(). */
export async function getSettings(scope: TenantScope): Promise<TenantSettings> {
  const { data, error } = await scope.client
    .from("tenant_settings")
    .select(TENANT_SETTINGS_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle();
  if (error) throw new Error(`tenant_settings: ${error.message}`);
  return parseTenantSettings(data);
}
