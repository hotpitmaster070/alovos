"use server";

import { revalidatePath } from "next/cache";
import { failure, success, type ActionResult, type AnbarErrorCode } from "./errors";
import {
  createProductWithBarcode,
  findProductByBarcode,
  insertLocation,
  insertProduct,
  locationExists,
  moveStockRpc,
  receiveStock,
  updateExpiry,
} from "./repository";
import { resolveScope, type OrgScope } from "./scope";
import type { CatalogProduct } from "./types";
import {
  normalizeCode,
  validateBarcodeProductInput,
  validateExpiryInput,
  validateLocationName,
  validateMoveInput,
  validateProductInput,
  validateReceiptInput,
} from "./validation";

const ANBAR_PATH = "/app/anbar";

async function scopeOrFailure(): Promise<{ scope: OrgScope } | { error: AnbarErrorCode }> {
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

export async function updateExpiryAction(data: FormData): Promise<ActionResult> {
  const input = validateExpiryInput(data);
  if (!input.ok) return failure(input.error);
  const current = await scopeOrFailure();
  if ("error" in current) return failure(current.error);

  const error = await updateExpiry(current.scope, input.value.productId, input.value.expiryDate);
  if (error) return failure(error);
  revalidatePath(ANBAR_PATH, "layout");
  return success;
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

/** Every action re-verifies the session and re-resolves the organization; nothing is trusted from the client. */
export async function moveStockAction(data: FormData): Promise<ActionResult> {
  const input = validateMoveInput(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated" || resolved.status === "no_organization") {
    return failure("unauthenticated");
  }
  if (resolved.status === "error") return failure("saveFailed");

  const error = await moveStockRpc(resolved.scope, input.value);
  if (error) return failure(error);

  revalidatePath(ANBAR_PATH);
  return success;
}

export async function addProductAction(data: FormData): Promise<ActionResult> {
  const input = validateProductInput(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated" || resolved.status === "no_organization") {
    return failure("unauthenticated");
  }
  if (resolved.status === "error") return failure("saveFailed");

  const { scope } = resolved;
  try {
    if (input.value.locationId && !(await locationExists(scope, input.value.locationId))) {
      return failure("locationNotFound");
    }
    const error = await insertProduct(scope, input.value);
    if (error) return failure(error);
  } catch (error) {
    console.error("addProductAction failed", error instanceof Error ? error.message : "unknown");
    return failure("saveFailed");
  }

  revalidatePath(ANBAR_PATH);
  return success;
}

export async function addLocationAction(data: FormData): Promise<ActionResult> {
  const input = validateLocationName(data);
  if (!input.ok) return failure(input.error);

  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated" || resolved.status === "no_organization") {
    return failure("unauthenticated");
  }
  if (resolved.status === "error") return failure("saveFailed");

  const error = await insertLocation(resolved.scope, input.name);
  if (error) return failure(error);

  revalidatePath(ANBAR_PATH);
  return success;
}
