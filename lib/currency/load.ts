import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantScope } from "@/lib/anbar/scope";
import { CURRENCY_COLUMNS, parseCurrency, type Currency } from "@/lib/currency/model";
import { mapLabelsError, type LabelsErrorCode } from "@/lib/labels/model";

/** Active currencies in their order (readable without sign-in). */
export async function listCurrencies(client: SupabaseClient): Promise<Currency[]> {
  const { data, error } = await client.from("currencies").select(CURRENCY_COLUMNS).order("sort").order("code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map(parseCurrency).filter((c): c is Currency => c !== null);
}

type Result<T> = { ok: true; value: T } | { ok: false; error: LabelsErrorCode; status: number };

/** Owner: the restaurant's currency (symbol and number format follow). Stored amounts are not converted. */
export async function setTenantCurrency(scope: TenantScope, code: string): Promise<Result<{ code: string }>> {
  const { data, error } = await scope.client.rpc("set_tenant_currency", { p_code: code });
  if (error) {
    const mapped = mapLabelsError(error);
    return { ok: false, error: mapped.code, status: mapped.status };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { currency?: unknown } | null;
  return { ok: true, value: { code: typeof row?.currency === "string" ? row.currency : code } };
}
