import { isDateOnly } from "@/lib/tenant-settings/time";
import { MAX_DAYS, PERCENT_MAX } from "@/lib/tenant-settings/validation";
import { KITCHEN_WASTE_REASONS, PREP_WASTE_REASONS, trimNormOf, WASTE_NOTE_MAX, wasteNormOf } from "@/lib/labels/waste";
import type { KitchenWasteReason, PrepWasteReason, WasteItem } from "@/lib/labels/waste";

/** Labels per print request; a 58 mm roll, not a print shop. */
export const LABEL_COPIES_MAX = 50;
/** Lots per print request. */
export const LABEL_LOTS_MAX = 100;
export const PREPARATION_NAME_MAX = 120;
/** public.preparation_validate() limit on a waste item name. */
export const WASTE_ITEM_NAME_MAX = 60;
export const SHELF_LIFE_DAYS_MAX = MAX_DAYS;

/** raw: received; semi: made by a recipe; trim: usable trim returned by a preparation. */
export const LOT_TYPES = ["raw", "semi", "trim"] as const;
/** Lots a label can be made for by hand (public.create_lot). */
export const MANUAL_LOT_TYPES = ["raw", "semi"] as const;
export type LotType = (typeof LOT_TYPES)[number];

/** Who may set shelf-life rules (public.can_set_shelf_life) and edit recipes (preparations policies). */
export const canSetShelfLife = (role: string | null): boolean => role === "owner" || role === "chef" || role === "cook";
export const canEditPreparations = (role: string | null): boolean => role === "owner" || role === "chef";

export type CompositionItem = { productId: string | null; name: string; qty: number | null; unit: string | null; lotNumber: string | null };

export type Lot = {
  id: string;
  lotNumber: string;
  productId: string;
  branchId: string;
  productionDate: string;
  expiryDate: string;
  quantity: number;
  unit: string;
  portions: number | null;
  storageLocationId: string;
  lotType: LotType;
  parentLotId: string | null;
  composition: CompositionItem[];
  preparationId: string | null;
};

export type ExpiringLot = {
  id: string;
  lotNumber: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  portions: number | null;
  productionDate: string;
  expiryDate: string;
  daysLeft: number;
  storageLocationId: string;
  storageName: string;
  lotType: LotType;
  inStock: number;
};

export type ShelfLifeSource = "rule" | "product" | "default";

/** The three levels public.get_shelf_life() picks from, for previews in the browser. */
export type ShelfLifeInfo = {
  productId: string;
  productDays: number | null;
  defaultDays: number;
  rules: Record<string, number>;
};

/** Same order as public.get_shelf_life(): rule for the place, else the product, else the tenant default. */
export function resolveShelfLife(info: ShelfLifeInfo, storageLocationId: string): { days: number; source: ShelfLifeSource } {
  const rule = info.rules[storageLocationId];
  if (rule !== undefined) return { days: rule, source: "rule" };
  if (info.productDays !== null) return { days: info.productDays, source: "product" };
  return { days: info.defaultDays, source: "default" };
}

export type PreparationInput = { productId: string; qty: number };
export type PreparationOutput = { productId: string; qty: number; portions: number | null; name: string | null };

export type Preparation = {
  id: string;
  name: string;
  inputs: PreparationInput[];
  outputs: PreparationOutput[];
  active: boolean;
  /** Expected waste in percent of the gross input; the sum of the non-usable items when there are items. */
  wastageNormPercent: number;
  /** Expected usable trim in percent of the gross input: the sum of the usable items. */
  trimNormPercent: number;
  /** Expected evaporation in percent of the gross input. */
  evaporationPercent: number;
  wastageItems: WasteItem[];
};

