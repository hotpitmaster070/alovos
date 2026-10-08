export function formatMoney(amount: number, symbol: string | null): string {
  const value = amount.toFixed(2);
  return symbol ? `${value} ${symbol}` : value;
}
