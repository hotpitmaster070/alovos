import type { TenantScope } from "@/lib/anbar/scope";
import { parseLossRow, type LossRow } from "./model";

/** get_theoretical_vs_actual() for a branch (null: every branch of the caller), biggest money loss first. */
export async function theoreticalVsActual(
  scope: TenantScope,
  branchId: string | null,
  range: { start: string; end: string },
): Promise<LossRow[]> {
  const { data, error } = await scope.client.rpc("get_theoretical_vs_actual", {
    p_branch_id: branchId,
    p_start: range.start,
    p_end: range.end,
  });
  if (error) throw new Error(`get_theoretical_vs_actual: ${error.message}`);
  return ((data ?? []) as unknown[]).flatMap((row) => {
    const parsed = parseLossRow(row);
    return parsed ? [parsed] : [];
  });
}
