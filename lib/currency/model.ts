import type { CurrencyInfo } from "@/lib/money";

/** currencies row: what a restaurant can work in. */
export type Currency = CurrencyInfo & { symbol: string; locale: string; names: { az: string; ru: string; en: string } };

export const CURRENCY_COLUMNS = "code, symbol, locale, name_az, name_ru, name_en";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function parseCurrency(row: unknown): Currency | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const code = text(r.code);
  const symbol = text(r.symbol);
  const locale = text(r.locale);
  if (!code || !/^[A-Z]{3}$/.test(code) || !symbol || !locale) return null;
  return { code, symbol, locale, names: { az: text(r.name_az) ?? code, ru: text(r.name_ru) ?? code, en: text(r.name_en) ?? code } };
}

/** "RUB - Российский рубль (₽)" in the UI language (AZ / RU / EN). */
export function currencyName(currency: Currency, lang: string): string {
  const name = lang === "RU" ? currency.names.ru : lang === "EN" ? currency.names.en : currency.names.az;
  return `${currency.code} - ${name} (${currency.symbol})`;
}

/**
 * The currency a new restaurant most likely works in: the one whose locale region matches the
 * browser's (ru-RU -> RUB), else the first of the list.
 */
export function guessCurrency(currencies: Currency[], browserLocales: readonly string[]): Currency | null {
  const region = (locale: string) => locale.split("-").slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase() ?? null;
  for (const locale of browserLocales) {
    const wanted = region(locale);
    const found = wanted ? currencies.find((currency) => region(currency.locale) === wanted) : undefined;
    if (found) return found;
  }
  return currencies[0] ?? null;
}

/** Price in another currency at fx_rate (units of the restaurant's currency per unit of it). */
export const convertPrice = (price: number, fxRate: number): number => Math.round(price * fxRate * 10_000) / 10_000;
