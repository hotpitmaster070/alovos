"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { StockKindCards } from "@/components/labels/stock-by-kind";
import { WastePhotoCard } from "@/components/waste/photo-ai";
import { Card } from "@/components/ui/card";
import type { StockValue } from "@/lib/labels/final";
import { ANBAR_APP_PATH, ANBAR_STORAGE_PATH, ORDERS_PATH, WASTE_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { wastePercents, type WasteSummary } from "@/lib/labels/waste";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { formatQty } from "@/lib/purchasing/format";
import type { OwnerSummary } from "@/lib/purchasing/model";
import { cn } from "@/lib/utils";

function Figure({ label, value, href, tone }: { label: string; value: string; href: string; tone?: string }) {
  return (
    <Link href={href} className="block">
      <Card className="flex h-full flex-col gap-2 transition-colors hover:border-beige/60">
        <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{label}</p>
        <p className={cn("font-serif text-4xl font-bold text-white", tone)}>{value}</p>
      </Card>
    </Link>
  );
}

/** Numbers only: live stock value, products running low and auto order drafts. */
export default function OwnerPanel({
  summary,
  waste,
  stock,
  photos,
  currency,
}: {
  summary: OwnerSummary | null;
  waste: WasteSummary | null;
  /** Stock by kind (raw / semi / trim) with cost, sale value, margin and today's waste. */
  stock: StockValue | null;
  /** Today's waste photos and AI checks; the AI package offer. */
  photos: ComponentProps<typeof WastePhotoCard> | null;
  currency: CurrencyInfo;
}) {
  const { t } = useT();
  const copy = t.purchasing.owner;
  const wasteCopy = t.labels.waste;
  const percents = waste ? wastePercents(waste) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-white/60">{copy.hint}</p>
      </div>
      {!summary ? (
        <p className="text-sm text-white/60">{copy.noAccess}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={`${copy.stockValue} · ${copy.live}`}
            value={formatMoney(summary.stockValue, currency)}
            href={ANBAR_STORAGE_PATH}
          />
          <Figure
            label={copy.lowStock}
            value={String(summary.lowStockCount)}
            href={ANBAR_APP_PATH}
            tone={summary.lowStockCount > 0 ? "text-amber-200" : undefined}
          />
          <Figure
            label={copy.critical}
            value={String(summary.criticalCount)}
            href={ANBAR_APP_PATH}
            tone={summary.criticalCount > 0 ? "text-red-300" : undefined}
          />
          <Figure label={copy.autoRequests} value={String(summary.autoRequestCount)} href={ORDERS_PATH} />
        </div>
      )}
      {stock && <StockKindCards value={stock} currency={currency} link={{ path: ANBAR_STORAGE_PATH, branchId: null }} />}
      {waste && (
        <Link href={`${WASTE_PATH}?${new URLSearchParams({ day: waste.day })}`} className="block">
          <Card className={cn("text-sm transition-colors hover:border-beige/60", percents && percents.over > 0 ? "border-red-500/50" : undefined)}>
            <p className="font-semibold text-white">
              {wasteCopy.today(
                `${formatQty(waste.wasteKg)} ${t.anbar.units.kg}`,
                waste.wasteCost === null ? null : formatMoney(waste.wasteCost, currency),
              )}
              {percents && (
                <span className={percents.over > 0 ? "text-red-300" : "text-white/70"}>{wasteCopy.vsNorm(percents.norm, percents.over)}</span>
              )}
            </p>
            {!percents && <p className="mt-1 text-xs text-white/50">{wasteCopy.noRuns}</p>}
          </Card>
        </Link>
      )}
      {photos && <WastePhotoCard {...photos} />}
    </div>
  );
}
