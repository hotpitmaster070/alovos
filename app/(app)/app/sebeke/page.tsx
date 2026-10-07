import SettingsView from "@/components/settings/settings-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { readSettings } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, "/app/sebeke");
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const client = gated.scope.client;
  const tenantId = gated.scope.tenantId;
  const [tenant, branches, locations, units] = await Promise.all([
    client.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
    client.from("branches").select("id, name").eq("tenant_id", tenantId).order("name").limit(200),
    client.from("storage_locations").select("id, name, type").eq("tenant_id", tenantId).order("name").limit(200),
    client.from("units").select("id, code, name").eq("tenant_id", tenantId).order("code").limit(200),
  ]);
  if (tenant.error) throw tenant.error;
  if (branches.error) throw branches.error;
  if (locations.error) throw locations.error;
  if (units.error) throw units.error;

  return (
    <SettingsView
      settings={readSettings(tenant.data?.settings)}
      branches={(branches.data ?? []) as { id: string; name: string }[]}
      locations={(locations.data ?? []) as { id: string; name: string; type: string }[]}
      units={(units.data ?? []) as { id: string; code: string; name: string }[]}
    />
  );
}
