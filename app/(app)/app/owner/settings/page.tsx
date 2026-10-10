import SmartSettingsView from "@/components/owner/smart-settings";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { deliveryConfig } from "@/lib/auto-order/delivery";
import { resolveScope } from "@/lib/anbar/scope";
import { OWNER_SETTINGS_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canInvite } from "@/lib/purchasing/model";
import { getSmartSettings, stockLimits } from "@/lib/smart-settings/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function OwnerSettingsPage() {
  const gated = redirectIfNoOrg(await resolveScope(), OWNER_SETTINGS_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, branches, settings] = await Promise.all([memberRole(scope), listBranches(scope), getSmartSettings(scope)]);
  const owner = canInvite(role);
  const branchId = branches[0]?.id ?? null;
  const limits = owner && settings ? await stockLimits(scope, branchId) : null;
  const delivery = deliveryConfig();

  return (
    <SmartSettingsView
      owner={owner}
      settings={settings}
      branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
      branchId={branchId}
      rows={limits?.ok ? limits.value : []}
      providers={{ whatsapp: delivery.whatsapp !== null, email: delivery.email !== null }}
    />
  );
}
