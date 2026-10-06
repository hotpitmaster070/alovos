export type SupabaseConfig = {
  url: string;
  publishableKey: string;
  storageKey: string;
};

/** Same default key that supabase-js and @supabase/ssr derive from the project URL. */
export const getStorageKey = (url: string): string =>
  `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return { url, publishableKey, storageKey: getStorageKey(url) };
}
