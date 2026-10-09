import type { TenantScope } from "@/lib/anbar/scope";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  mapPurchasingError,
  parseForecastRow,
  parseInvitation,
  parseInvitationPreview,
  parseOwnerSummary,
  parsePurchaseRequest,
  parseStockValueByType,
  parseSupplier,
  type ForecastRow,
  type ForecastStatus,
  type Invitation,
  type InvitationPreview,
  type InviteRole,
  type LimitsInput,
  type OwnerSummary,
  type PurchaseRequest,
  type PurchasingErrorCode,
  type RequestStatus,
  type StockValueByType,
  type Supplier,
  type SupplierInput,
  type SupplierPatch,
} from "./model";

/**
 * Every statement is built from a TenantScope; tables are filtered by tenant_id and RLS checks again.
 * Writes other than suppliers go through the database functions of 20261016_parlevel_forecast.sql.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: PurchasingErrorCode; status: number };

const failed = (error: { message?: unknown; code?: unknown }): { ok: false; error: PurchasingErrorCode; status: number } => {
  const mapped = mapPurchasingError(error);
  return { ok: false, error: mapped.code, status: mapped.status };
};

const rows = <T>(data: unknown, parse: (row: unknown) => T | null): T[] =>
  (Array.isArray(data) ? data : []).flatMap((row) => parse(row) ?? []);

const SUPPLIER_COLUMNS = "id, name, code, contact, delivery_days, branch_id, lead_time_days, default_currency, is_active";

export async function listSuppliers(scope: TenantScope, { includeInactive = false } = {}): Promise<Supplier[]> {
  const data = await fetchAll((from, to) => {
    let query = scope.client.from("suppliers").select(SUPPLIER_COLUMNS).eq("tenant_id", scope.tenantId);
    if (!includeInactive) query = query.eq("is_active", true);
    return query.order("name").order("id").range(from, to);
  });
  return rows(data, parseSupplier);
}

const supplierRow = (input: Partial<SupplierInput>) => ({
  ...(input.name !== undefined && { name: input.name }),
  ...(input.code !== undefined && { code: input.code }),
  ...(input.contact !== undefined && { contact: input.contact }),
  ...(input.deliveryDays !== undefined && { delivery_days: input.deliveryDays }),
  ...(input.branchId !== undefined && { branch_id: input.branchId }),
  ...(input.leadTimeDays !== undefined && { lead_time_days: input.leadTimeDays }),
  ...(input.currency !== undefined && { default_currency: input.currency }),
});

export async function createSupplier(scope: TenantScope, input: SupplierInput): Promise<Result<Supplier>> {
  const { data, error } = await scope.client
    .from("suppliers")
    .insert({ tenant_id: scope.tenantId, ...supplierRow(input) })
    .select(SUPPLIER_COLUMNS)
    .single();
  if (error) return failed(error);
  const supplier = parseSupplier(data);
  return supplier ? { ok: true, value: supplier } : failed({});
}

export async function updateSupplier(scope: TenantScope, id: string, patch: SupplierPatch): Promise<Result<Supplier>> {
  const { data, error } = await scope.client
    .from("suppliers")
    .update({ ...supplierRow(patch), ...(patch.active !== undefined && { is_active: patch.active }) })
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .select(SUPPLIER_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { ok: false, error: "supplier_not_found", status: 404 };
  const supplier = parseSupplier(data);
  return supplier ? { ok: true, value: supplier } : failed({});
}

const STATUS_ORDER: Record<ForecastStatus, number> = { critical: 0, order: 1, ok: 2, no_limits: 3 };

/** The caller's products with stock, limits and forecast; most urgent first, then by name. */
export async function listForecast(
  scope: TenantScope,
  { statuses = null, productIds = null }: { statuses?: ForecastStatus[] | null; productIds?: string[] | null } = {},
): Promise<ForecastRow[]> {
  if (productIds !== null && productIds.length === 0) return [];
  const data = await fetchAll((from, to) => {
    let query = scope.client.from("low_stock_with_forecast").select("*").eq("tenant_id", scope.tenantId);
    if (statuses) query = query.in("status", statuses);
    if (productIds) query = query.in("product_id", productIds);
    return query.order("product_id").range(from, to);
  });
  return rows(data, parseForecastRow).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

export async function setProductLimits(scope: TenantScope, productId: string, input: LimitsInput): Promise<Result<null>> {
  const { error } = await scope.client.rpc("set_product_limits", {
    p_product_id: productId,
    p_par_level: input.parLevel,
    p_min_stock: input.minStock,
    p_supplier_id: input.supplierId,
  });
  return error ? failed(error) : { ok: true, value: null };
}

/** Drafts created or extended by check_and_create_auto_requests(). */
export async function runAutoCheck(scope: TenantScope): Promise<Result<number>> {
  const { data, error } = await scope.client.rpc("check_and_create_auto_requests");
  if (error) return failed(error);
  return { ok: true, value: typeof data === "number" ? data : Number(data ?? 0) };
}

const REQUEST_COLUMNS = "id, supplier_id, branch_id, status, items, auto_created, request_date, created_at, sent_at";

export async function listPurchaseRequests(scope: TenantScope, statuses: RequestStatus[]): Promise<PurchaseRequest[]> {
  const data = await fetchAll((from, to) =>
    scope.client
      .from("purchase_requests")
      .select(REQUEST_COLUMNS)
      .eq("tenant_id", scope.tenantId)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return rows(data, parsePurchaseRequest);
}

/** Name and unit of the products listed in requests, keyed by id. */
export async function productLabels(scope: TenantScope, ids: string[]): Promise<Record<string, { name: string; unit: string }>> {
  if (ids.length === 0) return {};
  const data = await fetchAll((from, to) =>
    scope.client.from("products").select("id, name, unit").eq("tenant_id", scope.tenantId).in("id", ids).order("id").range(from, to),
  );
  const labels: Record<string, { name: string; unit: string }> = {};
  for (const row of data as { id?: unknown; name?: unknown; unit?: unknown }[]) {
    if (typeof row.id === "string") {
      labels[row.id] = { name: typeof row.name === "string" ? row.name : "", unit: typeof row.unit === "string" ? row.unit : "" };
    }
  }
  return labels;
}

export async function sendPurchaseRequest(
  scope: TenantScope,
  id: string,
  items: { product_id: string; qty: number }[] | null,
): Promise<Result<null>> {
  const { error } = await scope.client.rpc("send_purchase_request", { p_request_id: id, p_items: items });
  return error ? failed(error) : { ok: true, value: null };
}

export async function receivePurchaseRequest(scope: TenantScope, id: string): Promise<Result<null>> {
  const { error } = await scope.client.rpc("receive_purchase_request", { p_request_id: id });
  return error ? failed(error) : { ok: true, value: null };
}

export async function discardPurchaseRequest(scope: TenantScope, id: string): Promise<Result<null>> {
  const { error } = await scope.client.rpc("discard_purchase_request", { p_request_id: id });
  return error ? failed(error) : { ok: true, value: null };
}

/** Stock x latest purchase price per storage type; empty for roles that do not see costs. */
export async function stockValueByType(scope: TenantScope, branchId: string | null = null): Promise<StockValueByType[]> {
  const { data, error } = await scope.client.rpc("stock_value_by_type", { p_branch_id: branchId });
  if (error) throw new Error(`stock_value_by_type: ${error.message}`);
  return rows(data, parseStockValueByType);
}

export async function ownerSummary(scope: TenantScope): Promise<Result<OwnerSummary>> {
  const { data, error } = await scope.client.rpc("owner_summary");
  if (error) return failed(error);
  const summary = parseOwnerSummary(Array.isArray(data) ? data[0] : data);
  return summary ? { ok: true, value: summary } : failed({});
}

export async function createInvitation(scope: TenantScope, phone: string, role: InviteRole): Promise<Result<Invitation>> {
  const { data, error } = await scope.client.rpc("create_invitation", { p_phone: phone, p_role: role });
  if (error) return failed(error);
  const invitation = parseInvitation(Array.isArray(data) ? data[0] : data);
  return invitation ? { ok: true, value: invitation } : failed({});
}

export async function listInvitations(scope: TenantScope): Promise<Invitation[]> {
  const { data, error } = await scope.client
    .from("invitations")
    .select("id, phone, role, token, expires_at, used_at, created_at")
    .eq("tenant_id", scope.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`invitations: ${error.message}`);
  return rows(data, parseInvitation);
}

export async function invitationPreview(client: TenantScope["client"], token: string): Promise<InvitationPreview | null> {
  const { data, error } = await client.rpc("invitation_preview", { p_token: token });
  if (error) throw new Error(`invitation_preview: ${error.message}`);
  return parseInvitationPreview(Array.isArray(data) ? data[0] : data);
}

export async function acceptInvitation(client: TenantScope["client"], token: string): Promise<Result<string>> {
  const { data, error } = await client.rpc("accept_invitation", { p_token: token });
  if (error) return failed(error);
  return typeof data === "string" ? { ok: true, value: data } : failed({});
}
