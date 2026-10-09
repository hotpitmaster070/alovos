import type { WasteAiCheck } from "@/lib/wastage/model";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** billing_plans row; prices are data, never code. */
export type BillingPlan = {
  code: string;
  kind: "base" | "addon";
  price: number;
  currency: string;
  periodDays: number;
  trialDays: number;
  aiPhotos: number;
};

export const BILLING_PLAN_COLUMNS = "code, kind, price, currency, period_days, trial_days, ai_photos";

export function parseBillingPlan(row: unknown): BillingPlan | null {
  if (!isRecord(row)) return null;
  const code = text(row.code);
  const currency = text(row.currency);
  const price = num(row.price);
  const periodDays = num(row.period_days);
  if (!code || !currency || price === null || periodDays === null || (row.kind !== "base" && row.kind !== "addon")) return null;
  return { code, kind: row.kind, price, currency, periodDays, trialDays: num(row.trial_days) ?? 0, aiPhotos: num(row.ai_photos) ?? 0 };
}

/** waste_ai_state(): photos / AI switches and this month's checks. */
export type WasteAiState = {
  photoEnabled: boolean;
  aiEnabled: boolean;
  plan: string;
  used: number;
  limit: number;
  freePhotos: number;
  includedPhotos: number;
  tolerancePercent: number;
  photosThisMonth: number;
  requestedPlan: string | null;
};

export function parseWasteAiState(raw: unknown): WasteAiState | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!isRecord(row)) return null;
  const used = num(row.used);
  const limit = num(row.ai_limit);
  const tolerance = num(row.tolerance_percent);
  if (used === null || limit === null || tolerance === null || typeof row.photo_enabled !== "boolean" || typeof row.ai_enabled !== "boolean") {
    return null;
  }
  return {
    photoEnabled: row.photo_enabled,
    aiEnabled: row.ai_enabled,
    plan: text(row.plan) ?? "",
    used,
    limit,
    freePhotos: num(row.free_photos) ?? 0,
    includedPhotos: num(row.included_photos) ?? 0,
    tolerancePercent: tolerance,
    photosThisMonth: num(row.photos_this_month) ?? 0,
    requestedPlan: text(row.requested_plan),
  };
}

/** waste_photo_summary(): today's logs. */
export type WastePhotoSummary = {
  logs: number;
  withPhoto: number;
  approved: number;
  suspicious: number;
  needsReview: number;
  limitReached: number;
};

export function parseWastePhotoSummary(raw: unknown): WastePhotoSummary | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!isRecord(row)) return null;
  const logs = num(row.logs);
  if (logs === null) return null;
  return {
    logs,
    withPhoto: num(row.with_photo) ?? 0,
    approved: num(row.approved) ?? 0,
    suspicious: num(row.suspicious) ?? 0,
    needsReview: num(row.needs_review) ?? 0,
    limitReached: num(row.limit_reached) ?? 0,
  };
}

/** The add-on that gives AI checks (cheapest first), to offer when AI is off. */
export function aiAddon(plans: BillingPlan[]): BillingPlan | null {
  return plans.filter((p) => p.kind === "addon" && p.aiPhotos > 0).sort((a, b) => a.price - b.price)[0] ?? null;
}

export const basePlan = (plans: BillingPlan[]): BillingPlan | null => plans.find((p) => p.kind === "base") ?? null;

/** Owners and chefs clear suspicious logs and see the photo summary (require_kitchen_lead). */
export const canReviewWaste = (role: string | null): boolean => role === "owner" || role === "chef";

/** Plans, AI switches and the threshold: owners only. */
export const canManageBilling = (role: string | null): boolean => role === "owner";

export type AiBadge = "approved" | "suspicious" | "noAi" | "pending" | "limitReached";

export function aiBadge(check: WasteAiCheck | null): AiBadge | null {
  if (!check) return null;
  switch (check.status) {
    case "approved":
      return "approved";
    case "suspicious":
      return "suspicious";
    case "pending":
      return "pending";
    case "limit_reached":
      return "limitReached";
    default:
      return "noAi";
  }
}

export type WasteSettingsInput = { photoEnabled: boolean | null; aiEnabled: boolean | null; tolerancePercent: number | null };

/** PATCH body {photo_enabled?, ai_enabled?, tolerance_percent?}; null when invalid or empty. */
export function validateWasteSettings(body: unknown): WasteSettingsInput | null {
  if (!isRecord(body)) return null;
  const flag = (v: unknown): boolean | null | undefined => (v === undefined || v === null ? null : typeof v === "boolean" ? v : undefined);
  const photoEnabled = flag(body.photo_enabled);
  const aiEnabled = flag(body.ai_enabled);
  const rawTolerance = body.tolerance_percent;
  const tolerancePercent = rawTolerance === undefined || rawTolerance === null ? null : num(rawTolerance);
  if (photoEnabled === undefined || aiEnabled === undefined) return null;
  if (rawTolerance !== undefined && rawTolerance !== null && (tolerancePercent === null || tolerancePercent <= 0)) return null;
  if (photoEnabled === null && aiEnabled === null && tolerancePercent === null) return null;
  return { photoEnabled, aiEnabled, tolerancePercent };
}
