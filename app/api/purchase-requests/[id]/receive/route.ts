import { apiScope, invalidInput, resultResponse } from "@/lib/purchasing/api";
import { isUuid } from "@/lib/purchasing/model";
import { receivePurchaseRequest } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

/** The goods of a sent request arrived; its products are no longer counted as on order. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidInput();
  return resultResponse(await receivePurchaseRequest(current.scope, params.id), () => ({ ok: true }));
}
