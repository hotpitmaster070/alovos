import type { Weekday } from "./model";

/** A Sunday; weekday n is this date + n days. */
const SUNDAY_UTC = Date.UTC(2023, 0, 1);

export const weekdayName = (day: Weekday, locale: string, width: "short" | "long" = "short"): string =>
  new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(SUNDAY_UTC + day * 86_400_000));

/** "2026-10-12" -> "B.e., 12 okt" in the given locale. */
export function dateLabel(isoDate: string, locale: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** Up to 3 decimals without trailing zeros: 2.5, 8, 0.125. */
export const formatQty = (value: number): string => String(Math.round(value * 1000) / 1000);
