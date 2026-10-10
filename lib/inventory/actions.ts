"use server";

import { revalidatePath } from "next/cache";
import { resolveScope, type TenantScope } from "@/lib/anbar/scope";
import { isStorageType, type StorageType } from "@/lib/anbar/types";
import {
  ANBAR_APP_PATH,
  CHEF_INVENTORY_PATH,
  COOK_TASKS_PATH,
  DISCREPANCIES_PATH,
  OWNER_DASHBOARD_PATH,
} from "@/lib/auth-redirect";
import { zonesByBranch } from "./load";
import {
  COUNT_MAX_QUANTITY,
  isUuid,
  mapInventoryError,
  num,
  TASK_TITLE_MAX,
  type InventoryErrorCode,
  type Zone,
} from "./model";
import {
  isDiscrepancyReason,
  isInventoryMode,
  PARALLEL_MAX_COUNTERS,
  PARALLEL_MIN_COUNTERS,
  type DiscrepancyReason,
  type InventoryMode,
} from "./modes";

type Failure = { ok: false; error: InventoryErrorCode };
export type ActionResult<T = null> = { ok: true; value: T } | Failure;

async function scopeOrError(): Promise<{ scope: TenantScope } | Failure> {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return { ok: false, error: "unauthenticated" };
  if (resolved.status === "no_organization") return { ok: false, error: "no_tenant" };
  if (resolved.status === "error") return { ok: false, error: "save_failed" };
  return { scope: resolved.scope };
}

async function rpc<T>(name: string, args: Record<string, unknown>, pick: (data: unknown) => T): Promise<ActionResult<T>> {
  const current = await scopeOrError();
  if ("ok" in current) return current;
  const { data, error } = await current.scope.client.rpc(name, args);
  if (error) {
    const code = mapInventoryError(error.message ?? "");
    if (code === "save_failed") console.error(`${name} failed`, error.message);
    return { ok: false, error: code };
  }
  return { ok: true, value: pick(data) };
}

function revalidateInventory() {
  revalidatePath(CHEF_INVENTORY_PATH, "layout");
  revalidatePath(COOK_TASKS_PATH, "layout");
  revalidatePath(DISCREPANCIES_PATH);
}

export type NewTaskInput = {
  branchId: string;
  mode: InventoryMode;
  title: string;
  scheduledAt: string | null;
  assignments: { zoneId: string; assigneeId: string }[];
};

export async function createInventoryTaskAction(input: NewTaskInput): Promise<ActionResult<string>> {
  const title = typeof input?.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  const pairs = Array.isArray(input?.assignments) ? input.assignments : [];
  const scheduled = input?.scheduledAt ? new Date(input.scheduledAt) : null;
  if (
    !isUuid(input?.branchId) ||
    !isInventoryMode(input?.mode) ||
    title.length === 0 ||
    title.length > TASK_TITLE_MAX ||
    pairs.length === 0 ||
    pairs.length > 50 ||
    pairs.some((pair) => !isUuid(pair?.zoneId) || !isUuid(pair?.assigneeId)) ||
    (scheduled !== null && Number.isNaN(scheduled.getTime()))
  ) {
    return { ok: false, error: "invalid_input" };
  }
  if (input.mode === "control_parallel" && (pairs.length < PARALLEL_MIN_COUNTERS || pairs.length > PARALLEL_MAX_COUNTERS)) {
    return { ok: false, error: "invalid_input" };
  }
  const result = await rpc(
    "create_inventory_task",
    {
      p_branch_id: input.branchId,
      p_mode: input.mode,
      p_title: title,
      p_assignments: pairs.map((pair) => ({ zone_id: pair.zoneId, assignee_id: pair.assigneeId })),
      p_scheduled_at: scheduled?.toISOString() ?? null,
    },
    (data) => String(data),
  );
  if (result.ok) revalidateInventory();
  return result;
}

