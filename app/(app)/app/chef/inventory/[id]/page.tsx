import { notFound } from "next/navigation";
import ChefInventory from "@/components/inventory/chef-inventory";
import TaskDetail from "@/components/inventory/task-detail";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { CHEF_INVENTORY_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { getTask, taskLines } from "@/lib/inventory/load";
import { isUuid, TASK_BOARD_PAGE } from "@/lib/inventory/model";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function TaskDetailPage({ params, searchParams }: { params: { id: string }; searchParams: RawSearchParams }) {
  if (!isUuid(params.id)) notFound();
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, `${CHEF_INVENTORY_PATH}/${params.id}`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [role, settings] = await Promise.all([memberRole(scope), getSettings(scope)]);
  const currency = currencyOf(settings);
  if (!canApproveCounts(role)) {
    return (
      <ChefInventory
        allowed={false}
        branches={[]}
        branchId={null}
        stats={{ active: 0, awaiting: 0, finished: 0, share: null, losses: 0 }}
        tasks={[]}
        total={0}
        page={1}
        pageSize={TASK_BOARD_PAGE}
        zonesByBranch={{}}
        staffByBranch={{}}
        currency={currency}
        timeZone={settings.timezone}
      />
    );
  }

  const task = await getTask(scope, params.id);
  if (!task) notFound();
  const lines = await taskLines(scope, task.id);
  const close = searchParams.close;

  return (
    <TaskDetail
      task={task}
      lines={lines}
      currency={currency}
      timeZone={settings.timezone}
      autoClose={(Array.isArray(close) ? close[0] : close) === "1"}
    />
  );
}
