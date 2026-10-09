import { isLabelsErrorCode, type LabelsErrorCode } from "./model";

export type LabelsOutcome = { ok: true; data: unknown } | { ok: false; error: LabelsErrorCode };

/** JSON call to a labels route; network failures and unknown errors become save_failed. */
export async function callLabelsApi(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<LabelsOutcome> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const payload: unknown = await response?.json().catch(() => null);
  if (response?.ok) return { ok: true, data: payload };
  const error = typeof payload === "object" && payload !== null ? (payload as { error?: unknown }).error : null;
  return { ok: false, error: isLabelsErrorCode(error) ? error : "save_failed" };
}

/** A field of a JSON object payload. */
export const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
