export const WASTE_REASONS = ["spoiled", "overcooked", "dropped", "expired", "theft", "other"] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

export type WasteLot = {
  id: string;
  branchId: string | null;
  quantity: number;
  cost: number | null;
  expiry: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

export const isWasteReason = (value: string): value is WasteReason =>
  (WASTE_REASONS as readonly string[]).includes(value);

export const isUuid = (value: string): boolean => UUID.test(value);

/** Calendar day in Baku (UTC+4, no DST). Branch names stay in the database. */
export function bakuDayBounds(now: Date): { start: string; end: string } {
  const shifted = new Date(now.getTime() + BAKU_OFFSET_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BAKU_OFFSET_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

/**
 * Trigger matches lots only when movement.branch_id is null or equal.
 * Lots created without a branch (prihod from /app/anbar) need a null branch_id
 * or handle_stock_movement will not see them.
 */
export function branchForWaste(lots: Pick<WasteLot, "branchId">[]): string | null {
  if (lots.length === 0 || lots.some((lot) => lot.branchId === null)) return null;
  const ids = new Set(lots.map((lot) => lot.branchId));
  return ids.size === 1 ? lots[0].branchId : null;
}

export function stockAvailable(lots: WasteLot[], branchId: string | null): number {
  return lots
    .filter((lot) => branchId === null || lot.branchId === branchId)
    .reduce((sum, lot) => sum + lot.quantity, 0);
}

/** Same lot order as handle_stock_movement: expiry nulls last, then id. */
export function fifoCost(lots: WasteLot[], quantity: number): number {
  const ordered = [...lots].sort((a, b) => {
    if (a.expiry === b.expiry) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.expiry === null) return 1;
    if (b.expiry === null) return -1;
    return a.expiry < b.expiry ? -1 : 1;
  });
  let left = quantity;
  let value = 0;
  for (const lot of ordered) {
    if (left <= 0) break;
    const take = Math.min(Math.max(lot.quantity, 0), left);
    if (take <= 0) continue;
    value += take * (lot.cost ?? 0);
    left -= take;
  }
  return value;
}

export function unitCost(lots: { quantity: number; cost: number | null }[]): number {
  const priced = lots.filter((lot) => lot.cost != null);
  const active = priced.filter((lot) => lot.quantity > 0);
  const base = active.length > 0 ? active : priced;
  if (base.length === 0) return 0;
  const qty = base.reduce((sum, lot) => sum + lot.quantity, 0);
  if (qty > 0) return base.reduce((sum, lot) => sum + lot.quantity * (lot.cost ?? 0), 0) / qty;
  return base.reduce((sum, lot) => sum + (lot.cost ?? 0), 0) / base.length;
}

export type WasteCard = {
  id: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  photoUrl: string | null;
  actor: string | null;
  cost: number;
};

export type WasteMovementRow = {
  tenant_id: string;
  product_id: string;
  branch_id: string | null;
  from_location_id: string;
  to_location_id: null;
  quantity: number;
  movement_type: "waste";
  reason: WasteReason;
  user_id: string;
};

export function wasteMovement(input: {
  tenantId: string;
  productId: string;
  locationId: string;
  quantity: number;
  reason: WasteReason;
  userId: string;
  lots: WasteLot[];
}): WasteMovementRow {
  return {
    tenant_id: input.tenantId,
    product_id: input.productId,
    branch_id: branchForWaste(input.lots),
    from_location_id: input.locationId,
    to_location_id: null,
    quantity: input.quantity,
    movement_type: "waste",
    reason: input.reason,
    user_id: input.userId,
  };
}
