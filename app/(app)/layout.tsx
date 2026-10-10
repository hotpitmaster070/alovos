import { headers } from "next/headers";
import Sidebar from "@/components/sidebar";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { resolveScope } from "@/lib/anbar/scope";
import { DEFAULT_AFTER_LOGIN, PATHNAME_HEADER } from "@/lib/auth-redirect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const nextPath = headers().get(PATHNAME_HEADER) || DEFAULT_AFTER_LOGIN;
  const resolved = await resolveScope();
  redirectIfNoOrg(resolved, nextPath);

  return (
    <div className="min-h-screen bg-bg text-white has-[[data-surface=light]]:bg-[#F5F5F7] print:bg-white">
      <div className="print:hidden">
        <Sidebar />
      </div>
      <main className="px-4 py-8 lg:ml-64 lg:px-10 print:m-0 print:p-0">
        <div className="mx-auto max-w-[390px] lg:max-w-4xl print:max-w-none">{children}</div>
      </main>
    </div>
  );
}
