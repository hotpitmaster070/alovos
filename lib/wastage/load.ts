import type { KitchenBalance } from "@/lib/anbar/stock-view";
import type { OrgScope } from "@/lib/anbar/scope";
import { bakuDayBounds, isWasteReason, unitCost, type WasteCard, type WasteReason } from "@/lib/wastage/model";

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
  locationId: string | null;
  cost: number | null;
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
    locationId: asString(row.location_id),
    cost: asNumber(row.cost),
  };
}

async function signedPhoto(scope: OrgScope, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const signed = await scope.client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return signed.data?.signedUrl ?? null;
}

export async function listWasteCards(
  scope: OrgScope,
  filters: { branchId: string | "all"; locationId: string | "all" },
  balances: KitchenBalance[],
): Promise<WasteCard[]> {
  const day = bakuDayBounds(new Date());
  let query = scope.client
    .from("wastage_logs")
    .select("id, product_id, quantity, reason, photo_url, user_id, location_id, cost, created_at")
    .eq("tenant_id", scope.tenantId)
    .gte("created_at", day.start)
    .lt("created_at", day.end)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
  if (filters.locationId !== "all") query = query.eq("location_id", filters.locationId);

  const listed = await query;
  if (listed.error) throw listed.error;
  const logs = (listed.data ?? []).map(parseLog).filter((row): row is LogRow => row !== null);
  if (logs.length === 0) return [];

  const productIds = Array.from(new Set(logs.map((row) => row.productId).filter((v): v is string => typeof v === "string" && !!v)));
  const userIds = Array.from(new Set(logs.map((row) => row.userId).filter((id): id is string => typeof id === "string" && !!id)));
  const [products, profiles] = await Promise.all([
    scope.client.from("products").select("id, name").eq("tenant_id", scope.tenantId).in("id", productIds),
    userIds.length > 0
      ? scope.client.from("profiles").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error) throw products.error;
  if (profiles.error) throw profiles.error;

  const names = new Map<string, string>();
  for (const row of products.data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const name = asString(row.name);
    if (id && name) names.set(id, name);
  }
  const emails = new Map<string, string>();
  for (const row of profiles.data ?? []) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const email = asString(row.email);
    if (id && email) emails.set(id, email);
  }

  return Promise.all(
    logs.map(async (log) => {
      const lots = balances.filter(
        (row) => row.productId === log.productId && (log.locationId === null || row.locationId === log.locationId),
      );
      const cost = log.cost ?? log.quantity * unitCost(lots.map((row) => ({ quantity: row.quantity, cost: row.cost })));
      return {
        id: log.id,
        productName: names.get(log.productId) ?? "",
        quantity: log.quantity,
        unit: lots[0]?.unit ?? "",
        reason: log.reason,
        photoUrl: await signedPhoto(scope, log.photoPath),
        actor: log.userId ? emails.get(log.userId) ?? null : null,
        cost,
      };
    }),
  );
}
