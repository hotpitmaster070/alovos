import { PAGE_SIZE, pageRange } from "@/lib/pagination";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { lotCosts, productPrices } from "./costs";
import { mapRpcError, type AnbarErrorCode } from "./errors";
import { parseBranch, parseCatalogProduct, parseRows, parseStockLot, parseStorageLocation } from "./parse";
import type { TenantScope } from "./scope";
import { compareStorageLocations, type Branch, type CatalogLine, type CatalogProduct, type StorageLocation } from "./types";
import type { BarcodeProductInput, ReceiptInput, StorageLocationInput } from "./validation";

/**
 * All catalog and storage reads and writes live here. Every statement is built from a TenantScope and
 * carries .eq("tenant_id", tenantId) (inserts set tenant_id explicitly); RLS is the second line of
 * defence, not the only one. Stock changes only through stock_movements.
 */

const CATALOG_COLUMNS =
  "id, name, barcode, internal_code, photo_url, category, unit, shelf_life_days, min_stock, expiry_date, branch_id, storage_location_id, branch:branches(name)";

const withPrice = (product: CatalogProduct, prices: Map<string, number>): CatalogProduct => ({
  ...product,
  pricePerUnit: prices.get(product.id) ?? null,
});

export type CatalogFilters = {
  branchId: string | null;
  search: string | null;
  category: string | null;
  lowOnly: boolean;
};

export const NO_CATALOG_FILTERS: CatalogFilters = { branchId: null, search: null, category: null, lowOnly: false };

type CatalogPageRow = { id: string; stock: number; nearestExpiry: string | null; total: number };

function parseCatalogPageRow(row: unknown): CatalogPageRow | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const stock = Number(record.stock);
  const total = Number(record.total_count);
  if (typeof record.id !== "string" || !Number.isFinite(stock) || !Number.isFinite(total)) return null;
  return {
    id: record.id,
    stock,
    nearestExpiry: typeof record.nearest_expiry === "string" ? record.nearest_expiry : null,
    total,
  };
}

