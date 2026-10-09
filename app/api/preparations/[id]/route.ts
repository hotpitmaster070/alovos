import { invalidLabelsInput, labelsResponse, serializePreparation } from "@/lib/labels/api";
import { isUuid, validatePreparationDraft, type PreparationDraft } from "@/lib/labels/model";
import { updatePreparation } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** Owners and chefs: a full recipe {name, inputs, outputs} and/or {is_active}. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidLabelsInput();
  const body = await jsonBody(request);
  if (!body) return invalidLabelsInput();
  let draft: PreparationDraft | undefined;
  if ("name" in body || "inputs" in body || "outputs" in body) {
    const validated = validatePreparationDraft(body);
    if (!validated.ok) return invalidLabelsInput();
    draft = validated.value;
  }
  if ("is_active" in body && typeof body.is_active !== "boolean") return invalidLabelsInput();
  const active = typeof body.is_active === "boolean" ? body.is_active : undefined;
  if (!draft && active === undefined) return invalidLabelsInput();
  return labelsResponse(await updatePreparation(current.scope, params.id, { draft, active }), (preparation) => ({
    preparation: serializePreparation(preparation),
  }));
}
