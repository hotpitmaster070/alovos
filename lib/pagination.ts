export const PAGE_SIZE = 50;

/** 1-based page number from a search param; anything else is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Offset and inclusive end for .range(from, to). */
export function pageRange(page: number, size: number = PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * size;
  return { from, to: from + size - 1 };
}

export const SEARCH_MAX_LENGTH = 100;

/** Trimmed search text from a search param or form field; null when empty. */
export function parseSearch(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, SEARCH_MAX_LENGTH);
  return text === "" ? null : text;
}

export const pageCount = (total: number, size: number = PAGE_SIZE): number => Math.max(1, Math.ceil(total / size));
