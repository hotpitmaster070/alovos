import { isMergeMode, type MergeMode } from "@/lib/count/model";
import { isTimeZone } from "./time";

/** The currency is not here: owners change it through set_tenant_currency() (validateCurrencyCode). */
export type TenantSettingsUpdate = {
  language: string | null;
  timezone: string;
  expiry_warn_days: number;
  expiry_critical_days: number;
  low_stock_default: number;
  count_merge_mode: MergeMode;
  usage_window_days: number;
  invite_ttl_days: number;
  default_shelf_life_days: number;
  prep_balance_tolerance: number;
  prep_balance_tolerance_percent: number;
  default_portion_weight_kg: number | null;
  default_density_kg_per_l: number | null;
  default_trim_value_percent: number;
};

/** tenant_settings check on prep_balance_tolerance_percent. */
export const PERCENT_MAX = 100;

/** tenant_settings and shelf-life checks: 0..3650 days. */
export const MAX_DAYS = 3650;
/** tenant_settings checks on usage_window_days and invite_ttl_days. */
export const PERIOD_DAYS_MIN = 1;
export const PERIOD_DAYS_MAX = 365;

const text = (form: FormData, key: string): string => String(form.get(key) ?? "").trim();

function wholeNumber(form: FormData, key: string, max: number): number | null {
  const raw = text(form, key);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

/** Non-negative decimal ("0,3" accepted) up to max. */
function decimal(form: FormData, key: string, max: number): number | null {
  const raw = text(form, key).replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

/** Empty: null; a positive decimal; undefined when anything else. */
function optionalPositive(form: FormData, key: string): number | null | undefined {
  if (text(form, key) === "") return null;
  const value = decimal(form, key, Number.MAX_SAFE_INTEGER);
  return value !== null && value > 0 ? value : undefined;
}

/** An ISO 4217 code ("rub" -> "RUB"); null when it is not one. */
export function validateCurrencyCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Same rules as the tenant_settings checks; null when anything is off. */
export function validateTenantSettingsInput(form: FormData): TenantSettingsUpdate | null {
  const timezone = text(form, "timezone");
  const warn = wholeNumber(form, "expiry_warn_days", MAX_DAYS);
  const critical = wholeNumber(form, "expiry_critical_days", MAX_DAYS);
  const lowStock = wholeNumber(form, "low_stock_default", Number.MAX_SAFE_INTEGER);
  const mergeMode = text(form, "count_merge_mode");
  const usageWindow = wholeNumber(form, "usage_window_days", PERIOD_DAYS_MAX);
  const inviteTtl = wholeNumber(form, "invite_ttl_days", PERIOD_DAYS_MAX);
  const shelfLife = wholeNumber(form, "default_shelf_life_days", MAX_DAYS);
  if (!isTimeZone(timezone) || warn === null || critical === null || lowStock === null) return null;
  if (shelfLife === null) return null;
  const tolerance = decimal(form, "prep_balance_tolerance", Number.MAX_SAFE_INTEGER);
  const tolerancePercent = decimal(form, "prep_balance_tolerance_percent", PERCENT_MAX);
  if (tolerance === null || tolerancePercent === null) return null;
  const portionWeight = optionalPositive(form, "default_portion_weight_kg");
  const density = optionalPositive(form, "default_density_kg_per_l");
  const trimValue = decimal(form, "default_trim_value_percent", PERCENT_MAX);
  if (portionWeight === undefined || density === undefined || trimValue === null) return null;
  if (!isMergeMode(mergeMode)) return null;
  if (usageWindow === null || usageWindow < PERIOD_DAYS_MIN || inviteTtl === null || inviteTtl < PERIOD_DAYS_MIN) return null;
  if (warn > critical) return null;
  return {
    language: text(form, "language") || null,
    timezone,
    expiry_warn_days: warn,
    expiry_critical_days: critical,
    low_stock_default: lowStock,
    count_merge_mode: mergeMode,
    usage_window_days: usageWindow,
    invite_ttl_days: inviteTtl,
    default_shelf_life_days: shelfLife,
    prep_balance_tolerance: tolerance,
    prep_balance_tolerance_percent: tolerancePercent,
    default_portion_weight_kg: portionWeight,
    default_density_kg_per_l: density,
    default_trim_value_percent: trimValue,
  };
}
