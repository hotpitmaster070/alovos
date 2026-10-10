import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { forbidUnlessExpiryReviewer, invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { isUuid } from "@/lib/labels/model";
import { writeOffExpired } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** {stock_id}: the whole expired stock row is written off as waste (reason expired) in one transaction; owners and chefs. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const forbidden = await forbidUnlessExpiryReviewer(current.scope);
  if (forbidden) return forbidden;
  const body = await jsonBody(request);
  if (!body || !isUuid(body.stock_id)) return invalidLabelsInput();
  const result = await writeOffExpired(current.scope, body.stock_id);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, (id) => ({ ok: true, id }), 201);
}