/** Outputs of a recipe for the given amount of its first input, as public.create_lots_from_preparation() scales them. */
export function scalePreparation(preparation: Preparation, sourceQty: number): PreparationOutput[] {
  const base = preparation.inputs[0]?.qty;
  if (!base || !(sourceQty > 0)) return [];
  const scale = sourceQty / base;
  return preparation.outputs.map((output) => ({
    ...output,
    qty: Math.round(output.qty * scale * 1000) / 1000,
    portions: output.portions === null ? null : Math.round(output.portions * scale),
  }));
}

/** Portions of an actual yield, as the database stores them on the lot. */
export const portionsFor = (output: PreparationOutput, qty: number): number | null =>
  output.portions === null || !(output.qty > 0) ? null : Math.round((output.portions * qty) / output.qty);

// ---------------------------------------------------------------------------
// Parsing database rows
// ---------------------------------------------------------------------------
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const lotType = (value: unknown): LotType | null => ((LOT_TYPES as readonly unknown[]).includes(value) ? (value as LotType) : null);

function parseComposition(value: unknown): CompositionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = text(item.name);
    if (!name) return [];
    return [{ productId: text(item.product_id), name, qty: num(item.qty), unit: text(item.unit), lotNumber: text(item.lot_number) }];
  });
}

export function parseLot(row: unknown): Lot | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const lotNumber = text(row.lot_number);
  const productId = text(row.product_id);
  const branchId = text(row.branch_id);
  const productionDate = text(row.production_date);
  const expiryDate = text(row.expiry_date);
  const quantity = num(row.quantity);
  const storageLocationId = text(row.storage_location_id);
  const type = lotType(row.lot_type);
  if (!id || !lotNumber || !productId || !branchId || !productionDate || !expiryDate || quantity === null || !storageLocationId || !type) {
    return null;
  }
  return {
    id,
    lotNumber,
    productId,
    branchId,
    productionDate,
    expiryDate,
    quantity,
    unit: text(row.unit) ?? "",
    portions: num(row.portions),
    storageLocationId,
    lotType: type,
    parentLotId: text(row.parent_lot_id),
    composition: parseComposition(row.composition_json),
    preparationId: text(row.preparation_id),
  };
}

export function parseExpiringLot(row: unknown): ExpiringLot | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const lotNumber = text(row.lot_number);
  const productId = text(row.product_id);
  const productionDate = text(row.production_date);
  const expiryDate = text(row.expiry_date);
  const daysLeft = num(row.days_left);
  const quantity = num(row.quantity);
  const storageLocationId = text(row.storage_location_id);
  const type = lotType(row.lot_type);
  if (!id || !lotNumber || !productId || !productionDate || !expiryDate || daysLeft === null || quantity === null || !storageLocationId || !type) {
    return null;
  }
  return {
    id,
    lotNumber,
    productId,
    productName: text(row.product_name) ?? "",
    unit: text(row.unit) ?? "",
    quantity,
    portions: num(row.portions),
    productionDate,
    expiryDate,
    daysLeft,
    storageLocationId,
    storageName: text(row.storage_name) ?? "",
    lotType: type,
    inStock: num(row.in_stock) ?? 0,
  };
}

/** The GET /api/shelf-life-rules body. */
export function parseShelfLifeInfo(data: unknown): ShelfLifeInfo | null {
  if (!isRecord(data)) return null;
  const productId = text(data.product_id);
  const defaultDays = num(data.default_shelf_life_days);
  if (!productId || defaultDays === null || !Array.isArray(data.rules)) return null;
  const rules: Record<string, number> = {};
  for (const rule of data.rules) {
    if (!isRecord(rule)) continue;
    const id = text(rule.storage_location_id);
    const days = num(rule.shelf_life_days);
    if (id && days !== null) rules[id] = days;
  }
  return { productId, productDays: num(data.product_shelf_life_days), defaultDays, rules };
}

function parsePreparationItem(value: unknown): PreparationOutput | null {
  if (!isRecord(value)) return null;
  const productId = text(value.product_id);
  const qty = num(value.qty);
  if (!productId || qty === null) return null;
  return { productId, qty, portions: num(value.portions), name: text(value.name) };
}

