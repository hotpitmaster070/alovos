import { PERCENT_MAX } from "@/lib/tenant-settings/validation";

/**
 * Product kinds, run costing and stock value by kind (20261019_final_world_scheme.sql). Every number
 * comes from the database: lot costs, product sale prices and densities, tenant defaults.
 */

/** raw: bought; semi: made by a recipe; ready: a finished dish; trim: usable trim; waste: never stocked for use. */
export const PRODUCT_TYPES = ["raw", "semi", "ready", "trim", "waste"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const productType = (value: unknown): ProductType | null =>
  (PRODUCT_TYPES as readonly unknown[]).includes(value) ? (value as ProductType) : null;

/** Who sees money (public.can_see_costs). */
export const canSeeCosts = (role: string | null): boolean => role === "owner" || role === "chef";

/** Stock kinds of the reports (public.stock_kind). */
export const STOCK_KINDS = ["raw", "semi", "trim"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const stockKindOf = (type: ProductType): StockKind => (type === "semi" || type === "ready" ? "semi" : type === "trim" ? "trim" : "raw");
export const stockKind = (value: unknown): StockKind | null =>
  (STOCK_KINDS as readonly unknown[]).includes(value) ? (value as StockKind) : null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// ---------------------------------------------------------------------------
// Run cost (public.create_lots_from_preparation)
// ---------------------------------------------------------------------------
export type RunCostInput = {
  /** FIFO cost of everything taken. */
  inputCost: number;
  /** FIFO cost of the first input per base unit (kg or l). */
  firstCostPerBase: number;
  /** Returned trim: qty, base units in one unit of it, its value in percent of the input cost. */
  trims: { qty: number; factor: number; valuePercent: number }[];
  /** Outputs: qty and their mass in the base unit (null: unknown, then the cost is shared by quantity). */
  outputs: { qty: number; mass: number | null }[];
};

export type RunCost = {
  trimCost: number;
  /** inputCost - trimCost: what the outputs carry. */
  netCost: number;
  trimCostPerUnit: number[];
  outputCostPerUnit: number[];
};

/** Trim takes its value from the input; the net cost is shared by output mass (by quantity when a mass is unknown). */
export function runCost(input: RunCostInput): RunCost {
  const trimCostPerUnit = input.trims.map((trim) => (trim.factor * input.firstCostPerBase * trim.valuePercent) / PERCENT_MAX);
  const trimCost = input.trims.reduce((total, trim, i) => total + trim.qty * trimCostPerUnit[i], 0);
  const netCost = input.inputCost - trimCost;
  const byQty = input.outputs.some((output) => output.mass === null);
  const massSum = input.outputs.reduce((total, output) => total + (output.mass ?? 0), 0);
  const qtySum = input.outputs.reduce((total, output) => total + output.qty, 0);
  const outputCostPerUnit = input.outputs.map((output) => {
    if (byQty) return qtySum > 0 ? netCost / qtySum : 0;
    return massSum > 0 && output.qty > 0 ? (netCost * (output.mass ?? 0)) / massSum / output.qty : 0;
  });
  return { trimCost, netCost, trimCostPerUnit, outputCostPerUnit };
}

// ---------------------------------------------------------------------------
// Stock by kind (public.stock_summary / public.stock_items)
// ---------------------------------------------------------------------------
export type StockKindSummary = {
  kind: StockKind;
  lines: number;
  kg: number;
  liters: number;
  pieces: number;
  /** null for roles that do not see money. */
  costValue: number | null;
  saleValue: number | null;
  margin: number | null;
  /** Rows without a sale price: the sale value and margin leave them out. */
  unpriced: number;
};

export function parseStockSummary(row: unknown): StockKindSummary | null {
  if (!isRecord(row)) return null;
  const kind = stockKind(row.kind);
  const lines = num(row.lines);
  if (!kind || lines === null) return null;
  return {
    kind,
    lines,
    kg: num(row.kg) ?? 0,
    liters: num(row.liters) ?? 0,
    pieces: num(row.pieces) ?? 0,
    costValue: num(row.cost_value),
    saleValue: num(row.sale_value),
    margin: num(row.margin),
    unpriced: num(row.unpriced) ?? 0,
  };
}

export type StockValue = {
  kinds: Record<StockKind, StockKindSummary>;
  total: Omit<StockKindSummary, "kind"> & { wasteCost: number | null };
};

const emptyKind = (kind: StockKind): StockKindSummary => ({
  kind,
  lines: 0,
  kg: 0,
  liters: 0,
  pieces: 0,
  costValue: 0,
  saleValue: 0,
  margin: 0,
  unpriced: 0,
});

const addMoney = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/** Every kind (empty ones too) and the totals; wasteCost: today's waste at cost (null without money). */
export function stockValue(rows: StockKindSummary[], wasteCost: number | null, seesMoney: boolean): StockValue {
  const kinds = Object.fromEntries(
    STOCK_KINDS.map((kind) => {
      const found = rows.find((row) => row.kind === kind) ?? emptyKind(kind);
      return [kind, seesMoney ? found : { ...found, costValue: null, saleValue: null, margin: null }];
    }),
  ) as Record<StockKind, StockKindSummary>;
  const all = STOCK_KINDS.map((kind) => kinds[kind]);
  return {
    kinds,
    total: {
      lines: all.reduce((sum, row) => sum + row.lines, 0),
      kg: all.reduce((sum, row) => sum + row.kg, 0),
      liters: all.reduce((sum, row) => sum + row.liters, 0),
      pieces: all.reduce((sum, row) => sum + row.pieces, 0),
      costValue: all.reduce<number | null>((sum, row) => addMoney(sum, row.costValue), null),
      saleValue: all.reduce<number | null>((sum, row) => addMoney(sum, row.saleValue), null),
      margin: all.reduce<number | null>((sum, row) => addMoney(sum, row.margin), null),
      unpriced: all.reduce((sum, row) => sum + row.unpriced, 0),
      wasteCost: seesMoney ? wasteCost ?? 0 : null,
    },
  };
}

export type StockItem = {
  stockId: string;
  productId: string;
  productName: string;
  unit: string;
  kind: StockKind;
  quantity: number;
  expiryDate: string | null;
  daysLeft: number | null;
  locationId: string | null;
  locationName: string;
  lotNumber: string | null;
  costPerUnit: number | null;
  salePrice: number | null;
};

export function parseStockItem(row: unknown): StockItem | null {
  if (!isRecord(row)) return null;
  const stockId = text(row.stock_id);
  const productId = text(row.product_id);
  const productName = text(row.product_name);
  const kind = stockKind(row.kind);
  const quantity = num(row.quantity);
  if (!stockId || !productId || !productName || !kind || quantity === null) return null;
  return {
    stockId,
    productId,
    productName,
    unit: text(row.unit) ?? "",
    kind,
    quantity,
    expiryDate: text(row.expiry_date),
    daysLeft: num(row.days_left),
    locationId: text(row.location_id),
    locationName: text(row.location_name) ?? "",
    lotNumber: text(row.lot_number),
    costPerUnit: num(row.cost_per_unit),
    salePrice: num(row.sale_price),
  };
}

/** ?type= of the stock page: a kind, expiring, or everything. */
export const STOCK_FILTERS = ["all", ...STOCK_KINDS, "expiring"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];
export const stockFilter = (value: unknown): StockFilter =>
  (STOCK_FILTERS as readonly unknown[]).includes(value) ? (value as StockFilter) : "all";

/** Link to the stock page of a branch with a filter ("all" adds no type). */
export function stockHref(path: string, branchId: string | null, filter: StockFilter): string {
  const params = new URLSearchParams();
  if (branchId) params.set("branch", branchId);
  if (filter !== "all") params.set("type", filter);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Rows per kind block on the stock page (public.stock_items allows up to 200). */
export const STOCK_ITEMS_PAGE = 100;

// ---------------------------------------------------------------------------
// Product economics (public.set_product_economics; owners and chefs)
// ---------------------------------------------------------------------------
export type ProductEconomics = {
  productType: ProductType;
  salePrice: number | null;
  densityKgPerL: number | null;
  /** null: tenant_settings.default_trim_value_percent. */
  trimValuePercent: number | null;
};

const isBlank = (value: unknown): boolean => value === null || value === undefined || value === "";
function optionalNumber(value: unknown, valid: (n: number) => boolean): number | null | undefined {
  if (isBlank(value)) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(parsed) && valid(parsed) ? parsed : undefined;
}

export function validateProductEconomics(body: Record<string, unknown>): { ok: true; value: ProductEconomics } | { ok: false } {
  const type = productType(body.product_type);
  const salePrice = optionalNumber(body.sale_price, (n) => n >= 0);
  const densityKgPerL = optionalNumber(body.density_kg_per_l, (n) => n > 0);
  const trimValuePercent = optionalNumber(body.trim_value_percent, (n) => n >= 0 && n <= PERCENT_MAX);
  if (!type || salePrice === undefined || densityKgPerL === undefined || trimValuePercent === undefined) return { ok: false };
  return { ok: true, value: { productType: type, salePrice, densityKgPerL, trimValuePercent } };
}
