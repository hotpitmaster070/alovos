import WasteBoard from "@/components/wastage/waste-board";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { listWasteCards, wasteTotal } from "@/lib/wastage/load";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { currencyLabel } from "@/lib/tenant-settings/parse";

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
  const [locations, branches, waste, total] = await Promise.all([
    listStorageLocations(gated.scope, { includeInactive: true }),
    listBranches(gated.scope),
    listWasteCards(gated.scope, filters, settings, page),
    wasteTotal(gated.scope, filters, settings),
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
      symbol={currencyLabel(settings)}
    />
  );
}
