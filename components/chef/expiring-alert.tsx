"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";

/** Banner: how many lots expire within the review window and what they are worth (null: no costs visible). */
export default function ExpiringAlert({
  count,
  value,
  currency,
  href,
}: {
  count: number;
  value: number | null;
  currency: CurrencyInfo;
  href: string;
}) {
  const { t } = useT();
  const copy = t.expiry.dashboard;
  if (count === 0) {
    return <p className="rounded-[18px] border border-line bg-card p-4 text-sm text-white/60">{copy.alertEmpty}</p>;
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-amber-300/50 bg-amber-300/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" strokeWidth={1.5} aria-hidden="true" />
        <div>
          <p className="font-semibold text-amber-100">{copy.alertTitle(count)}</p>
          {value !== null && <p className="text-sm text-amber-200/80">{copy.alertValue(formatMoney(value, currency))}</p>}
        </div>
      </div>
      <Link href={href} className="rounded-[12px] border border-amber-300/60 px-3 py-2 text-sm text-amber-100 hover:bg-amber-300/10">
        {copy.open}
      </Link>
    </div>
  );
}
