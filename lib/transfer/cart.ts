import { TRANSFER_MAX_ITEMS } from "./model";

/** A product the source branch (or place) can send: non-expired stock and the nearest expiry (FEFO). */
export type TransferOption = {
  productId: string;
  name: string;
  internalCode: string | null;
  barcode: string | null;
  unit: string;
  available: number;
  nearestExpiry: string | null;
};

/** quantity: the text typed in, parsed on submit. */
export type CartLine = TransferOption & { quantity: string };

export type LineProblem = "quantity" | "exceeds";

const TRANSFER_NUMBER = /^TRF-\d{8}-\d{4,}$/;
export const isTransferNumber = (value: unknown): value is string => typeof value === "string" && TRANSFER_NUMBER.test(value);

/** "1,5" or "1 500.25" -> number; null when empty, not a number or not above zero. */
export function parseQuantity(text: string): number | null {
  const cleaned = text.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Adds a product once; a second add keeps the line (and its quantity) where it is. */
export function addLine(lines: CartLine[], option: TransferOption): { lines: CartLine[]; added: boolean } {
  if (lines.some((line) => line.productId === option.productId)) return { lines, added: false };
  if (lines.length >= TRANSFER_MAX_ITEMS) return { lines, added: false };
  return { lines: [...lines, { ...option, quantity: "" }], added: true };
}

export const removeLine = (lines: CartLine[], productId: string): CartLine[] => lines.filter((line) => line.productId !== productId);

export const setQuantity = (lines: CartLine[], productId: string, quantity: string): CartLine[] =>
  lines.map((line) => (line.productId === productId ? { ...line, quantity } : line));

/** New source branch or place: availability from the options; products not offered there have none. */
export function refreshAvailability(lines: CartLine[], options: TransferOption[]): CartLine[] {
  const byId = new Map(options.map((option) => [option.productId, option]));
  return lines.map((line) => {
    const option = byId.get(line.productId);
    return { ...line, available: option?.available ?? 0, nearestExpiry: option?.nearestExpiry ?? null };
  });
}

/** After a refused transfer: what the database says is really available. */
export function applyShortages(lines: CartLine[], shortages: { product_id: string; available: number }[]): CartLine[] {
  const byId = new Map(shortages.map((item) => [item.product_id, item.available]));
  return lines.map((line) => (byId.has(line.productId) ? { ...line, available: byId.get(line.productId) ?? 0 } : line));
}

export function lineProblem(line: CartLine): LineProblem | null {
  const quantity = parseQuantity(line.quantity);
  if (quantity === null) return "quantity";
  return quantity > line.available ? "exceeds" : null;
}

export type TransferDraft = {
  fromBranchId: string;
  toBranchId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  lines: CartLine[];
  note: string;
};

export function canSubmit(draft: TransferDraft): boolean {
  return (
    draft.fromBranchId !== "" &&
    draft.toBranchId !== "" &&
    draft.fromBranchId !== draft.toBranchId &&
    draft.lines.length > 0 &&
    draft.lines.length <= TRANSFER_MAX_ITEMS &&
    draft.lines.every((line) => lineProblem(line) === null)
  );
}

/** Body of POST /api/transfer; null while the draft cannot be sent. */
export function buildTransferRequest(draft: TransferDraft) {
  if (!canSubmit(draft)) return null;
  const note = draft.note.trim();
  return {
    from_branch_id: draft.fromBranchId,
    to_branch_id: draft.toBranchId,
    items: draft.lines.map((line) => ({
      product_id: line.productId,
      quantity: parseQuantity(line.quantity) as number,
      from_location_id: draft.fromLocationId,
      to_location_id: draft.toLocationId,
    })),
    note: note === "" ? null : note,
  };
}
