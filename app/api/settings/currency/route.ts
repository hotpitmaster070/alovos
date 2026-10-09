import { revalidatePath } from "next/cache";
import { setTenantCurrency } from "@/lib/currency/load";
import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { apiScope, jsonBody } from "@/lib/purchasing/api";
import { validateCurrencyCode } from "@/lib/tenant-settings/validation";

export const dynamic = "force-dynamic";

/** Owner: {code} -> the restaurant's currency. Stored amounts keep their numbers. */
export async function PATCH(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = (await jsonBody(request)) as { code?: unknown } | null;
  const code = validateCurrencyCode(body?.code);
  if (!code) return invalidLabelsInput();
  const result = await setTenantCurrency(current.scope, code);
  if (result.ok) revalidatePath("/", "layout");
  return labelsResponse(result, (value) => ({ ok: true, code: value.code }));
}
