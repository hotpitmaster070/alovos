import type { TenantScope } from "@/lib/anbar/scope";
import { pageRange } from "@/lib/pagination";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import { todayBounds } from "@/lib/tenant-settings/time";
import { isWasteReason, type WasteCard, type WasteReason } from "@/lib/wastage/model";

const BUCKET = "wastage-photos";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type LogRow = {
  id: string;
  productId: string;
  quantity: number;
  reason: WasteReason;
  photoPath: string | null;
  userId: string | null;
};

function parseLog(row: unknown): LogRow | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const productId = asString(row.product_id);
  const reason = asString(row.reason);
  const quantity = asNumber(row.quantity);
  if (!id || !productId || !reason || !isWasteReason(reason) || quantity === null) return null;
  return {
    id,
    productId,
    quantity,
    reason,
    photoPath: asString(row.photo_url),
    userId: asString(row.user_id),
  };
}

export type WasteFilters = { branchId: string | "all"; locationId: string | "all" };

/** Logged waste value per log id; empty for roles that may not see costs. */
async function wasteCosts(scope: TenantScope, ids: string[]): Promise<Map<string, number | null>> {
  const { data, error } = await scope.client
    .from("wastage_costs")
    .select("id, cost")
    .eq("tenant_id", scope.tenantId)
    .in("id", ids);
  if (error) throw error;
  const costs = new Map<string, number | null>();
  for (const row of data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    if (id) costs.set(id, asNumber(row.cost));
  }
  return costs;
}

async function signedPhoto(scope: TenantScope, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const signed = await scope.client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return signed.data?.signedUrl ?? null;
}

/** One page of today's waste (tenant's day), newest first, and how many logs today has. */
export async function listWasteCards(
  scope: TenantScope,
  filters: WasteFilters,
  settings: Pick<TenantSettings, "timezone">,
  page: number,
): Promise<{ cards: WasteCard[]; total: number }> {
  const day = todayBounds(settings.timezone, new Date());
  const { from, to } = pageRange(page);
  let query = scope.client
    .from("wastage_logs")
    .select("id, product_id, quantity, reason, photo_url, user_id, created_at", { count: "exact" })
    .eq("tenant_id", scope.tenantId)
    .gte("created_at", day.start)
    .lt("created_at", day.end);
  if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
  if (filters.locationId !== "all") query = query.eq("location_id", filters.locationId);

  const listed = await query.order("created_at", { ascending: false }).order("id").range(from, to);
  if (listed.error) {
    // PostgREST answers 416 for an offset past the end; the page is then empty.
    if (listed.error.code === "PGRST103") return { cards: [], total: listed.count ?? 0 };
    throw listed.error;
  }
  const total = listed.count ?? 0;
  const logs = (listed.data ?? []).map(parseLog).filter((row): row is LogRow => row !== null);
  if (logs.length === 0) return { cards: [], total };

  const productIds = Array.from(new Set(logs.map((row) => row.productId)));
  const userIds = Array.from(new Set(logs.map((row) => row.userId).filter((id): id is string => !!id)));
  const [products, profiles, costs] = await Promise.all([
    scope.client.from("products").select("id, name, unit").eq("tenant_id", scope.tenantId).in("id", productIds),
    userIds.length > 0
      ? scope.client.from("profiles").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    wasteCosts(scope, logs.map((log) => log.id)),
  ]);
  if (products.error) throw products.error;
  if (profiles.error) throw profiles.error;

  const productInfo = new Map<string, { name: string; unit: string }>();
  for (const row of products.data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    if (id) productInfo.set(id, { name: asString(row.name) ?? "", unit: asString(row.unit) ?? "" });
  }
  const emails = new Map<string, string>();
  for (const row of profiles.data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const email = asString(row.email);
    if (id && email) emails.set(id, email);
  }

  const cards = await Promise.all(
    logs.map(async (log) => ({
      id: log.id,
      productName: productInfo.get(log.productId)?.name ?? "",
      quantity: log.quantity,
      unit: productInfo.get(log.productId)?.unit ?? "",
      reason: log.reason,
      photoUrl: await signedPhoto(scope, log.photoPath),
      actor: log.userId ? emails.get(log.userId) ?? null : null,
      cost: costs.has(log.id) ? (costs.get(log.id) ?? 0) : null,
    })),
  );
  return { cards, total };
}

/** Value of all of today's waste in the filter; null when the caller may not see costs. */
export async function wasteTotal(
  scope: TenantScope,
  filters: WasteFilters,
  settings: Pick<TenantSettings, "timezone">,
): Promise<number | null> {
  const day = todayBounds(settings.timezone, new Date());
  const { data, error } = await scope.client.rpc("wastage_total", {
    p_start: day.start,
    p_end: day.end,
    p_branch_id: filters.branchId === "all" ? null : filters.branchId,
    p_location_id: filters.locationId === "all" ? null : filters.locationId,
  });
  if (error) throw error;
  return asNumber(data);
}
