import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { isUuid, validateRequestItems } from "@/lib/purchasing/model";
import { sendPurchaseRequest } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

/** Approves a draft and marks it sent: {items?: [{product_id, qty}]} replaces the quantities. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidInput();
  const body = (await jsonBody(request)) ?? {};
  let items: { product_id: string; qty: number }[] | null = null;
  if (body.items !== undefined) {
    const parsed = validateRequestItems(body.items);
    if (!parsed.ok) return invalidInput();
    items = parsed.value;
  }
  return resultResponse(await sendPurchaseRequest(current.scope, params.id, items), () => ({ ok: true }));
}
