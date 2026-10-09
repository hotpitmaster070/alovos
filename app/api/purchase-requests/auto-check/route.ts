import { apiScope, resultResponse } from "@/lib/purchasing/api";
import { runAutoCheck } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

/** Runs check_and_create_auto_requests() for the caller's tenant (owners and chefs). */
export async function POST() {
  const current = await apiScope();
  if ("response" in current) return current.response;
  return resultResponse(await runAutoCheck(current.scope), (changed) => ({ changed }));
}
