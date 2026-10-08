import ScannerView from "@/components/scanner/scanner-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const PATH = "/app/scanner";

export default async function ScannerPage({ searchParams }: { searchParams: RawSearchParams }) {
  const locationId = parseLocationFilter(searchParams.location);
  const branchId = parseLocationFilter(searchParams.branch);
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const [locations, branches] = await Promise.all([listStorageLocations(gated.scope), listBranches(gated.scope)]);

  return (
    <ScannerView
      locations={locations}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
    />
  );
}
