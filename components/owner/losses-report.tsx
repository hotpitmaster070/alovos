"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit, type Branch } from "@/lib/anbar/types";
import { OWNER_DASHBOARD_PATH, OWNER_LOSSES_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { LOSS_PERIODS, lossTotals, type LossPeriod, type LossRow } from "@/lib/losses/model";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { formatQty } from "@/lib/purchasing/format";
import { cn } from "@/lib/utils";

const chip = (active: boolean) => cn(buttonVariants("outline", "sm"), active && "bg-beige text-black");

/** Theoretical vs actual by product, biggest money loss first; red over the restaurant's line. */
export default function LossesReport({
  allowed,
  branches,
  branchId,
  period,
  range,
  currency,
  rows = [],
}: {
  allowed: boolean;
  branches: Branch[];
  branchId: string | null;
  period: LossPeriod;
  range: { start: string; end: string };
  currency: CurrencyInfo;
  rows?: LossRow[];
}) {
  const { t } = useT();
  const copy = t.owner.losses;
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);
  const qty = (value: number, u: string) => `${formatQty(value)} ${unit(u)}`;
  const href = (next: LossPeriod) => {
    const params = new URLSearchParams({ period: next });
    if (branchId) params.set("branch", branchId);
    return `${OWNER_LOSSES_PATH}?${params.toString()}`;
  };
  const totals = lossTotals(rows);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.subtitle}</p>
        </div>
        <Link href={branchId ? `${OWNER_DASHBOARD_PATH}?branch=${encodeURIComponent(branchId)}` : OWNER_DASHBOARD_PATH} className={buttonVariants("outline", "sm")}>
          {t.owner.wasteFeed.dashboard}
        </Link>
      </div>

      {!allowed ? (
        <Card>
          <p className="text-sm text-white/60">{copy.forbidden}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <nav className="flex gap-2" aria-label={copy.title}>
              {LOSS_PERIODS.map((item) => (
                <Link key={item} href={href(item)} aria-current={item === period ? "page" : undefined} className={chip(item === period)}>
                  {copy.periods[item]}
                </Link>
              ))}
            </nav>
            {branches.length > 1 && (
              <form method="get" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="period" value={period} />
                <label className="flex flex-col gap-1 text-xs text-white/60">
                  {t.owner.dashboard.branch}
                  <Select name="branch" defaultValue={branchId ?? "all"}>
                    <option value="all">{t.owner.dashboard.allBranches}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button type="submit" variant="outline" size="sm">
                  {t.owner.dashboard.apply}
                </Button>
              </form>
            )}
            <p className="text-sm text-white/50">{copy.range(range.start, range.end)}</p>
          </div>

          <Card className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/50">{copy.total}</p>
            <p className={cn("font-serif text-[26px] font-bold leading-tight", totals.value > 0 ? "text-red-400" : "text-emerald-400")}>
              {formatMoney(totals.value, currency)}
            </p>
            <p className="text-xs text-white/50">{copy.totalHint(totals.overLimit)}</p>
          </Card>

          <Card>
            {rows.length === 0 ? (
              <p className="text-sm text-white/60">{copy.empty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.product}</TableHead>
                    <TableHead className="text-right">{copy.expected}</TableHead>
                    <TableHead className="text-right">{copy.actual}</TableHead>
                    <TableHead className="text-right">{copy.lossQty}</TableHead>
                    <TableHead className="text-right">{copy.lossValue}</TableHead>
                    <TableHead className="text-right">{copy.lossPercent}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.productId} className={cn(row.overLimit && "text-red-400")}>
                      <TableCell>
                        <p className="font-medium">{row.productName}</p>
                        <p className={cn("text-xs", row.overLimit ? "text-red-300/80" : "text-white/50")}>
                          {copy.breakdown(qty(row.writtenOff, row.unit), qty(row.countLoss, row.unit))}
                        </p>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{qty(row.theoretical, row.unit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{qty(row.actual, row.unit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold">{qty(row.loss, row.unit)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold">{formatMoney(row.lossValue, currency)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.lossPercent === null ? <span className="text-xs">{copy.noSales}</span> : `${formatQty(row.lossPercent)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-3 text-xs text-white/50">{copy.how}</p>
          </Card>
        </>
      )}
    </div>
  );
}
