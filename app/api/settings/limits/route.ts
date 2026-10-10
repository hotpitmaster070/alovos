import { parseBranchId } from "@/lib/auto-order/model";
import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { parseLimitChanges } from "@/lib/smart-settings/model";
import { saveStockLimits, stockLimits } from "@/lib/smart-settings/repository";

export const dynamic = "force-dynamic";

/** ?branch_id= : every product with its stock there and the minimum it inherits (owners and chefs). */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const raw = new URL(request.url).searchParams.get("branch_id");
  const branchId = raw ? parseBranchId(raw) : null;
  if (raw && !branchId) return invalidInput();
  return resultResponse(await stockLimits(current.scope, branchId), (rows) => ({ rows }));
}

/** {branch_id?, items: [{product_id, min_stock?, branch_min?}]}: null clears a level so the next one applies. */
export async function PUT(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const parsed = parseLimitChanges(await jsonBody(request));
  if (!parsed) return invalidInput();
  return resultResponse(await saveStockLimits(current.scope, parsed.branchId, parsed.items), (saved) => ({ saved }));
}
