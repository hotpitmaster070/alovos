import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgErrorCode = "not_authenticated" | "rpc_failed" | "no_organization";

export class OrgError extends Error {
  readonly code: OrgErrorCode;

  constructor(code: OrgErrorCode, message: string) {
    super(message);
    this.name = "OrgError";
    this.code = code;
  }
}

const asId = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * Returns the caller's tenant id from public.current_tenant_id(): profiles.tenant_id, only while the
 * user has a membership in it. Without one (failed signup trigger, removed from the team)
 * ensure_my_tenant() provisions a tenant of their own and returns its id. Errors are never swallowed.
 */
export async function getTenantId(client: SupabaseClient): Promise<string> {
  const current = await client.rpc("current_tenant_id");
  if (current.error) throw new OrgError("rpc_failed", current.error.message);

  const existing = asId(current.data);
  if (existing) return existing;

  const ensured = await client.rpc("ensure_my_tenant");
  if (ensured.error) {
    const notAuthenticated = ensured.error.message.includes("not authenticated");
    throw new OrgError(notAuthenticated ? "not_authenticated" : "rpc_failed", ensured.error.message);
  }
  const created = asId(ensured.data);
  if (!created) throw new OrgError("no_organization", "ensure_my_tenant returned no id");
  return created;
}
