import ChefDashboard from "@/components/chef/chef-dashboard";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_STORAGE_PATH, CHEF_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canReviewExpiry, NEAR_EXPIRY_ANCHOR, nearExpiryTotals } from "@/lib/labels/expiry";
import { getNearExpiry } from "@/lib/labels/repository";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ChefDashboardPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, CHEF_DASHBOARD_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, settings, branches] = await Promise.all([memberRole(scope), getSettings(scope), listBranches(scope)]);
  if (!canReviewExpiry(role)) return <ChefDashboard allowed={false} />;

  const requested = first(searchParams.branch);
  const branch = branches.find((item) => item.id === requested) ?? branches[0] ?? null;
  const currency = currencyOf(settings);
  if (!branch) {
    return <ChefDashboard allowed branches={[]} branchId={null} expiring={{ count: 0, value: null, href: ANBAR_STORAGE_PATH }} currency={currency} />;
  }
  const lots = await getNearExpiry(scope, branch.id);
  if (!lots.ok) throw new Error(`get_near_expiry_batches: ${lots.error}`);
  const totals = nearExpiryTotals(lots.value);
  const href = `${ANBAR_STORAGE_PATH}?${new URLSearchParams({ branch: branch.id, type: "expiring" }).toString()}#${NEAR_EXPIRY_ANCHOR}`;

  return (
    <ChefDashboard
      allowed
      branches={branches.map((item) => ({ id: item.id, name: item.name }))}
      branchId={branch.id}
      expiring={{ count: totals.count, value: totals.value, href }}
      currency={currency}
    />
  );
}
