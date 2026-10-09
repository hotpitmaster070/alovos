import type { WasteReason } from "./model";

export type WasteErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "no_tenant"
  | "forbidden"
  | "product_not_found"
  | "location_not_found"
  | "insufficient_stock"
  | "photo_required"
  | "save_failed";

export type WasteInput = {
  productId: string;
  locationId: string;
  quantity: number;
  reason: WasteReason;
  photoPath: string | null;
};

type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const RAISED: Record<string, { code: WasteErrorCode; status: number }> = {
  invalid_input: { code: "invalid_input", status: 400 },
  photo_required: { code: "photo_required", status: 400 },
  unauthenticated: { code: "unauthenticated", status: 401 },
  no_tenant: { code: "no_tenant", status: 403 },
  forbidden: { code: "forbidden", status: 403 },
  product_not_found: { code: "product_not_found", status: 404 },
  location_not_found: { code: "location_not_found", status: 404 },
  insufficient_stock: { code: "insufficient_stock", status: 409 },
};

/** Error raised by create_wastage_with_movement -> API error code and HTTP status. */
export function mapWasteError(message: string): { code: WasteErrorCode; status: number } {
  const key = Object.keys(RAISED).find((name) => message.includes(name));
  return key ? RAISED[key] : { code: "save_failed", status: 500 };
}

export type WasteResult = { ok: true; id: string } | { ok: false; error: WasteErrorCode; status: number };

/** Log, movement and lot decrease in one database transaction; on failure nothing is written. */
export async function createWastage(client: RpcClient, input: WasteInput): Promise<WasteResult> {
  const { data, error } = await client.rpc("create_wastage_with_movement", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_storage_location_id: input.locationId,
    p_photo_path: input.photoPath,
  });
  if (error) {
    const mapped = mapWasteError(error.message ?? "");
    return { ok: false, error: mapped.code, status: mapped.status };
  }
  if (typeof data !== "string" || data === "") return { ok: false, error: "save_failed", status: 500 };
  return { ok: true, id: data };
}
