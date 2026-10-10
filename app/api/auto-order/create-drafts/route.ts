import { parseBranchId } from "@/lib/auto-order/model";
import { createAutoOrderDrafts } from "@/lib/auto-order/repository";
import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** {branch_id}: one draft per supplier for today; running it again only adds what is new. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const branchId = parseBranchId((await jsonBody(request))?.branch_id);
  if (!branchId) return invalidInput();
  return resultResponse(await createAutoOrderDrafts(current.scope, branchId), (drafts) => ({ drafts }));
}
