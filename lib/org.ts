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
 * Returns the caller's organization id. Works with the browser client and with the server client.
 * Reads it with public.current_org_id() and, when the user has no profile or no organization yet
 * (failed signup trigger), recovers through ensure_my_organization(). Errors are never swallowed.
 */
export async function getOrgId(client: SupabaseClient): Promise<string> {
  const current = await client.rpc("current_org_id");
  if (current.error) throw new OrgError("rpc_failed", current.error.message);

  const existing = asId(current.data);
  if (existing) return existing;

  const ensured = await client.rpc("ensure_my_organization");
  if (ensured.error) {
    const notAuthenticated = ensured.error.message.includes("not authenticated");
    throw new OrgError(notAuthenticated ? "not_authenticated" : "rpc_failed", ensured.error.message);
  }
  const created = asId(ensured.data);
  if (!created) throw new OrgError("no_organization", "ensure_my_organization returned no id");
  return created;
}
