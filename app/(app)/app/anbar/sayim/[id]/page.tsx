import { notFound } from "next/navigation";
import CountReport from "@/components/anbar/count-report";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, countLines, getCount, memberRole } from "@/lib/count/load";
import { isUuid } from "@/lib/count/model";
import { currencyLabel } from "@/lib/tenant-settings/parse";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";

export default async function CountReportPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, `${ANBAR_COUNT_PATH}/${params.id}`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;

  const count = await getCount(scope, params.id);
  if (!count) notFound();
  const [lines, locations, role, settings] = await Promise.all([
    countLines(scope, count.id),
    listStorageLocations(scope),
    memberRole(scope),
    getSettings(scope),
  ]);

  return (
    <CountReport
      count={count}
      lines={lines}
      locationName={locations.find((location) => location.id === count.locationId)?.name ?? null}
      canApprove={canApproveCounts(role)}
      currency={currencyLabel(settings)}
      timeZone={settings.timezone}
    />
  );
}
