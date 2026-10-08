import type { TenantScope } from "@/lib/anbar/scope";
import { isRecord, type CatalogProduct } from "@/lib/scanner/model";

/** Product suggestions shown under one invoice line. */
export const SUGGESTION_COUNT = 6;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

function parseProduct(row: unknown): CatalogProduct | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  return id && name !== null ? { id, name } : null;
}

const normalized = (name: string) => name.trim().toLowerCase();

/** LIKE pattern matching the text literally (case-insensitive with ilike). */
const literalPattern = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Product with exactly this name (trimmed, case-insensitive), or null. */
async function productNamed(scope: TenantScope, name: string): Promise<CatalogProduct | null> {
  const needle = normalized(name);
  if (!needle) return null;
  const { data, error } = await scope.client
    .from("products")
    .select("id, name")
    .eq("tenant_id", scope.tenantId)
    .ilike("name", literalPattern(name.trim()))
    .order("name")
    .order("id")
    .range(0, SUGGESTION_COUNT - 1);
  if (error) throw error;
  const rows = (data ?? []).map(parseProduct).filter((row): row is CatalogProduct => row !== null);
  return rows.find((row) => normalized(row.name) === needle) ?? null;
}

/** Recognized invoice line names -> the product with that name, when there is one. */
export async function matchProducts(scope: TenantScope, names: string[]): Promise<Record<string, CatalogProduct | null>> {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  const found = await Promise.all(unique.map(async (name) => [name, await productNamed(scope, name)] as const));
  return Object.fromEntries(found);
}

/** Products whose name, barcode or code contains the text (wildcards matched literally). */
export async function searchProducts(scope: TenantScope, text: string): Promise<CatalogProduct[]> {
  const page = await scope.client.rpc("catalog_page", {
    p_search: text,
    p_offset: 0,
    p_limit: SUGGESTION_COUNT,
  });
  if (page.error) throw page.error;
  const ids = (Array.isArray(page.data) ? page.data : []).flatMap((row: unknown) =>
    isRecord(row) && typeof row.id === "string" ? [row.id] : [],
  );
  if (ids.length === 0) return [];
  const { data, error } = await scope.client
    .from("products")
    .select("id, name")
    .eq("tenant_id", scope.tenantId)
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map(parseProduct).filter((row): row is CatalogProduct => row !== null).map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
}
