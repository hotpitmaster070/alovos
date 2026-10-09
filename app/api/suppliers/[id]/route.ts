import { apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { isUuid, validateSupplierPatch } from "@/lib/purchasing/model";
import { updateSupplier } from "@/lib/purchasing/repository";
import { serializeSupplier } from "@/lib/purchasing/serialize";

export const dynamic = "force-dynamic";

/** Edits a supplier or (is_active: false) deactivates it; products keep their supplier link. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidInput();
  const body = await jsonBody(request);
  const patch = body ? validateSupplierPatch(body) : null;
  if (!patch?.ok) return invalidInput();
  return resultResponse(await updateSupplier(current.scope, params.id, patch.value), (supplier) => ({
    supplier: serializeSupplier(supplier),
  }));
}
