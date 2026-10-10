import type { Lang } from "@/lib/i18n/dictionaries";

const LOCALES: Record<Lang, string> = { AZ: "az-AZ", RU: "ru-RU", EN: "en-GB" };

/** Quantities as typed by people: up to three decimals, no grouping surprises. */
export const formatQuantity = (value: number, lang: Lang) =>
  new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: 3 }).format(value);

/** A date-only value (YYYY-MM-DD); it carries no time zone, so it is shown as is. */
export function formatDay(day: string, lang: Lang): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat(LOCALES[lang], { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, date)),
  );
}

/** A timestamp in the restaurant's time zone (tenant_settings.timezone). */
export function formatMoment(iso: string, lang: Lang, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALES[lang], { timeZone, dateStyle: "medium", timeStyle: "short" }).format(at);
}
