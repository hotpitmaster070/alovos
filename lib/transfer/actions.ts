"use server";

import { resolveScope } from "@/lib/anbar/scope";
import type { TransferOption } from "./cart";
import { TRANSFER_MAX_ITEMS } from "./model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_LIMIT = 20;

export type TransferOptionsError = "unauthenticated" | "forbidden" | "invalid_input" | "not_found" | "save_failed";
export type TransferOptionsResult = { ok: true; options: TransferOption[] } | { ok: false; error: TransferOptionsError };

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function toOption(row: Record<string, unknown>): TransferOption | null {
  if (typeof row.product_id !== "string" || typeof row.name !== "string") return null;
  const available = Number(row.available);
  return {
    productId: row.product_id,
    name: row.name,
    internalCode: text(row.internal_code),
    barcode: text(row.barcode),
    unit: text(row.unit) ?? "",
    available: Number.isFinite(available) ? available : 0,
    nearestExpiry: text(row.nearest_expiry)?.slice(0, 10) ?? null,
  };
}

/**
 * Stock the source branch (or one place of it) can send, from public.transfer_stock_options():
 * a search on name / ALO code / barcode, or the given products (availability after a source change).
 */
export async function transferOptionsAction(input: {
  branchId: string;
  locationId: string | null;
  search?: string;
  productIds?: string[];
}): Promise<TransferOptionsResult> {
  const search = (input.search ?? "").trim();
  const productIds = input.productIds ?? null;
  if (
    !UUID.test(input.branchId) ||
    (input.locationId !== null && !UUID.test(input.locationId)) ||
    search.length > 100 ||
    (productIds !== null && (productIds.length > TRANSFER_MAX_ITEMS || !productIds.every((id) => UUID.test(id))))
  ) {
    return { ok: false, error: "invalid_input" };
  }
  if (productIds !== null && productIds.length === 0) return { ok: true, options: [] };

  const resolved = await resolveScope();
  if (resolved.status !== "ok") return { ok: false, error: resolved.status === "error" ? "save_failed" : "unauthenticated" };

  const { data, error } = await resolved.scope.client.rpc("transfer_stock_options", {
    p_branch_id: input.branchId,
    p_location_id: input.locationId,
    p_search: productIds ? null : search || null,
    p_product_ids: productIds,
    p_limit: SEARCH_LIMIT,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("forbidden")) return { ok: false, error: "forbidden" };
    if (message.includes("not_found")) return { ok: false, error: "not_found" };
    if (message.includes("invalid_input")) return { ok: false, error: "invalid_input" };
    console.error("transfer_stock_options failed", message);
    return { ok: false, error: "save_failed" };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { ok: true, options: rows.flatMap((row) => toOption(row) ?? []) };
}
