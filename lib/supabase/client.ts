import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookieStorage } from "./browser-storage";
import { getSupabaseConfig } from "./config";

let instance: SupabaseClient | null = null;

/**
 * The one browser client. The session lives in cookies (see browser-storage.ts) so server
 * components, server actions and middleware read the same session; persistence and token
 * refresh are on. Created lazily so importing this module on the server has no side effects.
 */
export function getBrowserClient(): SupabaseClient {
  if (!instance) {
    const { url, publishableKey, storageKey } = getSupabaseConfig();
    instance = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: cookieStorage,
        storageKey,
      },
    });
  }
  return instance;
}
