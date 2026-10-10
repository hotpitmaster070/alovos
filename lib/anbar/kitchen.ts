import { PAGE_SIZE, pageRange } from "@/lib/pagination";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import { dateBounds } from "@/lib/tenant-settings/time";
import { parseRows } from "./parse";
import type { TenantScope } from "./scope";
import type { MovementType, StockLine } from "./stock-view";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Supabase errors are plain objects; Next.js drops their message unless they are real Errors. */
function queryError(source: string, error: { message: string; code?: string }): Error {
  return new Error(`${source}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type StockFilters = { branchId: string | "all"; locationId: string | "all"; search: string | null };

type StockLineRow = { line: StockLine; total: number };

function parseStockLine(row: unknown): StockLineRow | null {
  if (!isRecord(row)) return null;
  const productId = asString(row.product_id);
  const locationId = asString(row.location_id);
  const quantity = asNumber(row.quantity);
  const total = asNumber(row.total_count);
  if (!productId || !locationId || quantity === null || total === null) return null;
  return {
    line: {
      productId,
      productName: asString(row.product_name) ?? "",
      locationId,
      locationName: asString(row.location_name) ?? "",
      quantity,
      unit: asString(row.unit) ?? "",
    },
    total,
  };
}

const allToNull = (value: string | "all"): string | null => (value === "all" ? null : value);

async function stockLinesPage(scope: TenantScope, filters: StockFilters, offset: number, limit: number) {
  const { data, error } = await scope.client.rpc("stock_lines_page", {
    p_branch_id: allToNull(filters.branchId),
    p_location_id: allToNull(filters.locationId),
    p_search: filters.search,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw queryError("stock_lines_page", error);
  return parseRows(data, parseStockLine);
}

/** One page of non-zero balances per product and storage location, and how many there are. */
export async function listStockLines(
  scope: TenantScope,
  filters: StockFilters,
  page: number,
): Promise<{ lines: StockLine[]; total: number }> {
  const { from } = pageRange(page);
  const rows = await stockLinesPage(scope, filters, from, PAGE_SIZE);
  if (rows.length === 0) {
    const total = from > 0 ? ((await stockLinesPage(scope, filters, 0, 1))[0]?.total ?? 0) : 0;
    return { lines: [], total };
  }
  return { lines: rows.map((row) => row.line), total: rows[0].total };
}

/** Value of the good lots in the filter and of the expired ones apart; nulls when the caller may not see costs. */
export async function stockValueTotal(
  scope: TenantScope,
  filters: Pick<StockFilters, "branchId" | "locationId">,
): Promise<{ total: number | null; expired: number | null }> {
  const { data, error } = await scope.client.rpc("stock_value", {
    p_branch_id: allToNull(filters.branchId),
    p_location_id: allToNull(filters.locationId),
  });
  if (error) throw queryError("stock_value", error);
  const row: unknown = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? { total: asNumber(row.total_value), expired: asNumber(row.expired_value) } : { total: null, expired: null };
}

export type MovementRow = {
  id: string;
  productName: string;
  quantity: number;
  movementType: MovementType | string;
  reason: string | null;
  createdAt: string;
  actor: string | null;
  fromLocation: string | null;
  toLocation: string | null;
};

function nestedName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return asString(value.name);
}

function parseMovement(row: unknown): MovementRow | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const createdAt = asString(row.created_at);
  const quantity = asNumber(row.quantity);
  const movementType = asString(row.movement_type);
  if (!id || !createdAt || quantity === null || !movementType) return null;
  const actor = isRecord(row.actor) ? asString(row.actor.email) : null;
  return {
    id,
    productName: nestedName(row.products) ?? "",
    quantity,
    movementType,
    reason: asString(row.reason),
    createdAt,
    actor,
    fromLocation: nestedName(row.from_location),
    toLocation: nestedName(row.to_location),
  };
}

export async function listStockMovements(
  scope: TenantScope,
  filters: { date: string | null; type: MovementType | null },
  settings: Pick<TenantSettings, "timezone">,
  page: number,
): Promise<{ rows: MovementRow[]; total: number }> {
  const { from, to } = pageRange(page);
  let query = scope.client
    .from("stock_movements")
    .select(
      "id, quantity, movement_type, reason, created_at, products(name), from_location:storage_locations!stock_movements_from_location_id_fkey(name), to_location:storage_locations!stock_movements_to_location_id_fkey(name), actor:profiles!stock_movements_user_id_fkey(email)",
      { count: "exact" },
    )
    .eq("tenant_id", scope.tenantId);

  if (filters.type) query = query.eq("movement_type", filters.type);
  if (filters.date) {
    const day = dateBounds(filters.date, settings.timezone);
    query = query.gte("created_at", day.start).lt("created_at", day.end);
  }

  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range(from, to);
  if (error) {
    // PostgREST answers 416 for an offset past the end; the page is then empty.
    if (error.code === "PGRST103") return { rows: [], total: count ?? 0 };
    throw queryError("stock_movements", error);
  }
  return { rows: parseRows(data, parseMovement), total: count ?? 0 };
}
