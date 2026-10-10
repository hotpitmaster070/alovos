import { parseExtraBody } from "@/lib/auto-order/model";
import { addPurchaseRequestExtra } from "@/lib/auto-order/repository";
import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { isUuid } from "@/lib/purchasing/model";

export const dynamic = "force-dynamic";

/** {product_id, qty}: adds to a draft; a product not in it yet comes in marked extra. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = parseExtraBody(await jsonBody(request));
  if (!isUuid(params.id) || !body) return invalidInput();
  return resultResponse(await addPurchaseRequestExtra(current.scope, params.id, body.productId, body.qty), () => ({ ok: true }));
}
