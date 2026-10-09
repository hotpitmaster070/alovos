"use server";

import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH, ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { resolveScope, type TenantScope } from "@/lib/anbar/scope";
import { isUuid, mapCountError, type CountErrorCode } from "./model";

export type CountActionResult = { ok: true; id: string } | { ok: false; error: CountErrorCode };

async function scopeOrError(): Promise<{ scope: TenantScope } | { error: CountErrorCode }> {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return { error: "unauthenticated" };
  if (resolved.status === "no_organization") return { error: "no_tenant" };
  if (resolved.status === "error") return { error: "save_failed" };
  return { scope: resolved.scope };
}

async function run(
  name: string,
  countId: string,
  fn: string,
  args: Record<string, unknown>,
  stockChanged = false,
): Promise<CountActionResult> {
  if (!isUuid(countId)) return { ok: false, error: "invalid_input" };
  const current = await scopeOrError();
  if ("error" in current) return { ok: false, error: current.error };
  const { error } = await current.scope.client.rpc(fn, args);
  if (error) {
    const mapped = mapCountError(error.message ?? "");
    if (mapped.code === "save_failed") console.error(`${name} failed`, error.message);
    return { ok: false, error: mapped.code };
  }
  revalidatePath(ANBAR_COUNT_PATH, "layout");
  if (stockChanged) revalidatePath(ANBAR_APP_PATH, "layout");
  return { ok: true, id: countId };
}

/** Chef/owner: combine everyone's entries (counting -> merging). Stock does not change. */
export async function mergeCountAction(countId: string): Promise<CountActionResult> {
  return run("mergeCountAction", countId, "merge_stock_count", { p_count_id: countId });
}

/** Chef/owner: the only step that changes stock, in one database transaction. */
export async function approveCountAction(countId: string): Promise<CountActionResult> {
  return run("approveCountAction", countId, "approve_stock_count", { p_count_id: countId }, true);
}

/** Chef/owner: drop an open count without touching stock. */
export async function cancelCountAction(countId: string): Promise<CountActionResult> {
  return run("cancelCountAction", countId, "cancel_stock_count", { p_count_id: countId });
}