export function parsePreparation(row: unknown): Preparation | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name || !Array.isArray(row.inputs) || !Array.isArray(row.outputs)) return null;
  const inputs = row.inputs.flatMap((item) => {
    const parsed = parsePreparationItem(item);
    return parsed ? [{ productId: parsed.productId, qty: parsed.qty }] : [];
  });
  const outputs = row.outputs.flatMap((item) => parsePreparationItem(item) ?? []);
  if (inputs.length === 0 || outputs.length === 0) return null;
  const wastageItems = (Array.isArray(row.wastage_items) ? row.wastage_items : []).flatMap((item): WasteItem[] => {
    if (!isRecord(item)) return [];
    const itemName = text(item.name);
    const normPercent = num(item.norm_percent);
    const usable = item.usable === true;
    return itemName && normPercent !== null ? [{ name: itemName, normPercent, usable, productId: usable ? text(item.product_id) : null }] : [];
  });
  return {
    id,
    name,
    inputs,
    outputs,
    active: row.is_active !== false,
    wastageNormPercent: num(row.wastage_norm_percent) ?? 0,
    trimNormPercent: num(row.trim_norm_percent) ?? 0,
    evaporationPercent: num(row.evaporation_percent) ?? 0,
    wastageItems,
  };
}

// ---------------------------------------------------------------------------
// Input validation (same rules as the database checks)
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

type Body = Record<string, unknown>;
type Invalid = { ok: false; error: "invalid_input" };
const invalid: Invalid = { ok: false, error: "invalid_input" };
type Valid<T> = { ok: true; value: T };

const trimmed = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const isBlank = (value: unknown): boolean => value === null || value === undefined || value === "";