/** Filtering, low-stock rule, ordering and the total count run in catalog_page. */
async function catalogPage(
  scope: TenantScope,
  filters: CatalogFilters,
  offset: number,
  limit: number,
  productId: string | null = null,
): Promise<CatalogPageRow[]> {
  const { data, error } = await scope.client.rpc("catalog_page", {
    p_branch_id: filters.branchId,
    p_search: filters.search,
    p_category: filters.category,
    p_low_only: filters.lowOnly,
    p_product_id: productId,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw error;
  return parseRows(data, parseCatalogPageRow);
}

/** Product details, price and stock value for the rows of one page, in page order. */
async function catalogLines(scope: TenantScope, branchId: string | null, rows: CatalogPageRow[]): Promise<CatalogLine[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [productRows, lots, prices, costs] = await Promise.all([
    scope.client.from("products").select(CATALOG_COLUMNS).eq("tenant_id", scope.tenantId).in("id", ids),
    fetchAll((from, to) => {
      let query = scope.client
        .from("product_stocks")
        .select("id, product_id, quantity, expiry_date")
        .eq("tenant_id", scope.tenantId)
        .in("product_id", ids)
        .gt("quantity", 0);
      if (branchId) query = query.eq("branch_id", branchId);
      return query.order("id").range(from, to);
    }),
    productPrices(scope, ids),
    lotCosts(scope, { productIds: ids, branchId }),
  ]);
  if (productRows.error) throw productRows.error;

  const values = new Map<string, number>();
  for (const lot of parseRows(lots, parseStockLot)) {
    values.set(lot.productId, (values.get(lot.productId) ?? 0) + lot.quantity * (costs.get(lot.id) ?? 0));
  }
  const products = new Map(parseRows(productRows.data, parseCatalogProduct).map((product) => [product.id, product]));

  return rows.flatMap((row) => {
    const found = products.get(row.id);
    if (!found) return [];
    const product = withPrice(found, prices);
    const value = values.get(row.id) ?? 0;
    return [
      {
        ...product,
        stock: row.stock,
        nearestExpiry: row.nearestExpiry,
        value: value > 0 ? value : row.stock * (product.pricePerUnit ?? 0),
      },
    ];
  });
}

/**
 * One page of the catalog for block 1.1: products of the branch (or shared ones without a branch)
 * with stock, nearest lot expiry and value, plus the number of products matching the filters.
 */
export async function listCatalog(
  scope: TenantScope,
  filters: CatalogFilters,
  page: number,
): Promise<{ lines: CatalogLine[]; total: number }> {
  const { from } = pageRange(page);
  const rows = await catalogPage(scope, filters, from, PAGE_SIZE);
  if (rows.length === 0) {
    const total = from > 0 ? ((await catalogPage(scope, filters, 0, 1))[0]?.total ?? 0) : 0;
    return { lines: [], total };
  }
  return { lines: await catalogLines(scope, filters.branchId, rows), total: rows[0].total };
}

/** One catalog line, e.g. a scanned product that is not on the current page. */
export async function getCatalogLine(
  scope: TenantScope,
  productId: string,
  branchId: string | null,
): Promise<CatalogLine | null> {
  const rows = await catalogPage(scope, { ...NO_CATALOG_FILTERS, branchId }, 0, 1, productId);
  return (await catalogLines(scope, branchId, rows))[0] ?? null;
}

export async function listCatalogCategories(scope: TenantScope, branchId: string | null): Promise<string[]> {
  const rows = await fetchAll((from, to) =>
    scope.client.rpc("catalog_categories", { p_branch_id: branchId }).order("category").range(from, to),
  );
  return rows.flatMap((row) =>
    typeof row === "object" && row !== null && typeof (row as { category?: unknown }).category === "string"
      ? [(row as { category: string }).category]
      : [],
  );
}

async function withProductPrice(scope: TenantScope, product: CatalogProduct | undefined): Promise<CatalogProduct | null> {
  if (!product) return null;
  return withPrice(product, await productPrices(scope, [product.id]));
}

/**
 * Products whose name, internal code, barcode or category contains the text (catalog_page escapes the
 * ILIKE wildcards), in catalog order.
 */
export async function searchProducts(scope: TenantScope, search: string, limit: number): Promise<CatalogProduct[]> {
  const rows = await catalogPage(scope, { ...NO_CATALOG_FILTERS, search }, 0, limit);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [productRows, prices] = await Promise.all([
    scope.client.from("products").select(CATALOG_COLUMNS).eq("tenant_id", scope.tenantId).in("id", ids),
    productPrices(scope, ids),
  ]);
  if (productRows.error) throw productRows.error;
  const products = new Map(parseRows(productRows.data, parseCatalogProduct).map((product) => [product.id, product]));
  return ids.flatMap((id) => {
    const product = products.get(id);
    return product ? [withPrice(product, prices)] : [];
  });
}

/** Looks a scanned code up as a factory barcode first, then as our internal code. */
export async function findProductByBarcode(scope: TenantScope, code: string): Promise<CatalogProduct | null> {
  const byBarcode = await scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("barcode", code)
    .order("created_at")
    .limit(1);
  if (byBarcode.error) throw byBarcode.error;
  const found = parseRows(byBarcode.data, parseCatalogProduct)[0];
  if (found) return withProductPrice(scope, found);

  const byInternal = await scope.client
    .from("products")
    .select(CATALOG_COLUMNS)
    .eq("tenant_id", scope.tenantId)
    .eq("internal_code", code)
    .limit(1);
  if (byInternal.error) throw byInternal.error;
  return withProductPrice(scope, parseRows(byInternal.data, parseCatalogProduct)[0]);
}

export async function createProductWithBarcode(
  scope: TenantScope,
  input: BarcodeProductInput,
): Promise<{ ok: true; product: CatalogProduct } | { ok: false; error: AnbarErrorCode }> {
  const { data, error } = await scope.client
    .from("products")
    .insert({
      tenant_id: scope.tenantId,
      name: input.name,
      barcode: input.barcode,
      category: input.category,
      unit: input.unit,
      cost: input.pricePerUnit,
      shelf_life_days: input.shelfLifeDays,
      min_stock: input.minStock,
      expiry_date: input.expiryDate,
      branch_id: input.branchId,
      storage_location_id: input.storageLocationId,
      ...(input.productType && { product_type: input.productType }),
    })
    .select(CATALOG_COLUMNS)
    .single();
  if (error) return { ok: false, error: mapRpcError(error) };
  const product = await withProductPrice(scope, parseCatalogProduct(data) ?? undefined);
  return product ? { ok: true, product } : { ok: false, error: "saveFailed" };
}

/** Writes products.expiry_date and every in-date lot in one transaction. Returns how many stock lots changed. */
export async function updateExpiry(
  scope: TenantScope,
  productId: string,
  expiryDate: string | null,
): Promise<{ ok: true; lotsUpdated: number } | { ok: false; error: AnbarErrorCode }> {
  const { data, error } = await scope.client.rpc("update_product_and_lots_expiry", {
    p_product_id: productId,
    p_expiry: expiryDate,
  });
  if (error) return { ok: false, error: mapRpcError(error) };
  const lotsUpdated = typeof data === "number" ? data : typeof data === "string" ? Number(data) : Number.NaN;
  if (!Number.isInteger(lotsUpdated) || lotsUpdated < 0) return { ok: false, error: "saveFailed" };
  return { ok: true, lotsUpdated };
}

export async function listBranches(scope: TenantScope): Promise<Branch[]> {
  const rows = await fetchAll((from, to) =>
    scope.client.from("branches").select("id, name, code").eq("tenant_id", scope.tenantId).order("name").order("id").range(from, to),
  );
  return parseRows(rows, parseBranch);
}

export const STORAGE_COLUMNS = "id, name, type, number, code, branch_id, is_active";

/** Active locations of one branch, or of every branch when branchId is null; type order, then number. */
export async function listStorageLocations(
  scope: TenantScope,
  { branchId = null, includeInactive = false }: { branchId?: string | null; includeInactive?: boolean } = {},
): Promise<StorageLocation[]> {
  const rows = await fetchAll((from, to) => {
    let query = scope.client.from("storage_locations").select(STORAGE_COLUMNS).eq("tenant_id", scope.tenantId);
    if (branchId) query = query.eq("branch_id", branchId);
    if (!includeInactive) query = query.eq("is_active", true);
    return query.order("id").range(from, to);
  });
  return parseRows(rows, parseStorageLocation).sort(compareStorageLocations);
}

/** A storage place with its product count and the stock count going on there, if any. */
export type StorageOverview = StorageLocation & {
  productCount: number;
  openCount: { id: string; status: string; counters: number } | null;
};

/** Places of one branch (or all) in display order, from public.storage_locations_overview(). */
export async function storageOverview(
  scope: TenantScope,
  { branchId = null, includeInactive = false }: { branchId?: string | null; includeInactive?: boolean } = {},
): Promise<StorageOverview[]> {
  const rows = await fetchAll((from, to) =>
    scope.client
      .rpc("storage_locations_overview", { p_branch_id: branchId, p_include_inactive: includeInactive })
      .range(from, to),
  );
  return rows.flatMap((row: unknown) => {
    const location = parseStorageLocation(row);
    if (!location || typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    const openId = typeof record.open_count_id === "string" ? record.open_count_id : null;
    return [
      {
        ...location,
        productCount: Number(record.product_count ?? 0),
        openCount:
          openId && typeof record.open_status === "string"
            ? { id: openId, status: record.open_status, counters: Number(record.open_counters ?? 0) }
            : null,
      },
    ];
  });
}

const storageError = (error: { code?: unknown; message?: unknown }): AnbarErrorCode => {
  const mapped = mapRpcError(error);
  return mapped === "duplicateBarcode" ? "duplicateLocation" : mapped;
};

/**
 * Creates places of one type in a branch through public.create_storage_locations_bulk(): numbers
 * continue after the highest of that branch and type unless a free number is given (one place).
 * name names a single place; otherwise places are called "<namePrefix> #<number>".
 */
export async function createStorageLocations(
  scope: TenantScope,
  input: StorageLocationInput,
): Promise<{ ok: true; locations: StorageLocation[] } | { ok: false; error: AnbarErrorCode }> {
  const { data, error } = await scope.client.rpc("create_storage_locations_bulk", {
    p_branch_id: input.branchId,
    p_type: input.type,
    p_count: input.count,
    p_number: input.number,
    p_name: input.name,
    p_name_prefix: input.namePrefix,
  });
  if (error) return { ok: false, error: storageError(error) };
  const locations = parseRows(Array.isArray(data) ? data : [], parseStorageLocation);
  return locations.length === input.count ? { ok: true, locations } : { ok: false, error: "saveFailed" };
}

export async function insertStorageLocation(
  scope: TenantScope,
  input: StorageLocationInput,
): Promise<{ ok: true; location: StorageLocation } | { ok: false; error: AnbarErrorCode }> {
  const created = await createStorageLocations(scope, { ...input, count: 1 });
  return created.ok ? { ok: true, location: created.locations[0] } : created;
}

export async function updateStorageLocation(
  scope: TenantScope,
  id: string,
  patch: { name?: string; isActive?: boolean },
): Promise<AnbarErrorCode | null> {
  const { error } = await scope.client
    .from("storage_locations")
    .update({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.isActive !== undefined && { is_active: patch.isActive }),
    })
    .eq("tenant_id", scope.tenantId)
    .eq("id", id);
  return error ? storageError(error) : null;
}

/**
 * Goods receipt: public.receive_stock_rpc() writes one 'prihod' movement (clients cannot insert
 * movements); the stock_movements trigger adds the lot to product_stocks.
 */
export async function receiveStock(scope: TenantScope, input: ReceiptInput): Promise<AnbarErrorCode | null> {
  const [location, product] = await Promise.all([
    scope.client
      .from("storage_locations")
      .select("id, branch_id")
      .eq("tenant_id", scope.tenantId)
      .eq("id", input.locationId)
      .eq("is_active", true)
      .maybeSingle(),
    scope.client
      .from("products")
      .select("id, unit")
      .eq("tenant_id", scope.tenantId)
      .eq("id", input.productId)
      .maybeSingle(),
  ]);
  if (location.error || product.error) return "saveFailed";
  if (!location.data) return "locationNotFound";
  if (!product.data) return "productNotFound";

  const { error } = await scope.client.rpc("receive_stock_rpc", {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_quantity: input.qty,
    p_cost_per_unit: input.pricePerUnit,
    p_expiry_date: input.expiryDate,
    p_unit: typeof product.data.unit === "string" ? product.data.unit : null,
  });
  return error ? mapRpcError(error) : null;
}
