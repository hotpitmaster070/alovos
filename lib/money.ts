/**
 * The only place money is formatted. The currency is the restaurant's (tenant_settings.currency,
 * currency_symbol, locale); there is no default currency in code.
 */
export type CurrencyInfo = {
  /** ISO 4217: AZN, RUB, TRY, USD, EUR. */
  code: string;
  /** Shown when the runtime does not know the code. */
  symbol: string | null;
  /** Number format: ru-RU -> 1 234,50 ₽. null: the runtime's default. */
  locale: string | null;
};

const ISO_CODE = /^[A-Z]{3}$/;

export function currencyOf(settings: { currency: string; currencySymbol: string | null; locale: string | null }): CurrencyInfo {
  return { code: settings.currency.trim().toUpperCase(), symbol: settings.currencySymbol, locale: settings.locale };
}

function formatter(currency: CurrencyInfo, options: Intl.NumberFormatOptions): Intl.NumberFormat | null {
  if (!ISO_CODE.test(currency.code)) return null;
  try {
    return new Intl.NumberFormat(currency.locale ?? undefined, { style: "currency", currency: currency.code, ...options });
  } catch {
    return null;
  }
}

const plain = (amount: number, currency: CurrencyInfo, digits: number) => {
  const value = new Intl.NumberFormat(currency.locale ?? undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  return `${value} ${currency.symbol ?? currency.code}`;
};

/** 1234.5 -> "1 234,50 ₽" (ru-RU, RUB), "1.234,50 ₼" (az-AZ, AZN); "—" without an amount. */
export function formatMoney(amount: number | null | undefined, currency: CurrencyInfo): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const format = formatter(currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!format) return plain(amount, currency, 2);
  // The runtime may show the code (AZN) where the restaurant set a symbol (₼).
  const parts = format.formatToParts(amount);
  return parts.map((part) => (part.type === "currency" && currency.symbol ? currency.symbol : part.value)).join("");
}

/** Unit prices and exchange rates keep more digits: 0.1734 TRY. */
export function formatRate(amount: number, currency: CurrencyInfo, digits = 4): string {
  const format = formatter(currency, { minimumFractionDigits: 0, maximumFractionDigits: digits });
  if (!format) return plain(amount, currency, digits);
  return format.formatToParts(amount).map((part) => (part.type === "currency" && currency.symbol ? currency.symbol : part.value)).join("");
}
