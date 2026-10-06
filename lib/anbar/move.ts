export type MoveQtyError = "invalidQty" | "exceedsQty";

export type MoveQtyResult =
  | { ok: true; qty: number }
  | { ok: false; error: MoveQtyError };

const QTY_PRECISION = 1000;

/** Quantities are floats in the database; round to 3 decimals to keep arithmetic stable. */
export const roundQty = (value: number): number =>
  Math.round(value * QTY_PRECISION) / QTY_PRECISION;

/** Validates the quantity to move: a finite number > 0 and not more than what is available. */
export function validateMoveQty(raw: unknown, available: number): MoveQtyResult {
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return { ok: false, error: "invalidQty" };

  const qty = roundQty(parsed);
  if (qty <= 0) return { ok: false, error: "invalidQty" };
  if (qty > roundQty(available)) return { ok: false, error: "exceedsQty" };
  return { ok: true, qty };
}
