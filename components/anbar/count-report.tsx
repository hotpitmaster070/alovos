"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import { approveCountAction, cancelCountAction, mergeCountAction, type CountActionResult } from "@/lib/count/actions";
import type { CountErrorCode, CountLine, StockCount } from "@/lib/count/model";
import { useT } from "@/lib/i18n/useT";
import { formatMoney } from "@/lib/money";
import { localDateTime } from "@/lib/tenant-settings/time";
import { cn } from "@/lib/utils";

type Notice = "merged" | "approved" | "cancelled";

const quantity = (value: number) => String(Number(value.toFixed(3)));
const signed = (value: number, text: string) => (value > 0 ? `+${text}` : text);

/** Discrepancy report of one count: expected / counted / difference / difference value. */
export default function CountReport({
  count,
  lines,
  locationName,
  canApprove,
  currency,
  timeZone,
}: {
  count: StockCount;
  lines: CountLine[];
  locationName: string | null;
  canApprove: boolean;
  /** Currency label for money amounts. */
  currency: string;
  timeZone: string;
}) {
  const { t } = useT();
  const copy = t.anbar.sayim;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "notice"; key: Notice } | { kind: "error"; key: CountErrorCode } | null>(null);

  const blind = lines.some((line) => line.expected === null);
  const hasMoney = lines.some((line) => line.differenceValue !== null);
  const totalValue = lines.reduce((sum, line) => sum + (line.differenceValue ?? 0), 0);
  const withDifference = lines.filter((line) => line.difference !== null && line.difference !== 0).length;

  const act = (run: () => Promise<CountActionResult>, done: Notice, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await run();
        setMessage(result.ok ? { kind: "notice", key: done } : { kind: "error", key: result.error });
        if (result.ok) router.refresh();
      } catch {
        setMessage({ kind: "error", key: "save_failed" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.discrepancies}</h1>
          <p className="mt-2 text-sm text-white/60">
            {[locationName, count.groupKey, copy.status[count.status]].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-white/50">
            {copy.startedAt}: {localDateTime(count.createdAt, timeZone)}
            {count.approvedAt && ` · ${copy.approvedAt}: ${localDateTime(count.approvedAt, timeZone)}`}
            {count.mergeMode && ` · ${copy.mergeMode}: ${copy.mergeModes[count.mergeMode]}`}
          </p>
        </div>
        <Link href={`${ANBAR_COUNT_PATH}?location=${encodeURIComponent(count.locationId)}`} className={buttonVariants("outline", "sm")}>
          {copy.title}
        </Link>
      </div>

      {message && (
        <p role={message.kind === "notice" ? "status" : "alert"} className={message.kind === "notice" ? "text-sm text-emerald-400" : "text-sm text-red-400"}>
          {message.kind === "notice" ? copy.notices[message.key] : copy.errors[message.key]}
        </p>
      )}

      {blind && <p className="text-sm text-white/60">{copy.hiddenUntilMerge}</p>}

      <Card>
        {lines.length === 0 ? (
          <p className="text-sm text-white/60">{copy.errors.nothing_counted}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.product}</TableHead>
                <TableHead className="text-right">{copy.expected}</TableHead>
                <TableHead className="text-right">{copy.actual}</TableHead>
                <TableHead className="text-right">{copy.difference}</TableHead>
                {hasMoney && <TableHead className="text-right">{copy.differenceValue}</TableHead>}
                <TableHead className="text-right">{copy.counters}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.productId}>
                  <TableCell>
                    {line.name}
                    <span className="text-white/40"> · {line.unit}</span>
                  </TableCell>
                  <TableCell className="text-right">{line.expected === null ? "—" : quantity(line.expected)}</TableCell>
                  <TableCell className="text-right">{quantity(line.counted)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right",
                      line.difference !== null && line.difference < 0 && "text-red-400",
                      line.difference !== null && line.difference > 0 && "text-emerald-400",
                    )}
                  >
                    {line.difference === null ? "—" : signed(line.difference, quantity(line.difference))}
                  </TableCell>
                  {hasMoney && (
                    <TableCell className="text-right">
                      {line.differenceValue === null ? "—" : signed(line.differenceValue, formatMoney(line.differenceValue, currency))}
                    </TableCell>
                  )}
                  <TableCell className="text-right">{line.counters}</TableCell>
                </TableRow>
              ))}
              {hasMoney && (
                <TableRow>
                  <TableCell className="font-semibold">{copy.total}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right">{withDifference}</TableCell>
                  <TableCell className="text-right font-semibold">{signed(totalValue, formatMoney(totalValue, currency))}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {!blind && lines.length > 0 && withDifference === 0 && <p className="mt-3 text-sm text-white/60">{copy.noDifferences}</p>}
      </Card>

      {canApprove && (count.status === "counting" || count.status === "merging" || count.status === "draft") && (
        <div className="flex flex-wrap gap-2">
          {count.status === "counting" && (
            <Button type="button" disabled={pending} onClick={() => act(() => mergeCountAction(count.id), "merged")}>
              {copy.merge}
            </Button>
          )}
          {count.status === "merging" && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => act(() => approveCountAction(count.id), "approved", copy.confirmApprove)}
            >
              {copy.approve}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => cancelCountAction(count.id), "cancelled", copy.confirmCancel)}
          >
            {copy.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
