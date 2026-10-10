"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import ParAlertBadge from "@/components/anbar/par-alert-badge";
import type { ParMark } from "@/lib/anbar/par";
import { isUnit, type StorageLocation } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { canSetShelfLife } from "@/lib/labels/model";
import type { ExpirySettings } from "@/lib/tenant-settings/parse";
import MoveLotDialog from "./move-lot-dialog";
import {
  STOCK_FILTERS,
  STOCK_KINDS,
  stockHref,
  type StockFilter,
  type StockItem,
  type StockKind,
  type StockKindSummary,
  type StockValue,
} from "@/lib/labels/final";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { formatQty } from "@/lib/purchasing/format";
import { cn } from "@/lib/utils";

/** raw green, semi blue, trim orange. */
export const KIND_STYLE: Record<StockKind, { badge: string; border: string; text: string }> = {
  raw: { badge: "border-green-400/60 text-green-300", border: "border-green-500/40", text: "text-green-300" },
  semi: { badge: "border-sky-400/60 text-sky-300", border: "border-sky-500/40", text: "text-sky-300" },
  trim: { badge: "border-orange-400/60 text-orange-300", border: "border-orange-500/40", text: "text-orange-300" },
};

/** Where the cards and tabs link: the stock page of a branch. */
export type StockLink = { path: string; branchId: string | null };

const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

function useAmounts() {
  const { t } = useT();
  return (row: Pick<StockKindSummary, "kg" | "liters" | "pieces">): string =>
    [
      row.kg > 0 && `${formatQty(row.kg)} ${t.anbar.units.kg}`,
      row.liters > 0 && `${formatQty(row.liters)} ${t.anbar.units.l}`,
      row.pieces > 0 && `${formatQty(row.pieces)} ${t.anbar.units.pcs}`,
    ]
      .filter(Boolean)
      .join(" · ") || "0";
}

function Money({ label, value, currency, className }: { label: string; value: number | null; currency: CurrencyInfo; className?: string }) {
  if (value === null) return null;
  return (
    <p className="flex justify-between gap-3 text-sm">
      <span className="text-white/60">{label}</span>
      <span className={cn("font-semibold text-white", className)}>{formatMoney(value, currency)}</span>
    </p>
  );
}

/** One card per kind and the total: amounts, and for owners and chefs cost, sale value, margin and today's waste. */
export function StockKindCards({ value, currency, link }: { value: StockValue; currency: CurrencyInfo; link: StockLink }) {
  const { t } = useT();
  const copy = t.labels.stock;
  const amounts = useAmounts();
  const hrefFor = (filter: StockFilter) => stockHref(link.path, link.branchId, filter);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STOCK_KINDS.map((kind) => {
        const row = value.kinds[kind];
        return (
          <Link key={kind} href={hrefFor(kind)} className="block">
            <Card className={cn("flex h-full flex-col gap-2 border transition hover:bg-white/[0.04]", KIND_STYLE[kind].border)}>
              <CardTitle className={KIND_STYLE[kind].text}>{copy.kinds[kind]}</CardTitle>
              <p className="text-lg font-semibold text-white">{amounts(row)}</p>
              <p className="text-xs text-white/50">{copy.lines(row.lines)}</p>
              <Money label={copy.cost} value={row.costValue} currency={currency} />
              <Money label={copy.sale} value={row.saleValue} currency={currency} />
              <Money label={copy.margin} value={row.margin} currency={currency} className="text-green-300" />
              {row.unpriced > 0 && row.saleValue !== null && <p className="text-xs text-amber-300">{copy.unpriced(row.unpriced)}</p>}
              <span className="mt-auto text-xs text-beige">{copy.open}</span>
            </Card>
          </Link>
        );
      })}
      <Link href={hrefFor("all")} className="block">
        <Card className="flex h-full flex-col gap-2 border border-beige/40 transition hover:bg-white/[0.04]">
          <CardTitle className="text-beige">{copy.total}</CardTitle>
          <p className="text-lg font-semibold text-white">{amounts(value.total)}</p>
          <p className="text-xs text-white/50">{copy.lines(value.total.lines)}</p>
          <Money label={copy.cost} value={value.total.costValue} currency={currency} />
          <Money label={copy.sale} value={value.total.saleValue} currency={currency} />
          <Money label={copy.margin} value={value.total.margin} currency={currency} className="text-green-300" />
          <Money label={copy.wasteToday} value={value.total.wasteCost} currency={currency} className="text-red-300" />
          <span className="mt-auto text-xs text-beige">{copy.open}</span>
        </Card>
      </Link>
    </div>
  );
}

export type StockBlock = { kind: StockKind | null; items: StockItem[]; total: number };

/** What the Move button needs; without it the rows have no button. */
export type StockMove = { locations: StorageLocation[]; settings: ExpirySettings; role: string | null };

