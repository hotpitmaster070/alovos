import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { discrepancyLines, getTask, recentTasks } from "@/lib/inventory/load";
import { isUuid } from "@/lib/inventory/model";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { addDays, isDateOnly, todayIn } from "@/lib/tenant-settings/time";
import DiscrepancyReport from "./discrepancy-report";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** Without a task or a start date the report covers the last 30 days. */
const DEFAULT_DAYS = 30;

/** Server part of the report, shared by /app/anbar/discrepancies and /app/owner/discrepancies. */
export default async function DiscrepancyPage({ searchParams, path }: { searchParams: RawSearchParams; path: string }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, path);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, branches, settings] = await Promise.all([memberRole(scope), listBranches(scope), getSettings(scope)]);
  const currency = currencyOf(settings);
  const requestedBranch = parseLocationFilter(searchParams.branch);
  const branchId = branches.some((branch) => branch.id === requestedBranch) ? requestedBranch : null;
  const taskRaw = first(searchParams.task);
  const taskId = isUuid(taskRaw) ? taskRaw : null;
  const fromRaw = first(searchParams.from) ?? "";
  const toRaw = first(searchParams.to) ?? "";
  const today = todayIn(settings.timezone, new Date());
  const from = isDateOnly(fromRaw) ? fromRaw : taskId ? "" : addDays(today, -(DEFAULT_DAYS - 1));
  const to = isDateOnly(toRaw) ? toRaw : "";
  const filters = { branchId, taskId, from, to, significant: first(searchParams.significant) === "1" };

  if (!canApproveCounts(role)) {
    return (
      <DiscrepancyReport allowed={false} path={path} branches={branches} tasks={[]} selectedTask={null} filters={filters} lines={[]} currency={currency} />
    );
  }

  const [tasks, lines, selected] = await Promise.all([
    recentTasks(scope, branchId),
    discrepancyLines(scope, { branchId, taskId, from: from || null, to: to || null }),
    taskId ? getTask(scope, taskId) : Promise.resolve(null),
  ]);
  const options = selected && !tasks.some((task) => task.id === selected.id) ? [selected, ...tasks] : tasks;

  return (
    <DiscrepancyReport
      allowed
      path={path}
      branches={branches}
      tasks={options}
      selectedTask={selected}
      filters={filters}
      lines={lines}
      currency={currency}
    />
  );
}
