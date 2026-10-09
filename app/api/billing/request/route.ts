import { revalidatePath } from "next/cache";
import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { apiScope, jsonBody } from "@/lib/purchasing/api";
import { requestBillingPlan } from "@/lib/waste/load";

export const dynamic = "force-dynamic";

/** Owner: {plan_code} -> an open plan request (activated by the platform after payment). */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = (await jsonBody(request)) as { plan_code?: unknown } | null;
  const planCode = typeof body?.plan_code === "string" ? body.plan_code.trim() : "";
  if (!/^[a-z0-9_]{1,40}$/.test(planCode)) return invalidLabelsInput();
  const result = await requestBillingPlan(current.scope, planCode);
  if (result.ok) revalidatePath("/app", "layout");
  return labelsResponse(result, (value) => ({ ok: true, id: value.id, plan_code: value.planCode }), 201);
}
