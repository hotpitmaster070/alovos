import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { invalidLabelsInput, labelsResponse, serializeLot } from "@/lib/labels/api";
import { validateReceiveLotInput } from "@/lib/labels/model";
import { receiveWithLot } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/**
 * Goods receipt with its lot in one transaction: {product_id, qty, storage_location_id, price?,
 * production_date?, shelf_life_days?, remember?}. shelf_life_days overrides the norm for this
 * delivery; remember stores it as the rule for the product in that place.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateReceiveLotInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const result = await receiveWithLot(current.scope, input.value);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, (lot) => ({ lot: serializeLot(lot) }), 201);
}
