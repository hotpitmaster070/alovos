import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { invalidLabelsInput, labelsResponse, serializeLot } from "@/lib/labels/api";
import { validatePreparationRunInput } from "@/lib/labels/model";
import { createLotsFromPreparation } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/**
 * Runs a recipe: {preparation_id, source_qty, storage_location_id, source_location_id?, outputs?}.
 * Inputs are written off (from source_location_id, else the place holding enough of the first input),
 * each output is received with its own expiry and gets a lot. outputs [{product_id, qty,
 * storage_location_id?}] are the actual yields; omitted -> the recipe scaled. trims [{product_id, qty,
 * note?, storage_location_id?}] is usable trim returned to stock as trim lots (net use = taken - trim).
 * All or nothing.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validatePreparationRunInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const result = await createLotsFromPreparation(current.scope, input.value);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, (lots) => ({ lots: lots.map(serializeLot) }), 201);
}