function ItemsTable({
  items,
  currency,
  seesMoney,
  move,
  par,
}: {
  items: StockItem[];
  currency: CurrencyInfo;
  seesMoney: boolean;
  move: StockMove | null;
  par: Record<string, ParMark>;
}) {
  const { t } = useT();
  const copy = t.labels.stock;
  const router = useRouter();
  const [moving, setMoving] = useState<StockItem | null>(null);
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);
  const canMove = move !== null && canSetShelfLife(move.role);
  if (items.length === 0) return <p className="text-sm text-white/60">{copy.empty}</p>;
  return (
    <div className="overflow-x-auto">
      {move && moving && (
        <MoveLotDialog
          item={moving}
          locations={move.locations}
          settings={move.settings}
          role={move.role}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            router.refresh();
          }}
        />
      )}
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-widest text-white/50">
          <tr>
            <th className="py-2 pr-3 font-medium">{copy.columns.name}</th>
            <th className="py-2 pr-3 font-medium">{copy.columns.qty}</th>
            <th className="py-2 pr-3 font-medium">{copy.columns.lot}</th>
            <th className="py-2 pr-3 font-medium">{copy.columns.expiry}</th>
            {seesMoney && <th className="py-2 pr-3 text-right font-medium">{copy.columns.cost}</th>}
            {seesMoney && <th className="py-2 pr-3 text-right font-medium">{copy.columns.sale}</th>}
            <th className="py-2 font-medium">{copy.columns.kind}</th>
            {canMove && <th className="py-2 pl-3" aria-label={t.labels.move.action} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => {
            const urgent = item.daysLeft !== null && item.daysLeft <= 0;
            const low = par[item.productId];
            return (
              <tr key={item.stockId}>
                <td className="py-2 pr-3">
                  <p className="font-semibold text-white">{item.productName}</p>
                  <p className="text-xs text-white/50">{item.locationName}</p>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatQty(item.quantity)} {unit(item.unit)}
                  {low && <ParAlertBadge quantity={low.quantity} min={low.min} unit={unit(low.unit)} compact className="ml-2" />}
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-white/70">{item.lotNumber ?? "—"}</td>
                <td className={cn("py-2 pr-3 whitespace-nowrap", urgent ? "text-red-300" : "text-white/80")}>
                  {item.expiryDate ? labelDate(item.expiryDate) : "—"}
                </td>
                {seesMoney && (
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {item.costPerUnit === null ? "—" : formatMoney(item.quantity * item.costPerUnit, currency)}
                  </td>
                )}
                {seesMoney && (
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {item.salePrice === null ? "—" : formatMoney(item.quantity * item.salePrice, currency)}
                  </td>
                )}
                <td className="py-2">
                  <Badge className={KIND_STYLE[item.kind].badge}>{copy.kinds[item.kind]}</Badge>
                </td>
                {canMove && (
                  <td className="py-2 pl-3 text-right">
                    {item.locationId && (item.daysLeft === null || item.daysLeft >= 0) && (
                      <Button size="sm" variant="outline" onClick={() => setMoving(item)}>
                        {t.labels.move.action}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Stock by kind: filter tabs, the kind cards (money for owners and chefs) and the rows FIFO. Cooks see
 * the same blocks with lot and expiry, without prices.
 */
export default function StockByKind({
  value,
  blocks,
  filter,
  currency,
  seesMoney,
  link,
  move,
  par = {},
}: {
  value: StockValue;
  blocks: StockBlock[];
  filter: StockFilter;
  currency: CurrencyInfo;
  seesMoney: boolean;
  link: StockLink;
  move?: StockMove;
  /** Products below their minimum in this branch, by product id; their rows get the red badge. */
  par?: Record<string, ParMark>;
}) {
  const { t } = useT();
  const copy = t.labels.stock;
  const hrefFor = (item: StockFilter) => stockHref(link.path, link.branchId, item);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-bold">{copy.title}</h2>
        <p className="mt-1 text-sm text-white/60">{seesMoney ? copy.hint : copy.cookHint}</p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label={copy.title}>
        {STOCK_FILTERS.map((item) => (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === filter ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition",
              item === filter ? "border-beige bg-beige text-black" : "border-line text-white/80 hover:bg-white/[0.06]",
            )}
          >
            {copy.filters[item]}
          </Link>
        ))}
      </nav>
      <StockKindCards value={value} currency={currency} link={link} />
      {blocks.map((block) => (
        <Card key={block.kind ?? "expiring"} className={cn("flex flex-col gap-3 border", block.kind ? KIND_STYLE[block.kind].border : "border-red-500/40")}>
          <CardTitle className={block.kind ? KIND_STYLE[block.kind].text : "text-red-300"}>
            {block.kind ? copy.kinds[block.kind] : copy.filters.expiring}
          </CardTitle>
          <ItemsTable items={block.items} currency={currency} seesMoney={seesMoney} move={move ?? null} par={par} />
          {block.total > block.items.length && <p className="text-xs text-white/50">{copy.more(block.items.length, block.total)}</p>}
        </Card>
      ))}
    </section>
  );
}
