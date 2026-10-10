import OwnerDashboard from "@/components/owner/owner-dashboard";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { OWNER_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { currencyOf } from "@/lib/money";
import { dashboardCards, discrepancySince, parAlerts } from "@/lib/owner/dashboard";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { addDays, todayIn } from "@/lib/tenant-settings/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function OwnerPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, OWNER_DASHBOARD_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, branches, settings] = await Promise.all([memberRole(scope), listBranches(scope), getSettings(scope)]);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requested) ? requested : null;

  if (!canApproveCounts(role)) {
    return <OwnerDashboard allowed={false} branches={branches} branchId={branchId} currency={currencyOf(settings)} />;
  }

  const weekStart = addDays(todayIn(settings.timezone, new Date()), -6);
  const [cards, alerts, week] = await Promise.all([
    dashboardCards(scope, branchId),
    parAlerts(scope, branchId),
    // Counts from inventory tasks are optional for the dashboard: without them the card shows "—".
    discrepancySince(scope, branchId, weekStart).catch((error: unknown) => {
      console.error("owner dashboard: discrepancies", error);
      return null;
    }),
  ]);

  return (
    <OwnerDashboard
      allowed
      branches={branches}
      branchId={branchId}
      currency={currencyOf(settings)}
      cards={cards}
      alerts={alerts}
      week={week}
    />
  );
}
