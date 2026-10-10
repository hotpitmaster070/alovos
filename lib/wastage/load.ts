import type { TenantScope } from "@/lib/anbar/scope";
import { pageRange } from "@/lib/pagination";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import { dateBounds, isDateOnly, todayIn } from "@/lib/tenant-settings/time";
import {
  isLoggedWasteReason,
  isWasteAiStatus,
  type LoggedWasteReason,
  type WasteAiCheck,
  type WasteCard,
  type WasteRun,
} from "@/lib/wastage/model";

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
  reason: LoggedWasteReason;
  reasonNote: string | null;
  parentLotId: string | null;
  preparationId: string | null;
  preparationRunId: string | null;
  photoPath: string | null;
  ai: WasteAiCheck | null;
  userId: string | null;
  createdAt: string | null;
};

export function parseAiCheck(row: Record<string, unknown>): WasteAiCheck | null {
  if (!isWasteAiStatus(row.ai_status)) return null;
  const analysis = isRecord(row.ai_analysis) ? row.ai_analysis : {};
  return {
    status: row.ai_status,
    confidence: asNumber(row.ai_confidence),
    detected: asString(analysis.detected) || null,
    notes: asString(analysis.notes) || null,
    requiresReview: row.requires_owner_review === true,
  };
}

function parseLog(row: unknown): LogRow | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const productId = asString(row.product_id);
  const reason = asString(row.reason);
  const quantity = asNumber(row.quantity);
  if (!id || !productId || !reason || !isLoggedWasteReason(reason) || quantity === null) return null;
  return {
    id,
    productId,
    quantity,
    reason,
    reasonNote: asString(row.reason_note),
    parentLotId: asString(row.parent_lot_id),
    preparationId: asString(row.preparation_id),
    preparationRunId: asString(row.preparation_run_id),
    photoPath: asString(row.photo_url),
    ai: parseAiCheck(row),
    userId: asString(row.user_id),
    createdAt: asString(row.created_at),
  };
}

export type WasteFilters = {
  branchId: string | "all";
  locationId: string | "all";
  /** Chef feed only. */
  reason?: LoggedWasteReason | null;
  userId?: string | null;
};

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

/** id -> value of a tenant table's column for the given ids. */
async function namesById(scope: TenantScope, table: "product_lots" | "preparations", column: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await scope.client.from(table).select(`id, ${column}`).eq("tenant_id", scope.tenantId).in("id", ids);
  if (error) throw error;
  for (const row of (data ?? []) as unknown[]) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const value = asString(row[column]);
    if (id && value) names.set(id, value);
  }
  return names;
}

async function runInfo(scope: TenantScope, ids: string[]): Promise<Map<string, { at: string; run: WasteRun | null }>> {
  const runs = new Map<string, { at: string; run: WasteRun | null }>();
  if (ids.length === 0) return runs;
  const { data, error } = await scope.client
    .from("preparation_runs")
    .select("id, created_at, base_unit, input_base, trim_base, net_base, waste_base, evaporation_base")
    .eq("tenant_id", scope.tenantId)
    .in("id", ids);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const at = asString(row.created_at);
    if (!id || !at) continue;
    const baseUnit = asString(row.base_unit);
    const gross = asNumber(row.input_base);
    const net = asNumber(row.net_base);
    runs.set(id, {
      at,
      run:
        baseUnit && gross !== null && net !== null
          ? {
              baseUnit,
              gross,
              trim: asNumber(row.trim_base) ?? 0,
              net,
              waste: asNumber(row.waste_base) ?? 0,
              evaporation: asNumber(row.evaporation_base) ?? 0,
            }
          : null,
    });
  }
  return runs;
}

const unique = (values: (string | null)[]): string[] => Array.from(new Set(values.filter((value): value is string => !!value)));

/** The tenant-local day (YYYY-MM-DD) of the journal, today when absent or invalid. */
export function wasteDay(value: string | null | undefined, settings: Pick<TenantSettings, "timezone">): string {
  return value && isDateOnly(value) ? value : todayIn(settings.timezone, new Date());
}

/** One page of a day's waste (tenant's day), newest first, and how many logs the day has. */
export async function listWasteCards(
  scope: TenantScope,
  filters: WasteFilters,
  settings: Pick<TenantSettings, "timezone">,
  page: number,
  date: string,
): Promise<{ cards: WasteCard[]; total: number }> {
  const day = dateBounds(date, settings.timezone);
  const { from, to } = pageRange(page);
  let query = scope.client
    .from("wastage_logs")
    .select("id, product_id, quantity, reason, reason_note, parent_lot_id, preparation_id, preparation_run_id, photo_url, ai_status, ai_confidence, ai_analysis, requires_owner_review, user_id, created_at", {
      count: "exact",
    })
    .eq("tenant_id", scope.tenantId)
    .gte("created_at", day.start)
    .lt("created_at", day.end);
  if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
  if (filters.locationId !== "all") query = query.eq("location_id", filters.locationId);
  if (filters.reason) query = query.eq("reason", filters.reason);
  if (filters.userId) query = query.eq("user_id", filters.userId);

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
  const [products, profiles, costs, lotNumbers, preparationNames, runs] = await Promise.all([
    scope.client.from("products").select("id, name, unit").eq("tenant_id", scope.tenantId).in("id", productIds),
    userIds.length > 0
      ? scope.client.from("profiles").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    wasteCosts(scope, logs.map((log) => log.id)),
    namesById(scope, "product_lots", "lot_number", unique(logs.map((log) => log.parentLotId))),
    namesById(scope, "preparations", "name", unique(logs.map((log) => log.preparationId))),
    runInfo(scope, unique(logs.map((log) => log.preparationRunId))),
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
      reasonNote: log.reasonNote,
      lotNumber: log.parentLotId ? lotNumbers.get(log.parentLotId) ?? null : null,
      preparation: log.preparationId
        ? {
            id: log.preparationId,
            name: preparationNames.get(log.preparationId) ?? "",
            runAt: log.preparationRunId ? runs.get(log.preparationRunId)?.at ?? null : null,
            run: log.preparationRunId ? runs.get(log.preparationRunId)?.run ?? null : null,
          }
        : null,
      photoUrl: await signedPhoto(scope, log.photoPath),
      ai: log.ai,
      actor: log.userId ? emails.get(log.userId) ?? null : null,
      createdAt: log.createdAt,
      cost: costs.has(log.id) ? (costs.get(log.id) ?? 0) : null,
    })),
  );
  return { cards, total };
}

/** Value of all of the day's waste in the filter; null when the caller may not see costs. */
export async function wasteTotal(
  scope: TenantScope,
  filters: WasteFilters,
  settings: Pick<TenantSettings, "timezone">,
  date: string,
): Promise<number | null> {
  const day = dateBounds(date, settings.timezone);
  const { data, error } = await scope.client.rpc("wastage_total", {
    p_start: day.start,
    p_end: day.end,
    p_branch_id: filters.branchId === "all" ? null : filters.branchId,
    p_location_id: filters.locationId === "all" ? null : filters.locationId,
    p_reason: filters.reason ?? null,
    p_user_id: filters.userId ?? null,
  });
  if (error) throw error;
  return asNumber(data);
}
