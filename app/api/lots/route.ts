import { invalidLabelsInput, labelsResponse, serializeLot } from "@/lib/labels/api";
import { validateLotInput } from "@/lib/labels/model";
import { createLot } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/**
 * A lot (label) for stock already on the shelf: {product_id, qty, storage_location_id,
 * production_date?, lot_type?}. Expiry = production date + public.get_shelf_life(); no stock movement.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateLotInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  return labelsResponse(await createLot(current.scope, input.value), (lot) => ({ lot: serializeLot(lot) }), 201);
}
