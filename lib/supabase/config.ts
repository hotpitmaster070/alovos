export type SupabaseConfig = {
  url: string;
  anonKey: string;
  storageKey: string;
};

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

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

/**
 * Static property access is required. Next.js only inlines NEXT_PUBLIC_* into the browser
 * bundle for direct reads; process.env[name] is empty on the client even when .env.local is loaded.
 */
const readEnv = (name: string): string => {
  const value =
    name === SUPABASE_URL_ENV
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : name === SUPABASE_ANON_KEY_ENV
        ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        : undefined;
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
  const anonKey = readEnv(SUPABASE_ANON_KEY_ENV);
  const missing = [
    url ? null : SUPABASE_URL_ENV,
    anonKey ? null : SUPABASE_ANON_KEY_ENV,
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

  return { url, anonKey, storageKey: getStorageKey(url) };
}
