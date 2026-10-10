import { addDays } from "@/lib/tenant-settings/time";

/** Report periods, ending on the restaurant's today. */
export const LOSS_PERIODS = ["week", "month"] as const;
export type LossPeriod = (typeof LOSS_PERIODS)[number];
export const LOSS_PERIOD_DAYS: Record<LossPeriod, number> = { week: 7, month: 30 };

export function parseLossPeriod(value: string | string[] | undefined): LossPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return LOSS_PERIODS.find((period) => period === raw) ?? "week";
}

/** Inclusive dates of the period, today being the restaurant's YYYY-MM-DD. */
export function lossRange(period: LossPeriod, today: string): { start: string; end: string } {
  return { start: addDays(today, 1 - LOSS_PERIOD_DAYS[period]), end: today };
}

/** One product of get_theoretical_vs_actual(), quantities in the product's unit. */
export type LossRow = {
  productId: string;
  productName: string;
  unit: string;
  theoretical: number;
  actual: number;
  loss: number;
  /** null when nothing was sold (no theoretical usage). */
  lossPercent: number | null;
  writtenOff: number;
  countLoss: number;
  lossValue: number | null;
  overLimit: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseLossRow(row: unknown): LossRow | null {
  if (!isRecord(row) || typeof row.product_id !== "string") return null;
  const theoretical = num(row.theoretical_qty);
  const actual = num(row.actual_qty);
  const loss = num(row.loss_qty);
  if (theoretical === null || actual === null || loss === null) return null;
  return {
    productId: row.product_id,
    productName: typeof row.product_name === "string" ? row.product_name : "",
    unit: typeof row.unit === "string" ? row.unit : "",
    theoretical,
    actual,
    loss,
    lossPercent: num(row.loss_pct),
    writtenOff: num(row.written_off_qty) ?? 0,
    countLoss: num(row.count_loss_qty) ?? 0,
    lossValue: num(row.loss_value),
    overLimit: row.over_limit === true,
  };
}

/** Net loss in money (surpluses subtract) and the products over the restaurant's line. */
export function lossTotals(rows: LossRow[]): { value: number; overLimit: number } {
  return {
    value: Math.round(rows.reduce((total, row) => total + (row.lossValue ?? 0), 0) * 100) / 100,
    overLimit: rows.filter((row) => row.overLimit).length,
  };
}
