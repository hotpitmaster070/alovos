import { headers } from "next/headers";
import NotificationsBell from "@/components/layout/notifications-bell";
import Sidebar from "@/components/sidebar";
import { redirectIfNoOrg } from "@/lib/app-gate";
import type { TenantScope } from "@/lib/anbar/scope";
import { resolveScope } from "@/lib/anbar/scope";
import { DEFAULT_AFTER_LOGIN, PATHNAME_HEADER } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canReviewExpiry } from "@/lib/labels/expiry";
import { unreadExpiringNotifications } from "@/lib/labels/repository";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";

/** The bell for owners and chefs; nothing for other roles or when it cannot be loaded. */
async function bellFor(scope: TenantScope) {
  try {
    if (!canReviewExpiry(await memberRole(scope))) return null;
    const [notifications, settings] = await Promise.all([unreadExpiringNotifications(scope), getSettings(scope)]);
    if (!notifications.ok) return null;
    return <NotificationsBell items={notifications.value} currency={currencyOf(settings)} />;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const nextPath = headers().get(PATHNAME_HEADER) || DEFAULT_AFTER_LOGIN;
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, nextPath);
  const bell = gated.status === "error" ? null : await bellFor(gated.scope);

  return (
    <div className="min-h-screen bg-bg text-white has-[[data-surface=light]]:bg-[#F5F5F7] print:bg-white">
      <div className="print:hidden">
        <Sidebar bell={bell} />
      </div>
      <main className="px-4 py-8 lg:ml-64 lg:px-10 print:m-0 print:p-0">
        <div className="mx-auto max-w-[390px] lg:max-w-4xl print:max-w-none">{children}</div>
      </main>
    </div>
  );
}
