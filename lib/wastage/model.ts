export const WASTE_REASONS = ["spoiled", "overcooked", "dropped", "expired", "theft", "other"] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isWasteReason = (value: string): value is WasteReason =>
  (WASTE_REASONS as readonly string[]).includes(value);

export const isUuid = (value: string): boolean => UUID.test(value);

export type WasteCard = {
  id: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  photoUrl: string | null;
  actor: string | null;
  /** null when the caller may not see costs (cook, staff). */
  cost: number | null;
};
