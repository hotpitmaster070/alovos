import BillingView from "@/components/waste/billing-view";
import { BILLING_PATH } from "@/lib/auth-redirect";
import { purchasingPageScope } from "@/lib/purchasing/page";
import { listBillingPlans, wasteAiState } from "@/lib/waste/load";
import { canManageBilling } from "@/lib/waste/plan";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const { scope, role } = await purchasingPageScope(BILLING_PATH);
  const [plans, state] = await Promise.all([listBillingPlans(scope.client), wasteAiState(scope)]);
  return <BillingView plans={plans} state={state} canManage={canManageBilling(role)} />;
}
