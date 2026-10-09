import type { StorageLocation, StorageType } from "./types";

/** Numbers already used by a type in a branch (inactive places keep theirs), ascending. */
export function usedStorageNumbers(locations: StorageLocation[], branchId: string, type: StorageType): number[] {
  return locations
    .filter((location) => location.branchId === branchId && location.type === type)
    .map((location) => location.number)
    .sort((a, b) => a - b);
}

/** MAX+1, as public.create_storage_locations_bulk() picks it. */
export const nextStorageNumber = (used: number[]): number => (used.length === 0 ? 1 : Math.max(...used) + 1);

/** [1, 2, 3, 4, 7, 9, 10] -> "#1–4, #7, #9–10". */
export function formatNumberRanges(numbers: number[]): string {
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i += 1;
    parts.push(start === sorted[i] ? `#${start}` : `#${start}–${sorted[i]}`);
  }
  return parts.join(", ");
}
