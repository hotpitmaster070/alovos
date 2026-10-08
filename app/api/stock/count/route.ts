import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import type { TenantScope } from "@/lib/anbar/scope";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { countByGroupKey, countLines, getCount } from "@/lib/count/load";
import { GROUP_KEY_MAX_LENGTH, isUuid, mapCountError, parseCountedQuantity } from "@/lib/count/model";

export const dynamic = "force-dynamic";

/**
 * Saves the caller's entries of an open count (form: count_id, qty_<product id>, intent=save|finish).
 * Only stock_count_items are written; stock changes when a chef approves the count.
 */
export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const form = await request.formData();
  const countId = String(form.get("count_id") ?? "");
  const finish = form.get("intent") === "finish";
  if (!isUuid(countId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  let count;
  try {
    count = await getCount(scope, countId);
  } catch (error) {
    console.error("count POST failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  if (!count) return NextResponse.json({ error: "count_not_found" }, { status: 404 });

  const back = (params: Record<string, string>) => {
    const next = new URL(ANBAR_COUNT_PATH, request.url);
    next.searchParams.set("location", count.locationId);
    for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
    return NextResponse.redirect(next, 303);
  };

  const items: { product_id: string; quantity: number }[] = [];
  for (const [key, value] of Array.from(form.entries())) {
    if (!key.startsWith("qty_")) continue;
    const productId = key.slice(4);
    const quantity = parseCountedQuantity(value);
    if (!isUuid(productId) || !quantity.ok) return back({ error: "invalid_input" });
    if (quantity.value !== null) items.push({ product_id: productId, quantity: quantity.value });
  }

  if (items.length > 0) {
    const saved = await current.supabase.rpc("save_stock_count_items", { p_count_id: countId, p_items: items });
    if (saved.error) return back({ error: mapCountError(saved.error.message ?? "").code });
  }
  if (finish) {
    const finished = await current.supabase.rpc("finish_my_stock_count", { p_count_id: countId });
    if (finished.error) return back({ error: mapCountError(finished.error.message ?? "").code });
  }
  return back({ notice: finish ? "finished" : "saved" });
}

/**
 * Merged list of a count: GET ?count_id=<uuid> or ?group_key=<label> (the open count with that label,
 * else the latest). Products entered by several people are combined by the tenant's merge mode
 * (latest entry or sum). The system quantity stays hidden while the count is blind.
 */
export async function GET(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const params = new URL(request.url).searchParams;
  const countId = params.get("count_id");
  const groupKey = params.get("group_key")?.trim() ?? "";
  if (countId !== null ? !isUuid(countId) : groupKey === "" || groupKey.length > GROUP_KEY_MAX_LENGTH) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const count = countId !== null ? await getCount(scope, countId) : await countByGroupKey(scope, groupKey);
    if (!count) return NextResponse.json({ error: "count_not_found" }, { status: 404 });
    const lines = await countLines(scope, count.id);
    return NextResponse.json({
      count: {
        id: count.id,
        status: count.status,
        locationId: count.locationId,
        groupKey: count.groupKey,
        mergeMode: count.mergeMode,
        finished: count.finishedBy.length,
        createdAt: count.createdAt,
        approvedAt: count.approvedAt,
      },
      lines,
    });
  } catch (error) {
    const mapped = mapCountError(error instanceof Error ? error.message : "");
    if (mapped.code === "save_failed") console.error("count GET failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: mapped.code }, { status: mapped.status });
  }
}
