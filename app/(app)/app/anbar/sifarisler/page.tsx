import AutoOrderBoard from "@/components/purchasing/auto-order-board";
import { listBranches } from "@/lib/anbar/repository";
import { parseLocationFilter } from "@/lib/anbar/stock-view";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { AUTO_ORDER_PATH } from "@/lib/auth-redirect";
import { autoOrderPreview, productOptions } from "@/lib/auto-order/repository";
import { draftMessage, messageLang } from "@/lib/auto-order/send";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { listPurchaseRequests, listSuppliers } from "@/lib/purchasing/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

export default async function AutoOrderPage({ searchParams }: { searchParams: RawSearchParams }) {
  const { scope, role } = await purchasingPageScope(AUTO_ORDER_PATH);
  const canEdit = canManagePurchasing(role);
  const [branches, drafts, suppliers, products, settings] = await Promise.all([
    listBranches(scope),
    listPurchaseRequests(scope, ["draft"]),
    listSuppliers(scope, { includeInactive: true }),
    productOptions(scope),
    getSettings(scope),
  ]);
  const requested = parseLocationFilter(searchParams.branch);
  const branchId = branches.find((branch) => branch.id === requested)?.id ?? branches[0]?.id ?? null;
  const preview = canEdit && branchId ? await autoOrderPreview(scope, branchId) : null;
  const dictionary = dictionaries[messageLang(settings.language)];
  const labels = Object.fromEntries(products.map((product) => [product.id, product]));
  const branchDrafts = drafts.filter((draft) => draft.branchId === null || draft.branchId === branchId);

  return (
    <AutoOrderBoard
      canEdit={canEdit}
      branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
      branchId={branchId}
      groups={preview?.ok ? preview.value : []}
      drafts={branchDrafts.map((draft) => {
        const supplier = suppliers.find((row) => row.id === draft.supplierId) ?? null;
        return { request: draft, ...draftMessage(dictionary, draft, supplier, labels), supplierName: supplier?.name ?? draft.supplierId };
      })}
      products={products}
    />
  );
}
