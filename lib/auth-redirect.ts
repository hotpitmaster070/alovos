export const DEFAULT_AFTER_LOGIN = "/app/anbar";
export const LOGIN_PATH = "/login";

const PROBE_ORIGIN = "http://redirect-probe.invalid";

/**
 * Accepts only same-origin relative paths ("/app/anbar?x=1"). Anything else (absolute URLs,
 * protocol-relative "//host", backslash tricks, control characters) falls back to the default.
 */
export function safeNextPath(
  raw: string | string[] | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;

  try {
    const url = new URL(value, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
