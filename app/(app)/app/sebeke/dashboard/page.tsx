import OwnerPanel from "@/components/purchasing/owner-panel";
import { OWNER_PATH } from "@/lib/auth-redirect";
import { canSeeCosts, stockValue } from "@/lib/labels/final";
import { stockSummary, wastageSummary } from "@/lib/labels/repository";
import { canManagePurchasing } from "@/lib/purchasing/model";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { ownerSummary } from "@/lib/purchasing/repository";
import { getSettings } from "@/lib/tenant-settings/getSettings";
import { currencyOf } from "@/lib/money";
import { listBillingPlans, wasteAiState, wastePhotoSummary } from "@/lib/waste/load";
import { aiAddon, canManageBilling } from "@/lib/waste/plan";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage() {
  const { scope, role } = await purchasingPageScope(OWNER_PATH);
  if (!canManagePurchasing(role)) {
    return <OwnerPanel summary={null} waste={null} stock={null} photos={null} currency={currencyOf(await getSettings(scope))} />;
  }
  const [summary, waste, stock, settings, photoSummary, aiState, plans] = await Promise.all([
    ownerSummary(scope),
    wastageSummary(scope),
    stockSummary(scope, null),
    getSettings(scope),
    wastePhotoSummary(scope),
    wasteAiState(scope),
    listBillingPlans(scope.client),
  ]);
  if (!summary.ok) throw new Error(`owner_summary: ${summary.error}`);
  if (!waste.ok) throw new Error(`wastage_summary: ${waste.error}`);
  if (!stock.ok) throw new Error(`stock_summary: ${stock.error}`);
  return (
    <OwnerPanel
      summary={summary.value}
      waste={waste.value}
      stock={stockValue(stock.value, waste.value.wasteCost, canSeeCosts(role))}
      photos={
        photoSummary
          ? { summary: photoSummary, state: aiState, addon: aiAddon(plans), canBuy: canManageBilling(role) }
          : null
      }
      currency={currencyOf(settings)}
    />
  );
}
