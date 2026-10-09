import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { isUuid, validateLimitsInput } from "@/lib/purchasing/model";
import { setProductLimits } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

/**
 * Chef/owner sets a product's limits in its own unit: {par_level, min_stock, supplier_id}. Empty values
 * clear a limit; min_stock without a value falls back to the tenant's low-stock default.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidInput();
  const body = await jsonBody(request);
  const input = body ? validateLimitsInput(body) : null;
  if (!input?.ok) return invalidInput();
  return resultResponse(await setProductLimits(current.scope, params.id, input.value), () => ({ ok: true }));
}
