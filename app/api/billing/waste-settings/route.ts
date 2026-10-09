import { revalidatePath } from "next/cache";
import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { apiScope, jsonBody } from "@/lib/purchasing/api";
import { setWasteSettings } from "@/lib/waste/load";
import { validateWasteSettings, type WasteAiState } from "@/lib/waste/plan";

export const dynamic = "force-dynamic";

const serialize = (state: WasteAiState) => ({
  photo_enabled: state.photoEnabled,
  ai_enabled: state.aiEnabled,
  plan: state.plan,
  used: state.used,
  ai_limit: state.limit,
  tolerance_percent: state.tolerancePercent,
});

/** Owner: {photo_enabled?, ai_enabled?, tolerance_percent?}; absent keeps a value. */
export async function PATCH(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateWasteSettings(body) : null;
  if (!input) return invalidLabelsInput();
  const result = await setWasteSettings(current.scope, input);
  if (result.ok) revalidatePath("/app", "layout");
  return labelsResponse(result, serialize);
}
