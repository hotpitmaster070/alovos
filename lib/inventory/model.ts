import type { StorageType } from "@/lib/anbar/types";
import { isStorageType } from "@/lib/anbar/types";
import {
  isDiscrepancyReason,
  isInventoryMode,
  isTaskStatus,
  type DiscrepancyReason,
  type InventoryMode,
  type ParallelCount,
  type TaskStatus,
} from "./modes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const TASK_TITLE_MAX = 120;
export const COUNT_MAX_QUANTITY = 1_000_000;
export const TASK_BOARD_PAGE = 30;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
export function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
const zoneType = (value: unknown): StorageType => (typeof value === "string" && isStorageType(value) ? value : "custom");
const emailLabel = (email: string | null, id: string) => email ?? id.slice(0, 8);

export type Zone = { id: string; name: string; type: StorageType };
export type Person = { userId: string; email: string };
export type StaffMember = Person & { role: string };
export type BoardAssignee = Person & { id: string; status: "pending" | "in_progress" | "submitted"; zoneId: string };

export type BoardTask = {
  id: string;
  title: string;
  mode: InventoryMode;
  status: TaskStatus;
  branchId: string;
  branchName: string;
  createdAt: string;
  scheduledAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  totalLoss: number | null;
  totalSurplus: number | null;
  zones: Zone[];
  assignees: BoardAssignee[];
  submitted: number;
  assigned: number;
};

function parseZones(raw: unknown): Zone[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) =>
    isRecord(item) && isUuid(item.id) ? [{ id: item.id, name: text(item.name) ?? "", type: zoneType(item.type) }] : [],
  );
}

const ASSIGNEE_STATUSES = ["pending", "in_progress", "submitted"] as const;
const assigneeStatus = (value: unknown): BoardAssignee["status"] =>
  (ASSIGNEE_STATUSES as readonly unknown[]).includes(value) ? (value as BoardAssignee["status"]) : "pending";

function parseAssignees(raw: unknown): BoardAssignee[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item) || !isUuid(item.id) || !isUuid(item.user_id) || !isUuid(item.zone_id)) return [];
    return [{ id: item.id, userId: item.user_id, email: emailLabel(text(item.email), item.user_id), status: assigneeStatus(item.status), zoneId: item.zone_id }];
  });
}

export function parseBoardTask(row: unknown): BoardTask | null {
  if (!isRecord(row) || !isUuid(row.id) || !isUuid(row.branch_id) || !isInventoryMode(row.mode) || !isTaskStatus(row.status)) return null;
  return {
    id: row.id,
    title: text(row.title) ?? "",
    mode: row.mode,
    status: row.status,
    branchId: row.branch_id,
    branchName: text(row.branch_name) ?? "",
    createdAt: text(row.created_at) ?? "",
    scheduledAt: text(row.scheduled_at),
    completedAt: text(row.completed_at),
    closedAt: text(row.closed_at),
    totalLoss: num(row.total_loss),
    totalSurplus: num(row.total_surplus),
    zones: parseZones(row.zones),
    assignees: parseAssignees(row.assignees),
    submitted: num(row.submitted) ?? 0,
    assigned: num(row.assigned) ?? 0,
  };
}

export function parseCounts(raw: unknown): ParallelCount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item) || !isUuid(item.user_id)) return [];
    const quantity = num(item.quantity);
    return quantity === null ? [] : [{ userId: item.user_id, label: emailLabel(text(item.email), item.user_id), quantity }];
  });
}

/** One product of one zone: inventory_task_lines() and inventory_discrepancy_lines(). */
export type TaskLine = {
  countId: string;
  countStatus: string;
  zone: Zone;
  productId: string;
  productName: string;
  unit: string;
  expected: number | null;
  /** The merged result (average of the counts); null before the merge. */
  merged: number | null;
  counts: ParallelCount[];
  unitCost: number | null;
  reason: DiscrepancyReason | null;
  task: { id: string; title: string; mode: InventoryMode; status: TaskStatus; completedAt: string | null } | null;
};

