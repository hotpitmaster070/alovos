import OrdersBoard, { type OrderSupplier } from "@/components/purchasing/orders-board";
import { ORDERS_PATH } from "@/lib/auth-redirect";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { listPurchaseRequests, listSuppliers, productLabels } from "@/lib/purchasing/repository";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { scope, role } = await purchasingPageScope(ORDERS_PATH);
  const [requests, suppliers] = await Promise.all([
    listPurchaseRequests(scope, ["draft", "sent"]),
    listSuppliers(scope, { includeInactive: true }),
  ]);
  const productIds = Array.from(new Set(requests.flatMap((request) => request.items.map((item) => item.productId))));
  const products = await productLabels(scope, productIds);
  const supplierLookup: Record<string, OrderSupplier> = Object.fromEntries(
    suppliers.map((supplier) => [supplier.id, { name: supplier.name, code: supplier.code, contact: supplier.contact }]),
  );

  return (
    <OrdersBoard
      drafts={requests.filter((request) => request.status === "draft")}
      sent={requests.filter((request) => request.status === "sent")}
      products={products}
      suppliers={supplierLookup}
      canEdit={canManagePurchasing(role)}
    />
  );
}
