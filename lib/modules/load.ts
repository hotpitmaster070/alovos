import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";

export async function loadRows(path: string, table: string, columns: string): Promise<Record<string, unknown>[]> {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, path);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const { data, error } = await gated.scope.client
    .from(table)
    .select(columns)
    .eq("tenant_id", gated.scope.tenantId)
    .limit(100);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
}
