import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/anbar/scope";
import { mapLabelsError, type LabelsErrorCode } from "@/lib/labels/model";
import {
  BILLING_PLAN_COLUMNS,
  parseBillingPlan,
  parseWasteAiState,
  parseWastePhotoSummary,
  type BillingPlan,
  type WasteAiState,
  type WastePhotoSummary,
  type WasteSettingsInput,
} from "@/lib/waste/plan";

/** Active plans, base first (readable without sign-in). */
export async function listBillingPlans(client: SupabaseClient): Promise<BillingPlan[]> {
  const { data, error } = await client.from("billing_plans").select(BILLING_PLAN_COLUMNS).order("sort").order("code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map(parseBillingPlan).filter((p): p is BillingPlan => p !== null);
}

export async function wasteAiState(scope: TenantScope): Promise<WasteAiState> {
  const { data, error } = await scope.client.rpc("waste_ai_state");
  if (error) throw new Error(error.message);
  const state = parseWasteAiState(data);
  if (!state) throw new Error("waste_ai_state returned no row");
  return state;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: LabelsErrorCode; status: number };

const failed = (error: { message?: unknown; code?: unknown }): { ok: false; error: LabelsErrorCode; status: number } => {
  const mapped = mapLabelsError(error);
  return { ok: false, error: mapped.code, status: mapped.status };
};

/** Owner: photos on/off, AI checks on/off, suspicious threshold; returns the new state. */
export async function setWasteSettings(scope: TenantScope, input: WasteSettingsInput): Promise<Result<WasteAiState>> {
  const { error } = await scope.client.rpc("set_waste_photo_settings", {
    p_photo_enabled: input.photoEnabled,
    p_ai_enabled: input.aiEnabled,
    p_tolerance_percent: input.tolerancePercent,
  });
  if (error) return failed(error);
  return { ok: true, value: await wasteAiState(scope) };
}

/** Owner asks for a plan; the platform activates it after payment. */
export async function requestBillingPlan(scope: TenantScope, planCode: string): Promise<Result<{ id: string; planCode: string }>> {
  const { data, error } = await scope.client.rpc("request_billing_plan", { p_plan_code: planCode });
  if (error) return failed(error);
  const row = (Array.isArray(data) ? data[0] : data) as { id?: unknown; plan_code?: unknown } | null;
  return { ok: true, value: { id: String(row?.id ?? ""), planCode: String(row?.plan_code ?? planCode) } };
}

/** Owner or chef looked at a suspicious waste log. */
export async function reviewWastePhoto(scope: TenantScope, logId: string): Promise<Result<null>> {
  const { error } = await scope.client.rpc("review_waste_photo", { p_log_id: logId });
  if (error) return failed(error);
  return { ok: true, value: null };
}

/** Today's photo / AI counts; null for roles that may not read it. */
export async function wastePhotoSummary(scope: TenantScope): Promise<WastePhotoSummary | null> {
  const { data, error } = await scope.client.rpc("waste_photo_summary");
  if (error) {
    if (error.code === "42501") return null;
    throw new Error(error.message);
  }
  return parseWastePhotoSummary(data);
}
