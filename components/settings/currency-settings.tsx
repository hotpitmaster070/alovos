"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { currencyName, type Currency } from "@/lib/currency/model";
import { useT } from "@/lib/i18n/useT";
import { isLabelsErrorCode, type LabelsErrorCode } from "@/lib/labels/model";
import { formatMoney, type CurrencyInfo } from "@/lib/money";

/** The restaurant's currency: everyone sees it, the owner changes it (stored amounts are not converted). */
export default function CurrencySettings({ current, currencies, canManage }: { current: CurrencyInfo; currencies: Currency[]; canManage: boolean }) {
  const { lang, t } = useT();
  const copy = t.labels.currency;
  const router = useRouter();
  const [code, setCode] = useState(current.code);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [toast, setToast] = useState<number | null>(null);
  const chosen = currencies.find((currency) => currency.code === code) ?? null;
  const known = currencies.some((currency) => currency.code === current.code);

  const save = async () => {
    setPending(true);
    setError(null);
    const response = await fetch("/api/settings/currency", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      setError(isLabelsErrorCode(body?.error) ? body.error : "save_failed");
      return;
    }
    setToast(Date.now());
    router.refresh();
  };

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.title}</CardTitle>
      <p className="text-sm text-white/80">
        {copy.current}: <span className="font-semibold text-white">{formatMoney(1234.5, current)}</span>
      </p>
      {canManage ? (
        <>
          <Select aria-label={copy.title} value={code} onChange={(event) => setCode(event.target.value)}>
            {!known ? <option value={current.code}>{current.code}</option> : null}
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currencyName(currency, lang)}
              </option>
            ))}
          </Select>
          {code !== current.code ? (
            <p role="alert" className="rounded-[12px] border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
              {copy.warning}
              {chosen ? ` · ${formatMoney(1234.5, chosen)}` : ""}
            </p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-red-300">{t.labels.errors[error]}</p> : null}
          <Button className="self-start" size="sm" disabled={pending || code === current.code || !chosen} onClick={() => void save()}>
            {copy.save}
          </Button>
        </>
      ) : (
        <p className="text-xs text-white/50">{copy.ownerOnly}</p>
      )}
      <Toast token={toast} text={copy.saved} />
    </Card>
  );
}
