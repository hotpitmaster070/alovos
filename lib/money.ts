export type TenantSettings = {
  currency: string | null;
  currencySymbol: string | null;
  language: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export function readSettings(value: unknown): TenantSettings {
  const record = isRecord(value) ? value : {};
  return {
    currency: asString(record.currency),
    currencySymbol: asString(record.currency_symbol),
    language: asString(record.language),
  };
}

export function formatMoney(amount: number, symbol: string | null): string {
  const value = amount.toFixed(2);
  return symbol ? `${value} ${symbol}` : value;
}
