import { isMergeMode, type MergeMode } from "@/lib/count/model";
import { isTimeZone } from "./time";

export type TenantSettingsUpdate = {
  currency: string;
  currency_symbol: string | null;
  language: string | null;
  timezone: string;
  expiry_warn_days: number;
  expiry_critical_days: number;
  low_stock_default: number;
  count_merge_mode: MergeMode;
};

const MAX_DAYS = 3650;

const text = (form: FormData, key: string): string => String(form.get(key) ?? "").trim();

function wholeNumber(form: FormData, key: string, max: number): number | null {
  const raw = text(form, key);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

/** Same rules as the tenant_settings checks; null when anything is off. */
export function validateTenantSettingsInput(form: FormData): TenantSettingsUpdate | null {
  const currency = text(form, "currency");
  const timezone = text(form, "timezone");
  const warn = wholeNumber(form, "expiry_warn_days", MAX_DAYS);
  const critical = wholeNumber(form, "expiry_critical_days", MAX_DAYS);
  const lowStock = wholeNumber(form, "low_stock_default", Number.MAX_SAFE_INTEGER);
  const mergeMode = text(form, "count_merge_mode");
  if (!currency || !isTimeZone(timezone) || warn === null || critical === null || lowStock === null) return null;
  if (!isMergeMode(mergeMode)) return null;
  if (warn > critical) return null;
  return {
    currency,
    currency_symbol: text(form, "currency_symbol") || null,
    language: text(form, "language") || null,
    timezone,
    expiry_warn_days: warn,
    expiry_critical_days: critical,
    low_stock_default: lowStock,
    count_merge_mode: mergeMode,
  };
}
