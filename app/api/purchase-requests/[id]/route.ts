import { apiScope, invalidInput, resultResponse } from "@/lib/purchasing/api";
import { isUuid } from "@/lib/purchasing/model";
import { discardPurchaseRequest } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

/** Drops a draft request (owners and chefs). */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidInput();
  return resultResponse(await discardPurchaseRequest(current.scope, params.id), () => ({ ok: true }));
}
