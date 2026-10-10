import CatalogView from "@/components/anbar/catalog-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import {
  listBranches,
  listCatalog,
  listCatalogCategories,
  listStorageLocations,
} from "@/lib/anbar/repository";
import { parMarks } from "@/lib/anbar/par";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { parAlerts } from "@/lib/owner/dashboard";
import { PAGE_SIZE, parsePage, parseSearch } from "@/lib/pagination";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CatalogPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_CATALOG_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const branches = await listBranches(gated.scope);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requested) ? requested : null;
  const search = parseSearch(searchParams.q);
  const category = parseSearch(searchParams.category);
  const lowOnly = first(searchParams.low) === "1";
  const page = parsePage(searchParams.page);

  const [catalog, categories, locations, settings, role, alerts] = await Promise.all([
    listCatalog(gated.scope, { branchId, search, category, lowOnly }, page),
    listCatalogCategories(gated.scope, branchId),
    listStorageLocations(gated.scope),
    getSettings(gated.scope),
    memberRole(gated.scope),
    parAlerts(gated.scope, branchId),
  ]);

  return (
    <CatalogView
      lines={catalog.lines}
      total={catalog.total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search ?? ""}
      category={category}
      lowOnly={lowOnly}
      categories={categories}
      branches={branches}
      locations={locations}
      branchId={branchId}
      settings={settings}
      par={parMarks(alerts, branchId)}
      canImport={canApproveCounts(role)}
    />
  );
}
