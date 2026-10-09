import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import type { TenantScope } from "@/lib/anbar/scope";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { countAtLocation, countByGroupKey, countLines, getCount, isTenantLocation } from "@/lib/count/load";
import { GROUP_KEY_MAX_LENGTH, isUuid, mapCountError, parseCountedQuantity, type StockCount } from "@/lib/count/model";

export const dynamic = "force-dynamic";

/**
 * Saves the caller's entries (form: count_id or location_id, qty_<product id>, intent=save|finish).
 * With location_id the place's open count is joined or created (the storage card's "start"/"join"
 * button posts only location_id); branch and counters are set by the
 * database from the place and the session, never from the request. Only stock_count_items are
 * written; stock changes when a chef approves the count.
 */
export async function POST(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const form = await request.formData();
  const rawCount = form.get("count_id");
  const rawLocation = form.get("location_id");
  const finish = form.get("intent") === "finish";

  let countId: string;
  if (rawCount !== null) {
    if (!isUuid(rawCount)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    countId = rawCount;
  } else {
    if (!isUuid(rawLocation)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const started = await current.supabase.rpc("start_stock_count", { p_location_id: rawLocation });
    if (started.error || typeof started.data !== "string") {
      const mapped = mapCountError(started.error?.message ?? "");
      return NextResponse.json({ error: mapped.code }, { status: mapped.status });
    }
    countId = started.data;
  }

  let count: StockCount | null;
  try {
    count = await getCount(scope, countId);
  } catch (error) {
    console.error("count POST failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  if (!count) return NextResponse.json({ error: "count_not_found" }, { status: 404 });
  const locationId = count.locationId;

  const back = (params: Record<string, string>) => {
    const next = new URL(ANBAR_COUNT_PATH, request.url);
    next.searchParams.set("location", locationId);
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
  return back({ notice: finish ? "finished" : items.length === 0 && rawCount === null ? "started" : "saved" });
}

/**
 * Merged list of a count: GET ?count_id=<uuid>, ?location_id=<uuid> (the place's open count, else its
 * latest closed one) or ?group_key=<value>. group_key is an alias: a storage place id is used as
 * location_id, anything else is the count's label (open count with that label, else the latest).
 * Entries of several people for one product are combined by the count's merge mode (latest or sum).
 * The system quantity stays hidden while the count is blind.
 */
export async function GET(request: Request) {
  const current = await requireTenant();
  if ("error" in current) return current.error;
  const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

  const params = new URL(request.url).searchParams;
  const countId = params.get("count_id");
  const locationId = params.get("location_id");
  const groupKey = params.get("group_key")?.trim() ?? "";
  if (
    (countId !== null && !isUuid(countId)) ||
    (locationId !== null && !isUuid(locationId)) ||
    (countId === null && locationId === null && (groupKey === "" || groupKey.length > GROUP_KEY_MAX_LENGTH))
  ) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    let count: StockCount | null;
    if (countId !== null) count = await getCount(scope, countId);
    else if (locationId !== null) count = await countAtLocation(scope, locationId);
    else if (isUuid(groupKey) && (await isTenantLocation(scope, groupKey))) count = await countAtLocation(scope, groupKey);
    else count = await countByGroupKey(scope, groupKey);
    if (!count) return NextResponse.json({ error: "count_not_found" }, { status: 404 });

    const lines = await countLines(scope, count.id);
    return NextResponse.json({
      count: {
        id: count.id,
        status: count.status,
        locationId: count.locationId,
        groupKey: count.groupKey,
        mergeMode: count.mergeMode,
        counters: count.counters.length,
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
