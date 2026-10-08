export const MOVEMENT_TYPES = ["prihod", "spisanie", "peremeshchenie", "transfer", "waste", "task", "count"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

import type { StorageLocation } from "./types";

export type KitchenLocation = StorageLocation;
export type KitchenBranch = { id: string; name: string };

/** Lots of one product summed per storage location. */
export type StockLine = {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  quantity: number;
  unit: string;
};

export type StockMoveInput = {
  productId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantity: number;
  movementType: MovementType;
  reason: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const isMovementType = (value: string): value is MovementType =>
  (MOVEMENT_TYPES as readonly string[]).includes(value);

export function parseMovementType(value: string | string[] | undefined): MovementType | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && isMovementType(raw) ? raw : null;
}

export function parseMovementDate(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return raw;
}

export function parseLocationFilter(value: string | string[] | undefined): string | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw === "all") return "all";
  return UUID.test(raw) ? raw : "all";
}

function optionalUuid(value: unknown): string | null | undefined {
  const text = asText(value);
  if (text === "") return null;
  return UUID.test(text) ? text : undefined;
}

export function parseStockMove(body: unknown): { ok: true; value: StockMoveInput } | { ok: false; error: "invalid_input" } {
  if (!isRecord(body)) return { ok: false, error: "invalid_input" };
  const productId = asText(body.product_id);
  const movementType = asText(body.movement_type);
  const fromLocationId = optionalUuid(body.from_location_id);
  const toLocationId = optionalUuid(body.to_location_id);
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(asText(body.quantity));
  const reasonText = asText(body.reason);

  if (!UUID.test(productId) || !isMovementType(movementType)) return { ok: false, error: "invalid_input" };
  if (fromLocationId === undefined || toLocationId === undefined) return { ok: false, error: "invalid_input" };
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: "invalid_input" };
  if (reasonText.length > 500) return { ok: false, error: "invalid_input" };

  const movesStock = movementType === "peremeshchenie" || movementType === "transfer";
  if (movementType === "prihod" && !toLocationId) return { ok: false, error: "invalid_input" };
  if (movementType !== "prihod" && !movesStock && !fromLocationId) {
    return { ok: false, error: "invalid_input" };
  }
  if (movesStock && (!fromLocationId || !toLocationId || fromLocationId === toLocationId)) {
    return { ok: false, error: "invalid_input" };
  }

  return {
    ok: true,
    value: {
      productId,
      fromLocationId: movementType === "prihod" ? null : fromLocationId,
      toLocationId: movementType === "prihod" || movesStock ? toLocationId : null,
      quantity,
      movementType,
      reason: reasonText === "" ? null : reasonText,
    },
  };
}
