import type { TenantScope } from "@/lib/anbar/scope";
import { discrepancyRow, totals, type ParallelCount } from "@/lib/inventory/modes";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export type DashboardCards = {
  stockCost: number;
  belowPar: number;
  outOfStock: number;
  wastedToday: number;
};

export type ParAlert = {
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  min: number;
  max: number | null;
  toOrder: number;
};

export const PAR_ALERT_LIMIT = 500;

/** Cards of the owner dashboard; owner_dashboard() refuses roles that may not see money. */
export async function dashboardCards(scope: TenantScope, branchId: string | null): Promise<DashboardCards> {
  const { data, error } = await scope.client.rpc("owner_dashboard", { p_branch_id: branchId });
  if (error) throw new Error(`owner_dashboard: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const record = isRecord(row) ? row : {};
  return {
    stockCost: num(record.stock_cost) ?? 0,
    belowPar: num(record.below_par) ?? 0,
    outOfStock: num(record.out_of_stock) ?? 0,
    wastedToday: num(record.wasted_today) ?? 0,
  };
}

export async function parAlerts(scope: TenantScope, branchId: string | null): Promise<ParAlert[]> {
  const { data, error } = await scope.client.rpc("par_alerts", { p_branch_id: branchId });
  if (error) throw new Error(`par_alerts: ${error.message}`);
  const alerts: ParAlert[] = [];
  for (const row of (data ?? []) as unknown[]) {
    if (!isRecord(row)) continue;
    const branch = text(row.branch_id);
    const product = text(row.product_id);
    const quantity = num(row.quantity);
    const min = num(row.min_qty);
    if (!branch || !product || quantity === null || min === null) continue;
    alerts.push({
      branchId: branch,
      branchName: text(row.branch_name) ?? "",
      productId: product,
      productName: text(row.product_name) ?? "",
      unit: text(row.unit) ?? "",
      quantity,
      min,
      max: num(row.max_qty),
      toOrder: num(row.order_qty) ?? 0,
    });
  }
  return alerts;
}

function parseCounts(raw: unknown): ParallelCount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const userId = text(item.user_id);
    const quantity = num(item.quantity);
    return userId && quantity !== null ? [{ userId, label: text(item.email) ?? userId.slice(0, 8), quantity }] : [];
  });
}

/** Money short in completed inventory tasks since a tenant-local date, and suspicious lines. */
export async function discrepancySince(
  scope: TenantScope,
  branchId: string | null,
  from: string,
): Promise<{ lost: number; suspicious: number }> {
  const { data, error } = await scope.client.rpc("inventory_discrepancy_lines", {
    p_branch_id: branchId,
    p_from: from,
    p_to: null,
    p_task_id: null,
  });
  if (error) throw new Error(`inventory_discrepancy_lines: ${error.message}`);
  const rows = ((data ?? []) as unknown[]).filter(isRecord).map((row) =>
    discrepancyRow({ expected: num(row.expected_quantity), counts: parseCounts(row.counts), unitCost: num(row.unit_cost) }),
  );
  const sum = totals(rows);
  return { lost: sum.lost, suspicious: sum.suspicious };
}