/** A new storage place of the branch, straight from the task dialog. */
export async function addZoneAction(branchId: string, type: StorageType, name: string): Promise<ActionResult<Zone>> {
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!isUuid(branchId) || !isStorageType(type) || clean.length === 0 || clean.length > 80) {
    return { ok: false, error: "invalid_input" };
  }
  const result = await rpc(
    "create_storage_locations_bulk",
    { p_branch_id: branchId, p_type: type, p_count: 1, p_number: null, p_name: clean, p_name_prefix: null },
    (data) => {
      const row = (Array.isArray(data) ? data[0] : data) as { id?: unknown; name?: unknown; type?: unknown } | null;
      return row && isUuid(row.id) ? { id: row.id, name: String(row.name ?? clean), type: isStorageType(String(row.type)) ? (row.type as StorageType) : type } : null;
    },
  );
  if (!result.ok) return result;
  if (!result.value) return { ok: false, error: "save_failed" };
  revalidatePath(ANBAR_APP_PATH, "layout");
  return { ok: true, value: result.value };
}

/** The branch's four default zones (ensure_default_zones), then its zones as they are now. */
export async function createDefaultZonesAction(branchId: string): Promise<ActionResult<Zone[]>> {
  if (!isUuid(branchId)) return { ok: false, error: "invalid_input" };
  const current = await scopeOrError();
  if ("ok" in current) return current;
  const { error } = await current.scope.client.rpc("ensure_default_zones", { p_branch_id: branchId });
  if (error) {
    const code = mapInventoryError(error.message ?? "");
    if (code === "save_failed") console.error("ensure_default_zones failed", error.message);
    return { ok: false, error: code };
  }
  try {
    const zones = await zonesByBranch(current.scope, branchId);
    revalidatePath(ANBAR_APP_PATH, "layout");
    return { ok: true, value: zones[branchId] ?? [] };
  } catch (cause) {
    console.error("createDefaultZonesAction", cause);
    return { ok: false, error: "save_failed" };
  }
}

export async function cancelInventoryTaskAction(taskId: string): Promise<ActionResult> {
  if (!isUuid(taskId)) return { ok: false, error: "invalid_input" };
  const result = await rpc("cancel_inventory_task", { p_task_id: taskId }, () => null);
  if (result.ok) revalidateInventory();
  return result;
}

export async function startAssignmentAction(assignmentId: string): Promise<ActionResult> {
  if (!isUuid(assignmentId)) return { ok: false, error: "invalid_input" };
  return rpc("start_task_assignment", { p_assignment_id: assignmentId }, () => null);
}

/** Sends the cook's zone; returns the task status ("completed" when this was the last zone). */
export async function submitAssignmentAction(
  assignmentId: string,
  items: { productId: string; quantity: number }[],
): Promise<ActionResult<string>> {
  if (!isUuid(assignmentId) || !Array.isArray(items) || items.length === 0 || items.length > 2000) {
    return { ok: false, error: "invalid_input" };
  }
  const clean = items.map((item) => ({ product_id: item?.productId, quantity: num(item?.quantity) }));
  if (clean.some((item) => !isUuid(item.product_id) || item.quantity === null || item.quantity < 0 || item.quantity > COUNT_MAX_QUANTITY)) {
    return { ok: false, error: "invalid_input" };
  }
  const result = await rpc("submit_task_assignment", { p_assignment_id: assignmentId, p_items: clean }, (data) => String(data ?? ""));
  if (result.ok) revalidateInventory();
  return result;
}

export async function setDiscrepancyReasonAction(
  countId: string,
  productId: string,
  reason: DiscrepancyReason | null,
): Promise<ActionResult> {
  if (!isUuid(countId) || !isUuid(productId) || (reason !== null && !isDiscrepancyReason(reason))) {
    return { ok: false, error: "invalid_input" };
  }
  return rpc("set_discrepancy_reason", { p_count_id: countId, p_product_id: productId, p_reason: reason }, () => null);
}

/** Owner/chef: stock becomes the counted balance; returns the money written off and found. */
export async function closeInventoryTaskAction(taskId: string): Promise<ActionResult<{ loss: number; surplus: number }>> {
  if (!isUuid(taskId)) return { ok: false, error: "invalid_input" };
  const result = await rpc("close_inventory_task", { p_task_id: taskId }, (data) => {
    const row = (Array.isArray(data) ? data[0] : data) as { total_loss?: unknown; total_surplus?: unknown } | null;
    return { loss: num(row?.total_loss) ?? 0, surplus: num(row?.total_surplus) ?? 0 };
  });
  if (result.ok) {
    revalidateInventory();
    revalidatePath(ANBAR_APP_PATH, "layout");
    revalidatePath(OWNER_DASHBOARD_PATH, "layout");
  }
  return result;
}
