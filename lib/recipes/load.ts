import type { TenantScope } from "@/lib/anbar/scope";
import type { CurrencyInfo } from "@/lib/money";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { foodCost } from "./model";

export type RecipeSummary = { id: string; name: string; category: string | null };

export type RecipeIngredient = {
  productId: string;
  name: string;
  unit: string;
  netto: number;
  brutto: number;
  wastePercent: number;
  priceLotId: string | null;
};

export type Recipe = RecipeSummary & {
  yieldQty: number | null;
  yieldUnit: string | null;
  ingredients: RecipeIngredient[];
};

/** Where an ingredient's unit price comes from (public.tech_card_unit_cost). */
export type PriceSource = "price_lot" | "latest_lot" | "product";

export type CostLine = {
  productId: string;
  grossQty: number;
  unitCost: number | null;
  lineCost: number | null;
  priceSource: PriceSource | null;
  lotId: string | null;
};

export type TechCardEconomics = {
  cost: number | null;
  salePrice: number | null;
  foodCostPercent: number | null;
  margin: number | null;
  ingredientCount: number;
  pricedCount: number;
};

export type TechCardCost = TechCardEconomics & { lines: CostLine[] };

export type IngredientPrice = { unitCost: number; priceSource: PriceSource; lotId: string | null };

export type PriceLot = { id: string; productId: string; lotNumber: string; unitCost: number; createdAt: string };

export type EditorProduct = { id: string; name: string; unit: string };

/** Money for owners and chefs; null for cooks, who edit the recipe without seeing prices. */
export type EditorMoney = {
  salePrice: number | null;
  prices: Record<string, IngredientPrice>;
  lots: PriceLot[];
  currency: CurrencyInfo;
};

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const priceSource = (value: unknown): PriceSource | null =>
  value === "price_lot" || value === "latest_lot" || value === "product" ? value : null;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

