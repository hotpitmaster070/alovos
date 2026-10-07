import { parseRows } from "./parse";
import type { OrgScope } from "./scope";
import {
  nextUtcDate,
  type KitchenBalance,
  type KitchenBranch,
  type KitchenLocation,
  type KitchenProduct,
  type MovementType,
} from "./stock-view";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Supabase errors are plain objects; Next.js drops their message unless they are real Errors. */
function queryError(table: string, error: { message: string; code?: string }): Error {
  return new Error(`${table}: ${error.message}${error.code ? ` (${error.code})` : ""}`);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseProduct(row: unknown): KitchenProduct | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  return id && name !== null ? { id, name } : null;
}

function parseLocation(row: unknown): KitchenLocation | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const type = asString(row.type);
  return id && name !== null && type !== null
    ? { id, name, type, branchId: asString(row.branch_id) }
    : null;
}

function parseBalance(row: unknown): KitchenBalance | null {
  if (!isRecord(row)) return null;
  const productId = asString(row.product_id);
  const locationId = asString(row.location_id);
  const quantity = asNumber(row.quantity);
  if (!productId || !locationId || quantity === null) return null;
  return {
    productId,
    locationId,
    branchId: asString(row.branch_id),
    quantity,
    unit: asString(row.unit) ?? "",
    cost: asNumber(row.cost_per_unit),
  };
}

export type KitchenBoard = {
  products: KitchenProduct[];
  locations: KitchenLocation[];
  balances: KitchenBalance[];
};

export async function listKitchenBoard(scope: OrgScope): Promise<KitchenBoard> {
  const [products, locations, balances] = await Promise.all([
    scope.client
      .from("products")
      .select("id, name")
      .eq("tenant_id", scope.tenantId)
      .eq("organization_id", scope.orgId)
      .order("name")
      .limit(500),
    scope.client
      .from("storage_locations")
      .select("id, name, type, branch_id")
      .eq("tenant_id", scope.tenantId)
      .order("type")
      .limit(50),
    scope.client
      .from("product_stocks")
      .select("product_id, location_id, branch_id, quantity, unit, cost_per_unit")
      .eq("tenant_id", scope.tenantId)
      .limit(2000),
  ]);
  if (products.error) throw queryError("products", products.error);
  if (locations.error) throw queryError("storage_locations", locations.error);
  if (balances.error) throw queryError("product_stocks", balances.error);
  return {
    products: parseRows(products.data, parseProduct),
    locations: parseRows(locations.data, parseLocation),
    balances: parseRows(balances.data, parseBalance),
  };
}

export async function listBranches(scope: OrgScope): Promise<KitchenBranch[]> {
  const { data, error } = await scope.client
    .from("branches")
    .select("id, name")
    .eq("tenant_id", scope.tenantId)
    .order("name")
    .limit(200);
  if (error) throw queryError("branches", error);
  return parseRows(data, (row) => {
    if (!isRecord(row)) return null;
    const id = asString(row.id);
    const name = asString(row.name);
    return id && name !== null ? { id, name } : null;
  });
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
  scope: OrgScope,
  filters: { date: string | null; type: MovementType | null },
): Promise<MovementRow[]> {
  let query = scope.client
    .from("stock_movements")
    .select(
      "id, quantity, movement_type, reason, created_at, products(name), from_location:storage_locations!stock_movements_from_location_id_fkey(name), to_location:storage_locations!stock_movements_to_location_id_fkey(name), actor:profiles!stock_movements_user_id_fkey(email)",
    )
    .eq("tenant_id", scope.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.type) query = query.eq("movement_type", filters.type);
  if (filters.date) {
    query = query.gte("created_at", `${filters.date}T00:00:00.000Z`).lt("created_at", `${nextUtcDate(filters.date)}T00:00:00.000Z`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return parseRows(data, parseMovement);
}
