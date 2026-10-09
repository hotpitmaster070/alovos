import type { PrepBalanceTolerance } from "@/lib/tenant-settings/parse";

/** Reasons a waste log can be written with outside the waste board (public.log_wastage). */
export const KITCHEN_WASTE_REASONS = ["cutting", "cooking", "expired", "other"] as const;
export type KitchenWasteReason = (typeof KITCHEN_WASTE_REASONS)[number];
/** Reasons of preparation waste (public.create_lots_from_preparation). */
export const PREP_WASTE_REASONS = ["cutting", "cooking", "other"] as const;
export type PrepWasteReason = (typeof PREP_WASTE_REASONS)[number];

/** What the cook picks in "Səbəb"; stored as reason + reason_note code. */
export const PREP_WASTE_CAUSES = ["norm", "fatty", "bony", "other"] as const;
export type PrepWasteCause = (typeof PREP_WASTE_CAUSES)[number];
const CAUSE_REASON: Record<PrepWasteCause, PrepWasteReason> = { norm: "cutting", fatty: "cutting", bony: "cutting", other: "other" };
/** public.require_waste_writer(): who may write waste off. */
export const canWriteOffWaste = (role: string | null): boolean => role === "owner" || role === "chef" || role === "cook";

export const WASTE_NOTE_MAX = 500;
export const WASTE_DAYS_MAX = 366;

/**
 * The reason and note a cause is stored with: "fatty" / "bony" become the note code ("balance" is
 * written by the database for a confirmed loss), "other" keeps the cook's text.
 */
export function causeToWaste(cause: PrepWasteCause, note: string): { reason: PrepWasteReason; note: string | null } {
  const text = note.trim();
  if (cause === "fatty" || cause === "bony") return { reason: CAUSE_REASON[cause], note: cause };
  return { reason: CAUSE_REASON[cause], note: cause === "other" && text ? text.slice(0, WASTE_NOTE_MAX) : null };
}

