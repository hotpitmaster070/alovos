export type SupabaseConfig = {
  url: string;
  publishableKey: string;
  storageKey: string;
};

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** Thrown when the public Supabase env is absent or not a usable URL. Callers must not turn this into an organization error. */
export class SupabaseConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[], message: string) {
    super(message);
    this.name = "SupabaseConfigError";
    this.missing = missing;
  }
}

export const isSupabaseConfigError = (error: unknown): error is SupabaseConfigError =>
  error instanceof SupabaseConfigError ||
  (error instanceof Error && error.name === "SupabaseConfigError");

/** Same default key that supabase-js and @supabase/ssr derive from the project URL. */
export const getStorageKey = (url: string): string =>
  `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

const readEnv = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

const parseHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = readEnv(SUPABASE_URL_ENV);
  const publishableKey = readEnv(SUPABASE_PUBLISHABLE_KEY_ENV);
  const missing = [
    url ? null : SUPABASE_URL_ENV,
    publishableKey ? null : SUPABASE_PUBLISHABLE_KEY_ENV,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new SupabaseConfigError(
      missing,
      `Supabase is not configured. Set ${missing.join(", ")} in .env.local.`,
    );
  }

  const parsed = parseHttpUrl(url);
  if (!parsed) {
    throw new SupabaseConfigError(
      [SUPABASE_URL_ENV],
      `Supabase is not configured. ${SUPABASE_URL_ENV} must be an absolute http(s) URL.`,
    );
  }

  return { url, publishableKey, storageKey: getStorageKey(url) };
}
