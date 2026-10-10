import ChefWasteFeed from "@/components/wastage/chef-waste-feed";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { CHEF_WASTE_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { currencyOf } from "@/lib/money";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { listWasteCards, wasteDay, wasteTotal } from "@/lib/wastage/load";
import { isLoggedWasteReason, isUuid } from "@/lib/wastage/model";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ChefWastePage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, CHEF_WASTE_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, settings, branches] = await Promise.all([memberRole(scope), getSettings(scope), listBranches(scope)]);
  const currency = currencyOf(settings);
  if (!canApproveCounts(role)) {
    return <ChefWasteFeed allowed={false} currency={currency} timeZone={settings.timezone} />;
  }

  const requestedBranch = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requestedBranch) ? requestedBranch : "all";
  const reasonRaw = first(searchParams.reason) ?? "";
  const reason = isLoggedWasteReason(reasonRaw) ? reasonRaw : null;
  const cookRaw = first(searchParams.cook) ?? "";
  const userId = isUuid(cookRaw) ? cookRaw : null;
  const page = parsePage(searchParams.page);
  const today = wasteDay(null, settings);
  const day = wasteDay(first(searchParams.day) ?? null, settings);
  const filters = { branchId, locationId: "all" as const, reason, userId };

  const [waste, total, people] = await Promise.all([
    listWasteCards(scope, filters, settings, page, day),
    wasteTotal(scope, filters, settings, day),
    scope.client.from("profiles").select("id, email").eq("tenant_id", scope.tenantId).order("email"),
  ]);
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  const cooks = (people.data ?? []).flatMap((row: { id?: unknown; email?: unknown }) =>
    typeof row.id === "string" ? [{ id: row.id, email: typeof row.email === "string" ? row.email : row.id.slice(0, 8) }] : [],
  );

  return (
    <ChefWasteFeed
      allowed
      currency={currency}
      timeZone={settings.timezone}
      branches={branches}
      branchId={branchId === "all" ? null : branchId}
      cooks={cooks}
      reason={reason}
      userId={userId}
      day={day}
      today={today}
      cards={waste.cards}
      count={waste.total}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
