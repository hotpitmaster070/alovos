"use server";

import { revalidatePath } from "next/cache";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { todayIn } from "@/lib/tenant-settings/time";
import { failure, success, type ActionResult, type AnbarErrorCode } from "./errors";
import {
  createProductWithBarcode,
  findProductByBarcode,
  getCatalogLine,
  createStorageLocations,
  insertStorageLocation,
  receiveStock,
  updateExpiry,
  updateStorageLocation,
} from "./repository";
import { resolveScope, type TenantScope } from "./scope";
import type { CatalogLine, CatalogProduct, StorageLocation } from "./types";
import {
  normalizeCode,
  validateBarcodeProductInput,
  validateExpiryInput,
  validateReceiptInput,
  validateStorageLocationInput,
} from "./validation";

const ANBAR_PATH = "/app/anbar";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTINGS_PATH = "/app/sebeke";

async function scopeOrFailure(): Promise<{ scope: TenantScope } | { error: AnbarErrorCode }> {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated" || resolved.status === "no_organization") {
    return { error: "unauthenticated" };
  }
  if (resolved.status === "error") return { error: "saveFailed" };
  return { scope: resolved.scope };
}

export type LookupResult =
  | { ok: true; code: string; product: CatalogProduct | null }
  | { ok: false; error: AnbarErrorCode };

/** Scanner lookup: the product for a factory barcode or internal code, or null when it is new. */
export async function lookupCodeAction(raw: string): Promise<LookupResult> {
  const code = normalizeCode(raw);
  if (!code) return { ok: false, error: "invalidInput" };
  const current = await scopeOrFailure();
  if ("error" in current) return { ok: false, error: current.error };
  try {
    return { ok: true, code, product: await findProductByBarcode(current.scope, code) };
  } catch (error) {
    console.error("lookupCodeAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "saveFailed" };
  }
}

export type CatalogLookupResult =
  | { ok: true; code: string; line: CatalogLine | null }
  | { ok: false; error: AnbarErrorCode };

/** Catalog scan or Enter: the product for a code with its stock in the branch, or null when it is new. */
export async function lookupCatalogLineAction(raw: string, branchId: string | null): Promise<CatalogLookupResult> {
  const code = normalizeCode(raw);
  if (!code || (branchId !== null && !UUID.test(branchId))) return { ok: false, error: "invalidInput" };
  const current = await scopeOrFailure();
  if ("error" in current) return { ok: false, error: current.error };
  try {
    const product = await findProductByBarcode(current.scope, code);
    if (!product) return { ok: true, code, line: null };
    const line = await getCatalogLine(current.scope, product.id, branchId);
    return { ok: true, code, line: line ?? { ...product, stock: 0, nearestExpiry: product.expiryDate, value: 0 } };
  } catch (error) {
    console.error("lookupCatalogLineAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "saveFailed" };
  }
}

export type CreateProductResult = { ok: true; product: CatalogProduct } | { ok: false; error: AnbarErrorCode };

export async function createBarcodeProductAction(data: FormData): Promise<CreateProductResult> {
  const input = validateBarcodeProductInput(data);
  if (!input.ok) return { ok: false, error: input.error };
  const current = await scopeOrFailure();
  if ("error" in current) return { ok: false, error: current.error };

  try {
    if (input.value.barcode && (await findProductByBarcode(current.scope, input.value.barcode))) {
      return { ok: false, error: "duplicateBarcode" };
    }
    const created = await createProductWithBarcode(current.scope, input.value);
    if (created.ok) revalidatePath(ANBAR_PATH, "layout");
    return created;
  } catch (error) {
    console.error("createBarcodeProductAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "saveFailed" };
  }
}

export type StorageLocationResult = { ok: true; location: StorageLocation } | { ok: false; error: AnbarErrorCode };

export async function addStorageLocationAction(data: FormData): Promise<StorageLocationResult> {
  const input = validateStorageLocationInput(data);
  if (!input.ok) return { ok: false, error: input.error };
  const current = await scopeOrFailure();
  if ("error" in current) return { ok: false, error: current.error };

  try {
    const created = await insertStorageLocation(current.scope, input.value);
    if (created.ok) {
      revalidatePath(ANBAR_PATH, "layout");
      revalidatePath(SETTINGS_PATH);
    }
    return created;
  } catch (error) {
    console.error("addStorageLocationAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "saveFailed" };
  }
}

export type StorageLocationsResult = { ok: true; locations: StorageLocation[] } | { ok: false; error: AnbarErrorCode };

/** One or more places of a type (fields: type, branchId, count, name or name_prefix, number). */
export async function createStorageLocationsAction(data: FormData): Promise<StorageLocationsResult> {
  const input = validateStorageLocationInput(data);
  if (!input.ok) return { ok: false, error: input.error };
  const current = await scopeOrFailure();
  if ("error" in current) return { ok: false, error: current.error };
  try {
    const created = await createStorageLocations(current.scope, input.value);
    if (created.ok) {
      revalidatePath(ANBAR_PATH, "layout");
      revalidatePath(SETTINGS_PATH);
    }
    return created;
  } catch (error) {
    console.error("createStorageLocationsAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "saveFailed" };
  }
}

/** Soft delete or restore; refused while a stock count is open there. */
export async function setStorageLocationActiveAction(id: string, active: boolean): Promise<ActionResult> {
  if (!UUID.test(id)) return failure("invalidInput");
  const current = await scopeOrFailure();
  if ("error" in current) return failure(current.error);
  try {
    const error = await updateStorageLocation(current.scope, id, { isActive: active });
    if (error) return failure(error);
    revalidatePath(ANBAR_PATH, "layout");
    revalidatePath(SETTINGS_PATH);
    return success;
  } catch (error) {
    console.error("setStorageLocationActiveAction failed", error instanceof Error ? error.message : "unknown");
    return failure("saveFailed");
  }
}

export type ExpiryActionResult =
  | { ok: true; lotsUpdated: number; line: CatalogLine | null }
  | { ok: false; error: AnbarErrorCode };

export async function updateExpiryAction(data: FormData): Promise<ExpiryActionResult> {
  const current = await scopeOrFailure();
  if ("error" in current) return failure(current.error);

  try {
    const settings = await getSettings(current.scope);
    const input = validateExpiryInput(data, todayIn(settings.timezone, new Date()));
    if (!input.ok) return failure(input.error);

    const updated = await updateExpiry(current.scope, input.value.productId, input.value.expiryDate);
    if (!updated.ok) return updated;

    revalidatePath(ANBAR_PATH, "layout");
    const line = await getCatalogLine(current.scope, input.value.productId, input.value.branchId);
    return { ok: true, lotsUpdated: updated.lotsUpdated, line };
  } catch (error) {
    console.error("updateExpiryAction failed", error instanceof Error ? error.message : "unknown");
    return failure("saveFailed");
  }
}

export async function receiveStockAction(data: FormData): Promise<ActionResult> {
  const input = validateReceiptInput(data);
  if (!input.ok) return failure(input.error);
  const current = await scopeOrFailure();
  if ("error" in current) return failure(current.error);

  try {
    const error = await receiveStock(current.scope, input.value);
    if (error) return failure(error);
  } catch (error) {
    console.error("receiveStockAction failed", error instanceof Error ? error.message : "unknown");
    return failure("saveFailed");
  }
  revalidatePath(ANBAR_PATH, "layout");
  return success;
}
