import StorageManager from "@/components/anbar/storage-manager";
import ExpiredStockCard from "@/components/labels/expired-stock-card";
import StockByKind from "@/components/labels/stock-by-kind";
import { canSeeCosts, stockFilter } from "@/lib/labels/final";
import { expiredStock, stockView } from "@/lib/labels/repository";
import { canWriteOffWaste } from "@/lib/labels/waste";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { listBranches, storageOverview } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { stockValueByType } from "@/lib/purchasing/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { currencyOf } from "@/lib/money";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function StoragePage({ searchParams }: { searchParams: RawSearchParams }) {
  const resolved = await resolveScope();
  const gated = redirectIfNoOrg(resolved, ANBAR_STORAGE_PATH);
  if (gated.status === "error") {
    throw gated.cause instanceof Error ? gated.cause : new Error("Tenant lookup failed");
  }
  const [branches, role, settings] = await Promise.all([listBranches(gated.scope), memberRole(gated.scope), getSettings(gated.scope)]);
  const requested = first(searchParams.branch);
  const branch = branches.find((item) => item.id === requested) ?? branches[0] ?? null;
  const filter = stockFilter(first(searchParams.type));
  const seesMoney = canSeeCosts(role);
  const [locations, value, expired, stock] = await Promise.all([
    branch ? storageOverview(gated.scope, { branchId: branch.id, includeInactive: true }) : [],
    branch && canManagePurchasing(role) ? stockValueByType(gated.scope, branch.id) : null,
    branch ? expiredStock(gated.scope, branch.id) : null,
    branch ? stockView(gated.scope, branch.id, filter, seesMoney) : null,
  ]);
  if (expired && !expired.ok) throw new Error(`expired_stock: ${expired.error}`);
  if (stock && !stock.ok) throw new Error(`stock_items: ${stock.error}`);
  const currency = currencyOf(settings);

  return (
    <div className="flex flex-col gap-6">
      <StorageManager
        key={branch?.id ?? ""}
        branches={branches}
        branch={branch}
        locations={locations}
        value={value}
        currency={currency}
      />
      {stock && (
        <StockByKind
          value={stock.value.value}
          blocks={stock.value.blocks}
          filter={filter}
          currency={currency}
          seesMoney={seesMoney}
          link={{ path: ANBAR_STORAGE_PATH, branchId: branch?.id ?? null }}
          move={{
            locations: locations.filter((location) => location.active),
            settings: { timezone: settings.timezone, expiryWarnDays: settings.expiryWarnDays, expiryCriticalDays: settings.expiryCriticalDays },
            role,
          }}
        />
      )}
      {expired && <ExpiredStockCard rows={expired.value} canWriteOff={canWriteOffWaste(role)} />}
    </div>
  );
}
