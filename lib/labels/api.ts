import { NextResponse } from "next/server";
import type { LabelsErrorCode, Lot, Preparation } from "./model";
import type { Result } from "./repository";
import { serializeWasteItem, type WasteEntry } from "./waste";

export const labelsError = (error: LabelsErrorCode, status: number) => NextResponse.json({ error }, { status });

export const invalidLabelsInput = () => labelsError("invalid_input", 400);

export function labelsResponse<T>(result: Result<T>, body: (value: T) => unknown, status = 200) {
  if (!result.ok) {
    if (result.error === "save_failed") console.error("labels request failed");
    return labelsError(result.error, result.status);
  }
  return NextResponse.json(body(result.value), { status });
}

/** Same shape as a product_lots row, so the browser reads it back with parseLot(). */
export const serializeLot = (lot: Lot) => ({
  id: lot.id,
  lot_number: lot.lotNumber,
  product_id: lot.productId,
  branch_id: lot.branchId,
  production_date: lot.productionDate,
  expiry_date: lot.expiryDate,
  quantity: lot.quantity,
  unit: lot.unit,
  portions: lot.portions,
  storage_location_id: lot.storageLocationId,
  lot_type: lot.lotType,
  parent_lot_id: lot.parentLotId,
  composition_json: lot.composition.map((item) => ({
    product_id: item.productId,
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    lot_number: item.lotNumber,
  })),
  preparation_id: lot.preparationId,
});

/** Same shape as a preparations row (parsePreparation). */
export const serializePreparation = (preparation: Preparation) => ({
  id: preparation.id,
  name: preparation.name,
  inputs: preparation.inputs.map((input) => ({ product_id: input.productId, qty: input.qty })),
  outputs: preparation.outputs.map((output) => ({
    product_id: output.productId,
    qty: output.qty,
    portions: output.portions,
    name: output.name,
  })),
  is_active: preparation.active,
  wastage_norm_percent: preparation.wastageNormPercent,
  trim_norm_percent: preparation.trimNormPercent,
  evaporation_percent: preparation.evaporationPercent,
  wastage_items: preparation.wastageItems.map(serializeWasteItem),
});

/** Same shape as a public.wastage_list() row (parseWasteEntry). */
export const serializeWasteEntry = (entry: WasteEntry) => ({
  id: entry.id,
  created_at: entry.createdAt,
  product_id: entry.productId,
  product_name: entry.productName,
  quantity: entry.quantity,
  unit: entry.unit,
  reason: entry.reason,
  reason_note: entry.reasonNote,
  location_name: entry.locationName,
  lot_number: entry.lotNumber,
  preparation_name: entry.preparationName,
  cost: entry.cost,
});
