import { notFound } from "next/navigation";
import BlindCount from "@/components/inventory/blind-count";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { COOK_TASKS_PATH } from "@/lib/auth-redirect";
import { myAssignmentLines, myTasks } from "@/lib/inventory/load";
import { isUuid } from "@/lib/inventory/model";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function BlindCountPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, `${COOK_TASKS_PATH}/${params.id}`);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [tasks, lines, settings] = await Promise.all([myTasks(scope), myAssignmentLines(scope, params.id), getSettings(scope)]);
  const task = tasks.find((item) => item.assignmentId === params.id);
  if (!task) notFound();

  return <BlindCount key={task.assignmentId} task={task} lines={lines} locale={settings.locale ?? undefined} />;
}