export async function listRecipes(scope: TenantScope): Promise<RecipeSummary[]> {
  const rows = await fetchAll((from, to) =>
    scope.client
      .from("tech_cards")
      .select("id, name, category")
      .eq("tenant_id", scope.tenantId)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return rows.flatMap((row) => {
    const record = row as Record<string, unknown>;
    return typeof record.id === "string"
      ? [{ id: record.id, name: typeof record.name === "string" ? record.name : "", category: textOrNull(record.category) }]
      : [];
  });
}

export async function getRecipe(scope: TenantScope, id: string): Promise<Recipe | null> {
  const card = await scope.client
    .from("tech_cards")
    .select("id, name, category, yield_qty, yield_unit")
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (card.error) throw new Error(`tech_cards: ${card.error.message}`);
  if (!card.data) return null;
  const rows = await scope.client
    .from("tech_card_ingredients")
    .select("product_id, netto, brutto, waste_percent, price_lot_id, sort, product:products(name, unit)")
    .eq("tenant_id", scope.tenantId)
    .eq("tech_card_id", id)
    .order("sort", { nullsFirst: false })
    .order("id")
    .limit(500);
  if (rows.error) throw new Error(`tech_card_ingredients: ${rows.error.message}`);
  const ingredients = (rows.data ?? []).flatMap((row) => {
    const record = row as Record<string, unknown>;
    if (typeof record.product_id !== "string") return [];
    const product = asRecord(Array.isArray(record.product) ? record.product[0] : record.product);
    return [
      {
        productId: record.product_id,
        name: typeof product.name === "string" ? product.name : "",
        unit: typeof product.unit === "string" ? product.unit : "",
        netto: num(record.netto),
        brutto: num(record.brutto),
        wastePercent: num(record.waste_percent),
        priceLotId: textOrNull(record.price_lot_id),
      },
    ];
  });
  const data = card.data as Record<string, unknown>;
  return {
    id: String(data.id),
    name: typeof data.name === "string" ? data.name : "",
    category: textOrNull(data.category),
    yieldQty: numOrNull(data.yield_qty),
    yieldUnit: textOrNull(data.yield_unit),
    ingredients,
  };
}

function parseEconomics(row: Record<string, unknown>): TechCardEconomics {
  const cost = numOrNull(row.cost);
  const salePrice = numOrNull(row.sale_price);
  return {
    cost,
    salePrice,
    ...foodCost(cost, salePrice),
    ingredientCount: num(row.ingredient_count),
    pricedCount: num(row.priced_count),
  };
}

/** Cost, sale price, food cost and margin of every card (owners and chefs; the RPC refuses cooks). */
export async function listRecipeEconomics(scope: TenantScope): Promise<Map<string, TechCardEconomics>> {
  const { data, error } = await scope.client.rpc("tech_card_economics", { p_tech_card_id: null });
  if (error) throw new Error(`tech_card_economics: ${error.message}`);
  const map = new Map<string, TechCardEconomics>();
  for (const raw of Array.isArray(data) ? data : []) {
    const row = asRecord(raw);
    if (typeof row.tech_card_id === "string") map.set(row.tech_card_id, parseEconomics(row));
  }
  return map;
}

/**
 * Live cost of one portion: per ingredient gross x unit price (pinned lot, else the latest lot with a
 * cost, else products.cost), then food cost = cost / sale price and the margin. Owners and chefs only.
 */
export async function getTechCardCost(scope: TenantScope, techCardId: string): Promise<TechCardCost> {
  const [lines, economics] = await Promise.all([
    scope.client.rpc("tech_card_cost_lines", { p_tech_card_id: techCardId }),
    scope.client.rpc("tech_card_economics", { p_tech_card_id: techCardId }),
  ]);
  if (lines.error) throw new Error(`tech_card_cost_lines: ${lines.error.message}`);
  if (economics.error) throw new Error(`tech_card_economics: ${economics.error.message}`);
  const row = asRecord(Array.isArray(economics.data) ? economics.data[0] : null);
  return {
    ...parseEconomics(row),
    lines: (Array.isArray(lines.data) ? lines.data : []).flatMap((raw) => {
      const line = asRecord(raw);
      if (typeof line.product_id !== "string") return [];
      return [
        {
          productId: line.product_id,
          grossQty: num(line.gross_qty),
          unitCost: numOrNull(line.unit_cost),
          lineCost: numOrNull(line.line_cost),
          priceSource: priceSource(line.price_source),
          lotId: textOrNull(line.lot_id),
        },
      ];
    }),
  };
}

/** Current unit price per product, for the editor's preview before saving. */
export async function listIngredientPrices(scope: TenantScope): Promise<Record<string, IngredientPrice>> {
  const { data, error } = await scope.client.rpc("ingredient_prices");
  if (error) throw new Error(`ingredient_prices: ${error.message}`);
  const prices: Record<string, IngredientPrice> = {};
  for (const raw of Array.isArray(data) ? data : []) {
    const row = asRecord(raw);
    const unitCost = numOrNull(row.unit_cost);
    const source = priceSource(row.price_source);
    if (typeof row.product_id === "string" && unitCost !== null && source) {
      prices[row.product_id] = { unitCost, priceSource: source, lotId: textOrNull(row.lot_id) };
    }
  }
  return prices;
}

/** Recent lots with a cost, to pin an ingredient's price to one of them. */
export async function listPriceLots(scope: TenantScope, limit = 300): Promise<PriceLot[]> {
  const { data, error } = await scope.client
    .from("product_lot_costs")
    .select("lot_id, cost_per_unit, created_at, lot:product_lots!inner(product_id, lot_number)")
    .eq("tenant_id", scope.tenantId)
    .not("cost_per_unit", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`product_lot_costs: ${error.message}`);
  return (data ?? []).flatMap((raw) => {
    const row = asRecord(raw);
    const lot = asRecord(Array.isArray(row.lot) ? row.lot[0] : row.lot);
    const unitCost = numOrNull(row.cost_per_unit);
    if (typeof row.lot_id !== "string" || typeof lot.product_id !== "string" || unitCost === null) return [];
    return [
      {
        id: row.lot_id,
        productId: lot.product_id,
        lotNumber: typeof lot.lot_number === "string" ? lot.lot_number : "",
        unitCost,
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
      },
    ];
  });
}
