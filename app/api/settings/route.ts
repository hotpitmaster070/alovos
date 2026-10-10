import { NextResponse } from "next/server";
import { memberRole } from "@/lib/count/load";
import { apiError, apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { canInvite } from "@/lib/purchasing/model";
import { parseSmartSettingsPatch } from "@/lib/smart-settings/model";
import { getSmartSettings, updateSmartSettings } from "@/lib/smart-settings/repository";

export const dynamic = "force-dynamic";

/** The restaurant's limits, loss alert and auto-order settings. */
export async function GET() {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const settings = await getSmartSettings(current.scope);
  return settings ? NextResponse.json({ settings }) : apiError("save_failed", 503);
}

/**
 * Owner: {low_stock_default?, loss_alert_percent?, loss_alert_enabled?, auto_order_enabled?, auto_order_draft_time?,
 * auto_order_time?, auto_send_if_not_confirmed?, auto_order_notify?}; the draft time may not be after the deadline.
 */
export async function PUT(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!canInvite(await memberRole(current.scope))) return apiError("forbidden", 403);
  const patch = parseSmartSettingsPatch(await jsonBody(request));
  if (!patch) return invalidInput();
  return resultResponse(await updateSmartSettings(current.scope, patch), (settings) => ({ settings }));
}
