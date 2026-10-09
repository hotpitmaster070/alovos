export const ANBAR_ERROR_CODES = [
  "unauthenticated",
  "invalidInput",
  "expiryOutOfRange",
  "productNotFound",
  "locationNotFound",
  "sameLocation",
  "invalidQty",
  "exceedsQty",
  "unitMismatch",
  "duplicateBarcode",
  "duplicateLocation",
  "numberTaken",
  "openCount",
  "concurrent",
  "saveFailed",
] as const;

export type AnbarErrorCode = (typeof ANBAR_ERROR_CODES)[number];

export type ActionResult = { ok: true } | { ok: false; error: AnbarErrorCode };

export const success: ActionResult = { ok: true };
export const failure = (error: AnbarErrorCode): { ok: false; error: AnbarErrorCode } => ({ ok: false, error });

type PostgrestErrorLike = { message?: unknown; code?: unknown };

/** Maps the stable messages raised by public.move_stock() (and Postgres codes) to error codes. */
export function mapRpcError(error: PostgrestErrorLike): AnbarErrorCode {
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : "";

  if (message.includes("number_taken") || message.includes("uniq_location_number_per_branch")) return "numberTaken";
  if (message.includes("duplicate_name") || message.includes("storage_locations_branch_id_name_key")) return "duplicateLocation";
  if (message.includes("open_count")) return "openCount";
  if (message.includes("branch_not_found")) return "invalidInput";
  if (message.includes("insufficient_stock")) return "exceedsQty";
  if (message.includes("invalid_qty")) return "invalidQty";
  if (message.includes("same_location")) return "sameLocation";
  if (message.includes("expiry_out_of_range")) return "expiryOutOfRange";
  if (message.includes("product_not_found")) return "productNotFound";
  if (message.includes("location_not_found")) return "locationNotFound";
  if (message.includes("unit_mismatch")) return "unitMismatch";
  if (message.includes("product_location_mismatch") || message.includes("conflict")) return "concurrent";
  if (message.includes("not_authenticated") || message.includes("no_organization")) return "unauthenticated";
  if (code === "23505") return "duplicateBarcode";
  if (code === "22P02" || message.includes("invalid_argument")) return "invalidInput";
  return "saveFailed";
}
