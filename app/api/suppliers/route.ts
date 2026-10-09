import { NextResponse } from "next/server";
import { apiError, apiScope, invalidInput, jsonBody, resultResponse } from "@/lib/purchasing/api";
import { validateSupplierInput } from "@/lib/purchasing/model";
import { createSupplier, listSuppliers } from "@/lib/purchasing/repository";
import { serializeSupplier } from "@/lib/purchasing/serialize";

export const dynamic = "force-dynamic";

/** Suppliers of the caller's tenant; ?include_inactive=1 adds deactivated ones. */
export async function GET(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const includeInactive = new URL(request.url).searchParams.get("include_inactive") === "1";
  try {
    const suppliers = await listSuppliers(current.scope, { includeInactive });
    return NextResponse.json({ suppliers: suppliers.map(serializeSupplier) });
  } catch (error) {
    console.error("suppliers GET failed", error instanceof Error ? error.message : "unknown");
    return apiError("save_failed", 500);
  }
}

/**
 * Creates a supplier (owners and chefs): {name, delivery_days: [1, 4], code?, contact?, branch_id?,
 * lead_time_days?}. delivery_days are weekdays, 0 = Sunday .. 6 = Saturday; code defaults to the name.
 */
export async function POST(request: Request) {
  const current = await apiScope();
  if ("response" in current) return current.response;
  const body = await jsonBody(request);
  const input = body ? validateSupplierInput(body) : null;
  if (!input?.ok) return invalidInput();
  return resultResponse(await createSupplier(current.scope, input.value), (supplier) => ({ supplier: serializeSupplier(supplier) }), 201);
}
