import type { TenantScope } from "@/lib/anbar/scope";
import { isStorageType } from "@/lib/anbar/types";
import {
  num,
  parseBlindLine,
  parseBoardTask,
  parseMyTask,
  parseTaskLine,
  TASK_BOARD_PAGE,
  type BlindLine,
  type BoardTask,
  type MyStats,
  type MyTask,
  type StaffMember,
  type TaskLine,
  type Zone,
} from "./model";

const rows = (data: unknown): unknown[] => (Array.isArray(data) ? data : data ? [data] : []);
const parsed = <T>(data: unknown, parse: (row: unknown) => T | null): T[] =>
  rows(data).flatMap((row) => {
    const value = parse(row);
    return value ? [value] : [];
  });

export async function taskBoard(
  scope: TenantScope,
  branchId: string | null,
  page: number,
): Promise<{ tasks: BoardTask[]; total: number }> {
  const { data, error } = await scope.client.rpc("inventory_task_board", {
    p_branch_id: branchId,
    p_limit: TASK_BOARD_PAGE,
    p_offset: (page - 1) * TASK_BOARD_PAGE,
  });
  if (error) throw new Error(`inventory_task_board: ${error.message}`);
  const list = rows(data);
  const first = list[0] as { total_count?: unknown } | undefined;
  return { tasks: parsed(list, parseBoardTask), total: num(first?.total_count) ?? 0 };
}

/** The latest tasks for the report's task filter. */
export async function recentTasks(scope: TenantScope, branchId: string | null, limit = 10): Promise<BoardTask[]> {
  const { data, error } = await scope.client.rpc("inventory_task_board", { p_branch_id: branchId, p_limit: limit, p_offset: 0 });
  if (error) throw new Error(`inventory_task_board: ${error.message}`);
  return parsed(data, parseBoardTask);
}

export async function taskCounts(
  scope: TenantScope,
  branchId: string | null,
  from: string,
): Promise<{ active: number; finished: number; awaiting: number }> {
  const { data, error } = await scope.client.rpc("inventory_task_counts", { p_branch_id: branchId, p_from: from });
  if (error) throw new Error(`inventory_task_counts: ${error.message}`);
  const row = (rows(data)[0] ?? {}) as Record<string, unknown>;
  return { active: num(row.active) ?? 0, finished: num(row.finished) ?? 0, awaiting: num(row.awaiting) ?? 0 };
}

export async function taskLines(scope: TenantScope, taskId: string): Promise<TaskLine[]> {
  const { data, error } = await scope.client.rpc("inventory_task_lines", { p_task_id: taskId });
  if (error) throw new Error(`inventory_task_lines: ${error.message}`);
  return parsed(data, parseTaskLine);
}

export async function getTask(scope: TenantScope, taskId: string): Promise<BoardTask | null> {
  const { data, error } = await scope.client.rpc("inventory_task_board", { p_branch_id: null, p_limit: 1, p_offset: 0, p_task_id: taskId });
  if (error) throw new Error(`inventory_task_board: ${error.message}`);
  return parsed(data, parseBoardTask).find((task) => task.id === taskId) ?? null;
}

export type DiscrepancyFilters = { branchId: string | null; taskId: string | null; from: string | null; to: string | null };

export async function discrepancyLines(scope: TenantScope, filters: DiscrepancyFilters): Promise<TaskLine[]> {
  const { data, error } = await scope.client.rpc("inventory_discrepancy_lines", {
    p_branch_id: filters.branchId,
    p_from: filters.from,
    p_to: filters.to,
    p_task_id: filters.taskId,
  });
  if (error) throw new Error(`inventory_discrepancy_lines: ${error.message}`);
  return parsed(data, parseTaskLine);
}

/** Active zones of the tenant per branch, from the storage_zones view. */
export async function zonesByBranch(scope: TenantScope, branchId: string | null = null): Promise<Record<string, Zone[]>> {
  let query = scope.client
    .from("storage_zones")
    .select("id, name, type, branch_id")
    .eq("tenant_id", scope.tenantId)
    .eq("is_active", true);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query.order("name").order("id").range(0, 999);
  if (error) throw new Error(`storage_zones: ${error.message}`);
  const result: Record<string, Zone[]> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    if (typeof row.id !== "string" || typeof row.branch_id !== "string") continue;
    const type = typeof row.type === "string" && isStorageType(row.type) ? row.type : "custom";
    (result[row.branch_id] ??= []).push({ id: row.id, name: typeof row.name === "string" ? row.name : "", type });
  }
  return result;
}

export async function branchStaff(scope: TenantScope, branchId: string): Promise<StaffMember[]> {
  const { data, error } = await scope.client.rpc("inventory_staff", { p_branch_id: branchId });
  if (error) throw new Error(`inventory_staff: ${error.message}`);
  return rows(data).flatMap((row) => {
    const record = row as Record<string, unknown>;
    return typeof record.user_id === "string"
      ? [{ userId: record.user_id, email: typeof record.email === "string" ? record.email : record.user_id.slice(0, 8), role: String(record.role ?? "") }]
      : [];
  });
}

export async function myTasks(scope: TenantScope): Promise<MyTask[]> {
  const { data, error } = await scope.client.rpc("my_inventory_tasks");
  if (error) throw new Error(`my_inventory_tasks: ${error.message}`);
  return parsed(data, parseMyTask);
}

export async function myStats(scope: TenantScope): Promise<MyStats> {
  const { data, error } = await scope.client.rpc("my_inventory_stats");
  if (error) throw new Error(`my_inventory_stats: ${error.message}`);
  const row = (rows(data)[0] ?? {}) as Record<string, unknown>;
  return { open: num(row.open_count) ?? 0, sent: num(row.sent_count) ?? 0, accuracy: num(row.accuracy) };
}

export async function myAssignmentLines(scope: TenantScope, assignmentId: string): Promise<BlindLine[]> {
  const { data, error } = await scope.client.rpc("my_assignment_lines", { p_assignment_id: assignmentId });
  if (error) {
    if (/task_not_found/.test(error.message)) return [];
    throw new Error(`my_assignment_lines: ${error.message}`);
  }
  return parsed(data, parseBlindLine);
}
