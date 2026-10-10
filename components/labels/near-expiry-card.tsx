"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi } from "@/lib/labels/client";
import {
  actionsFor,
  EXPIRY_NOTE_MAX,
  ExpiryAction,
  expiryTone,
  NEAR_EXPIRY_ANCHOR,
  nearExpiryTotals,
  reviewInputError,
  type ExpiryTone,
  type NearExpiryLot,
  type ReviewInputError,
} from "@/lib/labels/expiry";
import type { LabelsErrorCode } from "@/lib/labels/model";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { formatQty } from "@/lib/purchasing/format";
import { addDays } from "@/lib/tenant-settings/time";

const TONE_CLASS: Record<ExpiryTone, string> = {
  expired: "border-red-400/60 text-red-300",
  warning: "border-amber-300/60 text-amber-200",
  ok: "border-line text-white/70",
};

const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Lots of the branch expiring within the restaurant's review window. Owners and chefs decide per lot
 * (public.review_batch_action); everyone else only sees the list.
 */
export default function NearExpiryCard({
  lots,
  days,
  today,
  currency,
  canReview,
}: {
  lots: NearExpiryLot[];
  days: number;
  /** The restaurant's today (YYYY-MM-DD). */
  today: string;
  currency: CurrencyInfo;
  canReview: boolean;
}) {
  const { t } = useT();
  const copy = t.expiry;
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [extending, setExtending] = useState<NearExpiryLot | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState<ReviewInputError | null>(null);
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);
  const totals = nearExpiryTotals(lots);

  const send = async (lot: NearExpiryLot, action: ExpiryAction, extra: { note: string | null; newExpiry: string | null }) => {
    setPending(lot.lotId);
    setError(null);
    setDone(null);
    const outcome = await callLabelsApi("/api/expiry/review", "POST", {
      lot_id: lot.lotId,
      action,
      note: extra.note,
      new_expiry: extra.newExpiry,
    });
    setPending(null);
    if (!outcome.ok) {
      setError(outcome.error);
      return false;
    }
    setDone(copy.done[action](lot.productName));
    router.refresh();
    return true;
  };

  const decide = (lot: NearExpiryLot, action: ExpiryAction) => {
    if (action === ExpiryAction.Extend) {
      setExtending(lot);
      setNewExpiry(addDays(lot.expiryDate > today ? lot.expiryDate : today, 1));
      setNote("");
      setInvalid(null);
      return;
    }
    if (action === ExpiryAction.WriteOff && !window.confirm(copy.confirmWriteOff(`${formatQty(lot.quantity)} ${unit(lot.unit)}`, lot.productName))) {
      return;
    }
    void send(lot, action, { note: null, newExpiry: null });
  };

  const submitExtend = async (event: FormEvent) => {
    event.preventDefault();
    if (!extending) return;
    const input = { lotId: extending.lotId, action: ExpiryAction.Extend, note, newExpiry };
    const problem = reviewInputError(input, today);
    setInvalid(problem);
    if (problem) return;
    if (await send(extending, ExpiryAction.Extend, { note: note.trim(), newExpiry })) setExtending(null);
  };

  return (
    <Card id={NEAR_EXPIRY_ANCHOR} className="flex scroll-mt-6 flex-col gap-3 border-amber-300/40 bg-amber-300/5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-amber-100">{copy.card.title(days)}</CardTitle>
          <p className="mt-1 text-xs text-white/60">{copy.card.hint(days)}</p>
        </div>
        {lots.length > 0 && (
          <div className="text-right text-xs text-amber-200">
            <p>{copy.card.count(totals.count)}</p>
            {totals.value !== null && <p>{copy.card.total(formatMoney(totals.value, currency))}</p>}
          </div>
        )}
      </div>
      {done && (
        <p role="status" className="text-sm text-green-400">
          {done}
        </p>
      )}
      {lots.length === 0 ? (
        <p className="text-sm text-white/60">{copy.card.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.columns.product}</TableHead>
              <TableHead>{copy.columns.lot}</TableHead>
              <TableHead>{copy.columns.place}</TableHead>
              <TableHead className="text-right">{copy.columns.quantity}</TableHead>
              <TableHead>{copy.columns.expiry}</TableHead>
              <TableHead>{copy.columns.daysLeft}</TableHead>
              {totals.value !== null && <TableHead className="text-right">{copy.columns.value}</TableHead>}
              {canReview && <TableHead>{copy.columns.actions}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.map((lot) => (
              <TableRow key={lot.lotId}>
                <TableCell>
                  <p className="font-semibold">{lot.productName}</p>
                  {lot.internalCode && <p className="font-mono text-xs text-white/50">{lot.internalCode}</p>}
                </TableCell>
                <TableCell className="font-mono text-xs text-white/70">{lot.lotNumber ?? "—"}</TableCell>
                <TableCell className="text-white/70">{lot.locationName}</TableCell>
                <TableCell className="text-right">
                  {formatQty(lot.quantity)} {unit(lot.unit)}
                </TableCell>
                <TableCell>{labelDate(lot.expiryDate)}</TableCell>
                <TableCell>
                  <Badge className={TONE_CLASS[expiryTone(lot.daysLeft)]}>{copy.days(lot.daysLeft)}</Badge>
                  {lot.lastAction && <p className="mt-1 text-xs text-white/50">{copy.actions[lot.lastAction]}</p>}
                </TableCell>
                {totals.value !== null && <TableCell className="text-right">{formatMoney(lot.cost, currency)}</TableCell>}
                {canReview && (
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {actionsFor(lot.daysLeft).map((action) => (
                        <Button
                          key={action}
                          variant="outline"
                          size="sm"
                          className={action === ExpiryAction.WriteOff ? "border-red-400/60 text-red-300" : undefined}
                          disabled={pending !== null}
                          onClick={() => decide(lot, action)}
                        >
                          {pending === lot.lotId ? copy.working : copy.actions[action]}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t.labels.errors[error]}
        </p>
      )}
      <Dialog
        open={extending !== null}
        onOpenChange={(open) => !open && setExtending(null)}
        title={extending ? copy.extend.title(extending.productName) : ""}
        closeLabel={copy.extend.cancel}
      >
        <form className="flex flex-col gap-4" onSubmit={(event) => void submitExtend(event)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="near-expiry-date">{copy.extend.date}</Label>
            <Input
              id="near-expiry-date"
              type="date"
              min={addDays(today, 1)}
              value={newExpiry}
              onChange={(event) => setNewExpiry(event.target.value)}
              aria-invalid={invalid === "date"}
              required
            />
            {invalid === "date" && <p className="text-xs text-red-400">{copy.extend.dateError}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="near-expiry-note">{copy.extend.note}</Label>
            <Input
              id="near-expiry-note"
              value={note}
              maxLength={EXPIRY_NOTE_MAX}
              placeholder={copy.extend.notePlaceholder}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={invalid === "note"}
              required
            />
            {invalid === "note" && <p className="text-xs text-red-400">{copy.extend.noteError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setExtending(null)}>
              {copy.extend.cancel}
            </Button>
            <Button type="submit" disabled={pending !== null}>
              {pending ? copy.working : copy.extend.save}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
