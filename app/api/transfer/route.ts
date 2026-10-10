import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { canApproveCounts, memberRole } from "@/lib/count/load";
import { apiScope, jsonBody } from "@/lib/purchasing/api";
import {
  mapTransferError,
  parseShortages,
  parseTransferInput,
  pickTransferLang,
  rpcItems,
  TRANSFER_MESSAGES,
  TRANSFER_STATUS,
  type TransferError,
  type TransferLang,
} from "@/lib/transfer/model";

export const dynamic = "force-dynamic";

const failure = (error: TransferError, lang: TransferLang, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, message: TRANSFER_MESSAGES[lang][error], ...extra }, { status: TRANSFER_STATUS[error] });

/**
 * POST {from_branch_id, to_branch_id, items: [{product_id, quantity, from_location_id?, to_location_id?}], note?}.
 * One call to public.transfer_stock_between_branches(): the whole transfer commits or nothing does.
 * Owners and chefs only (checked here and again in the database); the tenant is never taken from the body.
 */
export async function POST(request: Request) {
  const lang = pickTransferLang(
    new URL(request.url).searchParams.get("lang") ?? request.headers.get("x-alovos-lang"),
    request.headers.get("accept-language"),
  );
  const current = await apiScope();
  if ("response" in current) return current.response;
  const { scope } = current;

  if (!canApproveCounts(await memberRole(scope))) return failure("forbidden", lang);

  const input = parseTransferInput(await jsonBody(request));
  if (!input) return failure("invalid_input", lang);
  if (input.fromBranchId === input.toBranchId) return failure("same_branch", lang);

  const { data, error } = await scope.client.rpc("transfer_stock_between_branches", {
    p_from_branch: input.fromBranchId,
    p_to_branch: input.toBranchId,
    p_items: rpcItems(input.items),
    p_note: input.note,
  });

  if (error) {
    const code = mapTransferError(error.message);
    if (code !== "insufficient_stock") {
      if (code === "save_failed") console.error("transfer_stock_between_branches failed", error.message);
      return failure(code, lang);
    }
    const shortages = parseShortages(error.details);
    const names = new Map<string, string>();
    if (shortages.length > 0) {
      const found = await scope.client
        .from("products")
        .select("id, name, unit")
        .eq("tenant_id", scope.tenantId)
        .in("id", shortages.map((item) => item.productId));
      for (const row of (found.data ?? []) as { id: string; name: string; unit: string | null }[]) {
        names.set(row.id, row.unit ? `${row.name} (${row.unit})` : row.name);
      }
    }
    const messages = TRANSFER_MESSAGES[lang];
    const lines = shortages.map((item) =>
      messages.shortageLine(names.get(item.productId) ?? item.productId, String(item.requested), String(item.available)),
    );
    return failure("insufficient_stock", lang, {
      message: [messages.insufficient_stock, ...lines].join("\n"),
      shortages: shortages.map((item) => ({
        product_id: item.productId,
        name: names.get(item.productId) ?? null,
        requested: item.requested,
        available: item.available,
      })),
    });
  }

  revalidatePath(ANBAR_APP_PATH, "layout");
  const result = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  return NextResponse.json(
    {
      ok: true,
      transfer_id: result.transfer_id ?? null,
      items: result.items ?? input.items.length,
      movements: result.movements ?? null,
    },
    { status: 201 },
  );
}
