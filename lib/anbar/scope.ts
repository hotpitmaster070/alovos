import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantId, OrgError } from "@/lib/org";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Proof that the tenant id was resolved on the server for the verified user through
 * public.current_tenant_id(). Repository functions only accept this type, so every query is built
 * with the tenant filter.
 */
export type TenantScope = {
  readonly client: SupabaseClient;
  readonly tenantId: string;
};

export type ScopeResult =
  | { status: "unauthenticated" }
  | { status: "no_organization" }
  | { status: "error"; cause: unknown }
  | { status: "ok"; scope: TenantScope };

/**
 * Resolves user + tenant once per request. Never reads the tenant id from client input.
 * A missing Supabase configuration is not a tenant failure and is rethrown.
 */
export const resolveScope = cache(async (): Promise<ScopeResult> => {
  const { supabase, userId } = await createServerSupabase();
  if (!userId) return { status: "unauthenticated" };

  try {
    const tenantId = await getTenantId(supabase);
    return { status: "ok", scope: { client: supabase, tenantId } };
  } catch (error) {
    if (error instanceof OrgError && error.code === "no_organization") {
      return { status: "no_organization" };
    }
    console.error("resolveScope failed", error instanceof Error ? error.message : "unknown");
    return { status: "error", cause: error };
  }
});
