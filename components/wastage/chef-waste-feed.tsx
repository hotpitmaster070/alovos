"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Branch } from "@/lib/anbar/types";
import { CHEF_WASTE_PATH, COOK_WASTE_PATH, OWNER_DASHBOARD_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { formatQty } from "@/lib/purchasing/format";
import { localDateTime } from "@/lib/tenant-settings/time";
import { LOGGED_WASTE_REASONS, type LoggedWasteReason, type WasteCard } from "@/lib/wastage/model";

export default function ChefWasteFeed({
  allowed,
  currency,
  timeZone,
  branches = [],
  branchId = null,
  cooks = [],
  reason = null,
  userId = null,
  day = "",
  today = "",
  cards = [],
  count = 0,
  total = null,
  page = 1,
  pageSize = 50,
}: {
  allowed: boolean;
  currency: CurrencyInfo;
  timeZone: string;
  branches?: Branch[];
  branchId?: string | null;
  cooks?: { id: string; email: string }[];
  reason?: LoggedWasteReason | null;
  userId?: string | null;
  day?: string;
  today?: string;
  cards?: WasteCard[];
  count?: number;
  /** Value of every log matching the filters on that day. */
  total?: number | null;
  page?: number;
  pageSize?: number;
}) {
  const { t } = useT();
  const copy = t.owner.wasteFeed;
  const reasons = t.waste.reasons;

  if (!allowed) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <Card>
          <p className="text-sm text-white/60">{copy.forbidden}</p>
        </Card>
      </div>
    );
  }

  const query: Record<string, string> = { day };
  if (branchId) query.branch = branchId;
  if (reason) query.reason = reason;
  if (userId) query.cook = userId;
  const amount = formatMoney(total ?? 0, currency);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          {total !== null && (
            <p className="mt-2 text-lg font-semibold text-red-400">{day === today ? copy.lossToday(amount) : copy.loss(amount)}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={COOK_WASTE_PATH} className={buttonVariants("default", "sm")}>
            {copy.logWaste}
          </Link>
          <Link href={OWNER_DASHBOARD_PATH} className={buttonVariants("outline", "sm")}>
            {copy.dashboard}
          </Link>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {branches.length > 1 && (
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
        )}
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {copy.reason}
          <Select name="reason" defaultValue={reason ?? ""}>
            <option value="">{copy.allReasons}</option>
            {LOGGED_WASTE_REASONS.map((value) => (
              <option key={value} value={value}>
                {reasons[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {copy.cook}
          <Select name="cook" defaultValue={userId ?? ""}>
            <option value="">{copy.allCooks}</option>
            {cooks.map((cook) => (
              <option key={cook.id} value={cook.id}>
                {cook.email}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {copy.day}
          <Input type="date" name="day" defaultValue={day} max={today} />
        </label>
        <Button type="submit" variant="outline" size="sm">
          {copy.apply}
        </Button>
      </form>

      <Card>
        {cards.length === 0 ? (
          <p className="text-sm text-white/60">{copy.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.date}</TableHead>
                <TableHead>{copy.cook}</TableHead>
                <TableHead>{copy.product}</TableHead>
                <TableHead className="text-right">{copy.quantity}</TableHead>
                <TableHead>{copy.reason}</TableHead>
                <TableHead className="text-right">{copy.cost}</TableHead>
                <TableHead>{copy.photo}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cards.map((card) => (
                <TableRow key={card.id}>
                  <TableCell className="whitespace-nowrap text-white/70">{card.createdAt ? localDateTime(card.createdAt, timeZone) : "—"}</TableCell>
                  <TableCell>{card.actor ?? "—"}</TableCell>
                  <TableCell>{card.productName}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatQty(card.quantity)} {card.unit}
                  </TableCell>
                  <TableCell>{reasons[card.reason]}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatMoney(card.cost, currency)}</TableCell>
                  <TableCell>
                    {card.photoUrl ? (
                      <a href={card.photoUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={card.photoUrl} alt="" className="h-10 w-10 rounded-[8px] object-cover" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Pager path={CHEF_WASTE_PATH} query={query} page={page} pageSize={pageSize} total={count} shown={cards.length} />
    </div>
  );
}
