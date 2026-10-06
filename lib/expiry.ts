export const EXPIRY_RED_DAYS = 7;
export const EXPIRY_YELLOW_DAYS = 30;

export type ExpiryLevel = "expired" | "red" | "yellow" | "green" | "none";

export type ExpiryInfo = {
  level: ExpiryLevel;
  /** Whole days until expiry (negative when already expired); null when there is no date. */
  daysLeft: number | null;
};

/** Flat badge colours; "expired" is dark with a light border so it stays visible on the dark theme. */
export const EXPIRY_BADGE_CLASSES: Record<Exclude<ExpiryLevel, "none">, string> = {
  expired: "border-white/50 bg-black text-white",
  red: "border-red-500/40 bg-red-500/10 text-red-400",
  yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  green: "border-green-500/40 bg-green-500/10 text-green-400",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

export const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/** Adds whole days to a UTC date and returns it as YYYY-MM-DD (used for server-side range filters). */
export function addDaysUtc(now: Date, days: number): string {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return toDateOnly(new Date(base + days * MS_PER_DAY));
}

function daysBetween(expiryDate: string, now: Date): number | null {
  const match = DATE_ONLY.exec(expiryDate);
  if (!match) return null;
  const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(expiry)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiry - today) / MS_PER_DAY);
}

/**
 * expired: expiry_date < today. red: < 7 days. yellow: < 30 days. green: later. none: no date.
 * Days are counted between UTC calendar dates.
 */
export function getExpiryInfo(expiryDate: string | null, now: Date): ExpiryInfo {
  if (!expiryDate) return { level: "none", daysLeft: null };
  const daysLeft = daysBetween(expiryDate, now);
  if (daysLeft === null) return { level: "none", daysLeft: null };

  if (daysLeft < 0) return { level: "expired", daysLeft };
  if (daysLeft < EXPIRY_RED_DAYS) return { level: "red", daysLeft };
  if (daysLeft < EXPIRY_YELLOW_DAYS) return { level: "yellow", daysLeft };
  return { level: "green", daysLeft };
}
