import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { isUuid } from "@/lib/labels/model";
import { apiScope } from "@/lib/purchasing/api";
import { reviewWastePhoto } from "@/lib/waste/load";

export const dynamic = "force-dynamic";

/** Owners and chefs: a suspicious waste log has been looked at. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidLabelsInput();
  const result = await reviewWastePhoto(current.scope, params.id);
  return labelsResponse(result, () => ({ ok: true }));
}