// ---------------------------------------------------------------------------
// Units and balance (same rules as public.unit_family / unit_factor and the preparation check)
// ---------------------------------------------------------------------------
const UNIT_BASE: Record<string, { base: "kg" | "l"; factor: number }> = {
  kg: { base: "kg", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  l: { base: "l", factor: 1 },
  ml: { base: "l", factor: 0.001 },
};

export const unitBase = (unit: string): { base: "kg" | "l"; factor: number } | null => UNIT_BASE[unit.trim().toLowerCase()] ?? null;

export type MassBase = "kg" | "l";
const MASS_BASES: readonly MassBase[] = ["kg", "l"];

/**
 * A recipe line: qty in the product's unit, portions in that qty, the portion weight in kg (the
 * product's, else tenant_settings.default_portion_weight_kg) and the density in kg per litre (the
 * product's, else tenant_settings.default_density_kg_per_l).
 */
export type MassLine = {
  qty: number;
  unit: string;
  portions: number | null;
  portionWeightKg: number | null;
  densityKgPerL: number | null;
};

/** Amount of `base` in one unit of a line (public.line_factor): by the unit, pieces by the portion weight, kg <-> l by the density. */
export function lineFactor(line: MassLine, base: MassBase): number | null {
  let unit = unitBase(line.unit);
  if (!unit) {
    if (!(line.portionWeightKg !== null && line.portionWeightKg > 0)) return null;
    const perUnit = line.portions !== null && line.qty > 0 ? line.portions / line.qty : 1;
    unit = { base: "kg", factor: line.portionWeightKg * perUnit };
  }
  if (unit.base === base) return unit.factor;
  if (!(line.densityKgPerL !== null && line.densityKgPerL > 0)) return null;
  return base === "kg" ? unit.factor * line.densityKgPerL : unit.factor / line.densityKgPerL;
}

/** Base of a balance: kg when every line converts to it, else l; null when neither. */
export function massBase(lines: MassLine[]): MassBase | null {
  if (lines.length === 0) return null;
  return MASS_BASES.find((base) => lines.every((line) => lineFactor(line, base) !== null)) ?? null;
}

export type BalanceOutput = {
  /** In the base unit; null when neither a weight nor a recipe estimate exists. */
  mass: number | null;
  /** Weight unknown: counted at the weight the recipe implies for it. */
  estimated: boolean;
};

export type PrepBalance = {
  baseUnit: MassBase;
  /** Gross: everything taken. */
  input: number;
  /** Usable trim returned to stock. */
  trim: number;
  /** Net use: input - trim. */
  net: number;
  output: number;
  waste: number;
  /** Expected evaporation: the recipe percent of the gross input. */
  evaporation: number;
  /** net - output - waste - evaporation; positive = something is missing. */
  difference: number;
  exceeds: boolean;
  outputs: BalanceOutput[];
};

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Balance of a run, as public.create_lots_from_preparation() checks it: net (gross - trim) = outputs +
 * waste + evaporation. null when an input or a trim line has no weight (no balance at all). An output
 * without a weight counts at the weight the recipe implies for it: recipe input minus its known outputs,
 * norms and evaporation, shared by the recipe quantities of such outputs.
 */
export function calculateBalance(run: {
  inputs: MassLine[];
  outputs: MassLine[];
  /** Trim returned, with the actual amounts. */
  trims: MassLine[];
  normPercent: number;
  trimNormPercent: number;
  evaporationPercent: number;
  /** Taken amount / recipe amount of the first input. */
  scale: number;
  /** Actual quantity of each recipe output, in order. */
  actual: number[];
  /** Waste in the unit of the first input. */
  waste: number;
  tolerance: PrepBalanceTolerance;
}): PrepBalance | null {
  const baseUnit = massBase(run.inputs);
  if (!baseUnit) return null;
  const factors = run.inputs.map((line) => lineFactor(line, baseUnit) ?? 0);
  const input = run.inputs.reduce((total, line, i) => total + round3(line.qty * run.scale) * factors[i], 0);
  if (!(input > 0)) return null;
  const trimFactors = run.trims.map((line) => lineFactor({ ...line, portions: null }, baseUnit));
  if (trimFactors.some((factor) => factor === null)) return null;
  const trim = run.trims.reduce((total, line, i) => total + line.qty * (trimFactors[i] ?? 0), 0);
  const net = input - trim;
  const evaporation = (input * run.evaporationPercent) / 100;
  const planInput = run.inputs.reduce((total, line, i) => total + line.qty * factors[i], 0);

  const outputMasses = run.outputs.map((line) => lineFactor(line, baseUnit));
  const planKnown = run.outputs.reduce((total, line, i) => total + line.qty * (outputMasses[i] ?? 0), 0);
  const unknownPlan = run.outputs.reduce((total, line, i) => total + (outputMasses[i] === null ? line.qty : 0), 0);
  const implied = planInput * (1 - (run.normPercent + run.trimNormPercent + run.evaporationPercent) / 100) - planKnown;
  const unknownFactor = unknownPlan > 0 && implied > 0 ? implied / unknownPlan : null;

  const outputs = run.outputs.map((_, i): BalanceOutput => {
    const qty = run.actual[i] ?? 0;
    const factor = outputMasses[i];
    if (factor !== null) return { mass: round3(qty * factor), estimated: false };
    return unknownFactor === null ? { mass: null, estimated: false } : { mass: round3(qty * unknownFactor), estimated: true };
  });
  const output = run.outputs.reduce((total, _, i) => {
    const factor = outputMasses[i] ?? unknownFactor;
    return total + (factor === null ? 0 : (run.actual[i] ?? 0) * factor);
  }, 0);
  const waste = run.waste * factors[0];
  const difference = round3(net - output - waste - evaporation);
  const exceeds =
    net > 0 &&
    (Math.abs(difference) > run.tolerance.prepBalanceTolerance ||
      (Math.abs(difference) * 100) / net > run.tolerance.prepBalanceTolerancePercent);
  return {
    baseUnit,
    input: round3(input),
    trim: round3(trim),
    net: round3(net),
    output: round3(output),
    waste: round3(waste),
    evaporation: round3(evaporation),
    difference,
    exceeds,
    outputs,
  };
}

/** A recipe norm item: usable items are trim that goes back to stock (productId: the trim product), the others waste. */
export type WasteItem = { name: string; normPercent: number; usable: boolean; productId: string | null };

/** Same shape as a preparations.wastage_items element. */
export const serializeWasteItem = (item: WasteItem) => ({
  name: item.name,
  norm_percent: item.normPercent,
  usable: item.usable,
  ...(item.usable && item.productId && { product_id: item.productId }),
});

const percentSum = (items: WasteItem[]): number => Math.round(items.reduce((sum, item) => sum + item.normPercent, 0) * 1000) / 1000;
/** Waste norm of a recipe: its non-usable items' sum when it has items (public.preparation_validate). */
export const wasteNormOf = (normPercent: number, items: WasteItem[]): number =>
  items.length > 0 ? percentSum(items.filter((item) => !item.usable)) : normPercent;
/** Trim norm of a recipe: its usable items' sum. */
export const trimNormOf = (items: WasteItem[]): number => percentSum(items.filter((item) => item.usable));

/** Gross input of a run (lines with the taken amounts) in the unit of the first input. */
function inputInFirstUnit(inputs: MassLine[]): number {
  const first = inputs[0];
  if (!first) return 0;
  const base = massBase(inputs);
  const firstFactor = base ? lineFactor(first, base) : null;
  if (!base || !firstFactor) return first.qty;
  return inputs.reduce((total, line) => total + line.qty * (lineFactor(line, base) ?? 0), 0) / firstFactor;
}

/** Norm waste of a run in the unit of the first input, and the share of each waste item. */
export function wasteNorm(inputs: MassLine[], normPercent: number, items: WasteItem[]): { qty: number; items: { name: string; qty: number }[] } {
  const gross = inputInFirstUnit(inputs);
  return {
    qty: round3((gross * normPercent) / 100),
    items: items.filter((item) => !item.usable).map((item) => ({ name: item.name, qty: round3((gross * item.normPercent) / 100) })),
  };
}

/** Expected usable trim of a run in the unit of the first input, per usable item. */
export function trimPlan(inputs: MassLine[], items: WasteItem[]): { name: string; productId: string | null; qty: number }[] {
  const gross = inputInFirstUnit(inputs);
  return items
    .filter((item) => item.usable)
    .map((item) => ({ name: item.name, productId: item.productId, qty: round3((gross * item.normPercent) / 100) }));
}

export type WasteCause = PrepWasteCause | "balance";

/** How a log reads in the waste journal: the cook's cause (when the note is one of ours) and the free text. */
export function describeWaste(reason: string, note: string | null): { cause: WasteCause | null; note: string | null } {
  if (note === "fatty" || note === "bony") return { cause: note, note: null };
  if (note === "balance" && reason === "other") return { cause: "balance", note: null };
  if (reason === "cutting" && !note) return { cause: "norm", note: null };
  return { cause: reason === "other" ? "other" : null, note };
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export type WasteEntry = {
  id: string;
  createdAt: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unit: string;
  reason: string;
  reasonNote: string | null;
  locationName: string | null;
  lotNumber: string | null;
  preparationName: string | null;
  /** null when the caller may not see costs. */
  cost: number | null;
};

export function parseWasteEntry(row: unknown): WasteEntry | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const createdAt = text(row.created_at);
  const quantity = num(row.quantity);
  const reason = text(row.reason);
  if (!id || !createdAt || quantity === null || !reason) return null;
  return {
    id,
    createdAt,
    productId: text(row.product_id),
    productName: text(row.product_name) ?? "",
    quantity,
    unit: text(row.unit) ?? "",
    reason,
    reasonNote: text(row.reason_note),
    locationName: text(row.location_name),
    lotNumber: text(row.lot_number),
    preparationName: text(row.preparation_name),
    cost: num(row.cost),
  };
}

export type WasteSummary = {
  day: string;
  wasteKg: number;
  wasteCost: number | null;
  runs: number;
  inputKg: number;
  normKg: number;
  prepWasteKg: number;
};

export function parseWasteSummary(row: unknown): WasteSummary | null {
  if (!isRecord(row)) return null;
  const day = text(row.day);
  const wasteKg = num(row.waste_kg);
  const runs = num(row.runs);
  if (!day || wasteKg === null || runs === null) return null;
  return {
    day,
    wasteKg,
    wasteCost: num(row.waste_cost),
    runs,
    inputKg: num(row.input_kg) ?? 0,
    normKg: num(row.norm_kg) ?? 0,
    prepWasteKg: num(row.prep_waste_kg) ?? 0,
  };
}

/** Norm and actual waste of the day's preparations in percent of their input; null without runs. */
export function wastePercents(summary: WasteSummary): { norm: number; actual: number; over: number } | null {
  if (summary.runs === 0 || !(summary.inputKg > 0)) return null;
  const norm = (summary.normKg * 100) / summary.inputKg;
  const actual = (summary.prepWasteKg * 100) / summary.inputKg;
  const tenth = (value: number) => Math.round(value * 10) / 10;
  return { norm: tenth(norm), actual: tenth(actual), over: tenth(actual - norm) };
}

export type ExpiredStockRow = {
  stockId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  expiryDate: string;
  daysLeft: number;
  locationId: string;
  locationName: string;
  lotNumber: string | null;
};

export function parseExpiredStockRow(row: unknown): ExpiredStockRow | null {
  if (!isRecord(row)) return null;
  const stockId = text(row.stock_id);
  const productId = text(row.product_id);
  const quantity = num(row.quantity);
  const expiryDate = text(row.expiry_date);
  const daysLeft = num(row.days_left);
  const locationId = text(row.location_id);
  if (!stockId || !productId || quantity === null || !expiryDate || daysLeft === null || !locationId) return null;
  return {
    stockId,
    productId,
    productName: text(row.product_name) ?? "",
    unit: text(row.unit) ?? "",
    quantity,
    expiryDate,
    daysLeft,
    locationId,
    locationName: text(row.location_name) ?? "",
    lotNumber: text(row.lot_number),
  };
}
