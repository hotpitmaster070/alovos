"use server";

import { revalidatePath } from "next/cache";
import { createProductWithBarcode } from "@/lib/anbar/repository";
import { resolveScope, type TenantScope } from "@/lib/anbar/scope";
import type { Unit } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, ANBAR_RECEIVING_PATH, CHEF_RECEIVING_PATH } from "@/lib/auth-redirect";
import {
  DELEGATION_DURATIONS,
  DELEGATION_REASON_MAX,
  isUuid,
  mapReceivingError,
  parseProducts,
  parseReceipt,
  RECEIVING_MAX_LINES,
  RECEIVING_MAX_PRICE,
  RECEIVING_MAX_QUANTITY,
  SCAN_MAX_ROWS,
  type ReceiptLineInput,
  type DelegationDuration,
  type ReceiptResult,
  type ReceivingErrorCode,
  type ReceivingProduct,
} from "./model";

type Failure = { ok: false; error: ReceivingErrorCode };
export type ReceivingResult<T> = { ok: true; value: T } | Failure;

async function scopeOrError(): Promise<{ scope: TenantScope } | Failure> {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return { ok: false, error: "unauthenticated" };
  if (resolved.status === "no_organization") return { ok: false, error: "no_tenant" };
  if (resolved.status === "error") return { ok: false, error: "save_failed" };
  return { scope: resolved.scope };
}

async function rpc<T>(name: string, args: Record<string, unknown>, pick: (data: unknown) => T): Promise<ReceivingResult<T>> {
  const current = await scopeOrError();
  if ("ok" in current) return current;
  const { data, error } = await current.scope.client.rpc(name, args);
  if (error) {
    const code = mapReceivingError(error.message ?? "");
    if (code === "save_failed") console.error(`${name} failed`, error.message);
    return { ok: false, error: code };
  }
  return { ok: true, value: pick(data) };
}

export async function orderLinesAction(branchId: string, orderId: string): Promise<ReceivingResult<ReceivingProduct[]>> {
  if (!isUuid(branchId) || !isUuid(orderId)) return { ok: false, error: "invalid_input" };
  return rpc("receiving_order_lines", { p_branch_id: branchId, p_order_id: orderId }, parseProducts);
}

export async function receivingProductsAction(branchId: string): Promise<ReceivingResult<ReceivingProduct[]>> {
  if (!isUuid(branchId)) return { ok: false, error: "invalid_input" };
  return rpc("receiving_products", { p_branch_id: branchId }, parseProducts);
}

export type StartDelegationInput = {
  branchId: string;
  toUserId: string;
  minutes: DelegationDuration;
  reason: string;
};

export async function startDelegationAction(input: StartDelegationInput): Promise<ReceivingResult<string>> {
  const reason = typeof input?.reason === "string" ? input.reason.trim().replace(/\s+/g, " ") : "";
  if (
    !isUuid(input?.branchId) ||
    !isUuid(input.toUserId) ||
    !DELEGATION_DURATIONS.includes(input.minutes) ||
    reason.length > DELEGATION_REASON_MAX
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const result = await rpc(
    "start_delegation",
    { p_branch_id: input.branchId, p_to_user_id: input.toUserId, p_minutes: input.minutes, p_reason: reason || null },
    (data) => (typeof data === "string" ? data : ""),
  );
  if (result.ok) revalidateReceiving();
  return result;
}

export async function endDelegationAction(delegationId: string): Promise<ReceivingResult<null>> {
  if (!isUuid(delegationId)) return { ok: false, error: "invalid_input" };
  const result = await rpc("end_delegation", { p_delegation_id: delegationId }, () => null);
  if (result.ok) revalidateReceiving();
  return result;
}

function revalidateReceiving() {
  revalidatePath(CHEF_RECEIVING_PATH);
  revalidatePath(ANBAR_RECEIVING_PATH);
}

export type ReceiveGoodsInput = {
  branchId: string;
  orderId: string | null;
  locationId: string;
  invoicePath: string;
  lines: ReceiptLineInput[];
  /** The invoice scan the lines came from; prices of a delegate's scan are read server-side by it. */
  scanId: string | null;
};

const validScanRows = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length <= SCAN_MAX_ROWS &&
  value.every((row) => Number.isInteger(row) && row >= 0 && row < SCAN_MAX_ROWS);

const validQty = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= RECEIVING_MAX_QUANTITY;

export async function receiveGoodsAction(input: ReceiveGoodsInput): Promise<ReceivingResult<ReceiptResult>> {
  if (
    !isUuid(input?.branchId) ||
    !isUuid(input.locationId) ||
    (input.orderId !== null && !isUuid(input.orderId)) ||
    (input.scanId !== null && !isUuid(input.scanId)) ||
    typeof input.invoicePath !== "string" ||
    input.invoicePath === ""
  ) {
    return { ok: false, error: input?.invoicePath ? "invalid_input" : "invoice_photo_required" };
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > RECEIVING_MAX_LINES) {
    return { ok: false, error: "invalid_input" };
  }
  const lines = [];
  for (const line of input.lines) {
    const price = line?.price ?? null;
    if (
      !isUuid(line?.productId) ||
      !validQty(line.receivedQty) ||
      (line.expectedQty !== null && !validQty(line.expectedQty)) ||
      !validScanRows(line.scanRows ?? []) ||
      (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > RECEIVING_MAX_PRICE))
    ) {
      return { ok: false, error: "invalid_input" };
    }
    lines.push({
      product_id: line.productId,
      received_qty: line.receivedQty,
      expected_qty: line.expectedQty,
      photo_path: typeof line.photoPath === "string" && line.photoPath !== "" ? line.photoPath : null,
      price,
      scan_rows: line.scanRows ?? [],
    });
  }

  const result = await rpc(
    "receive_goods",
    {
      p_branch_id: input.branchId,
      p_order_id: input.orderId,
      p_location_id: input.locationId,
      p_invoice_path: input.invoicePath,
      p_lines: lines,
      p_scan_id: input.scanId,
    },
    parseReceipt,
  );
  if (result.ok) {
    revalidatePath(ANBAR_APP_PATH, "layout");
    revalidatePath(CHEF_RECEIVING_PATH);
    revalidatePath(ANBAR_RECEIVING_PATH);
  }
  return result;
}

const PRODUCT_NAME_MAX = 120;

/** A product for an invoice line that matched nothing in the catalog; the price comes with the receipt. */
export async function createReceivingProductAction(
  branchId: string,
  name: string,
  unit: Unit,
): Promise<ReceivingResult<ReceivingProduct>> {
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!isUuid(branchId) || clean === "" || clean.length > PRODUCT_NAME_MAX) return { ok: false, error: "invalid_input" };
  const current = await scopeOrError();
  if ("ok" in current) return current;
  try {
    const created = await createProductWithBarcode(current.scope, {
      name: clean,
      barcode: null,
      category: null,
      unit,
      pricePerUnit: null,
      shelfLifeDays: null,
      minStock: null,
      expiryDate: null,
      branchId,
      storageLocationId: null,
      productType: null,
    });
    if (!created.ok) return { ok: false, error: created.error === "invalidInput" ? "invalid_input" : "save_failed" };
    revalidatePath(ANBAR_APP_PATH, "layout");
    return {
      ok: true,
      value: {
        productId: created.product.id,
        name: created.product.name,
        unit: created.product.unit,
        expected: null,
        unitCost: created.product.pricePerUnit,
      },
    };
  } catch (error) {
    console.error("createReceivingProductAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "save_failed" };
  }
}
