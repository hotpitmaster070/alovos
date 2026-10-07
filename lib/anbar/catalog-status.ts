import { addDaysUtc, getExpiryInfo } from "@/lib/expiry";

export type StatusDot = "green" | "yellow" | "red";

export type ExpiryStatus = { dot: StatusDot | null; daysLeft: number | null };

/** Catalog status dot: red when expired or under 7 days, yellow under 30, green later, none without a date. */
export function expiryStatus(expiryDate: string | null, now: Date): ExpiryStatus {
  const { level, daysLeft } = getExpiryInfo(expiryDate, now);
  if (level === "none") return { dot: null, daysLeft: null };
  if (level === "expired" || level === "red") return { dot: "red", daysLeft };
  return { dot: level, daysLeft };
}

export function isLowStock(stock: number, minStock: number | null): boolean {
  return minStock !== null && minStock > 0 && stock < minStock;
}

/** Expiry pre-filled on goods receipt: today + shelf life when known, else the product's own date. */
export function receiptExpiryDefault(
  product: { shelfLifeDays: number | null; expiryDate: string | null },
  now: Date,
): string | null {
  if (product.shelfLifeDays !== null) return addDaysUtc(now, product.shelfLifeDays);
  return product.expiryDate;
}
