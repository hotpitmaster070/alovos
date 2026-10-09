"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BILLING_PATH, WASTE_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatRate } from "@/lib/money";
import type { BillingPlan, WasteAiState, WastePhotoSummary } from "@/lib/waste/plan";

/** A plan's price in the plan's own currency (billing_plans), in the UI language's number format. */
export const planPrice = (plan: BillingPlan, locale: string): string =>
  formatRate(plan.price, { code: plan.currency, symbol: null, locale }, 2);

/** Owner asks for a plan; shows "requested" once sent. */
export function RequestPlanButton({ plan, label, requested }: { plan: BillingPlan; label: string; requested: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  if (requested) return <p className="text-xs text-amber-200">{t.labels.billing.requested}</p>;
  const send = async () => {
    setPending(true);
    setError(false);
    const response = await fetch("/api/billing/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_code: plan.code }),
    });
    setPending(false);
    if (!response.ok) {
      setError(true);
      return;
    }
    router.refresh();
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" disabled={pending} onClick={() => void send()}>
        {label}
      </Button>
      {error ? <p className="text-xs text-red-300">{t.labels.errors.save_failed}</p> : null}
    </div>
  );
}

/** Dashboard: today's write-offs with photos and AI verdicts; the AI package when AI is off. */
export function WastePhotoCard({
  summary,
  state,
  addon,
  canBuy,
}: {
  summary: WastePhotoSummary;
  state: WasteAiState;
  addon: BillingPlan | null;
  canBuy: boolean;
}) {
  const { t } = useT();
  const copy = t.labels.photoAi;
  return (
    <Card className={summary.needsReview > 0 ? "border-red-500/50" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link href={WASTE_PATH} className="block">
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.today}</p>
          <p className="mt-1 text-sm font-semibold text-white">{copy.todayLine(summary.logs, summary.withPhoto)}</p>
          {state.aiEnabled ? (
            <p className="mt-1 text-xs text-white/70">
              {copy.counts(summary.approved, summary.suspicious)} · {copy.usage(state.used, state.limit)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-white/60">{copy.badges.noAi}</p>
          )}
          {summary.needsReview > 0 ? <p className="mt-1 text-xs text-red-300">{copy.toReview(summary.needsReview)}</p> : null}
        </Link>
        <div className="flex flex-col items-end gap-2">
          {!state.aiEnabled && addon && canBuy ? (
            <RequestPlanButton plan={addon} label={copy.buyAi(planPrice(addon, t.labels.locale))} requested={state.requestedPlan === addon.code} />
          ) : null}
          {canBuy ? (
            <Link href={BILLING_PATH} className="text-xs text-beige underline underline-offset-2">
              {t.labels.billing.open}
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
