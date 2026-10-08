import { getExpiryInfo } from "@/lib/expiry";
import type { ExpirySettings, StockSettings } from "@/lib/tenant-settings/parse";
import { addDays, todayIn } from "@/lib/tenant-settings/time";

export type StatusDot = "green" | "yellow" | "red";

export type ExpiryStatus = { dot: StatusDot | null; daysLeft: number | null };

/** Catalog status dot from the tenant's expiry thresholds; none without a date. */
export function expiryStatus(expiryDate: string | null, now: Date, settings: ExpirySettings): ExpiryStatus {
  const { level, daysLeft } = getExpiryInfo(expiryDate, now, settings);
  if (level === "none") return { dot: null, daysLeft: null };
  if (level === "expired" || level === "red") return { dot: "red", daysLeft };
  return { dot: level, daysLeft };
}

/** The product's own min_stock, else the tenant's low_stock_default. 0 means not tracked. */
export function getLowStockThreshold(settings: StockSettings, minStock: number | null = null): number {
  return minStock ?? settings.lowStockDefault;
}

export function isLowStock(stock: number, minStock: number | null, settings: StockSettings): boolean {
  const threshold = getLowStockThreshold(settings, minStock);
  return threshold > 0 && stock < threshold;
}

/** Expiry pre-filled on goods receipt: tenant's today + shelf life when known, else the product's own date. */
export function receiptExpiryDefault(
  product: { shelfLifeDays: number | null; expiryDate: string | null },
  now: Date,
  settings: Pick<ExpirySettings, "timezone">,
): string | null {
  if (product.shelfLifeDays !== null) return addDays(todayIn(settings.timezone, now), product.shelfLifeDays);
  return product.expiryDate;
}
