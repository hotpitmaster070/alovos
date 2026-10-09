import Landing from "@/components/landing";
import { createClient } from "@/lib/supabase/server";
import { listBillingPlans } from "@/lib/waste/load";
import { basePlan, type BillingPlan } from "@/lib/waste/plan";

export const dynamic = "force-dynamic";

async function loadPlan(): Promise<BillingPlan | null> {
  try {
    return basePlan(await listBillingPlans(createClient()));
  } catch (error) {
    console.error("billing_plans:", error instanceof Error ? error.message : error);
    return null;
  }
}

export default async function Home() {
  return <Landing plan={await loadPlan()} />;
}
