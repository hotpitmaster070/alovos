import ReceivingView from "@/components/receiving/receiving-view";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { branchStaff, zonesByBranch } from "@/lib/inventory/load";
import type { StaffMember, Zone } from "@/lib/inventory/model";
import { currencyOf } from "@/lib/money";
import { currentUserId, myDelegations, receivingOrders } from "@/lib/receiving/load";
import type { ReceivingOrder } from "@/lib/receiving/model";
import { getSettings } from "@/lib/tenant-settings/getSettings";

/**
 * Shared by the chef and the warehouse receiving pages. Owners and chefs see everything and can hand
 * receiving over ("I stepped away"); a delegate sees only the delegated branch, without prices.
 */
export default async function ReceivingPage({ path, searchParams }: { path: string; searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, path);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, allBranches, settings, delegations, userId] = await Promise.all([
    memberRole(scope),
    listBranches(scope),
    getSettings(scope),
    myDelegations(scope),
    currentUserId(scope),
  ]);
  const currency = currencyOf(settings);
  const manager = canApproveCounts(role);
  const incoming = manager ? null : delegations.find((delegation) => delegation.direction === "incoming") ?? null;
  const branches = incoming ? allBranches.filter((branch) => branch.id === incoming.branchId) : allBranches;
  const allowed = manager || (incoming !== null && branches.length > 0);

  const requested = Array.isArray(searchParams.branch) ? searchParams.branch[0] : searchParams.branch;
  const branchId = branches.find((branch) => branch.id === requested)?.id ?? branches[0]?.id ?? null;

  let orders: ReceivingOrder[] = [];
  let zones: Zone[] = [];
  let candidates: StaffMember[] = [];
  if (allowed && branchId) {
    const [branchOrders, branchZones, staff] = await Promise.all([
      receivingOrders(scope, branchId),
      zonesByBranch(scope, branchId),
      manager ? branchStaff(scope, branchId) : Promise.resolve([]),
    ]);
    orders = branchOrders;
    zones = branchZones[branchId] ?? [];
    candidates = staff.filter((member) => member.userId !== userId);
  }
  const outgoing = manager
    ? delegations.find((delegation) => delegation.direction === "outgoing" && delegation.branchId === branchId) ?? null
    : null;

  return (
    <ReceivingView
      key={branchId ?? "none"}
      allowed={allowed}
      showCosts={manager}
      path={path}
      tenantId={scope.tenantId}
      branches={branches}
      branchId={branchId}
      orders={orders}
      zones={zones}
      currency={currency}
      timeZone={settings.timezone}
      delegation={{ canDelegate: manager, candidates, incoming, outgoing }}
    />
  );
}
