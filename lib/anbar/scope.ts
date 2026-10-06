import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Proof that the organization id was resolved on the server for the verified user. Repository
 * functions only accept this type, so every query is built with the organization filter.
 */
export type OrgScope = {
  readonly client: SupabaseClient;
  readonly orgId: string;
};

export type ScopeResult =
  | { status: "unauthenticated" }
  | { status: "error" }
  | { status: "ok"; scope: OrgScope };

/** Resolves user + organization once per request/action. Never reads the org id from client input. */
export async function resolveScope(): Promise<ScopeResult> {
  try {
    const { supabase, userId } = await createServerSupabase();
    if (!userId) return { status: "unauthenticated" };
    const orgId = await getOrgId(supabase);
    return { status: "ok", scope: { client: supabase, orgId } };
  } catch (error) {
    console.error("resolveScope failed", error instanceof Error ? error.message : "unknown");
    return { status: "error" };
  }
}
