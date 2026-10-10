/** Recipe card editor: input checks, waste %, food cost. Mirrors public.save_tech_card() and tech_card_economics(). */

export const TECH_CARD_NAME_MAX = 120;
export const TECH_CARD_CATEGORY_MAX = 60;
export const TECH_CARD_UNIT_MAX = 10;
export const TECH_CARD_MAX_INGREDIENTS = 100;
export const INGREDIENT_MAX_QTY = 1000;
export const SALE_PRICE_MAX = 10_000_000;
export const YIELD_MAX = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const TECH_CARD_ERROR_CODES = [
  "invalid_input",
  "forbidden",
  "recipe_not_found",
  "product_not_found",
  "duplicate_product",
  "no_tenant",
  "unauthenticated",
  "save_failed",
] as const;
export type TechCardErrorCode = (typeof TECH_CARD_ERROR_CODES)[number];

export function mapTechCardError(message: string): TechCardErrorCode {
  return (
    TECH_CARD_ERROR_CODES.find((code) => code !== "save_failed" && code !== "unauthenticated" && message.includes(code)) ??
    "save_failed"
  );
}

/** Per portion, in the product's unit. */
export type IngredientInput = { productId: string; brutto: number; netto: number; priceLotId: string | null };

export type TechCardInput = {
  id: string | null;
  name: string;
  category: string | null;
  salePrice: number | null;
  yieldQty: number | null;
  yieldUnit: string | null;
  ingredients: IngredientInput[];
};

/** (brutto - netto) / brutto in percent, 2 decimals; null unless 0 < netto <= brutto. */
export function wastePercent(brutto: number, netto: number): number | null {
  if (!Number.isFinite(brutto) || !Number.isFinite(netto) || brutto <= 0 || netto <= 0 || netto > brutto) return null;
  return Math.round(((brutto - netto) / brutto) * 10000) / 100;
}

/** Food cost % of the sale price and the margin; null parts when the cost or the price is unknown. */
export function foodCost(cost: number | null, salePrice: number | null): { foodCostPercent: number | null; margin: number | null } {
  const known = cost !== null && Number.isFinite(cost);
  return {
    foodCostPercent: known && salePrice !== null && salePrice > 0 ? Math.round((cost / salePrice) * 10000) / 100 : null,
    margin: known && salePrice !== null ? Math.round((salePrice - cost) * 10000) / 10000 : null,
  };
}

const cleanText = (value: unknown, max: number): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) return undefined;
  return text === "" ? null : text;
};

const optionalNumber = (value: unknown, min: number, max: number, strictMin: boolean): number | null | undefined => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (strictMin ? value <= min : value < min) return undefined;
  return value > max ? undefined : value;
};

/** Server-side check of the editor's payload; null when anything is off. */
export function parseTechCardInput(raw: unknown): TechCardInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record.id === null || record.id === undefined ? null : isUuid(record.id) ? record.id : undefined;
  const name = cleanText(record.name, TECH_CARD_NAME_MAX);
  const category = cleanText(record.category, TECH_CARD_CATEGORY_MAX);
  const yieldUnit = cleanText(record.yieldUnit, TECH_CARD_UNIT_MAX);
  const salePrice = optionalNumber(record.salePrice, 0, SALE_PRICE_MAX, false);
  const yieldQty = optionalNumber(record.yieldQty, 0, YIELD_MAX, true);
  if (id === undefined || !name || category === undefined || yieldUnit === undefined || salePrice === undefined || yieldQty === undefined) {
    return null;
  }
  if (!Array.isArray(record.ingredients) || record.ingredients.length > TECH_CARD_MAX_INGREDIENTS) return null;
  const ingredients: IngredientInput[] = [];
  const seen = new Set<string>();
  for (const item of record.ingredients) {
    if (typeof item !== "object" || item === null) return null;
    const line = item as Record<string, unknown>;
    const { brutto, netto } = line;
    if (!isUuid(line.productId) || seen.has(line.productId)) return null;
    if (typeof brutto !== "number" || typeof netto !== "number" || brutto > INGREDIENT_MAX_QTY) return null;
    if (wastePercent(brutto, netto) === null) return null;
    const priceLotId = line.priceLotId === null || line.priceLotId === undefined || line.priceLotId === "" ? null : line.priceLotId;
    if (priceLotId !== null && !isUuid(priceLotId)) return null;
    seen.add(line.productId);
    ingredients.push({ productId: line.productId, brutto, netto, priceLotId });
  }
  return { id, name, category, salePrice, yieldQty, yieldUnit, ingredients };
}

/** Text field -> number for the editor ("0,25" accepted); NaN when not a number. */
export function parseDecimal(value: string): number {
  const text = value.trim().replace(",", ".");
  return text === "" ? NaN : Number(text);
}
