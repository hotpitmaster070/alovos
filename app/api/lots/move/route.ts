import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { invalidLabelsInput, labelsResponse, serializeLot } from "@/lib/labels/api";
import { validateMoveLotInput } from "@/lib/labels/model";
import { moveStockLot } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/**
 * Moves one stock lot to another place of its branch: {stock_id, to_location_id, qty?, shelf_life_days?,
 * remember?, reason?}. Into another kind of place the expiry restarts from today with the target norm
 * (or shelf_life_days); remember stores that as the rule. Returns the new label, null without an expiry.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateMoveLotInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const result = await moveStockLot(current.scope, input.value);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, (lot) => ({ lot: lot && serializeLot(lot) }));
}
