import type { TenantScope } from "@/lib/anbar/scope";
import { pageRange } from "@/lib/pagination";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  COUNT_COLUMNS,
  OPEN_COUNT_STATUSES,
  parseCount,
  parseCountLine,
  type CountLine,
  type CountProduct,
  type StockCount,
} from "./model";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function single(data: unknown): StockCount | null {
  if (data === null || data === undefined) return null;
  const count = parseCount(data);
  if (!count) throw new Error("stock_counts: unexpected row");
  return count;
}

/** The open (draft, counting or merging) count of a storage place; there is at most one. */
export async function openCountAt(scope: TenantScope, locationId: string): Promise<StockCount | null> {
  const { data, error } = await scope.client
    .from("stock_counts")
    .select(COUNT_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("location_id", locationId)
    .in("status", [...OPEN_COUNT_STATUSES])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return single(data);
}

export async function getCount(scope: TenantScope, id: string): Promise<StockCount | null> {
  const { data, error } = await scope.client
    .from("stock_counts")
    .select(COUNT_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return single(data);
}

/** The count of a storage place: the open one, else the latest closed one. */
export async function countAtLocation(scope: TenantScope, locationId: string): Promise<StockCount | null> {
  const open = await openCountAt(scope, locationId);
  if (open) return open;
  const { data, error } = await scope.client
    .from("stock_counts")
    .select(COUNT_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("location_id", locationId)
    .in("status", ["approved", "cancelled"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 0);
  if (error) throw new Error(error.message);
  return single(data?.[0] ?? null);
}

/** Whether the id is a storage place of the tenant. */
export async function isTenantLocation(scope: TenantScope, id: string): Promise<boolean> {
  const { data, error } = await scope.client
    .from("storage_locations")
    .select("id")
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

/** The count labelled with a group key: the open one, else the latest. */
export async function countByGroupKey(scope: TenantScope, groupKey: string): Promise<StockCount | null> {
  const { data, error } = await scope.client
    .from("stock_counts")
    .select(COUNT_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("group_key", groupKey)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, 99);
  if (error) throw new Error(error.message);
  const counts = (data ?? []).map(parseCount).filter((count): count is StockCount => count !== null);
  return counts.find((count) => OPEN_COUNT_STATUSES.includes(count.status)) ?? counts[0] ?? null;
}

/** Merged list of a count (per product, by the tenant's merge mode); blind columns come back null. */
export async function countLines(scope: TenantScope, countId: string): Promise<CountLine[]> {
  const rows = await fetchAll((from, to) => scope.client.rpc("stock_count_lines", { p_count_id: countId }).range(from, to));
  return rows.map(parseCountLine).filter((line): line is CountLine => line !== null);
}

/** What the signed-in user entered in a count, by product id. */
export async function myCountEntries(scope: TenantScope, countId: string): Promise<Record<string, number>> {
  const rows = await fetchAll((from, to) =>
    scope.client.rpc("my_stock_count_items", { p_count_id: countId }).order("product_id").range(from, to),
  );
  const entries: Record<string, number> = {};
  for (const row of rows) {
    if (isRecord(row) && typeof row.product_id === "string") entries[row.product_id] = Number(row.counted_quantity);
  }
  return entries;
}

/** One page of the products kept at a storage place (their default place or a lot there). */
export async function countProducts(
  scope: TenantScope,
  locationId: string,
  page: number,
): Promise<{ products: CountProduct[]; total: number }> {
  const { from, to } = pageRange(page);
  const { data, error } = await scope.client.rpc("count_products_page", {
    p_location_id: locationId,
    p_offset: from,
    p_limit: to - from + 1,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  const products = rows.flatMap((row: unknown) =>
    isRecord(row) && typeof row.id === "string" && typeof row.name === "string"
      ? [{ id: row.id, name: row.name, unit: typeof row.unit === "string" ? row.unit : "" }]
      : [],
  );
  const total = rows.length > 0 && isRecord(rows[0]) ? Number(rows[0].total_count) : 0;
  return { products, total };
}

/** Role of the signed-in user in the current tenant. */
export async function memberRole(scope: TenantScope): Promise<string | null> {
  const { data, error } = await scope.client.rpc("current_member_role");
  if (error) throw new Error(error.message);
  return typeof data === "string" && data !== "" ? data : null;
}

export const canApproveCounts = (role: string | null): boolean => role === "owner" || role === "chef";
export const canCount = (role: string | null): boolean => canApproveCounts(role) || role === "cook";

/** Counts of the tenant, newest first, one page. */
export async function listCounts(scope: TenantScope, page: number): Promise<{ counts: StockCount[]; total: number }> {
  const { from, to } = pageRange(page);
  const { data, error, count } = await scope.client
    .from("stock_counts")
    .select(COUNT_COLUMNS, { count: "exact" })
    .eq("tenant_id", scope.tenantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return {
    counts: (data ?? []).map(parseCount).filter((item): item is StockCount => item !== null),
    total: count ?? 0,
  };
}
