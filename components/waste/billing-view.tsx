"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toast } from "@/components/ui/toast";
import { RequestPlanButton, planPrice } from "@/components/waste/photo-ai";
import { useT } from "@/lib/i18n/useT";
import { basePlan, type BillingPlan, type WasteAiState } from "@/lib/waste/plan";

/** Plan, this month's photos / AI checks, the AI packages and the owner's photo switches. */
export default function BillingView({ plans, state, canManage }: { plans: BillingPlan[]; state: WasteAiState; canManage: boolean }) {
  const { t } = useT();
  const copy = t.labels.billing;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<number | null>(null);
  const base = basePlan(plans);
  const addons = plans.filter((plan) => plan.kind === "addon");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(false);
    const response = await fetch("/api/billing/waste-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        photo_enabled: form.get("photo_enabled") === "on",
        ai_enabled: form.get("ai_enabled") === "on",
        tolerance_percent: Number(form.get("tolerance_percent")),
      }),
    });
    setPending(false);
    if (!response.ok) {
      setError(true);
      return;
    }
    setToast(Date.now());
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/60">{copy.hint}</p>
      </div>

      {base ? (
        <Card>
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.plan}</p>
          <p className="mt-1 font-serif text-3xl font-bold text-white">{copy.price(planPrice(base, t.labels.locale), base.periodDays)}</p>
          {base.trialDays > 0 ? <p className="mt-1 text-xs text-white/60">{copy.trial(base.trialDays)}</p> : null}
          <p className="mt-3 text-sm text-white/80">
            {state.aiEnabled
              ? `${copy.photos(state.photosThisMonth)} · ${copy.aiUsage(state.used, state.limit)}`
              : `${copy.aiOff} ${state.photosThisMonth}/${state.freePhotos}`}
          </p>
          {state.plan === "free" ? <p className="mt-1 text-xs text-white/50">{copy.freeChecks(state.freePhotos)}</p> : null}
        </Card>
      ) : null}

      {addons.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.packages}</p>
          {addons.map((plan) => (
            <Card key={plan.code} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{copy.addon(planPrice(plan, t.labels.locale), plan.aiPhotos, plan.periodDays)}</p>
              {state.plan === plan.code ? (
                <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-xs text-emerald-300">{copy.active}</span>
              ) : canManage ? (
                <RequestPlanButton plan={plan} label={copy.request} requested={state.requestedPlan === plan.code} />
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <form onSubmit={save} className="flex flex-col gap-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.settings}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="photo_enabled" defaultChecked={state.photoEnabled} disabled={!canManage} />
            {copy.photoEnabled}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ai_enabled" defaultChecked={state.aiEnabled} disabled={!canManage} />
            {copy.aiEnabled}
          </label>
          <div>
            <Label htmlFor="ai-tolerance">{copy.tolerance}</Label>
            <Input
              id="ai-tolerance"
              name="tolerance_percent"
              type="number"
              min="1"
              step="any"
              defaultValue={state.tolerancePercent}
              disabled={!canManage}
              required
            />
            <p className="mt-1.5 text-xs text-white/50">{copy.toleranceHint}</p>
          </div>
          {error ? <p className="text-sm text-red-300">{t.labels.errors.save_failed}</p> : null}
          {canManage ? (
            <Button type="submit" disabled={pending} className="self-start">
              {copy.save}
            </Button>
          ) : (
            <p className="text-xs text-white/50">{copy.ownerOnly}</p>
          )}
        </form>
      </Card>
      <Toast token={toast} text={copy.saved} />
    </div>
  );
}
