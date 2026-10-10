export const WASTE_REASONS = ["spoiled", "overcooked", "dropped", "expired", "theft", "other"] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isWasteReason = (value: string): value is WasteReason =>
  (WASTE_REASONS as readonly string[]).includes(value);

/**
 * A run in its base unit (kg or l): taken (gross), usable trim returned, net use (gross - trim), the
 * waste logged and the recipe evaporation. null amounts: the run had no balance base.
 */
export type WasteRun = {
  baseUnit: string;
  gross: number;
  trim: number;
  net: number;
  waste: number;
  evaporation: number;
};

/** Reasons a log can carry: the board's plus preparation waste (wastage_logs_reason_check). */
export const LOGGED_WASTE_REASONS = [...WASTE_REASONS, "cutting", "cooking"] as const;
export type LoggedWasteReason = (typeof LOGGED_WASTE_REASONS)[number];

export const isLoggedWasteReason = (value: string): value is LoggedWasteReason =>
  (LOGGED_WASTE_REASONS as readonly string[]).includes(value);

export const isUuid = (value: string): boolean => UUID.test(value);

/** wastage_logs.ai_status: set by the server only (20261020_waste_photo_ai.sql). */
export const WASTE_AI_STATUSES = ["pending", "approved", "suspicious", "not_checked", "limit_reached"] as const;
export type WasteAiStatus = (typeof WASTE_AI_STATUSES)[number];

export const isWasteAiStatus = (value: unknown): value is WasteAiStatus =>
  typeof value === "string" && (WASTE_AI_STATUSES as readonly string[]).includes(value);

export type WasteAiCheck = {
  status: WasteAiStatus;
  /** 0..100 */
  confidence: number | null;
  /** What the model saw and why it is suspicious. */
  detected: string | null;
  notes: string | null;
  requiresReview: boolean;
};

export type WasteCard = {
  id: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: LoggedWasteReason;
  reasonNote: string | null;
  /** Number of the lot it came from (parent_lot_id). */
  lotNumber: string | null;
  /** The recipe and run (preparation_runs) it was cut in. */
  preparation: { id: string; name: string; runAt: string | null; run: WasteRun | null } | null;
  photoUrl: string | null;
  /** null for logs without a photo. */
  ai: WasteAiCheck | null;
  actor: string | null;
  createdAt: string | null;
  /** null when the caller may not see costs (cook, staff). */
  cost: number | null;
};
