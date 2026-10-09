import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { isUuid, validateShelfLifeRuleInput, type ShelfLifeInfo } from "@/lib/labels/model";
import { setShelfLifeRule, shelfLifeInfo } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

const serialize = (info: ShelfLifeInfo) => ({
  product_id: info.productId,
  product_shelf_life_days: info.productDays,
  default_shelf_life_days: info.defaultDays,
  rules: Object.entries(info.rules).map(([storageLocationId, days]) => ({
    storage_location_id: storageLocationId,
    shelf_life_days: days,
  })),
});

/** ?product_id=: the place rules, the product's own shelf life and the tenant default. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const productId = new URL(request.url).searchParams.get("product_id");
  if (!isUuid(productId)) return invalidLabelsInput();
  return labelsResponse(await shelfLifeInfo(current.scope, productId), serialize);
}

/** {product_id, storage_location_id, shelf_life_days}: sets the norm once; shelf_life_days null removes it. */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateShelfLifeRuleInput(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  return labelsResponse(await setShelfLifeRule(current.scope, input.value), serialize);
}
