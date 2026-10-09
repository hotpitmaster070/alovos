import { invalidLabelsInput, labelsResponse } from "@/lib/labels/api";
import { SHELF_LIFE_DAYS_MAX } from "@/lib/labels/model";
import { expiringLots } from "@/lib/labels/repository";
import { apiScope } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** Lots still in stock expiring within ?days= (default: tenant_settings.expiry_warn_days), soonest first. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const raw = new URL(request.url).searchParams.get("days");
  const days = raw === null || raw === "" ? null : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (days !== null && !(days <= SHELF_LIFE_DAYS_MAX)) return invalidLabelsInput();
  return labelsResponse(await expiringLots(current.scope, days), (lots) => ({
    lots: lots.map((lot) => ({
      id: lot.id,
      lot_number: lot.lotNumber,
      product_id: lot.productId,
      product_name: lot.productName,
      unit: lot.unit,
      quantity: lot.quantity,
      portions: lot.portions,
      production_date: lot.productionDate,
      expiry_date: lot.expiryDate,
      days_left: lot.daysLeft,
      storage_location_id: lot.storageLocationId,
      storage_name: lot.storageName,
      lot_type: lot.lotType,
      in_stock: lot.inStock,
    })),
  }));
}
