import { NextResponse } from "next/server";
import type { TenantScope } from "@/lib/anbar/scope";
import { requireTenant } from "@/lib/api/tenant";
import type { PurchasingErrorCode } from "./model";
import type { Result } from "./repository";

/** The caller's tenant scope, or the response to return (401/403/500). */
export async function apiScope(): Promise<{ scope: TenantScope } | { response: NextResponse }> {
  const current = await requireTenant();
  if (current.error || !current.tenantId) {
    return { response: current.error ?? NextResponse.json({ error: "no_tenant" }, { status: 403 }) };
  }
  return { scope: { client: current.supabase, tenantId: current.tenantId } };
}

/** JSON object body; null for anything else. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export const apiError = (error: PurchasingErrorCode, status: number) => NextResponse.json({ error }, { status });

export const invalidInput = () => apiError("invalid_input", 400);

export function resultResponse<T>(result: Result<T>, body: (value: T) => unknown, status = 200) {
  if (!result.ok) {
    if (result.error === "save_failed") console.error("purchasing request failed");
    return apiError(result.error, result.status);
  }
  return NextResponse.json(body(result.value), { status });
}
