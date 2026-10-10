import { forbidUnlessExpiryReviewer, invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { NOTIFICATIONS_SHOWN } from "@/lib/labels/expiry";
import { isUuid } from "@/lib/labels/model";
import { markExpiringRead } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** {ids?}: marks those (or all) unread "expiring soon" notifications read; owners and chefs. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const forbidden = await forbidUnlessExpiryReviewer(current.scope);
  if (forbidden) return forbidden;
  const body = await jsonBody(request);
  const ids = body?.ids ?? null;
  if (ids !== null && (!Array.isArray(ids) || ids.length === 0 || ids.length > NOTIFICATIONS_SHOWN || !ids.every(isUuid))) {
    return invalidLabelsInput();
  }
  const result = await markExpiringRead(current.scope, ids);
  return labelsResponse(result, (count) => ({ ok: true, count }));
}
