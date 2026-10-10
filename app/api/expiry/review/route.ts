import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH, CHEF_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { forbidUnlessExpiryReviewer, invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { parseReviewBody } from "@/lib/labels/expiry";
import { isUuid } from "@/lib/labels/model";
import { reviewBatchAction } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** {lot_id, action, note?, new_expiry?}: the chef's or owner's decision on one lot. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const forbidden = await forbidUnlessExpiryReviewer(current.scope);
  if (forbidden) return forbidden;
  const body = await jsonBody(request);
  const input = body ? parseReviewBody(body) : null;
  if (!input || !isUuid(input.lotId)) return invalidLabelsInput();
  const result = await reviewBatchAction(current.scope, input);
  if (result.ok) {
    revalidatePath(ANBAR_APP_PATH, "layout");
    revalidatePath(CHEF_DASHBOARD_PATH);
  }
  return labelsResponse(result, (id) => ({ ok: true, id }), 201);
}