/** A positive number ("2,5" accepted); undefined when it is anything else. */
function positive(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** null for empty, undefined for anything that is not a non-negative number. */
function optionalAmount(value: unknown): number | null | undefined {
  if (isBlank(value)) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (isBlank(value)) return null;
  return isUuid(value) ? value : undefined;
}

function optionalDate(value: unknown): string | null | undefined {
  if (isBlank(value)) return null;
  return typeof value === "string" && isDateOnly(value) ? value : undefined;
}

function optionalDays(value: unknown): number | null | undefined {
  if (isBlank(value)) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= SHELF_LIFE_DAYS_MAX ? parsed : undefined;
}

export type LotInput = { productId: string; qty: number; storageLocationId: string; productionDate: string | null; lotType: LotType };

export function validateLotInput(body: Body): Valid<LotInput> | Invalid {
  const qty = positive(body.qty);
  const productionDate = optionalDate(body.production_date);
  const type = lotType(body.lot_type ?? "raw");
  if (
    !isUuid(body.product_id) ||
    qty === undefined ||
    !isUuid(body.storage_location_id) ||
    productionDate === undefined ||
    !type ||
    !(MANUAL_LOT_TYPES as readonly string[]).includes(type)
  ) {
    return invalid;
  }
  return { ok: true, value: { productId: body.product_id, qty, storageLocationId: body.storage_location_id, productionDate, lotType: type } };
}

export type ReceiveLotInput = {
  productId: string;
  qty: number;
  storageLocationId: string;
  /** Per unit, in currency (null: the restaurant's currency). */
  price: number | null;
  /** ISO code of the supplier's invoice; with fxRate the cost is stored as price x fxRate. */
  currency: string | null;
  /** Units of the restaurant's currency per unit of currency. */
  fxRate: number | null;
  productionDate: string | null;
  /** Overrides the norm for this delivery; remembered as the place rule when remember is set. */
  shelfLifeDays: number | null;
  remember: boolean;
  /** The sent purchase request this delivery belongs to, chosen by hand (needs a price); null: matched automatically. */
  requestId: string | null;
};

export function validateReceiveLotInput(body: Body): Valid<ReceiveLotInput> | Invalid {
  const qty = positive(body.qty);
  const price = optionalAmount(body.price);
  const code = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : null;
  const currency = isBlank(body.currency) ? null : code !== null && /^[A-Z]{3}$/.test(code) ? code : undefined;
  const fxRate = optionalAmount(body.fx_rate);
  if (currency === undefined || fxRate === undefined || fxRate === 0 || (currency !== null && (fxRate === null || price === null))) return invalid;
  const productionDate = optionalDate(body.production_date);
  const shelfLifeDays = optionalDays(body.shelf_life_days);
  const remember = body.remember ?? false;
  const requestId = isBlank(body.purchase_request_id) ? null : isUuid(body.purchase_request_id) ? body.purchase_request_id : undefined;
  if (
    !isUuid(body.product_id) ||
    qty === undefined ||
    !isUuid(body.storage_location_id) ||
    price === undefined ||
    productionDate === undefined ||
    shelfLifeDays === undefined ||
    typeof remember !== "boolean" ||
    (remember && shelfLifeDays === null) ||
    requestId === undefined ||
    (requestId !== null && price === null)
  ) {
    return invalid;
  }
  return {
    ok: true,
    value: {
      productId: body.product_id,
      qty,
      storageLocationId: body.storage_location_id,
      price,
      currency,
      fxRate,
      productionDate,
      shelfLifeDays,
      remember,
      requestId,
    },
  };
}

export type PreparationRunOutput = { productId: string; qty: number; storageLocationId: string | null };

export type PreparationRunInput = {
  preparationId: string;
  sourceQty: number;
  storageLocationId: string;
  sourceLocationId: string | null;
  outputs: PreparationRunOutput[] | null;
  /** Waste in the unit of the first input. */
  wastage: { qty: number; reason: PrepWasteReason; note: string | null } | null;
  /** Usable trim returned to stock, one line per trim product; net use = taken - trim. */
  trims: PreparationRunTrim[];
  /** The cook confirmed a balance difference above the tolerance. */
  confirmLoss: boolean;
};

export type PreparationRunTrim = { productId: string; qty: number; note: string | null; storageLocationId: string | null };

function wasteNote(value: unknown): string | null | undefined {
  if (isBlank(value)) return null;
  if (typeof value !== "string") return undefined;
  const note = value.trim();
  return note.length > WASTE_NOTE_MAX ? undefined : note || null;
}

function prepWastage(value: unknown): PreparationRunInput["wastage"] | undefined {
  if (isBlank(value)) return null;
  if (!isRecord(value)) return undefined;
  const qty = optionalAmount(value.qty);
  const reason = value.reason ?? "cutting";
  const note = wasteNote(value.note);
  if (qty === undefined || note === undefined || !(PREP_WASTE_REASONS as readonly unknown[]).includes(reason)) return undefined;
  return qty ? { qty, reason: reason as PrepWasteReason, note } : null;
}

/** [{product_id, qty, note?, storage_location_id?}], one line per product; undefined when invalid. */
function prepTrims(value: unknown): PreparationRunTrim[] | undefined {
  if (isBlank(value)) return [];
  if (!Array.isArray(value)) return undefined;
  const trims: PreparationRunTrim[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isUuid(item.product_id)) return undefined;
    const qty = positive(item.qty);
    const note = wasteNote(item.note);
    const storageLocationId = optionalUuid(item.storage_location_id);
    if (qty === undefined || note === undefined || storageLocationId === undefined) return undefined;
    if (trims.some((other) => other.productId === item.product_id)) return undefined;
    trims.push({ productId: item.product_id, qty, note, storageLocationId });
  }
  return trims;
}

