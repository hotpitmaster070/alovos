import { PAGE_SIZE, LOW_STOCK_THRESHOLD } from "./constants";
import { mapRpcError, type AnbarErrorCode } from "./errors";
import { parseCatalogItem, parseLocation, parseProduct, parseRows } from "./parse";
import type { OrgScope } from "./scope";
import type { CatalogItem, Location, Product } from "./types";
import { addDaysUtc, toDateOnly } from "@/lib/expiry";
import type { MoveInput, ProductFilters, ProductInput } from "./validation";

const PRODUCT_COLUMNS = "id, name, barcode, expiry_date, qty, unit, cost, location_id";

/**
 * All reads and writes of products/locations live here. Every statement is built from an OrgScope
 * and carries .eq("organization_id", orgId) (inserts set organization_id explicitly); RLS is the
 * second line of defence, not the only one. Stock moves go through the move_stock RPC only.
 */

const CATALOG_COLUMNS = "id, name, barcode, expiry_date, quantity, branch:branches(name)";

/** Catalog rows for block 1.1: barcode, expiry, quantity and the product's branch. */
export async function listCatalog(scope: OrgScope): Promise<CatalogItem[]> {
  const { data, error } = await scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("organization_id", scope.orgId)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(500);
  if (error) throw error;
  return parseRows(data, parseCatalogItem);
}

export async function listLocations(scope: OrgScope): Promise<Location[]> {
  const { data, error } = await scope.client
    .from("locations")
    .select("id, name")
    .eq("organization_id", scope.orgId)
    .order("name")
    .limit(500);
  if (error) throw error;
  return parseRows(data, parseLocation);
}

export async function locationExists(scope: OrgScope, locationId: string): Promise<boolean> {
  const { data, error } = await scope.client
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("organization_id", scope.orgId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export type ProductPage = { products: Product[]; hasNext: boolean };

/**
 * One page of products, soonest expiry first (no expiry last), then name, then id (stable order).
 * Fetches PAGE_SIZE + 1 rows to know whether a next page exists without an expensive count.
 */
export async function listProducts(
  scope: OrgScope,
  filters: ProductFilters,
  now: Date = new Date(),
): Promise<ProductPage> {
  let query = scope.client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("organization_id", scope.orgId);

  if (filters.barcode) query = query.eq("barcode", filters.barcode);
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.lowStock) query = query.lt("qty", LOW_STOCK_THRESHOLD);

  const today = toDateOnly(now);
  if (filters.expiredOnly) query = query.lt("expiry_date", today);
  if (filters.expiry === "week") query = query.lt("expiry_date", addDaysUtc(now, 7));
  if (filters.expiry === "month") query = query.lt("expiry_date", addDaysUtc(now, 30));
  if (filters.expiry === "ok") query = query.gte("expiry_date", addDaysUtc(now, 30));

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error } = await query
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("name")
    .order("id")
    .range(from, from + PAGE_SIZE);
  if (error) throw error;

  const rows = parseRows(data, parseProduct);
  return { products: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

export async function insertLocation(scope: OrgScope, name: string): Promise<AnbarErrorCode | null> {
  const { error } = await scope.client
    .from("locations")
    .insert({ organization_id: scope.orgId, name });
  return error ? mapRpcError(error) : null;
}

export async function insertProduct(scope: OrgScope, input: ProductInput): Promise<AnbarErrorCode | null> {
  const { error } = await scope.client.from("products").insert({
    organization_id: scope.orgId,
    tenant_id: scope.tenantId,
    name: input.name,
    barcode: input.barcode,
    expiry_date: input.expiryDate,
    location_id: input.locationId,
    qty: input.qty,
    cost: input.cost,
    unit: input.unit,
  });
  return error ? mapRpcError(error) : null;
}

/** The only way stock moves: the atomic, org-checked move_stock RPC. */
export async function moveStockRpc(scope: OrgScope, input: MoveInput): Promise<AnbarErrorCode | null> {
  const { error } = await scope.client.rpc("move_stock", {
    p_product_id: input.productId,
    p_from_location: input.fromLocationId,
    p_to_location: input.toLocationId,
    p_qty: input.qty,
  });
  return error ? mapRpcError(error) : null;
}
