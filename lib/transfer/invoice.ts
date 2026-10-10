import type { TenantScope } from "@/lib/anbar/scope";

export type InvoiceLot = { quantity: number; expiryDate: string | null; fromPlace: string | null; toPlace: string | null };
export type InvoiceItem = {
  productId: string;
  name: string;
  internalCode: string | null;
  unit: string;
  quantity: number;
  lots: InvoiceLot[];
};
export type TransferInvoice = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
  from: string;
  to: string;
  items: InvoiceItem[];
};

type Row = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

/** A transfer document of the scope's tenant with its items and the moved lots; null when not found. */
export async function loadTransferInvoice(scope: TenantScope, id: string): Promise<TransferInvoice | null> {
  const doc = await scope.client
    .from("branch_transfers")
    .select("id, number, status, created_at, note, from_branch_id, to_branch_id, created_by")
    .eq("tenant_id", scope.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (doc.error) throw new Error(`branch_transfers: ${doc.error.message}`);
  const head = doc.data as Row | null;
  if (!head) return null;

  const [branches, creator, items, movements] = await Promise.all([
    scope.client.from("branches").select("id, name").eq("tenant_id", scope.tenantId).in("id", [String(head.from_branch_id), String(head.to_branch_id)]),
    head.created_by
      ? scope.client.from("profiles").select("id, email").eq("id", head.created_by as string).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    scope.client.from("branch_transfer_items").select("product_id, quantity, unit").eq("tenant_id", scope.tenantId).eq("transfer_id", id),
    scope.client
      .from("stock_movements")
      .select("product_id, quantity, expiry_date, from_location_id, to_location_id, created_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_transfer_id", id)
      .order("created_at"),
  ]);
  for (const result of [branches, items, movements]) {
    if (result.error) throw new Error(`transfer invoice: ${result.error.message}`);
  }

  const itemRows = rows(items.data);
  const moveRows = rows(movements.data);
  const productIds = Array.from(new Set(itemRows.map((row) => String(row.product_id))));
  const placeIds = Array.from(
    new Set(moveRows.flatMap((row) => [str(row.from_location_id), str(row.to_location_id)]).filter((value): value is string => value !== null)),
  );
  const [products, places] = await Promise.all([
    productIds.length
      ? scope.client.from("products").select("id, name, internal_code, unit").eq("tenant_id", scope.tenantId).in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    placeIds.length
      ? scope.client.from("storage_locations").select("id, name, code").eq("tenant_id", scope.tenantId).in("id", placeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error || places.error) throw new Error("transfer invoice: products or places");

  const productById = new Map(rows(products.data).map((row) => [String(row.id), row]));
  const placeName = new Map(rows(places.data).map((row) => [String(row.id), [str(row.code), str(row.name)].filter(Boolean).join(" · ")]));
  const branchName = new Map(rows(branches.data).map((row) => [String(row.id), String(row.name ?? "")]));

  return {
    id: String(head.id),
    number: String(head.number ?? ""),
    status: String(head.status ?? "completed"),
    createdAt: String(head.created_at ?? ""),
    note: str(head.note),
    createdBy: str((creator.data as Row | null)?.email),
    from: branchName.get(String(head.from_branch_id)) ?? "",
    to: branchName.get(String(head.to_branch_id)) ?? "",
    items: itemRows.map((row) => {
      const productId = String(row.product_id);
      const product = productById.get(productId);
      return {
        productId,
        name: str(product?.name) ?? productId,
        internalCode: str(product?.internal_code),
        unit: str(row.unit) ?? str(product?.unit) ?? "",
        quantity: Number(row.quantity),
        lots: moveRows
          .filter((move) => String(move.product_id) === productId)
          .map((move) => ({
            quantity: Number(move.quantity),
            expiryDate: str(move.expiry_date),
            fromPlace: placeName.get(String(move.from_location_id)) ?? null,
            toPlace: placeName.get(String(move.to_location_id)) ?? null,
          })),
      };
    }),
  };
}
