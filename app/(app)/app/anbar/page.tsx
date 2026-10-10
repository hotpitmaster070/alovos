import StockBoard from "@/components/anbar/stock-board";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listStockLines, stockValueTotal } from "@/lib/anbar/kitchen";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { currencyOf, formatMoney } from "@/lib/money";
import { PAGE_SIZE, parsePage, parseSearch } from "@/lib/pagination";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { listForecast, listSuppliers } from "@/lib/purchasing/repository";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { getSettings } from "@/lib/tenant-settings/getSettings";
export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function AnbarPage({ searchParams }: { searchParams: RawSearchParams }) {
  const locationId = parseLocationFilter(searchParams.location);
  const branchId = parseLocationFilter(searchParams.branch);
  const search = parseSearch(searchParams.q);
  const page = parsePage(searchParams.page);
  const notice = Array.isArray(searchParams.notice) ? searchParams.notice[0] : searchParams.notice;
  const forecastAll = searchParams.forecast === "all";
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_APP_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }

  const [stock, value, locations, branches, settings, role, attention, suppliers] = await Promise.all([
    listStockLines(gated.scope, { branchId, locationId, search }, page),
    stockValueTotal(gated.scope, { branchId, locationId }),
    listStorageLocations(gated.scope, { includeInactive: true }),
    listBranches(gated.scope),
    getSettings(gated.scope),
    memberRole(gated.scope),
    listForecast(gated.scope, { statuses: forecastAll ? null : ["critical", "order"] }),
    listSuppliers(gated.scope),
  ]);
  const onPage = Array.from(new Set(stock.lines.map((line) => line.productId)));
  const known = new Set(attention.map((row) => row.productId));
  const pageForecast = await listForecast(gated.scope, { productIds: onPage.filter((id) => !known.has(id)) });

  return (
    <StockBoard
      lines={stock.lines}
      total={stock.total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search ?? ""}
      locations={locations}
      branches={branches}
      locationId={locationId}
      branchId={branchId}
      money={formatMoney(value.total, currencyOf(settings))}
      expiredMoney={value.expired ? formatMoney(value.expired, currencyOf(settings)) : null}
      updated={notice === "1"}
      forecast={[...attention, ...pageForecast]}
      attention={attention}
      forecastAll={forecastAll}
      suppliers={suppliers}
      canSetLimits={canManagePurchasing(role)}
    />
  );
}