export function validatePreparationRunInput(body: Body): Valid<PreparationRunInput> | Invalid {
  const sourceQty = positive(body.source_qty);
  const sourceLocationId = optionalUuid(body.source_location_id);
  const wastage = prepWastage(body.wastage);
  const trims = prepTrims(body.trims);
  const confirmLoss = body.confirm_loss ?? false;
  if (
    !isUuid(body.preparation_id) ||
    sourceQty === undefined ||
    !isUuid(body.storage_location_id) ||
    sourceLocationId === undefined ||
    wastage === undefined ||
    trims === undefined ||
    typeof confirmLoss !== "boolean" ||
    (wastage !== null && wastage.qty > sourceQty)
  ) {
    return invalid;
  }
  let outputs: PreparationRunOutput[] | null = null;
  if (!isBlank(body.outputs)) {
    if (!Array.isArray(body.outputs) || body.outputs.length === 0) return invalid;
    outputs = [];
    for (const item of body.outputs) {
      if (!isRecord(item) || !isUuid(item.product_id)) return invalid;
      const qty = positive(item.qty);
      const storageLocationId = optionalUuid(item.storage_location_id);
      if (qty === undefined || storageLocationId === undefined) return invalid;
      outputs.push({ productId: item.product_id, qty, storageLocationId });
    }
  }
  return {
    ok: true,
    value: {
      preparationId: body.preparation_id,
      sourceQty,
      storageLocationId: body.storage_location_id,
      sourceLocationId,
      outputs,
      wastage,
      trims,
      confirmLoss,
    },
  };
}

export type WastageInput = {
  productId: string;
  quantity: number;
  reason: KitchenWasteReason;
  reasonNote: string | null;
  parentLotId: string | null;
  preparationId: string | null;
  storageLocationId: string | null;
};

/** POST /api/wastage JSON body; the place is storage_location_id, else the place of parent_lot_id. */
export function validateWastageInput(body: Body): Valid<WastageInput> | Invalid {
  const quantity = positive(body.quantity);
  const reasonNote = wasteNote(body.reason_note);
  const parentLotId = optionalUuid(body.parent_lot_id);
  const preparationId = optionalUuid(body.preparation_id);
  const storageLocationId = optionalUuid(body.storage_location_id);
  if (
    !isUuid(body.product_id) ||
    quantity === undefined ||
    !(KITCHEN_WASTE_REASONS as readonly unknown[]).includes(body.reason) ||
    reasonNote === undefined ||
    parentLotId === undefined ||
    preparationId === undefined ||
    storageLocationId === undefined ||
    (parentLotId === null && storageLocationId === null)
  ) {
    return invalid;
  }
  return {
    ok: true,
    value: {
      productId: body.product_id,
      quantity,
      reason: body.reason as KitchenWasteReason,
      reasonNote,
      parentLotId,
      preparationId,
      storageLocationId,
    },
  };
}

export type ShelfLifeRuleInput = { productId: string; storageLocationId: string; days: number | null };

/** shelf_life_days null removes the rule. */
export function validateShelfLifeRuleInput(body: Body): Valid<ShelfLifeRuleInput> | Invalid {
  const days = optionalDays(body.shelf_life_days);
  if (!isUuid(body.product_id) || !isUuid(body.storage_location_id) || days === undefined) return invalid;
  return { ok: true, value: { productId: body.product_id, storageLocationId: body.storage_location_id, days } };
}

export const MOVE_REASON_MAX = 200;

/** Same rule as public.move_stock_lot(): the clock restarts when the kind of place changes or the target is custom. */
export const moveRestartsClock = (fromType: string, toType: string): boolean => fromType !== toType || toType === "custom";

export type MoveLotInput = {
  stockId: string;
  toLocationId: string;
  /** null: the whole lot. */
  qty: number | null;
  /** Overrides the norm of the target place; only when the clock restarts. */
  shelfLifeDays: number | null;
  remember: boolean;
  reason: string | null;
};

