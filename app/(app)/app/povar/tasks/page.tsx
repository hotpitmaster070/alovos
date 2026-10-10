import CookTasks from "@/components/inventory/cook-tasks";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { COOK_TASKS_PATH } from "@/lib/auth-redirect";
import { myStats, myTasks } from "@/lib/inventory/load";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function CookTasksPage() {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, COOK_TASKS_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const scope = gated.scope;
  const [tasks, stats, settings, user] = await Promise.all([myTasks(scope), myStats(scope), getSettings(scope), scope.client.auth.getUser()]);

  return (
    <CookTasks
      email={user.data.user?.email ?? ""}
      tasks={tasks}
      stats={stats}
      timeZone={settings.timezone}
      locale={settings.locale ?? undefined}
    />
  );
}
