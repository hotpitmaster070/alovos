import { NextResponse } from "next/server";
import { apiScope, apiError, invalidInput } from "@/lib/purchasing/api";
import { FORECAST_STATUSES, type ForecastStatus } from "@/lib/purchasing/model";
import { listForecast } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

const isStatus = (value: string): value is ForecastStatus => (FORECAST_STATUSES as readonly string[]).includes(value);

/**
 * low_stock_with_forecast of the caller's tenant: stock, par level, min stock, supplier and next
 * delivery, average daily usage, projected stock at the delivery and what to order.
 * GET ?status=critical,order narrows the list; most urgent first.
 */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;

  const raw = new URL(request.url).searchParams.get("status");
  const statuses = raw ? raw.split(",").map((value) => value.trim()) : null;
  if (statuses && !statuses.every(isStatus)) return invalidInput();

  try {
    const rows = await listForecast(current.scope, { statuses: statuses as ForecastStatus[] | null });
    return NextResponse.json({
      products: rows.map((row) => ({
        product_id: row.productId,
        branch_id: row.branchId,
        name: row.name,
        unit: row.unit,
        current_stock: row.currentStock,
        par_level: row.parLevel,
        min_stock: row.minStock,
        supplier_id: row.supplierId,
        supplier_name: row.supplierName,
        delivery_days: row.deliveryDays,
        next_delivery_date: row.nextDeliveryDate,
        days_until_delivery: row.daysUntilDelivery,
        avg_daily_usage: row.avgDailyUsage,
        projected_stock: row.projectedStock,
        need_to_order: row.needToOrder,
        on_order: row.onOrder,
        will_run_out: row.willRunOut,
        status: row.status,
      })),
    });
  } catch (error) {
    console.error("low-stock-with-forecast failed", error instanceof Error ? error.message : "unknown");
    return apiError("save_failed", 500);
  }
}