export function validateMoveLotInput(body: Body): Valid<MoveLotInput> | Invalid {
  const qty = isBlank(body.qty) ? null : positive(body.qty);
  const shelfLifeDays = optionalDays(body.shelf_life_days);
  const remember = body.remember ?? false;
  const reason = isBlank(body.reason) ? null : typeof body.reason === "string" ? trimmed(body.reason) || null : undefined;
  if (
    !isUuid(body.stock_id) ||
    !isUuid(body.to_location_id) ||
    qty === undefined ||
    shelfLifeDays === undefined ||
    typeof remember !== "boolean" ||
    (remember && shelfLifeDays === null) ||
    reason === undefined ||
    (reason !== null && reason.length > MOVE_REASON_MAX)
  ) {
    return invalid;
  }
  return { ok: true, value: { stockId: body.stock_id, toLocationId: body.to_location_id, qty, shelfLifeDays, remember, reason } };
}

export function validatePrintInput(body: Body): Valid<{ lotIds: string[]; copies: number }> | Invalid {
  const copies = typeof body.copies === "string" && /^\d+$/.test(body.copies) ? Number(body.copies) : body.copies ?? 1;
  if (!Array.isArray(body.lot_ids) || body.lot_ids.length === 0 || body.lot_ids.length > LABEL_LOTS_MAX) return invalid;
  if (!body.lot_ids.every(isUuid) || typeof copies !== "number" || !Number.isInteger(copies) || copies < 1 || copies > LABEL_COPIES_MAX) {
    return invalid;
  }
  return { ok: true, value: { lotIds: Array.from(new Set(body.lot_ids)), copies } };
}

export type PreparationDraft = {
  name: string;
  inputs: PreparationInput[];
  outputs: PreparationOutput[];
  /** null: not sent, the column keeps its value (its default on insert). */
  wastageNormPercent: number | null;
  /** null: not sent, the stored items stay. */
  wastageItems: WasteItem[] | null;
  /** null: not sent, the column keeps its value. */
  evaporationPercent: number | null;
  /** Weight of one portion of products of this recipe, saved on the products. */
  portionWeights: { productId: string; kg: number }[];
};

/** [{product_id, portion_weight_kg}] for products of the recipe; undefined when invalid. */
function portionWeights(value: unknown, productIds: string[]): PreparationDraft["portionWeights"] | undefined {
  if (isBlank(value)) return [];
  if (!Array.isArray(value)) return undefined;
  const weights: PreparationDraft["portionWeights"] = [];
  for (const item of value) {
    const kg = isRecord(item) ? positive(item.portion_weight_kg) : undefined;
    if (!isRecord(item) || !isUuid(item.product_id) || kg === undefined || !productIds.includes(item.product_id)) return undefined;
    if (weights.some((other) => other.productId === item.product_id)) return undefined;
    weights.push({ productId: item.product_id, kg });
  }
  return weights;
}

function percent(value: unknown): number | undefined {
  const parsed = optionalAmount(value);
  return parsed !== null && parsed !== undefined && parsed <= PERCENT_MAX ? parsed : undefined;
}

/** Items as public.preparation_validate() keeps them; undefined when invalid. */
function wasteItems(value: unknown): WasteItem[] | null | undefined {
  if (value === undefined) return null;
  if (value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const items: WasteItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const name = trimmed(item.name);
    const normPercent = percent(item.norm_percent);
    const usable = item.usable ?? false;
    const productId = optionalUuid(item.product_id);
    if (name === "" || name.length > WASTE_ITEM_NAME_MAX || normPercent === undefined || typeof usable !== "boolean") return undefined;
    if (productId === undefined || items.some((other) => other.name.toLowerCase() === name.toLowerCase())) return undefined;
    items.push({ name, normPercent, usable, productId: usable ? productId : null });
  }
  return items;
}

export { trimNormOf, wasteNormOf };

