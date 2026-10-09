import SettingsView from "@/components/settings/settings-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { memberRole } from "@/lib/count/load";
import { listCurrencies } from "@/lib/currency/load";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, "/app/sebeke");
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const client = gated.scope.client;
  const tenantId = gated.scope.tenantId;
  const [settings, branches, locations, units, currencies, role] = await Promise.all([
    getSettings(gated.scope),
    listBranches(gated.scope),
    listStorageLocations(gated.scope, { includeInactive: true }),
    fetchAll((from, to) =>
      client.from("units").select("id, code, name").eq("tenant_id", tenantId).order("code").order("id").range(from, to),
    ),
    listCurrencies(client),
    memberRole(gated.scope),
  ]);

  return (
    <SettingsView
      settings={settings}
      branches={branches}
      locations={locations}
      units={units as { id: string; code: string; name: string }[]}
      currencies={currencies}
      isOwner={role === "owner"}
    />
  );
}
