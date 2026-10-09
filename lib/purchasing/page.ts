import type { TenantScope } from "@/lib/anbar/scope";
import { resolveScope } from "@/lib/anbar/scope";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { memberRole } from "@/lib/count/load";

/** Tenant scope and member role for a purchasing page; redirects to login or onboarding. */
export async function purchasingPageScope(path: string): Promise<{ scope: TenantScope; role: string | null }> {
  const gated = redirectIfNoOrg(await resolveScope(), path);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  return { scope: gated.scope, role: await memberRole(gated.scope) };
}
