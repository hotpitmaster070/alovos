import ZaqotovkaView from "@/components/labels/zaqotovka-view";
import { listBranches, listStorageLocations } from "@/lib/anbar/repository";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { canEditPreparations, isUuid } from "@/lib/labels/model";
import { expiringLots, listLabelProducts, listPreparations } from "@/lib/labels/repository";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { getSettings } from "@/lib/tenant-settings/getSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "alovos" };

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value[0] : value) ?? null;

/** Recipes (inputs -> outputs), running them with labels, and lots expiring soon. */
export default async function ZaqotovkaPage({ searchParams }: { searchParams: RawSearchParams }) {
  const { scope, role } = await purchasingPageScope(ZAQOTOVKA_PATH);
  const [preparations, products, branches, locations, settings, expiring] = await Promise.all([
    listPreparations(scope),
    listLabelProducts(scope),
    listBranches(scope),
    listStorageLocations(scope),
    getSettings(scope),
    expiringLots(scope, null),
  ]);

  const product = first(searchParams.product);
  const from = first(searchParams.from);
  const qty = Number(first(searchParams.qty));

  return (
    <ZaqotovkaView
      preparations={preparations}
      products={products}
      branches={branches}
      locations={locations}
      expiring={expiring.ok ? expiring.value : []}
      settings={{ timezone: settings.timezone, expiryWarnDays: settings.expiryWarnDays, expiryCriticalDays: settings.expiryCriticalDays }}
      balanceSettings={{
        prepBalanceTolerance: settings.prepBalanceTolerance,
        prepBalanceTolerancePercent: settings.prepBalanceTolerancePercent,
        defaultPortionWeightKg: settings.defaultPortionWeightKg,
        defaultDensityKgPerL: settings.defaultDensityKgPerL,
      }}
      canEdit={canEditPreparations(role)}
      start={
        isUuid(product)
          ? { productId: product, fromLocationId: isUuid(from) ? from : null, qty: Number.isFinite(qty) && qty > 0 ? qty : null }
          : null
      }
    />
  );
}
