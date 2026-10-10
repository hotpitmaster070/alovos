import type { ParAlert } from "@/lib/owner/dashboard";

/** A product below its minimum: the branch balance and the threshold par_alerts() applied. */
export type ParMark = { quantity: number; min: number; unit: string };

/**
 * par_alerts() rows by product. With a branch only its rows count; without one the first row of the
 * product wins (par_alerts() lists the emptiest first). Products not listed are not below their minimum.
 */
export function parMarks(alerts: ParAlert[], branchId: string | null): Record<string, ParMark> {
  const marks: Record<string, ParMark> = {};
  for (const alert of alerts) {
    if (branchId !== null && alert.branchId !== branchId) continue;
    if (marks[alert.productId]) continue;
    marks[alert.productId] = { quantity: alert.quantity, min: alert.min, unit: alert.unit };
  }
  return marks;
}
