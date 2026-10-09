import { revalidatePath } from "next/cache";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { validateProductEconomics, type ProductEconomics } from "@/lib/labels/final";
import { canEditPreparations, isUuid } from "@/lib/labels/model";
import { memberRole } from "@/lib/count/load";
import { productEconomics, setProductEconomics } from "@/lib/labels/repository";
import { apiScope, jsonBody } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

const serialize = (value: ProductEconomics) => ({
  product_type: value.productType,
  sale_price: value.salePrice,
  density_kg_per_l: value.densityKgPerL,
  trim_value_percent: value.trimValuePercent,
});

/** Type, density, trim value and (for owners and chefs) the sale price of a product; can_edit for owners and chefs. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidLabelsInput();
  const [result, role] = await Promise.all([productEconomics(current.scope, params.id), memberRole(current.scope)]);
  return labelsResponse(result, (value) => ({ ...serialize(value), can_edit: canEditPreparations(role) }));
}

/** Owners and chefs: {product_type, sale_price, density_kg_per_l, trim_value_percent}; empty clears a value. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  if (!isUuid(params.id)) return invalidLabelsInput();
  const body = await jsonBody(request);
  const input = body ? validateProductEconomics(body) : null;
  if (!input?.ok) return invalidLabelsInput();
  const result = await setProductEconomics(current.scope, params.id, input.value);
  if (result.ok) revalidatePath(ANBAR_APP_PATH, "layout");
  return labelsResponse(result, serialize);
}
