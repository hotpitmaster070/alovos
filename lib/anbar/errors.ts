export const ANBAR_ERROR_CODES = [
  "unauthenticated",
  "invalidInput",
  "productNotFound",
  "locationNotFound",
  "sameLocation",
  "invalidQty",
  "exceedsQty",
  "unitMismatch",
  "duplicateBarcode",
  "concurrent",
  "saveFailed",
] as const;

export type AnbarErrorCode = (typeof ANBAR_ERROR_CODES)[number];

export type ActionResult = { ok: true } | { ok: false; error: AnbarErrorCode };

export const success: ActionResult = { ok: true };
export const failure = (error: AnbarErrorCode): ActionResult => ({ ok: false, error });

type PostgrestErrorLike = { message?: unknown; code?: unknown };

/** Maps the stable messages raised by public.move_stock() (and Postgres codes) to error codes. */
export function mapRpcError(error: PostgrestErrorLike): AnbarErrorCode {
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : "";

  if (message.includes("insufficient_stock")) return "exceedsQty";
  if (message.includes("invalid_qty")) return "invalidQty";
  if (message.includes("same_location")) return "sameLocation";
  if (message.includes("product_not_found")) return "productNotFound";
  if (message.includes("location_not_found")) return "locationNotFound";
  if (message.includes("unit_mismatch")) return "unitMismatch";
  if (message.includes("product_location_mismatch") || message.includes("conflict")) return "concurrent";
  if (message.includes("not_authenticated") || message.includes("no_organization")) return "unauthenticated";
  if (code === "23505") return "duplicateBarcode";
  if (code === "22P02" || message.includes("invalid_argument")) return "invalidInput";
  return "saveFailed";
}
