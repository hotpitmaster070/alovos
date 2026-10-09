import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/api/tenant";
import type { TenantScope } from "@/lib/anbar/scope";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { countAtLocation, countByGroupKey, countLines, getCount, isTenantLocation, openCountAt } from "@/lib/count/load";
import { GROUP_KEY_MAX_LENGTH, countFormError, isCountErrorCode, isUuid, mapCountError, parseCountedQuantity, type StockCount } from "@/lib/count/model";

export const dynamic = "force-dynamic";

/** Same redirect the successful save uses. This POST is an HTML form, so it never answers with JSON. */
function redirectToCount(request: Request, params: Record<string, string>): NextResponse {
  const next = new URL(ANBAR_COUNT_PATH, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") next.searchParams.set(key, value);
  }
  return NextResponse.redirect(next, 303);
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch (error) {
    console.error("count POST tenant error unreadable", error instanceof Error ? error.message : "unknown");
  }
  return "save_failed";
}

/**
 * Saves the caller's entries (form: count_id or location_id, qty_<product id>, intent=save|finish).
 * With location_id the place's open count is joined or created (the storage card's "start"/"join"
 * button posts only location_id); branch and counters are set by the database from the place and
 * the session, never from the request. Failures redirect back to the count page with ?error=.
 * Only stock_count_items are written; stock changes when a chef approves the count.
 */
export async function POST(request: Request) {
  const send = (params: Record<string, string>) => redirectToCount(request, params);
  try {
    const current = await requireTenant();
    if ("error" in current) {
      if (!current.error) return send({ error: "save_failed" });
      const code = await readErrorCode(current.error);
      const error = code === "forbidden" ? "permission_denied" : code;
      return send({ error: isCountErrorCode(error) ? error : "save_failed" });
    }
    const scope: TenantScope = { client: current.supabase, tenantId: current.tenantId };

    const form = await request.formData();
    const rawCount = form.get("count_id");
    const rawLocation = form.get("location_id");
    const finish = form.get("intent") === "finish";
    const locationHint = isUuid(rawLocation) ? rawLocation : "";

    let countId = "";
    if (rawCount !== null) {
      if (!isUuid(rawCount)) return send({ error: "invalid_input", ...(locationHint ? { location: locationHint } : {}) });
      countId = rawCount;
    } else {
      if (!isUuid(rawLocation)) return send({ error: "invalid_input" });
      const started = await current.supabase.rpc("start_stock_count", { p_location_id: rawLocation });
      if (started.error || typeof started.data !== "string") {
        const message = started.error?.message ?? "";
        console.error("count POST start_stock_count failed", message || "no id");
        const mapped = countFormError(message);
        let existingId = mapped.existingId ?? "";
        if (mapped.error === "count_already_open" && existingId === "") {
          try {
            const open = await openCountAt(scope, rawLocation);
            existingId = open?.id ?? "";
          } catch (error) {
            console.error("count POST open-count lookup failed", error instanceof Error ? error.message : "unknown");
          }
        }
        return send({
          error: mapped.error,
          location: rawLocation,
          ...(existingId ? { existingId } : {}),
        });
      }
      countId = started.data;
    }

    let count: StockCount | null;
    try {
      count = await getCount(scope, countId);
    } catch (error) {
      console.error("count POST getCount failed", error instanceof Error ? error.message : "unknown");
      return send({
        error: "save_failed",
        ...(countId ? { countId } : {}),
        ...(locationHint ? { location: locationHint } : {}),
      });
    }
    if (!count) {
      return send({
        error: "count_not_found",
        ...(countId ? { countId } : {}),
        ...(locationHint ? { location: locationHint } : {}),
      });
    }

    const loaded = count;
    const sendCount = (params: Record<string, string>) => send({ location: loaded.locationId, countId: loaded.id, ...params });

    const items: { product_id: string; quantity: number }[] = [];
    for (const [key, value] of Array.from(form.entries())) {
      if (!key.startsWith("qty_")) continue;
      const productId = key.slice(4);
      const quantity = parseCountedQuantity(value);
      if (!isUuid(productId) || !quantity.ok) return sendCount({ error: "invalid_input" });
      if (quantity.value !== null) items.push({ product_id: productId, quantity: quantity.value });
    }

    if (items.length > 0) {
      const saved = await current.supabase.rpc("save_stock_count_items", { p_count_id: countId, p_items: items });
      if (saved.error) {
        const message = saved.error.message ?? "";
        console.error("count POST save_stock_count_items failed", message || "unknown");
        const mapped = countFormError(message);
        return sendCount({ error: mapped.error, ...(mapped.existingId ? { existingId: mapped.existingId } : {}) });
      }
    }
    if (finish) {
      const finished = await current.supabase.rpc("finish_my_stock_count", { p_count_id: countId });
      if (finished.error) {
        const message = finished.error.message ?? "";
        console.error("count POST finish_my_stock_count failed", message || "unknown");
        const mapped = countFormError(message);
        return sendCount({ error: mapped.error, ...(mapped.existingId ? { existingId: mapped.existingId } : {}) });
      }
    }
    return sendCount({ notice: finish ? "finished" : items.length === 0 && rawCount === null ? "started" : "saved" });
  } catch (error) {
    console.error("count POST failed", error instanceof Error ? error.message : "unknown");
    return send({ error: "save_failed" });
  }
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
