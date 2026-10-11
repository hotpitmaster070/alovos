import { NextResponse } from "next/server";
import { receiptOrderOptions } from "@/lib/auto-order/repository";
import { isUuid } from "@/lib/purchasing/model";
import { apiError, apiScope } from "@/lib/purchasing/api";

export const dynamic = "force-dynamic";

/** ?product_id=&branch_id=: the latest sent orders of the restaurant with the product still to come. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const params = new URL(request.url).searchParams;
  const productId = params.get("product_id");
  const branchId = params.get("branch_id") || null;
  if (!isUuid(productId) || (branchId !== null && !isUuid(branchId))) return apiError("invalid_input", 400);
  return NextResponse.json({ orders: await receiptOrderOptions(current.scope, productId, branchId) });
}
