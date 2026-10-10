import ChefInventory from "@/components/inventory/chef-inventory";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { CHEF_INVENTORY_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { branchStaff, discrepancyLines, taskBoard, taskCounts, zonesByBranch } from "@/lib/inventory/load";
import { TASK_BOARD_PAGE, type StaffMember } from "@/lib/inventory/model";
import { discrepancyRow, discrepancyShare, totals } from "@/lib/inventory/modes";
import { currencyOf } from "@/lib/money";
import { parsePage } from "@/lib/pagination";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { addDays, startOfDate, todayIn } from "@/lib/tenant-settings/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const EMPTY_STATS = { active: 0, awaiting: 0, finished: 0, share: null, losses: 0 };

export default async function ChefInventoryPage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, CHEF_INVENTORY_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, branches, settings] = await Promise.all([memberRole(scope), listBranches(scope), getSettings(scope)]);
  const currency = currencyOf(settings);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requested) ? requested : null;
  const page = parsePage(searchParams.page);

  if (!canApproveCounts(role)) {
    return (
      <ChefInventory
        allowed={false}
        branches={branches}
        branchId={branchId}
        stats={EMPTY_STATS}
        tasks={[]}
        total={0}
        page={page}
        pageSize={TASK_BOARD_PAGE}
        zonesByBranch={{}}
        staffByBranch={{}}
        currency={currency}
        timeZone={settings.timezone}
      />
    );
  }

  const weekStart = addDays(todayIn(settings.timezone, new Date()), -6);
  const [counts, week, board, zones, staffLists] = await Promise.all([
    taskCounts(scope, branchId, startOfDate(weekStart, settings.timezone).toISOString()),
    discrepancyLines(scope, { branchId, taskId: null, from: weekStart, to: null }),
    taskBoard(scope, branchId, page),
    zonesByBranch(scope),
    Promise.all(branches.map(async (branch) => [branch.id, await branchStaff(scope, branch.id)] as const)),
  ]);

  const rows = week.map((line) =>
    discrepancyRow({ expected: line.expected, counts: line.counts, unitCost: line.unitCost }),
  );
  const share = discrepancyShare(
    rows.map((row, index) => ({ expected: week[index].expected, difference: row.discrepancy?.difference ?? null, unitCost: week[index].unitCost })),
  );
  const staffByBranch: Record<string, StaffMember[]> = Object.fromEntries(staffLists);

  return (
    <ChefInventory
      allowed
      branches={branches}
      branchId={branchId}
      stats={{ active: counts.active, awaiting: counts.awaiting, finished: counts.finished, share, losses: totals(rows).lost }}
      tasks={board.tasks}
      total={board.total}
      page={page}
      pageSize={TASK_BOARD_PAGE}
      zonesByBranch={zones}
      staffByBranch={staffByBranch}
      currency={currency}
      timeZone={settings.timezone}
    />
  );
}
