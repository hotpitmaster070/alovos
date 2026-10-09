/**
 * Inventory task modes and the arithmetic of their reports. Pure: quantities come from the count,
 * prices from the database (product_last_purchase_price), the currency from tenant settings.
 */
export const INVENTORY_MODES = ["fast_zones", "control_parallel"] as const;
export type InventoryMode = (typeof INVENTORY_MODES)[number];
export const isInventoryMode = (value: unknown): value is InventoryMode =>
  typeof value === "string" && (INVENTORY_MODES as readonly string[]).includes(value);

/** control_parallel: how many cooks count the same zone (create_inventory_task enforces 2-5). */
export const PARALLEL_MIN_COUNTERS = 2;
export const PARALLEL_MAX_COUNTERS = 5;
export const PARALLEL_DEFAULT_COUNTERS = 3;
/** Counts of one product differing by more than this share of their average are suspicious. */
export const PARALLEL_VARIANCE_THRESHOLD = 0.05;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export type Discrepancy = {
  expected: number;
  counted: number;
  /** counted - expected: negative is a shortage. */
  difference: number;
  /** (expected - counted) x unit cost: positive is money lost; null without a price. */
  cost: number | null;
};

export function calculateDiscrepancy(expected: number, counted: number, unitCost: number | null): Discrepancy {
  const difference = round3(counted - expected);
  const cost = unitCost === null || !Number.isFinite(unitCost) ? null : round2((expected - counted) * unitCost);
  return { expected, counted, difference, cost: cost === 0 ? 0 : cost };
}

export type ParallelCount = { userId: string; label: string; quantity: number };

export type ParallelVariance = {
  average: number;
  min: number;
  max: number;
  /** (max - min) / average; Infinity when the average is 0 but the counts differ. */
  spreadRatio: number;
  suspicious: boolean;
  /** The count farthest from the others' median, when one clearly stands out (3+ counts). */
  outlier: ParallelCount | null;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function calculateParallelVariance(
  counts: ParallelCount[],
  threshold: number = PARALLEL_VARIANCE_THRESHOLD,
): ParallelVariance | null {
  if (counts.length === 0) return null;
  const quantities = counts.map((count) => count.quantity);
  const average = round3(quantities.reduce((sum, value) => sum + value, 0) / quantities.length);
  const min = Math.min(...quantities);
  const max = Math.max(...quantities);
  const spread = max - min;
  const spreadRatio = spread === 0 ? 0 : average === 0 ? Infinity : spread / Math.abs(average);
  const suspicious = spreadRatio > threshold;

  let outlier: ParallelCount | null = null;
  if (suspicious && counts.length >= 3) {
    const distances = counts.map((count, index) => {
      const others = quantities.filter((_, other) => other !== index);
      return Math.abs(count.quantity - median(others));
    });
    const farthest = Math.max(...distances);
    if (distances.filter((distance) => distance === farthest).length === 1) {
      outlier = counts[distances.indexOf(farthest)];
    }
  }
  return { average, min, max, spreadRatio, suspicious, outlier };
}

export type DiscrepancyInput = {
  expected: number | null;
  counts: ParallelCount[];
  unitCost: number | null;
};

export type DiscrepancyRow = {
  /** Average of the cooks' counts (what the merge recorded). */
  counted: number | null;
  discrepancy: Discrepancy | null;
  variance: ParallelVariance | null;
};

export function discrepancyRow(input: DiscrepancyInput): DiscrepancyRow {
  const variance = calculateParallelVariance(input.counts);
  const counted = variance?.average ?? null;
  const discrepancy = input.expected === null || counted === null ? null : calculateDiscrepancy(input.expected, counted, input.unitCost);
  return { counted, discrepancy, variance };
}

/** Lost: shortages only, in money; surplus: the value found above the expected balance. */
export function totals(rows: DiscrepancyRow[]): { lost: number; surplus: number; suspicious: number } {
  let lost = 0;
  let surplus = 0;
  let suspicious = 0;
  for (const row of rows) {
    const cost = row.discrepancy?.cost ?? 0;
    if (cost > 0) lost += cost;
    if (cost < 0) surplus -= cost;
    if (row.variance?.suspicious) suspicious += 1;
  }
  return { lost: round2(lost), surplus: round2(surplus), suspicious };
}
