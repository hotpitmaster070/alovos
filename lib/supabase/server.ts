import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";
import { readSession } from "./cookie-codec";

export type ServerSupabase = {
  supabase: SupabaseClient;
  /** Verified against the Auth server; never trust anything read from the cookie directly. */
  userId: string | null;
};

/**
 * Per-request client for server components and server actions. It sends the user's access token
 * from the session cookie, so PostgREST applies RLS as that user. It never writes cookies, so it
 * is safe to call from Server Components; middleware.ts refreshes the session before rendering.
 */
export async function createServerSupabase(): Promise<ServerSupabase> {
  const { url, publishableKey, storageKey } = getSupabaseConfig();
  const session = readSession(storageKey, cookies().getAll());

  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: session ? { headers: { Authorization: `Bearer ${session.access_token}` } } : {},
  });

  if (!session) return { supabase, userId: null };

  const { data, error } = await supabase.auth.getUser(session.access_token);
  return { supabase, userId: error || !data.user ? null : data.user.id };
}
