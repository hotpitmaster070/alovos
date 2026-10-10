import { NextResponse } from "next/server";
import { parseSendAllBody } from "@/lib/auto-order/model";
import { sendDrafts } from "@/lib/auto-order/send";
import { apiError, apiScope, invalidInput, jsonBody } from "@/lib/purchasing/api";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { memberRole } from "@/lib/count/load";

export const dynamic = "force-dynamic";

/** {ids?: uuid[]}: sends the drafts (all without ids) and returns each supplier's message with WhatsApp / email links. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!canManagePurchasing(await memberRole(current.scope))) return apiError("forbidden", 403);
  const body = parseSendAllBody(await jsonBody(request));
  if (!body) return invalidInput();
  const result = await sendDrafts(current.scope, body.ids);
  if (result.sent.length === 0 && result.failed.length > 0) return apiError(result.failed[0].error, 409);
  return NextResponse.json(result);
}
