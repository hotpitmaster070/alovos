import type { TenantScope } from "@/lib/anbar/scope";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  parseStockItem,
  parseStockSummary,
  productType,
  STOCK_ITEMS_PAGE,
  STOCK_KINDS,
  stockValue,
  type ProductEconomics,
  type ProductType,
  type StockFilter,
  type StockItem,
  type StockKind,
  type StockKindSummary,
  type StockValue,
} from "./final";
import {
  mapLabelsError,
  parseExpiringLot,
  parseLot,
  parsePreparation,
  type ExpiringLot,
  type LabelsErrorCode,
  type Lot,
  type LotInput,
  type Preparation,
  type PreparationDraft,
  type PreparationRunInput,
  type ReceiveLotInput,
  type ShelfLifeInfo,
  type ShelfLifeRuleInput,
  type WastageInput,
} from "./model";
import {
  parseExpiredStockRow,
  parseWasteEntry,
  parseWasteSummary,
  serializeWasteItem,
  type ExpiredStockRow,
  type WasteEntry,
  type WasteSummary,
} from "./waste";

/**
 * Lots, shelf-life rules, recipes and label prints. Every statement is built from a TenantScope; reads
 * are filtered by tenant_id and RLS checks again. Lots and rules are only written by the 20261018
 * database functions, which number lots, compute expiry and move stock in one transaction.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: LabelsErrorCode; status: number };

const failed = (error: { message?: unknown; code?: unknown }): { ok: false; error: LabelsErrorCode; status: number } => {
  const mapped = mapLabelsError(error);
  return { ok: false, error: mapped.code, status: mapped.status };
};

const rows = <T>(data: unknown, parse: (row: unknown) => T | null): T[] =>
  (Array.isArray(data) ? data : data ? [data] : []).flatMap((row) => parse(row) ?? []);

function oneLot(data: unknown, error: { message?: unknown; code?: unknown } | null): Result<Lot> {
  if (error) return failed(error);
  const lot = rows(data, parseLot)[0];
  return lot ? { ok: true, value: lot } : failed({});
}

/** A label for stock already on the shelf; no movement. */
export async function createLot(scope: TenantScope, input: LotInput): Promise<Result<Lot>> {
  const { data, error } = await scope.client.rpc("create_lot", {
    p_product_id: input.productId,
    p_qty: input.qty,
    p_storage_id: input.storageLocationId,
    p_production_date: input.productionDate,
    p_lot_type: input.lotType,
  });
  return oneLot(data, error);
}

/**
 * Goods receipt and its lot in one transaction: the prihod movement carries the lot expiry. A price in
 * another currency is stored converted (maya) with the original price, currency and rate kept.
 */
export async function receiveWithLot(scope: TenantScope, input: ReceiveLotInput): Promise<Result<Lot>> {
  const { data, error } = await scope.client.rpc("receive_stock_with_lot_fx", {
    p_product_id: input.productId,
    p_qty: input.qty,
    p_storage_id: input.storageLocationId,
    p_price: input.price,
    p_currency: input.currency,
    p_fx_rate: input.fxRate,
    p_production_date: input.productionDate,
    p_shelf_life_days: input.shelfLifeDays,
    p_remember: input.remember,
  });
  return oneLot(data, error);
}

/**
 * Writes the gross input off, creates one lot per output and one trim lot per returned trim line (its
 * parent: the input lot); nothing is saved when stock is short. Output lots come first, then trim lots.
 */
export async function createLotsFromPreparation(scope: TenantScope, input: PreparationRunInput): Promise<Result<Lot[]>> {
  const { data, error } = await scope.client.rpc("create_lots_from_preparation", {
    p_preparation_id: input.preparationId,
    p_source_qty: input.sourceQty,
    p_storage_id: input.storageLocationId,
    p_source_location_id: input.sourceLocationId,
    p_outputs:
      input.outputs?.map((output) => ({
        product_id: output.productId,
        qty: output.qty,
        ...(output.storageLocationId && { storage_location_id: output.storageLocationId }),
      })) ?? null,
    p_wastage: input.wastage && { qty: input.wastage.qty, reason: input.wastage.reason, note: input.wastage.note },
    p_confirm_loss: input.confirmLoss,
    p_trims:
      input.trims.length > 0
        ? input.trims.map((trim) => ({
            product_id: trim.productId,
            qty: trim.qty,
            ...(trim.note && { note: trim.note }),
            ...(trim.storageLocationId && { storage_location_id: trim.storageLocationId }),
          }))
        : null,
  });
  if (error) return failed(error);
  return { ok: true, value: rows(data, parseLot) };
}

