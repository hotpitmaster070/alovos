import SupplierManager from "@/components/purchasing/supplier-manager";
import { listBranches } from "@/lib/anbar/repository";
import { SUPPLIERS_PATH } from "@/lib/auth-redirect";
import { listCurrencies } from "@/lib/currency/load";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { listSuppliers } from "@/lib/purchasing/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const { scope, role } = await purchasingPageScope(SUPPLIERS_PATH);
  const [suppliers, branches, currencies, settings] = await Promise.all([
    listSuppliers(scope, { includeInactive: true }),
    listBranches(scope),
    listCurrencies(scope.client),
    getSettings(scope),
  ]);
  return (
    <SupplierManager
      suppliers={suppliers}
      branches={branches.map(({ id, name }) => ({ id, name }))}
      canEdit={canManagePurchasing(role)}
      currencies={currencies}
      baseCode={settings.currency}
    />
  );
}
