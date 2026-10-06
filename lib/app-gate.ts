import { redirect } from "next/navigation";
import { loginPath, onboardingPath } from "@/lib/auth-redirect";
import type { ScopeResult } from "@/lib/anbar/scope";

type GatedScope = Extract<ScopeResult, { status: "ok" } | { status: "error" }>;

/**
 * No session goes to login. A verified session whose organization could not be recovered
 * goes to onboarding. Login is not used for that case: the login page sends a verified
 * session straight back into the app, which would loop.
 */
export function redirectIfNoOrg(resolved: ScopeResult, nextPath: string): GatedScope {
  if (resolved.status === "unauthenticated") redirect(loginPath(nextPath));
  if (resolved.status === "no_organization") redirect(onboardingPath(nextPath));
  return resolved;
}
