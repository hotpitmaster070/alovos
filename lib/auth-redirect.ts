export const ANBAR_APP_PATH = "/app/anbar";
export const ANBAR_CATALOG_PATH = `${ANBAR_APP_PATH}/kataloq`;
export const ANBAR_MOVEMENTS_PATH = `${ANBAR_APP_PATH}/movements`;
export const ANBAR_COUNT_PATH = `${ANBAR_APP_PATH}/sayim`;
export const ANBAR_RECEIPT_PATH = `${ANBAR_APP_PATH}/qebul`;
export const ANBAR_IMPORT_PATH = `${ANBAR_APP_PATH}/import`;
export const ANBAR_STORAGE_PATH = `${ANBAR_APP_PATH}/saxlama`;
export const SETTINGS_PATH = "/app/sebeke";
export const SUPPLIERS_PATH = `${SETTINGS_PATH}/tedarikciler`;
export const INVITE_PATH = `${SETTINGS_PATH}/davet`;
export const OWNER_PATH = `${SETTINGS_PATH}/dashboard`;
export const BILLING_PATH = `${SETTINGS_PATH}/billing`;
export const ORDERS_PATH = "/app/sifarisler";
export const ZAQOTOVKA_PATH = "/app/zaqotovka";
export const WASTE_PATH = "/app/tullanti";
export const KITCHEN_STOCK_PATH = "/app/menim-isim";
export const OWNER_DASHBOARD_PATH = "/app/owner";
export const COOK_WASTE_PATH = "/app/povar/wastage";
export const CHEF_WASTE_PATH = "/app/chef/wastage";
export const CHEF_INVENTORY_PATH = "/app/chef/inventory";
export const COOK_TASKS_PATH = "/app/povar/tasks";
export const DISCREPANCIES_PATH = `${ANBAR_APP_PATH}/discrepancies`;
export const OWNER_DISCREPANCIES_PATH = "/app/owner/discrepancies";
export const CHEF_RECEIVING_PATH = "/app/chef/receiving";
export const ANBAR_RECEIVING_PATH = `${ANBAR_APP_PATH}/receiving`;
export const CHEF_RECIPES_PATH = "/app/chef/recipes";
export const RECIPES_PATH = "/app/reseptler";
export const DEFAULT_AFTER_LOGIN = ANBAR_CATALOG_PATH;
export const LOGIN_PATH = "/login";
export const REGISTER_PATH = "/register";
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

export function registerPath(nextPath: string, inviteToken: string | null = null): string {
  const invite = inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : "";
  return `${REGISTER_PATH}?next=${encodeURIComponent(safeNextPath(nextPath))}${invite}`;
}

export function onboardingPath(nextPath: string): string {
  return `${ONBOARDING_PATH}?next=${encodeURIComponent(safeNextPath(nextPath))}`;
}
