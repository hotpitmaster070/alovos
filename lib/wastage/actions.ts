"use server";

import { listStockLines } from "@/lib/anbar/kitchen";
import { resolveScope } from "@/lib/anbar/scope";
import { parseLocationFilter, type StockLine } from "@/lib/anbar/stock-view";
import { parseSearch } from "@/lib/pagination";

export type WasteStockResult = { ok: true; lines: StockLine[] } | { ok: false };

/** Stock lines the write-off form can pick from: the first page matching the typed name. */
export async function searchWasteStockAction(input: {
  search: string;
  branchId: string;
  locationId: string;
}): Promise<WasteStockResult> {
  const resolved = await resolveScope();
  if (resolved.status !== "ok") return { ok: false };
  try {
    const found = await listStockLines(
      resolved.scope,
      {
        branchId: parseLocationFilter(input.branchId),
        locationId: parseLocationFilter(input.locationId),
        search: parseSearch(input.search),
      },
      1,
    );
    return { ok: true, lines: found.lines.filter((line) => line.quantity > 0) };
  } catch (error) {
    console.error("searchWasteStockAction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false };
  }
}
