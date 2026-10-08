import { isMergeMode, type MergeMode } from "@/lib/count/model";
import { isTimeZone } from "./time";

/** One tenant_settings row. Every value comes from the database; there are no code defaults. */
export type TenantSettings = {
  currency: string;
  currencySymbol: string | null;
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
};

export type ExpirySettings = Pick<TenantSettings, "timezone" | "expiryWarnDays" | "expiryCriticalDays">;
export type StockSettings = Pick<TenantSettings, "lowStockDefault">;

/** What money amounts are suffixed with: the symbol, else the currency code. */
export const currencyLabel = (settings: Pick<TenantSettings, "currency" | "currencySymbol">): string =>
  settings.currencySymbol ?? settings.currency;

export const TENANT_SETTINGS_COLUMNS =
  "currency, currency_symbol, language, timezone, expiry_warn_days, expiry_critical_days, low_stock_default, count_merge_mode";

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

function mergeMode(value: unknown): MergeMode {
  if (!isMergeMode(value)) throw new TenantSettingsError(`unknown count_merge_mode ${String(value)}`);
  return value;
}

export function parseTenantSettings(row: unknown): TenantSettings {
  if (!isRecord(row)) throw new TenantSettingsError("row is missing");
  const currency = optionalText(row.currency);
  if (!currency) throw new TenantSettingsError("currency is empty");
  const timezone = optionalText(row.timezone);
  if (!timezone || !isTimeZone(timezone)) throw new TenantSettingsError(`unknown timezone ${String(row.timezone)}`);
  return {
    currency,
    currencySymbol: optionalText(row.currency_symbol),
    language: optionalText(row.language),
    timezone,
    expiryWarnDays: count(row, "expiry_warn_days"),
    expiryCriticalDays: count(row, "expiry_critical_days"),
    lowStockDefault: count(row, "low_stock_default"),
    countMergeMode: mergeMode(row.count_merge_mode),
  };
}
