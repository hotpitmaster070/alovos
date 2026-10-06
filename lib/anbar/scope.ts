import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId, OrgError } from "@/lib/org";
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
  | { status: "no_organization" }
  | { status: "error"; cause: unknown }
  | { status: "ok"; scope: OrgScope };

/**
 * Resolves user + organization once per request. Never reads the org id from client input.
 * A missing Supabase configuration is not an organization failure and is rethrown.
 */
export const resolveScope = cache(async (): Promise<ScopeResult> => {
  const { supabase, userId } = await createServerSupabase();
  if (!userId) return { status: "unauthenticated" };

  try {
    const orgId = await getOrgId(supabase);
    return { status: "ok", scope: { client: supabase, orgId } };
  } catch (error) {
    if (error instanceof OrgError && error.code === "no_organization") {
      return { status: "no_organization" };
    }
    console.error("resolveScope failed", error instanceof Error ? error.message : "unknown");
    return { status: "error", cause: error };
  }
});