/** What public.get_shelf_life() picks from for one product: place rules, product days, tenant default. */
export async function shelfLifeInfo(scope: TenantScope, productId: string): Promise<Result<ShelfLifeInfo>> {
  const [product, rules, settings] = await Promise.all([
    scope.client.from("products").select("id, shelf_life_days").eq("tenant_id", scope.tenantId).eq("id", productId).maybeSingle(),
    scope.client
      .from("product_shelf_life_rules")
      .select("storage_location_id, shelf_life_days")
      .eq("tenant_id", scope.tenantId)
      .eq("product_id", productId),
    scope.client.from("tenant_settings").select("default_shelf_life_days").eq("tenant_id", scope.tenantId).maybeSingle(),
  ]);
  const error = product.error ?? rules.error ?? settings.error;
  if (error) return failed(error);
  if (!product.data) return { ok: false, error: "product_not_found", status: 404 };
  const defaultDays = Number(settings.data?.default_shelf_life_days);
  if (!Number.isInteger(defaultDays)) return failed({});
  const productDays = product.data.shelf_life_days;
  return {
    ok: true,
    value: {
      productId,
      productDays: typeof productDays === "number" ? productDays : null,
      defaultDays,
      rules: Object.fromEntries(
        (rules.data ?? []).flatMap((rule: { storage_location_id?: unknown; shelf_life_days?: unknown }) =>
          typeof rule.storage_location_id === "string" && typeof rule.shelf_life_days === "number"
            ? [[rule.storage_location_id, rule.shelf_life_days]]
            : [],
        ),
      ),
    },
  };
}

export async function setShelfLifeRule(scope: TenantScope, input: ShelfLifeRuleInput): Promise<Result<ShelfLifeInfo>> {
  const { error } = await scope.client.rpc("set_shelf_life_rule", {
    p_product_id: input.productId,
    p_storage_id: input.storageLocationId,
    p_days: input.days,
  });
  if (error) return failed(error);
  return shelfLifeInfo(scope, input.productId);
}

/** Logs the printed copies of each lot; returns the number of lots. */
export async function printLabels(scope: TenantScope, lotIds: string[], copies: number): Promise<Result<number>> {
  const { data, error } = await scope.client.rpc("print_labels", { p_lot_ids: lotIds, p_copies: copies });
  if (error) return failed(error);
  return { ok: true, value: typeof data === "number" ? data : Number(data ?? 0) };
}

/** Lots still in stock that expire within the days (null: tenant_settings.expiry_warn_days). */
export async function expiringLots(scope: TenantScope, days: number | null): Promise<Result<ExpiringLot[]>> {
  try {
    const data = await fetchAll((from, to) => scope.client.rpc("expiring_lots", { p_days: days }).range(from, to));
    return { ok: true, value: rows(data, parseExpiringLot) };
  } catch (error) {
    return failed({ message: error instanceof Error ? error.message : undefined });
  }
}

/** Lots by id, for reprinting. */
export async function lotsByIds(scope: TenantScope, ids: string[]): Promise<Lot[]> {
  if (ids.length === 0) return [];
  const data = await fetchAll((from, to) =>
    scope.client.from("product_lots").select("*").eq("tenant_id", scope.tenantId).in("id", ids).order("id").range(from, to),
  );
  return rows(data, parseLot);
}

const PREPARATION_COLUMNS =
  "id, name, inputs, outputs, is_active, wastage_norm_percent, trim_norm_percent, evaporation_percent, wastage_items";

export async function listPreparations(scope: TenantScope, { includeInactive = false } = {}): Promise<Preparation[]> {
  const data = await fetchAll((from, to) => {
    let query = scope.client.from("preparations").select(PREPARATION_COLUMNS).eq("tenant_id", scope.tenantId);
    if (!includeInactive) query = query.eq("is_active", true);
    return query.order("name").order("id").range(from, to);
  });
  return rows(data, parsePreparation);
}

/**
 * The recipe and the portion weights of its products in one transaction (public.save_preparation;
 * owners and chefs). id null creates the recipe. Products are checked by the preparation_validate trigger.
 */
async function savePreparation(scope: TenantScope, id: string | null, draft: PreparationDraft): Promise<Result<Preparation>> {
  const { data, error } = await scope.client.rpc("save_preparation", {
    p_id: id,
    p_name: draft.name,
    p_inputs: draft.inputs.map((input) => ({ product_id: input.productId, qty: input.qty })),
    p_outputs: draft.outputs.map((output) => ({
      product_id: output.productId,
      qty: output.qty,
      ...(output.portions !== null && { portions: output.portions }),
      ...(output.name !== null && { name: output.name }),
    })),
    p_wastage_norm_percent: draft.wastageNormPercent,
    p_wastage_items: draft.wastageItems?.map(serializeWasteItem) ?? null,
    p_portion_weights: draft.portionWeights.map((weight) => ({ product_id: weight.productId, portion_weight_kg: weight.kg })),
    p_evaporation_percent: draft.evaporationPercent,
  });
  if (error) return failed(error);
  const preparation = rows(data, parsePreparation)[0];
  return preparation ? { ok: true, value: preparation } : failed({});
}

