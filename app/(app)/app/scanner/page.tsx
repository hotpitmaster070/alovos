import ScannerView from "@/components/scanner/scanner-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import { listScannerCatalog } from "@/lib/scanner/load";
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

  const [catalog, branches] = await Promise.all([
    listScannerCatalog(gated.scope),
    listBranches(gated.scope),
  ]);

  return (
    <ScannerView
      locations={catalog.locations}
      products={catalog.products}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
    />
  );
}