export function validatePreparationDraft(body: Body): Valid<PreparationDraft> | Invalid {
  const name = trimmed(body.name);
  if (name === "" || name.length > PREPARATION_NAME_MAX || !Array.isArray(body.inputs) || !Array.isArray(body.outputs)) return invalid;
  if (body.inputs.length === 0 || body.outputs.length === 0) return invalid;
  const inputs: PreparationInput[] = [];
  for (const item of body.inputs) {
    const qty = isRecord(item) ? positive(item.qty) : undefined;
    if (!isRecord(item) || !isUuid(item.product_id) || qty === undefined) return invalid;
    if (inputs.some((other) => other.productId === item.product_id)) return invalid;
    inputs.push({ productId: item.product_id, qty });
  }
  const outputs: PreparationOutput[] = [];
  for (const item of body.outputs) {
    if (!isRecord(item) || !isUuid(item.product_id)) return invalid;
    const qty = positive(item.qty);
    const portions = isBlank(item.portions) ? null : positive(item.portions);
    if (qty === undefined || portions === undefined || outputs.some((other) => other.productId === item.product_id)) return invalid;
    outputs.push({ productId: item.product_id, qty, portions, name: trimmed(item.name) || null });
  }
  const wastageItems = wasteItems(body.wastage_items);
  const norm = isBlank(body.wastage_norm_percent) ? null : percent(body.wastage_norm_percent);
  if (wastageItems === undefined || norm === undefined) return invalid;
  const evaporationPercent = isBlank(body.evaporation_percent) ? null : percent(body.evaporation_percent);
  if (evaporationPercent === undefined) return invalid;
  const wastageNormPercent = wastageItems && wastageItems.length > 0 ? wasteNormOf(0, wastageItems) : norm;
  const trimNorm = wastageItems ? trimNormOf(wastageItems) : 0;
  if ((wastageNormPercent ?? 0) + trimNorm + (evaporationPercent ?? 0) > PERCENT_MAX) return invalid;
  const weights = portionWeights(body.portion_weights, [...inputs, ...outputs].map((line) => line.productId));
  if (weights === undefined) return invalid;
  return { ok: true, value: { name, inputs, outputs, wastageNormPercent, wastageItems, evaporationPercent, portionWeights: weights } };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const LABELS_ERROR_CODES = [
  "invalid_input",
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "product_not_found",
  "location_not_found",
  "preparation_not_found",
  "lot_not_found",
  "insufficient_stock",
  "balance_mismatch",
  "stock_exists",
  "lot_expired",
  "open_count",
  "request_not_found",
  "save_failed",
] as const;
export type LabelsErrorCode = (typeof LABELS_ERROR_CODES)[number];

export const isLabelsErrorCode = (value: unknown): value is LabelsErrorCode =>
  (LABELS_ERROR_CODES as readonly unknown[]).includes(value);

const STATUS: Record<LabelsErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  no_tenant: 403,
  forbidden: 403,
  product_not_found: 404,
  location_not_found: 404,
  preparation_not_found: 404,
  lot_not_found: 404,
  insufficient_stock: 409,
  balance_mismatch: 409,
  stock_exists: 409,
  lot_expired: 409,
  open_count: 409,
  request_not_found: 404,
  save_failed: 500,
};

/** Maps the stable messages raised by the 20261018 functions (and Postgres errors) to error codes. */
export function mapLabelsError(error: { message?: unknown; code?: unknown }): { code: LabelsErrorCode; status: number } {
  const message = typeof error.message === "string" ? error.message : "";
  const pgCode = typeof error.code === "string" ? error.code : "";
  const found =
    LABELS_ERROR_CODES.find((code) => code !== "save_failed" && new RegExp(`\\b${code}\\b`).test(message)) ??
    (/row-level security|permission denied/.test(message) || pgCode === "42501"
      ? "forbidden"
      : /_check|invalid input syntax/.test(message) || pgCode === "22023" || pgCode === "23514" || pgCode === "22P02"
        ? "invalid_input"
        : "save_failed");
  return { code: found, status: STATUS[found] };
}