export const createPreparation = (scope: TenantScope, draft: PreparationDraft): Promise<Result<Preparation>> =>
  savePreparation(scope, null, draft);

export async function updatePreparation(
  scope: TenantScope,
  id: string,
  patch: { draft?: PreparationDraft; active?: boolean },
): Promise<Result<Preparation>> {
  if (patch.draft) {
    const saved = await savePreparation(scope, id, patch.draft);
    if (!saved.ok || patch.active === undefined) return saved;
  }
  const { data, error } = await scope.client
    .from("preparations")
    .update({ is_active: patch.active })
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .select(PREPARATION_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { ok: false, error: "preparation_not_found", status: 404 };
  const preparation = parsePreparation(data);
  return preparation ? { ok: true, value: preparation } : failed({});
}

/** A waste log and its 'waste' stock movement in one transaction (public.log_wastage); returns the log id. */
export async function logWastage(scope: TenantScope, input: WastageInput): Promise<Result<string>> {
  const { data, error } = await scope.client.rpc("log_wastage", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_reason_note: input.reasonNote,
    p_parent_lot_id: input.parentLotId,
    p_preparation_id: input.preparationId,
    p_storage_location_id: input.storageLocationId,
  });
  if (error) return failed(error);
  return typeof data === "string" ? { ok: true, value: data } : failed({});
}

/** Writes the whole expired stock row off as waste (reason expired); returns the log id. */
export async function writeOffExpired(scope: TenantScope, stockId: string): Promise<Result<string>> {
  const { data, error } = await scope.client.rpc("write_off_expired_stock", { p_stock_id: stockId });
  if (error) return failed(error);
  return typeof data === "string" ? { ok: true, value: data } : failed({});
}

async function rpcRows<T>(
  scope: TenantScope,
  fn: string,
  args: Record<string, unknown>,
  parse: (row: unknown) => T | null,
): Promise<Result<T[]>> {
  try {
    const data = await fetchAll((from, to) => scope.client.rpc(fn, args).range(from, to));
    return { ok: true, value: rows(data, parse) };
  } catch (error) {
    return failed({ message: error instanceof Error ? error.message : undefined });
  }
}

/** Waste logs of the last days; cost only for callers who may see costs. */
export const listWastage = (scope: TenantScope, days: number): Promise<Result<WasteEntry[]>> =>
  rpcRows(scope, "wastage_list", { p_days: days }, parseWasteEntry);

/** Stock rows of the branch past (or within the warning days of) their expiry. */
export const expiredStock = (scope: TenantScope, branchId: string | null): Promise<Result<ExpiredStockRow[]>> =>
  rpcRows(scope, "expired_stock", { p_branch_id: branchId }, parseExpiredStockRow);

/** Today's waste of the tenant and its preparations against their norm (owners and chefs). */
export async function wastageSummary(scope: TenantScope): Promise<Result<WasteSummary>> {
  const { data, error } = await scope.client.rpc("wastage_summary", {});
  if (error) return failed(error);
  const summary = rows(data, parseWasteSummary)[0];
  return summary ? { ok: true, value: summary } : failed({});
}

const positiveOrNull = (value: unknown): number | null => {
  const parsed = value === null || value === undefined ? NaN : Number(value);
  return parsed > 0 ? parsed : null;
};

/** Stock per kind (raw / semi / trim); money only for owners and chefs. */
export async function stockSummary(scope: TenantScope, branchId: string | null): Promise<Result<StockKindSummary[]>> {
  const { data, error } = await scope.client.rpc("stock_summary", { p_branch_id: branchId });
  if (error) return failed(error);
  return { ok: true, value: rows(data, parseStockSummary) };
}

/** One page of stock rows, FIFO (earliest expiry first); kind null: all kinds. */
export async function stockItems(
  scope: TenantScope,
  query: { branchId: string | null; kind: StockKind | null; expiring: boolean; offset: number; limit: number },
): Promise<Result<{ items: StockItem[]; total: number }>> {
  const { data, error } = await scope.client.rpc("stock_items", {
    p_branch_id: query.branchId,
    p_kind: query.kind,
    p_expiring: query.expiring,
    p_offset: query.offset,
    p_limit: query.limit,
  });
  if (error) return failed(error);
  const list = Array.isArray(data) ? data : [];
  const total = Number((list[0] as { total_count?: unknown } | undefined)?.total_count ?? 0);
  return { ok: true, value: { items: rows(list, parseStockItem), total: Number.isFinite(total) ? total : 0 } };
}

