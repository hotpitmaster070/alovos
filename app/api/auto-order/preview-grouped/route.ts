import { parseBranchId, supplierCount } from "@/lib/auto-order/model";
import { autoOrderPreview } from "@/lib/auto-order/repository";
import { apiScope, invalidInput, resultResponse } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** ?branch_id= : what is below its minimum and how much to order, per supplier (no supplier last). */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const branchId = parseBranchId(new URL(request.url).searchParams.get("branch_id"));
  if (!branchId) return invalidInput();
  return resultResponse(await autoOrderPreview(current.scope, branchId), (groups) => ({ suppliers: supplierCount(groups), groups }));
}
