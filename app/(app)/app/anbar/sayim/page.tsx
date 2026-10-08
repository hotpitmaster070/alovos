import CountForm from "@/components/anbar/count-form";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import {
  canApproveCounts,
  canCount,
  countLines,
  countProducts,
  listCounts,
  memberRole,
  myCountEntries,
  openCountAt,
} from "@/lib/count/load";
import { isCountErrorCode } from "@/lib/count/model";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const isNotice = (value: unknown): value is "saved" | "finished" => value === "saved" || value === "finished";

export default async function CountPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_COUNT_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const page = parsePage(searchParams.page);
  const historyPage = parsePage(searchParams.h);

  const [branches, allLocations, role, user, history, settings] = await Promise.all([
    listBranches(scope),
    listStorageLocations(scope),
    memberRole(scope),
    scope.client.auth.getUser(),
    listCounts(scope, historyPage),
    getSettings(scope),
  ]);
  const locations = allLocations.filter((location) => location.active);
  const requested = first(searchParams.location);
  const location = locations.find((item) => item.id === requested) ?? locations[0] ?? null;

  const [count, catalog] = location
    ? await Promise.all([openCountAt(scope, location.id), countProducts(scope, location.id, page)])
    : [null, { products: [], total: 0 }];
  const [mine, lines] = count?.status === "counting"
    ? await Promise.all([myCountEntries(scope, count.id), countLines(scope, count.id)])
    : [{}, []];
  const onPage = new Set(catalog.products.map((product) => product.id));
  const extraProducts = lines
    .filter((line) => line.productId in mine && !onPage.has(line.productId))
    .map((line) => ({ id: line.productId, name: line.name, unit: line.unit }));
  const counters = Object.fromEntries(lines.map((line) => [line.productId, line.counters]));
  const userId = user.data.user?.id ?? null;
  const notice = first(searchParams.notice);
  const error = first(searchParams.error);

  return (
    <CountForm
      key={location?.id ?? ""}
      branches={branches}
      locations={locations}
      locationId={location?.id ?? null}
      count={count}
      finishedMine={count !== null && userId !== null && count.finishedBy.includes(userId)}
      canCount={canCount(role)}
      canApprove={canApproveCounts(role)}
      products={catalog.products}
      extraProducts={extraProducts}
      counters={counters}
      total={catalog.total}
      page={page}
      pageSize={PAGE_SIZE}
      mine={mine}
      notice={isNotice(notice) ? notice : null}
      error={isCountErrorCode(error) ? error : null}
      history={history.counts}
      historyTotal={history.total}
      historyPage={historyPage}
      timeZone={settings.timezone}
    />
  );
}
