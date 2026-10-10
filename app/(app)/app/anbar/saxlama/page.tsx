import StorageManager from "@/components/anbar/storage-manager";
import ExpiredStockCard from "@/components/labels/expired-stock-card";
import NearExpiryCard from "@/components/labels/near-expiry-card";
import StockByKind from "@/components/labels/stock-by-kind";
import { canReviewExpiry, isPastExpiry } from "@/lib/labels/expiry";
import { canSeeCosts, stockFilter } from "@/lib/labels/final";
import { expiredStock, getNearExpiry, stockView } from "@/lib/labels/repository";
import { redirectIfNoOrg } from "@/lib/app-gate";
import { parMarks } from "@/lib/anbar/par";
import { listBranches, storageOverview } from "@/lib/anbar/repository";
import { resolveScope } from "@/lib/anbar/scope";
import type { RawSearchParams } from "@/lib/anbar/validation";
import { ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import { memberRole } from "@/lib/count/load";
import { parAlerts } from "@/lib/owner/dashboard";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { stockValueByType } from "@/lib/purchasing/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { todayIn } from "@/lib/tenant-settings/time";
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
  const [locations, value, expired, nearExpiry, stock, alerts] = await Promise.all([
    branch ? storageOverview(gated.scope, { branchId: branch.id, includeInactive: true }) : [],
    branch && canManagePurchasing(role) ? stockValueByType(gated.scope, branch.id) : null,
    branch ? expiredStock(gated.scope, branch.id) : null,
    branch ? getNearExpiry(gated.scope, branch.id) : null,
    branch ? stockView(gated.scope, branch.id, filter, seesMoney) : null,
    branch ? parAlerts(gated.scope, branch.id) : [],
  ]);
  if (expired && !expired.ok) throw new Error(`expired_stock: ${expired.error}`);
  if (nearExpiry && !nearExpiry.ok) throw new Error(`get_near_expiry_batches: ${nearExpiry.error}`);
  if (stock && !stock.ok) throw new Error(`stock_items: ${stock.error}`);
  const currency = currencyOf(settings);
  const canReview = canReviewExpiry(role);

  return (
    <div className="flex flex-col gap-6">
      {nearExpiry && (
        <NearExpiryCard
          key={branch?.id ?? ""}
          lots={nearExpiry.value}
          days={settings.expiryReviewDays}
          today={todayIn(settings.timezone, new Date())}
          currency={currency}
          canReview={canReview}
        />
      )}
      {expired && <ExpiredStockCard rows={expired.value.filter((row) => isPastExpiry(row.daysLeft))} canWriteOff={canReview} />}
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
          par={parMarks(alerts, branch?.id ?? null)}
          move={{
            locations: locations.filter((location) => location.active),
            settings: { timezone: settings.timezone, expiryWarnDays: settings.expiryWarnDays, expiryCriticalDays: settings.expiryCriticalDays },
            role,
          }}
        />
      )}
    </div>
  );
}
