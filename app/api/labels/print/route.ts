import { invalidLabelsInput, labelsResponse, serializeLot } from "@/lib/labels/api";
import { validatePrintInput } from "@/lib/labels/model";
import { lotsByIds, printLabels } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** Logs a print of {lot_ids, copies} and returns the lots to render; the browser prints them. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validatePrintInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const logged = await printLabels(current.scope, input.value.lotIds, input.value.copies);
  if (!logged.ok) return labelsResponse(logged, () => null);
  const lots = await lotsByIds(current.scope, input.value.lotIds);
  return labelsResponse({ ok: true, value: lots }, (found) => ({
    logged: logged.value,
    copies: input.value.copies,
    lots: found.map(serializeLot),
  }));
}
