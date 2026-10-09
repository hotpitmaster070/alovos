import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only (route handlers): client with the service_role key, for the functions clients must not call (AI verdicts).
 * Null when SUPABASE_SERVICE_ROLE_KEY is not set; callers then skip those steps.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
