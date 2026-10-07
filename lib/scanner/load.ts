import type { KitchenLocation } from "@/lib/anbar/stock-view";
import type { OrgScope } from "@/lib/anbar/scope";
import { isRecord, type CatalogProduct } from "@/lib/scanner/model";

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

function parseLocation(row: unknown): KitchenLocation | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const type = asString(row.type);
  if (!id || name === null || type === null) return null;
  return { id, name, type, branchId: asString(row.branch_id) };
}

function parseProduct(row: unknown): CatalogProduct | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  return id && name !== null ? { id, name } : null;
}

export async function listScannerCatalog(scope: OrgScope): Promise<{
  locations: KitchenLocation[];
  products: CatalogProduct[];
}> {
  const [locations, products] = await Promise.all([
    scope.client
      .from("storage_locations")
      .select("id, name, type, branch_id")
      .eq("tenant_id", scope.tenantId)
      .order("name")
      .limit(50),
    scope.client
      .from("products")
      .select("id, name")
      .eq("tenant_id", scope.tenantId)
      .order("name")
      .limit(500),
  ]);
  if (locations.error) throw locations.error;
  if (products.error) throw products.error;
  return {
    locations: (locations.data ?? []).map(parseLocation).filter((row): row is KitchenLocation => row !== null),
    products: (products.data ?? []).map(parseProduct).filter((row): row is CatalogProduct => row !== null),
  };
}