export function parseTaskLine(row: unknown): TaskLine | null {
  if (!isRecord(row) || !isUuid(row.stock_count_id) || !isUuid(row.zone_id) || !isUuid(row.product_id)) return null;
  const task =
    isUuid(row.task_id) && isInventoryMode(row.mode) && isTaskStatus(row.task_status)
      ? { id: row.task_id, title: text(row.task_title) ?? "", mode: row.mode, status: row.task_status, completedAt: text(row.completed_at) }
      : null;
  return {
    countId: row.stock_count_id,
    countStatus: text(row.count_status) ?? "",
    zone: { id: row.zone_id, name: text(row.zone_name) ?? "", type: zoneType(row.zone_type) },
    productId: row.product_id,
    productName: text(row.product_name) ?? "",
    unit: text(row.unit) ?? "",
    expected: num(row.expected_quantity),
    merged: num(row.counted_quantity),
    counts: parseCounts(row.counts),
    unitCost: num(row.unit_cost),
    reason: isDiscrepancyReason(row.discrepancy_reason) ? row.discrepancy_reason : null,
    task,
  };
}

/** A cook's assignment: my_inventory_tasks(). */
export type MyTask = {
  assignmentId: string;
  taskId: string;
  title: string;
  mode: InventoryMode;
  taskStatus: TaskStatus;
  status: BoardAssignee["status"];
  zone: Zone;
  branchName: string;
  scheduledAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  productCount: number;
  peersTotal: number;
  peersSubmitted: number;
};

export function parseMyTask(row: unknown): MyTask | null {
  if (!isRecord(row) || !isUuid(row.assignment_id) || !isUuid(row.task_id) || !isUuid(row.zone_id)) return null;
  if (!isInventoryMode(row.mode) || !isTaskStatus(row.task_status)) return null;
  return {
    assignmentId: row.assignment_id,
    taskId: row.task_id,
    title: text(row.title) ?? "",
    mode: row.mode,
    taskStatus: row.task_status,
    status: assigneeStatus(row.status),
    zone: { id: row.zone_id, name: text(row.zone_name) ?? "", type: zoneType(row.zone_type) },
    branchName: text(row.branch_name) ?? "",
    scheduledAt: text(row.scheduled_at),
    createdAt: text(row.created_at) ?? "",
    submittedAt: text(row.submitted_at),
    productCount: num(row.product_count) ?? 0,
    peersTotal: num(row.peers_total) ?? 0,
    peersSubmitted: num(row.peers_submitted) ?? 0,
  };
}

/** A product of the cook's zone: my_assignment_lines(). expected is null while blind. */
export type BlindLine = { productId: string; name: string; unit: string; mine: number | null; expected: number | null };

export function parseBlindLine(row: unknown): BlindLine | null {
  if (!isRecord(row) || !isUuid(row.product_id)) return null;
  return {
    productId: row.product_id,
    name: text(row.name) ?? "",
    unit: text(row.unit) ?? "",
    mine: num(row.my_quantity),
    expected: row.revealed === true ? num(row.expected_quantity) : null,
  };
}

export type MyStats = { open: number; sent: number; accuracy: number | null };

export const INVENTORY_ERROR_CODES = [
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "invalid_input",
  "branch_not_found",
  "location_not_found",
  "assignee_not_found",
  "open_count",
  "task_not_found",
  "task_closed",
  "already_submitted",
  "product_not_found",
  "nothing_counted",
  "insufficient_stock",
  "line_not_found",
  "duplicate_name",
  "save_failed",
] as const;
export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];

export function mapInventoryError(message: string): InventoryErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes("uniq_open_count_per_location")) return "open_count";
  if (lower.includes("storage_locations_branch_id_name_key")) return "duplicate_name";
  if (lower.includes("permission denied")) return "forbidden";
  return INVENTORY_ERROR_CODES.find((code) => code !== "save_failed" && lower.includes(code)) ?? "save_failed";
}
