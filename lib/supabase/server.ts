import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export type ServerSupabase = {
  supabase: SupabaseClient;
  /** Verified against the Auth server; never trust anything read from the cookie directly. */
  userId: string | null;
};

/**
 * Per-request client for server components and server actions.
 * The session comes from the request cookies via @supabase/ssr, so PostgREST applies RLS
 * as that user. Cookie writes are attempted for route handlers; Server Components ignore
 * the refresh write because middleware already stored it.
 */
export async function createServerSupabase(): Promise<ServerSupabase> {
  const cookieStore = cookies();
  const { url, anonKey } = getSupabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. middleware.ts refreshes the session.
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  return { supabase, userId: error || !data.user ? null : data.user.id };
}
