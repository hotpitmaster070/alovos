import type { TenantScope } from "@/lib/anbar/scope";
import { canSeeCosts } from "@/lib/labels/final";
import { listLabelProducts } from "@/lib/labels/repository";
import { currencyOf } from "@/lib/money";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { getTechCardCost, listIngredientPrices, listPriceLots, type EditorMoney, type EditorProduct } from "./load";

/** Products to pick from and, for owners and chefs, the prices behind the live cost. */
export async function loadEditorData(
  scope: TenantScope,
  role: string | null,
  techCardId: string | null,
): Promise<{ products: EditorProduct[]; money: EditorMoney | null }> {
  const products = (await listLabelProducts(scope)).map((product) => ({ id: product.id, name: product.name, unit: product.unit }));
  if (!canSeeCosts(role)) return { products, money: null };
  const [settings, prices, lots, cost] = await Promise.all([
    getSettings(scope),
    listIngredientPrices(scope),
    listPriceLots(scope),
    techCardId ? getTechCardCost(scope, techCardId) : Promise.resolve(null),
  ]);
  return { products, money: { salePrice: cost?.salePrice ?? null, prices, lots, currency: currencyOf(settings) } };
}
