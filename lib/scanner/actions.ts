"use server";

import { resolveScope } from "@/lib/anbar/scope";
import { parseSearch, SEARCH_MAX_LENGTH } from "@/lib/pagination";
import { matchProducts, searchProducts } from "./load";
import type { CatalogProduct } from "./model";

export type ProductMatchResult = { ok: true; products: Record<string, CatalogProduct | null> } | { ok: false };
export type ProductSearchResult = { ok: true; products: CatalogProduct[] } | { ok: false };

/** Recognized lines are matched by exact name; at most one lookup per line of the scan. */
export async function matchScannedProductsAction(names: string[]): Promise<ProductMatchResult> {
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) return { ok: false };
  const resolved = await resolveScope();
  if (resolved.status !== "ok") return { ok: false };
  try {
    return { ok: true, products: await matchProducts(resolved.scope, names.map((name) => name.slice(0, SEARCH_MAX_LENGTH))) };
  } catch (error) {
    console.error("matchScannedProductsAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false };
  }
}

export async function searchScannerProductsAction(text: string): Promise<ProductSearchResult> {
  const search = parseSearch(text);
  if (!search) return { ok: true, products: [] };
  const resolved = await resolveScope();
  if (resolved.status !== "ok") return { ok: false };
  try {
    return { ok: true, products: await searchProducts(resolved.scope, search) };
  } catch (error) {
    console.error("searchScannerProductsAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false };
  }
}
