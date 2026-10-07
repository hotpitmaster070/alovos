import { PAGE_SIZE, LOW_STOCK_THRESHOLD } from "./constants";
import { mapRpcError, type AnbarErrorCode } from "./errors";
import {
  parseBranch,
  parseCatalogProduct,
  parseLocation,
  parseProduct,
  parseRows,
  parseStockLot,
  parseStorageLocation,
} from "./parse";
import type { OrgScope } from "./scope";
import type { Branch, CatalogLine, CatalogProduct, Location, Product, StorageLocation } from "./types";
import { addDaysUtc, toDateOnly } from "@/lib/expiry";
import type { BarcodeProductInput, MoveInput, ProductFilters, ProductInput, ReceiptInput } from "./validation";

const PRODUCT_COLUMNS = "id, name, barcode, expiry_date, qty, unit, cost, location_id";

/**
 * All reads and writes of products/locations live here. Every statement is built from an OrgScope
 * and carries .eq("organization_id", orgId) (inserts set organization_id explicitly); RLS is the
 * second line of defence, not the only one. Stock moves go through the move_stock RPC only.
 */

const CATALOG_COLUMNS =
  "id, name, barcode, internal_code, photo_url, unit, cost, expiry_date, branch_id, branch:branches(name)";

/**
 * Catalog for block 1.1. Products of the branch (or shared ones without a branch) with their
 * stock from product_stocks: total quantity, nearest lot expiry and value.
 */
export async function listCatalog(scope: OrgScope, branchId: string | null): Promise<CatalogLine[]> {
  let products = scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("organization_id", scope.orgId);
  if (branchId) products = products.or(`branch_id.eq.${branchId},branch_id.is.null`);

  let lots = scope.client
    .from("product_stocks")
    .select("product_id, quantity, expiry_date, cost_per_unit")
    .eq("tenant_id", scope.tenantId)
    .gt("quantity", 0);
  if (branchId) lots = lots.eq("branch_id", branchId);

  const [productRows, lotRows] = await Promise.all([products.order("name").limit(500), lots.limit(5000)]);
  if (productRows.error) throw productRows.error;
  if (lotRows.error) throw lotRows.error;

  const byProduct = new Map<string, { stock: number; nearestExpiry: string | null; value: number }>();
  for (const lot of parseRows(lotRows.data, parseStockLot)) {
    const entry = byProduct.get(lot.productId) ?? { stock: 0, nearestExpiry: null, value: 0 };
    entry.stock += lot.quantity;
    entry.value += lot.quantity * (lot.costPerUnit ?? 0);
    if (lot.expiryDate && (!entry.nearestExpiry || lot.expiryDate < entry.nearestExpiry)) {
      entry.nearestExpiry = lot.expiryDate;
    }
    byProduct.set(lot.productId, entry);
  }

  return parseRows(productRows.data, parseCatalogProduct).map((product) => {
    const entry = byProduct.get(product.id);
    return {
      ...product,
      stock: entry?.stock ?? 0,
      nearestExpiry: entry?.nearestExpiry ?? product.expiryDate,
      value: entry && entry.value > 0 ? entry.value : (entry?.stock ?? 0) * (product.pricePerUnit ?? 0),
    };
  });
}

/** Looks a scanned code up as a factory barcode first, then as our internal code. */
export async function findProductByBarcode(scope: OrgScope, code: string): Promise<CatalogProduct | null> {
  const byBarcode = await scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("organization_id", scope.orgId)
    .eq("barcode", code)
    .order("created_at")
    .limit(1);
  if (byBarcode.error) throw byBarcode.error;
  const found = parseRows(byBarcode.data, parseCatalogProduct)[0];
  if (found) return found;

  const byInternal = await scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("organization_id", scope.orgId)
    .eq("internal_code", code)
    .limit(1);
  if (byInternal.error) throw byInternal.error;
  return parseRows(byInternal.data, parseCatalogProduct)[0] ?? null;
}

export async function createProductWithBarcode(
  scope: OrgScope,
  input: BarcodeProductInput,
): Promise<{ ok: true; product: CatalogProduct } | { ok: false; error: AnbarErrorCode }> {
  const { data, error } = await scope.client
    .from("products")
    .insert({
      organization_id: scope.orgId,
      tenant_id: scope.tenantId,
      name: input.name,
      barcode: input.barcode,
      unit: input.unit,
      cost: input.pricePerUnit,
      expiry_date: input.expiryDate,
      branch_id: input.branchId,
    })
    .select(CATALOG_COLUMNS)
    .single();
  if (error) return { ok: false, error: mapRpcError(error) };
  const product = parseCatalogProduct(data);
  return product ? { ok: true, product } : { ok: false, error: "saveFailed" };
}

export async function updateExpiry(
  scope: OrgScope,
  productId: string,
  expiryDate: string | null,
): Promise<AnbarErrorCode | null> {
  const { error } = await scope.client.rpc("set_product_expiry", {
    p_product_id: productId,
    p_expiry: expiryDate,
  });
  return error ? mapRpcError(error) : null;
}

export async function listBranches(scope: OrgScope): Promise<Branch[]> {
  const { data, error } = await scope.client
    .from("branches")
    .select("id, name")
    .eq("tenant_id", scope.tenantId)
    .order("name")
    .limit(200);
  if (error) throw error;
  return parseRows(data, parseBranch);
}

export async function listStorageLocations(scope: OrgScope): Promise<StorageLocation[]> {
  const { data, error } = await scope.client
    .from("storage_locations")
    .select("id, name, type, branch_id")
    .eq("tenant_id", scope.tenantId)
    .order("name")
    .limit(200);
  if (error) throw error;
  return parseRows(data, parseStorageLocation);
}

/** Goods receipt: one 'prihod' movement; the stock_movements trigger adds the lot to product_stocks. */
export async function receiveStock(scope: OrgScope, input: ReceiptInput): Promise<AnbarErrorCode | null> {
  const [location, product] = await Promise.all([
    scope.client
      .from("storage_locations")
      .select("id, branch_id")
      .eq("tenant_id", scope.tenantId)
      .eq("id", input.locationId)
      .maybeSingle(),
    scope.client
      .from("products")
      .select("id, unit")
      .eq("tenant_id", scope.tenantId)
      .eq("organization_id", scope.orgId)
      .eq("id", input.productId)
      .maybeSingle(),
  ]);
  if (location.error || product.error) return "saveFailed";
  if (!location.data) return "locationNotFound";
  if (!product.data) return "productNotFound";

  const { error } = await scope.client.from("stock_movements").insert({
    tenant_id: scope.tenantId,
    product_id: input.productId,
    branch_id: location.data.branch_id ?? null,
    to_location_id: input.locationId,
    quantity: input.qty,
    movement_type: "prihod",
    expiry_date: input.expiryDate,
    cost_per_unit: input.pricePerUnit,
    unit: typeof product.data.unit === "string" ? product.data.unit : null,
  });
  return error ? mapRpcError(error) : null;
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