/**
 * What the stock page shows for a filter: the value by kind (with today's waste cost for roles that see
 * money) and the row blocks - one per kind for "all", the kind, or the expiring rows.
 */
export async function stockView(
  scope: TenantScope,
  branchId: string | null,
  filter: StockFilter,
  seesMoney: boolean,
): Promise<Result<{ value: StockValue; blocks: { kind: StockKind | null; items: StockItem[]; total: number }[] }>> {
  const kinds: (StockKind | null)[] = filter === "all" ? [...STOCK_KINDS] : filter === "expiring" ? [null] : [filter];
  const [summary, waste, ...pages] = await Promise.all([
    stockSummary(scope, branchId),
    seesMoney ? wastageSummary(scope) : null,
    ...kinds.map((kind) =>
      stockItems(scope, { branchId, kind, expiring: filter === "expiring", offset: 0, limit: STOCK_ITEMS_PAGE }),
    ),
  ]);
  if (!summary.ok) return summary;
  const blocks = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page.ok) return page;
    blocks.push({ kind: kinds[i], items: page.value.items, total: page.value.total });
  }
  const wasteCost = waste && waste.ok ? waste.value.wasteCost : null;
  return { ok: true, value: { value: stockValue(summary.value, wasteCost, seesMoney), blocks } };
}

export type ProductEconomicsRow = ProductEconomics & { id: string };

/** Type, density and trim value of a product; the sale price only for roles that see money (else null). */
export async function productEconomics(scope: TenantScope, productId: string): Promise<Result<ProductEconomicsRow>> {
  const [product, price] = await Promise.all([
    scope.client
      .from("products")
      .select("id, product_type, density_kg_per_l, trim_value_percent")
      .eq("tenant_id", scope.tenantId)
      .eq("id", productId)
      .maybeSingle(),
    scope.client.from("product_sale_prices").select("sale_price").eq("id", productId).maybeSingle(),
  ]);
  const error = product.error ?? price.error;
  if (error) return failed(error);
  if (!product.data) return { ok: false, error: "product_not_found", status: 404 };
  const row = product.data as Record<string, unknown>;
  const percent = row.trim_value_percent === null || row.trim_value_percent === undefined ? null : Number(row.trim_value_percent);
  const sale = (price.data as { sale_price?: unknown } | null)?.sale_price;
  return {
    ok: true,
    value: {
      id: productId,
      productType: productType(row.product_type) ?? "raw",
      salePrice: sale === null || sale === undefined ? null : Number(sale),
      densityKgPerL: positiveOrNull(row.density_kg_per_l),
      trimValuePercent: percent !== null && Number.isFinite(percent) ? percent : null,
    },
  };
}

/** Owners and chefs; null clears an optional value. */
export async function setProductEconomics(scope: TenantScope, productId: string, value: ProductEconomics): Promise<Result<ProductEconomicsRow>> {
  const { error } = await scope.client.rpc("set_product_economics", {
    p_product_id: productId,
    p_product_type: value.productType,
    p_sale_price: value.salePrice,
    p_density_kg_per_l: value.densityKgPerL,
    p_trim_value_percent: value.trimValuePercent,
  });
  if (error) return failed(error);
  return productEconomics(scope, productId);
}

export type LabelProduct = {
  id: string;
  name: string;
  unit: string;
  productType: ProductType;
  portionWeightKg: number | null;
  densityKgPerL: number | null;
};

/** Products of the tenant for recipe pickers and label names. */
export async function listLabelProducts(scope: TenantScope): Promise<LabelProduct[]> {
  const data = await fetchAll((from, to) =>
    scope.client
      .from("products")
      .select("id, name, unit, product_type, portion_weight_kg, density_kg_per_l")
      .eq("tenant_id", scope.tenantId)
      .order("name")
      .order("id")
      .range(from, to),
  );
  return (data as Record<string, unknown>[]).flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [
      {
        id: row.id,
        name: row.name,
        unit: typeof row.unit === "string" ? row.unit : "",
        productType: productType(row.product_type) ?? "raw",
        portionWeightKg: positiveOrNull(row.portion_weight_kg),
        densityKgPerL: positiveOrNull(row.density_kg_per_l),
      },
    ];
  });
}
