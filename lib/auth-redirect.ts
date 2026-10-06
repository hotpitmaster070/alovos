export const ANBAR_APP_PATH = "/app/anbar";
export const ANBAR_CATALOG_PATH = `${ANBAR_APP_PATH}/kataloq`;
export const DEFAULT_AFTER_LOGIN = ANBAR_APP_PATH;
export const LOGIN_PATH = "/login";
export const ONBOARDING_PATH = "/onboarding";

/** Request header set by middleware so server layouts know the path they are rendering. */
export const PATHNAME_HEADER = "x-alovos-path";

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
    if (url.pathname === LOGIN_PATH || url.pathname === ONBOARDING_PATH) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function requestPathname(nextPath: string): string {
  try {
    return new URL(nextPath, PROBE_ORIGIN).pathname;
  } catch {
    return ANBAR_APP_PATH;
  }
}

export function loginPath(nextPath: string): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}

export function onboardingPath(nextPath: string): string {
  return `${ONBOARDING_PATH}?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
