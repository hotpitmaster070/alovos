"use server";

import { revalidatePath } from "next/cache";
import { resolveScope } from "@/lib/anbar/scope";
import { CHEF_RECIPES_PATH, RECIPES_PATH } from "@/lib/auth-redirect";
import { isUuid, mapTechCardError, parseTechCardInput, type TechCardErrorCode } from "./model";

export type TechCardActionResult<T = null> = { ok: true; value: T } | { ok: false; error: TechCardErrorCode };

async function rpc<T>(name: string, args: Record<string, unknown>, pick: (data: unknown) => T): Promise<TechCardActionResult<T>> {
  const resolved = await resolveScope();
  if (resolved.status === "unauthenticated") return { ok: false, error: "unauthenticated" };
  if (resolved.status === "no_organization") return { ok: false, error: "no_tenant" };
  if (resolved.status === "error") return { ok: false, error: "save_failed" };
  const { data, error } = await resolved.scope.client.rpc(name, args);
  if (error) {
    const code = mapTechCardError(error.message ?? "");
    if (code === "save_failed") console.error(`${name} failed`, error.message);
    return { ok: false, error: code };
  }
  revalidatePath(RECIPES_PATH, "layout");
  revalidatePath(CHEF_RECIPES_PATH, "layout");
  return { ok: true, value: pick(data) };
}

/** Creates (id null) or replaces a card with its ingredients; returns the card id. */
export async function saveTechCardAction(raw: unknown): Promise<TechCardActionResult<string>> {
  const input = parseTechCardInput(raw);
  if (!input) return { ok: false, error: "invalid_input" };
  return rpc(
    "save_tech_card",
    {
      p_id: input.id,
      p_name: input.name,
      p_category: input.category,
      p_sale_price: input.salePrice,
      p_yield_qty: input.yieldQty,
      p_yield_unit: input.yieldUnit,
      p_ingredients: input.ingredients.map((item) => ({
        product_id: item.productId,
        brutto: item.brutto,
        netto: item.netto,
        price_lot_id: item.priceLotId,
      })),
    },
    (data) => String(data ?? ""),
  );
}

export async function deleteTechCardAction(id: unknown): Promise<TechCardActionResult> {
  if (!isUuid(id)) return { ok: false, error: "invalid_input" };
  return rpc("delete_tech_card", { p_id: id }, () => null);
}
