"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { isUnit } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi } from "@/lib/labels/client";
import type { LabelsErrorCode } from "@/lib/labels/model";
import type { ExpiredStockRow } from "@/lib/labels/waste";
import { formatQty } from "@/lib/purchasing/format";

const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

/** Stock past or near its expiry; spoiled rows are written off as waste (reason expired). */
export default function ExpiredStockCard({ rows, canWriteOff }: { rows: ExpiredStockRow[]; canWriteOff: boolean }) {
  const { t } = useT();
  const copy = t.labels.waste;
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);

  const writeOff = async (row: ExpiredStockRow) => {
    const qty = `${formatQty(row.quantity)} ${unit(row.unit)}`;
    if (!window.confirm(copy.confirmWriteOff(qty, row.productName))) return;
    setPendingId(row.stockId);
    setError(null);
    setDone(null);
    const outcome = await callLabelsApi("/api/wastage/expired", "POST", { stock_id: row.stockId });
    setPendingId(null);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setDone(copy.writtenOff(row.productName));
    router.refresh();
  };

  return (
    <Card className={rows.length > 0 ? "flex flex-col gap-3 border-red-400/50 bg-red-500/5" : "flex flex-col gap-3"}>
      <div>
        <CardTitle className={rows.length > 0 ? "text-red-200" : undefined}>{copy.expiredTitle}</CardTitle>
        <p className="mt-1 text-xs text-white/50">{copy.expiredHint}</p>
      </div>
      {done && (
        <p role="status" className="text-sm text-green-400">
          {done}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-white/60">{copy.expiredEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <li key={row.stockId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{row.productName}</p>
                {row.lotNumber && <p className="font-mono text-xs text-white/50">{row.lotNumber}</p>}
                <p className="text-xs text-white/60">
                  {row.locationName} · {formatQty(row.quantity)} {unit(row.unit)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                <Badge className={row.daysLeft <= 0 ? "border-red-400/60 text-red-300" : "border-amber-300/60 text-amber-200"}>
                  {labelDate(row.expiryDate)} · {copy.expiredDays(row.daysLeft)}
                </Badge>
                {canWriteOff && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-400/60 text-red-300"
                    disabled={pendingId !== null}
                    onClick={() => void writeOff(row)}
                  >
                    {pendingId === row.stockId ? t.labels.prep.working : copy.writeOff}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t.labels.errors[error]}
        </p>
      )}
    </Card>
  );
}
