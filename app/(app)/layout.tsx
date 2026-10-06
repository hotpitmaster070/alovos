import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import {
  DEFAULT_AFTER_LOGIN,
  isPublicAnbarPath,
  onboardingPath,
  PATHNAME_HEADER,
  requestPathname,
} from "@/lib/auth-redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const nextPath = headers().get(PATHNAME_HEADER) || DEFAULT_AFTER_LOGIN;
  const pathname = requestPathname(nextPath);
  const resolved = await resolveScope();
  if (isPublicAnbarPath(pathname)) {
    if (resolved.status === "no_organization") redirect(onboardingPath(nextPath));
  } else {
    redirectIfNoOrg(resolved, nextPath);
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <Sidebar />
      <main className="px-4 py-8 lg:ml-64 lg:px-10">
        <div className="mx-auto max-w-[390px] lg:max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
