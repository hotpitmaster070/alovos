import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerSupabase = {
  supabase: SupabaseClient;
  /** Verified against the Auth server; never trust anything read from the cookie directly. */
  userId: string | null;
};

function readPublicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("MISSING ENV:", { url: !!url, key: !!key });
    throw new Error("Supabase env is missing. Check .env.local has NEXT_PUBLIC_SUPABASE_URL and ANON_KEY");
  }
  return { url, key };
}

/** Per-request client. Session cookies are the ones @supabase/ssr writes, so RLS sees the same user. */
export function createClient() {
  const { url, key } = readPublicEnv();
  const cookieStore = cookies();

  return createServerClient(url, key, {
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
}

export async function createServerSupabase(): Promise<ServerSupabase> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, userId: error || !data.user ? null : data.user.id };
}
