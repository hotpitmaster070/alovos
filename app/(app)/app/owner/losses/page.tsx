import LossesReport from "@/components/owner/losses-report";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { OWNER_LOSSES_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { lossRange, parseLossPeriod } from "@/lib/losses/model";
import { theoreticalVsActual } from "@/lib/losses/repository";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { todayIn } from "@/lib/tenant-settings/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function OwnerLossesPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, OWNER_LOSSES_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, branches, settings] = await Promise.all([memberRole(scope), listBranches(scope), getSettings(scope)]);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requested) ? requested : null;
  const period = parseLossPeriod(searchParams.period);
  const range = lossRange(period, todayIn(settings.timezone, new Date()));
  const currency = currencyOf(settings);
  const allowed = canApproveCounts(role);

  return (
    <LossesReport
      allowed={allowed}
      branches={branches}
      branchId={branchId}
      period={period}
      range={range}
      currency={currency}
      rows={allowed ? await theoreticalVsActual(scope, branchId, range) : []}
    />
  );
}
