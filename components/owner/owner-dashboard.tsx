"use client";

import Link from "next/link";
import ParAlertBadge from "@/components/anbar/par-alert-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Branch } from "@/lib/anbar/types";
import { AUTO_ORDER_PATH, CHEF_WASTE_PATH, OWNER_DISCREPANCIES_PATH, OWNER_LOSSES_PATH, OWNER_SETTINGS_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import type { DashboardCards, ParAlert } from "@/lib/owner/dashboard";
import { PAR_ALERT_LIMIT } from "@/lib/owner/dashboard";
import { formatQty } from "@/lib/purchasing/format";
import { cn } from "@/lib/utils";

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "good" | "bad" | "neutral" }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-[11px] font-medium uppercase tracking-widest text-white/50">{label}</p>
      <p
        className={cn(
          "font-serif text-[26px] font-bold leading-tight",
          tone === "good" && "text-emerald-400",
          tone === "bad" && "text-red-400",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-white/50">{hint}</p>
    </Card>
  );
}

export default function OwnerDashboard({
  allowed,
  branches,
  branchId,
  currency,
  cards,
  alerts = [],
  week = null,
}: {
  allowed: boolean;
  branches: Branch[];
  branchId: string | null;
  currency: CurrencyInfo;
  cards?: DashboardCards;
  alerts?: ParAlert[];
  /** null when inventory results could not be read. */
  week?: { lost: number; suspicious: number } | null;
}) {
  const { t } = useT();
  const copy = t.owner.dashboard;
  const wasteHref = branchId ? `${CHEF_WASTE_PATH}?branch=${encodeURIComponent(branchId)}` : CHEF_WASTE_PATH;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.subtitle}</p>
        </div>
        {allowed && (
          <div className="flex flex-wrap gap-2">
            <Link href={branchId ? `${OWNER_LOSSES_PATH}?branch=${encodeURIComponent(branchId)}` : OWNER_LOSSES_PATH} className={buttonVariants("outline", "sm")}>
              {t.owner.losses.open}
            </Link>
            <Link href={branchId ? `${OWNER_DISCREPANCIES_PATH}?branch=${encodeURIComponent(branchId)}` : OWNER_DISCREPANCIES_PATH} className={buttonVariants("outline", "sm")}>
              {t.inventory.report.title}
            </Link>
            <Link href={wasteHref} className={buttonVariants("outline", "sm")}>
              {copy.wasteFeed}
            </Link>
            <Link href={branchId ? `${AUTO_ORDER_PATH}?branch=${encodeURIComponent(branchId)}` : AUTO_ORDER_PATH} className={buttonVariants("outline", "sm")}>
              {t.autoOrder.board.title}
            </Link>
            <Link href={OWNER_SETTINGS_PATH} className={buttonVariants("outline", "sm")}>
              {t.autoOrder.settings.open}
            </Link>
          </div>
        )}
      </div>

      {branches.length > 1 && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-white/60">
            {copy.branch}
            <Select name="branch" defaultValue={branchId ?? "all"}>
              <option value="all">{copy.allBranches}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            {copy.apply}
          </Button>
        </form>
      )}

      {!allowed || !cards ? (
        <Card>
          <p className="text-sm text-white/60">{copy.forbidden}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={copy.stockCost} value={formatMoney(cards.stockCost, currency)} hint={copy.stockCostHint} tone="good" />
            <StatCard
              label={copy.belowPar}
              value={String(cards.belowPar)}
              hint={copy.belowParHint(cards.outOfStock)}
              tone={cards.belowPar > 0 ? "bad" : "good"}
            />
            <StatCard
              label={copy.wastedToday}
              value={formatMoney(cards.wastedToday, currency)}
              hint={copy.wastedTodayHint}
              tone={cards.wastedToday > 0 ? "bad" : "neutral"}
            />
            <StatCard
              label={copy.discrepancies}
              value={week ? formatMoney(week.lost, currency) : "—"}
              hint={copy.discrepanciesHint(week?.suspicious ?? 0)}
              tone={week && (week.lost > 0 || week.suspicious > 0) ? "bad" : "neutral"}
            />
          </div>

          <Card>
            <h2 className="mb-3 text-base font-medium">{copy.runningOut}</h2>
            {alerts.length === 0 ? (
              <p className="text-sm text-white/60">{copy.nothingRunningOut}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.product}</TableHead>
                    <TableHead className="text-right">{copy.left}</TableHead>
                    <TableHead className="text-right">{copy.minimum}</TableHead>
                    <TableHead className="text-right">{copy.toOrder}</TableHead>
                    {!branchId && <TableHead>{copy.branch}</TableHead>}
                    <TableHead>{copy.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={`${alert.branchId}:${alert.productId}`}>
                      <TableCell>
                        {alert.productName}
                        <span className="text-white/40"> · {alert.unit}</span>
                      </TableCell>
                      <TableCell className={cn("text-right", alert.quantity <= 0 && "text-red-400")}>{formatQty(alert.quantity)}</TableCell>
                      <TableCell className="text-right">{formatQty(alert.min)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatQty(alert.toOrder)}</TableCell>
                      {!branchId && <TableCell>{alert.branchName}</TableCell>}
                      <TableCell>
                        <ParAlertBadge quantity={alert.quantity} min={alert.min} unit={alert.unit} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {alerts.length >= PAR_ALERT_LIMIT && <p className="mt-3 text-xs text-white/50">{copy.shownLimit(PAR_ALERT_LIMIT)}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
