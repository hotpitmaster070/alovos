"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { StorageLocation } from "@/lib/anbar/types";
import { isUnit } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi, field } from "@/lib/labels/client";
import type { StockItem } from "@/lib/labels/final";
import {
  LABEL_COPIES_MAX,
  MOVE_REASON_MAX,
  SHELF_LIFE_DAYS_MAX,
  canSetShelfLife,
  moveRestartsClock,
  parseLot,
  parseShelfLifeInfo,
  resolveShelfLife,
  type LabelsErrorCode,
  type Lot,
  type ShelfLifeInfo,
} from "@/lib/labels/model";
import { formatQty } from "@/lib/purchasing/format";
import type { ExpirySettings } from "@/lib/tenant-settings/parse";
import { addDays, todayIn } from "@/lib/tenant-settings/time";
import { BirkaPrintSheet, type BirkaLabel } from "./birka-print";

const wholeNumber = (value: string, max: number): number | null =>
  /^\d+$/.test(value.trim()) && Number(value) <= max ? Number(value) : null;

const amount = (value: string): number | null => {
  const parsed = Number(value.replace(",", "."));
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Moves one stock lot to another place of its branch (fresh -> freezer so it is not thrown away). Into a
 * place of another kind the use-by date restarts today with the norm for that place, which the cook can
 * change and remember; into the same kind the date stays. Prints the new label when asked.
 */
export default function MoveLotDialog({
  item,
  locations,
  settings,
  role,
  onClose,
  onDone,
}: {
  item: StockItem;
  /** Active places of the item's branch. */
  locations: StorageLocation[];
  settings: ExpirySettings;
  role: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const copy = t.labels.move;
  const from = locations.find((location) => location.id === item.locationId) ?? null;
  const targets = locations.filter((location) => location.id !== item.locationId && location.branchId === from?.branchId);
  const [info, setInfo] = useState<ShelfLifeInfo | null>(null);
  const [toId, setToId] = useState(() => targets.find((location) => location.type !== from?.type)?.id ?? targets[0]?.id ?? "");
  const [qty, setQty] = useState(String(item.quantity));
  /** null: the norm for the target place. */
  const [days, setDays] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [remember, setRemember] = useState(false);
  const [reason, setReason] = useState("");
  const [copies, setCopies] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [printing, setPrinting] = useState<{ label: BirkaLabel; copies: number } | null>(null);

  const to = targets.find((location) => location.id === toId) ?? null;
  const restarts = from !== null && to !== null && moveRestartsClock(from.type, to.type);
  const resolved = info && to ? resolveShelfLife(info, to.id) : null;
  const unit = isUnit(item.unit) ? t.anbar.units[item.unit] : item.unit;
  const today = todayIn(settings.timezone, new Date());

  useEffect(() => {
    let active = true;
    void callLabelsApi(`/api/shelf-life-rules?product_id=${encodeURIComponent(item.productId)}`, "GET").then((outcome) => {
      if (!active) return;
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const parsed = parseShelfLifeInfo(outcome.data);
      if (parsed) setInfo(parsed);
      else setError("save_failed");
    });
    return () => {
      active = false;
    };
  }, [item.productId]);

  const chooseTarget = (id: string) => {
    setToId(id);
    setDays(null);
    setRemember(false);
  };
  const close = () => (moved ? onDone() : onClose());

  const qtyValue = amount(qty);
  const qtyValid = qtyValue !== null && qtyValue <= item.quantity;
  const daysText = days ?? (resolved ? String(resolved.days) : "");
  const dayCount = wholeNumber(daysText, SHELF_LIFE_DAYS_MAX);
  const copyCount = wholeNumber(copies, LABEL_COPIES_MAX);
  const changed = restarts && resolved !== null && dayCount !== null && dayCount !== resolved.days;
  const newExpiry = restarts ? (dayCount !== null ? addDays(today, dayCount) : null) : item.expiryDate;
  const reasonText = reason.trim();
  const ready = !pending && !moved && info !== null && to !== null && qtyValid && copyCount !== null && (!restarts || dayCount !== null);

  const submit = async () => {
    if (!ready || !to || qtyValue === null || copyCount === null) {
      setError("invalid_input");
      return;
    }
    setPending(true);
    setError(null);
    const outcome = await callLabelsApi("/api/lots/move", "POST", {
      stock_id: item.stockId,
      to_location_id: to.id,
      qty: qtyValue === item.quantity ? null : qtyValue,
      shelf_life_days: changed ? dayCount : null,
      remember: changed && remember,
      reason: reasonText || null,
    });
    if (!outcome.ok) {
      setPending(false);
      setError(outcome.error);
      return;
    }
    setMoved(true);
    const lot: Lot | null = parseLot(field(outcome.data, "lot"));
    if (!lot || copyCount === 0) {
      setPending(false);
      onDone();
      return;
    }
    const logged = await callLabelsApi("/api/labels/print", "POST", { lot_ids: [lot.id], copies: copyCount });
    setPending(false);
    if (!logged.ok) {
      setError(logged.error);
      return;
    }
    setPrinting({ label: { lot, productName: item.productName, storageName: to.name }, copies: copyCount });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending && close()}
      title={copy.title}
      description={copy.hint(`${formatQty(item.quantity)} ${unit}`, item.productName, item.locationName)}
      closeLabel={t.labels.prep.close}
    >
      {targets.length === 0 ? (
        <p className="text-sm text-white/70">{copy.noTargets}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="move-to">{copy.to}</Label>
              <Select id="move-to" value={toId} disabled={pending || moved} onChange={(event) => chooseTarget(event.target.value)}>
                {targets.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="move-qty">{copy.qty}</Label>
              <Input
                id="move-qty"
                inputMode="decimal"
                value={qty}
                disabled={pending}
                aria-invalid={!qtyValid}
                onChange={(event) => setQty(event.target.value)}
              />
              <p className="mt-1 text-xs text-white/50">{copy.qtyHint(`${formatQty(item.quantity)} ${unit}`)}</p>
            </div>
          </div>

          <div className="rounded-[12px] border border-line p-3">
            <p className="text-xs text-white/60">{copy.expiry}</p>
            <p className="text-2xl font-bold">{newExpiry ? labelDate(newExpiry) : "—"}</p>
            <p className="text-xs text-white/50">{restarts ? copy.restarts : copy.keeps}</p>
            {restarts && resolved && !changed && <p className="text-xs text-white/50">{t.labels.receipt.source[resolved.source]}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="move-days">{copy.shelfLife}</Label>
              <Input
                id="move-days"
                type="number"
                inputMode="numeric"
                min="0"
                max={SHELF_LIFE_DAYS_MAX}
                step="1"
                value={restarts ? daysText : ""}
                disabled={!restarts || !info || pending}
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="move-copies">{copy.copies}</Label>
              <Input
                id="move-copies"
                type="number"
                inputMode="numeric"
                min="0"
                max={LABEL_COPIES_MAX}
                step="1"
                value={copies}
                disabled={pending}
                onChange={(event) => setCopies(event.target.value)}
              />
            </div>
          </div>
          {changed && canSetShelfLife(role) && (
            <label className="flex items-center gap-2 text-sm text-white/80">
              <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              {copy.remember}
            </label>
          )}
          <div>
            <Label htmlFor="move-reason">{copy.reason}</Label>
            <Input
              id="move-reason"
              value={reason}
              maxLength={MOVE_REASON_MAX}
              placeholder={copy.reasonPlaceholder}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {moved && <p className="text-sm text-green-300">{copy.done(newExpiry ? labelDate(newExpiry) : "—")}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
          <div className="flex justify-end">
            <Button disabled={!ready} onClick={() => void submit()}>
              {pending ? copy.working : copy.submit}
            </Button>
          </div>
        </div>
      )}

      {printing && <BirkaPrintSheet labels={[{ label: printing.label, copies: printing.copies }]} settings={settings} onDone={onDone} />}
    </Dialog>
  );
}
