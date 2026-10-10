import { isPurchasingErrorCode, type PurchasingErrorCode } from "./model";

export type ApiOutcome = { ok: true; data: unknown } | { ok: false; error: PurchasingErrorCode };

/** JSON call to a purchasing route; network failures and unknown errors become save_failed. */
export async function callPurchasingApi(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<ApiOutcome> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const payload: unknown = await response?.json().catch(() => null);
  if (response?.ok) return { ok: true, data: payload };
  const error = typeof payload === "object" && payload !== null ? (payload as { error?: unknown }).error : null;
  return { ok: false, error: isPurchasingErrorCode(error) ? error : "save_failed" };
}
