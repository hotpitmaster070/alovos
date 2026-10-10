import { isMergeMode, type MergeMode } from "@/lib/count/model";
import { isTimeZone } from "./time";

/** Same as the tenant_settings column defaults; used only when a row holds an empty or unknown value. */
export const FALLBACK_TIMEZONE = "UTC";
export const FALLBACK_CURRENCY = "USD";

/** One tenant_settings row. Every value comes from the database; timezone and currency fall back to the column defaults. */
export type TenantSettings = {
  /** ISO 4217 code; with currencySymbol and locale it is the CurrencyInfo every amount is formatted with. */
  currency: string;
  currencySymbol: string | null;
  /** Number format of amounts (ru-RU, az-AZ). */
  locale: string | null;
  language: string | null;
  timezone: string;
  /** Red expiry status below this many days left. */
  expiryWarnDays: number;
  /** Yellow expiry status below this many days left. */
  expiryCriticalDays: number;
  /** Low stock threshold for products without their own min_stock. */
  lowStockDefault: number;
  /** How parallel stock count entries of one product combine: latest entry or sum. */
  countMergeMode: MergeMode;
  /** Days of movements the average daily usage is computed over. */
  usageWindowDays: number;
  /** Days an invitation link stays valid. */
  inviteTtlDays: number;
  /** Shelf life of products with no rule for the place and no shelf_life_days of their own. */
  defaultShelfLifeDays: number;
  /** Preparation balance (inputs = outputs + waste): allowed difference in kg/l and in percent of the input. */
  prepBalanceTolerance: number;
  prepBalanceTolerancePercent: number;
  /** Weight of one portion (kg) for products counted in pieces that have none of their own. */
  defaultPortionWeightKg: number | null;
  /** kg per litre for products without their own density (kg <-> l in the preparation balance). */
  defaultDensityKgPerL: number | null;
  /** Value of returned trim in percent of the input cost, for trim products without their own. */
  defaultTrimValuePercent: number;
};

export type PrepBalanceTolerance = Pick<TenantSettings, "prepBalanceTolerance" | "prepBalanceTolerancePercent">;

export type ExpirySettings = Pick<TenantSettings, "timezone" | "expiryWarnDays" | "expiryCriticalDays">;
export type StockSettings = Pick<TenantSettings, "lowStockDefault">;

export const TENANT_SETTINGS_COLUMNS =
  "currency, currency_symbol, locale, language, timezone, expiry_warn_days, expiry_critical_days, low_stock_default, count_merge_mode, usage_window_days, invite_ttl_days, default_shelf_life_days, prep_balance_tolerance, prep_balance_tolerance_percent, default_portion_weight_kg, default_density_kg_per_l, default_trim_value_percent";

export class TenantSettingsError extends Error {
  constructor(message: string) {
    super(`tenant_settings: ${message}`);
    this.name = "TenantSettingsError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function count(record: Record<string, unknown>, key: string): number {
  const value = typeof record[key] === "string" ? Number(record[key]) : record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TenantSettingsError(`${key} must be a non-negative integer`);
  }
  return value;
}

function amount(record: Record<string, unknown>, key: string): number {
  const value = typeof record[key] === "string" ? Number(record[key]) : record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TenantSettingsError(`${key} must be a non-negative number`);
  }
  return value;
}

const optionalAmount = (record: Record<string, unknown>, key: string): number | null =>
  record[key] === null || record[key] === undefined ? null : amount(record, key);

function mergeMode(value: unknown): MergeMode {
  if (!isMergeMode(value)) throw new TenantSettingsError(`unknown count_merge_mode ${String(value)}`);
  return value;
}

export function parseTenantSettings(row: unknown): TenantSettings {
  if (!isRecord(row)) throw new TenantSettingsError("row is missing");
  const currency = optionalText(row.currency) ?? FALLBACK_CURRENCY;
  const stored = optionalText(row.timezone);
  const timezone = stored && isTimeZone(stored) ? stored : FALLBACK_TIMEZONE;
  return {
    currency,
    currencySymbol: optionalText(row.currency_symbol),
    locale: optionalText(row.locale),
    language: optionalText(row.language),
    timezone,
    expiryWarnDays: count(row, "expiry_warn_days"),
    expiryCriticalDays: count(row, "expiry_critical_days"),
    lowStockDefault: count(row, "low_stock_default"),
    countMergeMode: mergeMode(row.count_merge_mode),
    usageWindowDays: count(row, "usage_window_days"),
    inviteTtlDays: count(row, "invite_ttl_days"),
    defaultShelfLifeDays: count(row, "default_shelf_life_days"),
    prepBalanceTolerance: amount(row, "prep_balance_tolerance"),
    prepBalanceTolerancePercent: amount(row, "prep_balance_tolerance_percent"),
    defaultPortionWeightKg: optionalAmount(row, "default_portion_weight_kg"),
    defaultDensityKgPerL: optionalAmount(row, "default_density_kg_per_l"),
    defaultTrimValuePercent: amount(row, "default_trim_value_percent"),
  };
}
