export const SALE_MAX_ITEMS = 100;
export const SALE_MAX_PORTIONS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Gross quantity per portion, as public.tech_card_gross() computes it for the write-off and the cost. */
export function grossPerPortion(ingredient: { netto: number; brutto: number; wastePercent: number }): number {
  if (ingredient.brutto > 0) return ingredient.brutto;
  if (ingredient.netto <= 0) return 0;
  return ingredient.wastePercent > 0 && ingredient.wastePercent < 100
    ? ingredient.netto / (1 - ingredient.wastePercent / 100)
    : ingredient.netto;
}

export type SaleItem = { recipe_id: string; quantity: number };
export type SaleRequest = { branch_id: string; items: SaleItem[] };

export type Deduction = { recipe_id: string; product_id: string; deducted: number; shortage: number };
export type SaleWarning = {
  message_key: "insufficient_stock_warning";
  recipe_id: string;
  product_id: string;
  meta: { shortage: number };
};
export type SaleResult = { deductions: Deduction[]; warnings: SaleWarning[] };

export const SALE_ERROR_CODES = [
  "invalid_input",
  "forbidden",
  "branch_not_found",
  "recipe_not_found",
  "no_tenant",
  "save_failed",
] as const;
export type SaleErrorCode = (typeof SALE_ERROR_CODES)[number];

export const SALE_ERROR_STATUS: Record<SaleErrorCode, number> = {
  invalid_input: 400,
  forbidden: 403,
  branch_not_found: 404,
  recipe_not_found: 404,
  no_tenant: 403,
  save_failed: 500,
};

export function saleErrorCode(message: string): SaleErrorCode {
  return SALE_ERROR_CODES.find((code) => code !== "save_failed" && message.includes(code)) ?? "save_failed";
}

export function parseSaleRequest(body: unknown): SaleRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (!isUuid(record.branch_id) || !Array.isArray(record.items)) return null;
  if (record.items.length === 0 || record.items.length > SALE_MAX_ITEMS) return null;
  const items: SaleItem[] = [];
  for (const raw of record.items) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const quantity = item.quantity;
    if (!isUuid(item.recipe_id) || typeof quantity !== "number" || !Number.isFinite(quantity)) return null;
    if (quantity <= 0 || quantity > SALE_MAX_PORTIONS) return null;
    items.push({ recipe_id: item.recipe_id, quantity });
  }
  return { branch_id: record.branch_id, items };
}

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/** RPC rows (one per recipe ingredient) to deductions plus a warning per shortage. */
export function toSaleResult(data: unknown): SaleResult {
  const deductions: Deduction[] = [];
  const warnings: SaleWarning[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (!isUuid(row.recipe_id) || !isUuid(row.product_id)) continue;
    const deduction = { recipe_id: row.recipe_id, product_id: row.product_id, deducted: num(row.deducted), shortage: num(row.shortage) };
    deductions.push(deduction);
    if (deduction.shortage > 0) {
      warnings.push({
        message_key: "insufficient_stock_warning",
        recipe_id: deduction.recipe_id,
        product_id: deduction.product_id,
        meta: { shortage: deduction.shortage },
      });
    }
  }
  return { deductions, warnings };
}

/** Client-side parse of the route's JSON. */
export function parseSaleResponse(body: unknown): ({ ok: true } & SaleResult) | { ok: false; error: SaleErrorCode } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "save_failed" };
  const record = body as Record<string, unknown>;
  if (record.success !== true) {
    const error = typeof record.error === "string" ? (SALE_ERROR_CODES as readonly string[]).find((code) => code === record.error) : undefined;
    return { ok: false, error: (error as SaleErrorCode | undefined) ?? "save_failed" };
  }
  const deductions = Array.isArray(record.deductions) ? (record.deductions as Deduction[]) : [];
  const warnings = Array.isArray(record.warnings) ? (record.warnings as SaleWarning[]) : [];
  return { ok: true, deductions, warnings };
}
