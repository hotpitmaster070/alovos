import type { ExpirySettings } from "@/lib/tenant-settings/parse";
import { daysBetween, todayIn } from "@/lib/tenant-settings/time";

export type ExpiryLevel = "expired" | "red" | "yellow" | "green" | "none";

export type ExpiryInfo = {
  level: ExpiryLevel;
  /** Whole days until expiry (negative when already expired); null when there is no date. */
  daysLeft: number | null;
};

/**
 * expired: expiry_date before today. red: fewer than expiryWarnDays left. yellow: fewer than
 * expiryCriticalDays. green: later. none: no date. "Today" is the tenant's calendar date.
 */
export function getExpiryInfo(expiryDate: string | null, now: Date, settings: ExpirySettings): ExpiryInfo {
  if (!expiryDate) return { level: "none", daysLeft: null };
  const daysLeft = daysBetween(todayIn(settings.timezone, now), expiryDate);
  if (daysLeft === null) return { level: "none", daysLeft: null };

  if (daysLeft < 0) return { level: "expired", daysLeft };
  if (daysLeft < settings.expiryWarnDays) return { level: "red", daysLeft };
  if (daysLeft < settings.expiryCriticalDays) return { level: "yellow", daysLeft };
  return { level: "green", daysLeft };
}
