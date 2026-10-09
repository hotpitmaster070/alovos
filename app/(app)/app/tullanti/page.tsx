import WasteBoard from "@/components/wastage/waste-board";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { listWasteCards, wasteDay, wasteTotal } from "@/lib/wastage/load";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { currencyOf } from "@/lib/money";
import { memberRole } from "@/lib/count/load";
import { wasteAiState } from "@/lib/waste/load";
import { canReviewWaste } from "@/lib/waste/plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const PATH = "/app/tullanti";

export default async function TullantiPage({ searchParams }: { searchParams: RawSearchParams }) {
  const locationId = parseLocationFilter(searchParams.location);
  const branchId = parseLocationFilter(searchParams.branch);
  const page = parsePage(searchParams.page);
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const settings = await getSettings(gated.scope);
  const filters = { branchId, locationId };
  const today = wasteDay(null, settings);
  const day = wasteDay(typeof searchParams.day === "string" ? searchParams.day : null, settings);
  const [locations, branches, waste, total, ai, role] = await Promise.all([
    listStorageLocations(gated.scope, { includeInactive: true }),
    listBranches(gated.scope),
    listWasteCards(gated.scope, filters, settings, page, day),
    wasteTotal(gated.scope, filters, settings, day),
    wasteAiState(gated.scope),
    memberRole(gated.scope),
  ]);

  return (
    <WasteBoard
      locations={locations}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
      cards={waste.cards}
      count={waste.total}
      page={page}
      pageSize={PAGE_SIZE}
      total={total}
      currency={currencyOf(settings)}
      day={day}
      today={today}
      timeZone={settings.timezone}
      photoEnabled={ai.photoEnabled}
      canReview={canReviewWaste(role)}
    />
  );
}
