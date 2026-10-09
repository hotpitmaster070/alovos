"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Branch, CatalogProduct, StorageLocation } from "@/lib/anbar/types";
import { isUnit } from "@/lib/anbar/types";
import { ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi, field } from "@/lib/labels/client";
import {
  LABEL_COPIES_MAX,
  SHELF_LIFE_DAYS_MAX,
  canSetShelfLife,
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

type Step = { kind: "choose" } | { kind: "storage"; location: StorageLocation } | { kind: "prep" };

const wholeNumber = (value: string, max: number): number | null =>
  /^\d+$/.test(value.trim()) && Number(value) <= max ? Number(value) : null;

/**
 * After "Qəbul et": where the goods go. A storage place shows the use-by date from the norm (rule for
 * the place, product, tenant default), lets the cook adjust it and asks for the number of labels;
 * "Çap et" saves receipt and lot in one transaction and prints. "Zaqotovka et" receives into the chosen
 * place and opens the prep page for this product.
 */
export default function ReceiptWhereDialog({
  product,
  qty,
  price,
  currency,
  fxRate,
  branches,
  locations,
  settings,
  role,
  onClose,
  onDone,
}: {
  product: CatalogProduct;
  qty: number;
  /** Per unit in currency (null currency: the restaurant's). */
  price: number | null;
  currency: string | null;
  fxRate: number | null;
  branches: Branch[];
  locations: StorageLocation[];
  settings: ExpirySettings;
  role: string | null;
  onClose: () => void;
  onDone: (lot: Lot) => void;
}) {
  const { t } = useT();
  const copy = t.labels.receipt;
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [info, setInfo] = useState<ShelfLifeInfo | null>(null);
  const [days, setDays] = useState("");
  const [remember, setRemember] = useState(false);
  const [copies, setCopies] = useState("1");
  const [prepLocation, setPrepLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [printing, setPrinting] = useState<{ lot: Lot; label: BirkaLabel; copies: number } | null>(null);

  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const showBranch = new Set(locations.map((location) => location.branchId)).size > 1;
  const ordered = [...locations].sort(
    (a, b) => (a.branchId === product.branchId ? 0 : 1) - (b.branchId === product.branchId ? 0 : 1),
  );
  const locationLabel = (location: StorageLocation) => {
    const branch = showBranch ? branchName.get(location.branchId) : null;
    return branch ? `${branch} · ${location.name}` : location.name;
  };
  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;

  useEffect(() => {
    let active = true;
    void callLabelsApi(`/api/shelf-life-rules?product_id=${encodeURIComponent(product.id)}`, "GET").then((outcome) => {
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
  }, [product.id]);

  const resolved = step.kind === "storage" && info ? resolveShelfLife(info, step.location.id) : null;
  const dayCount = wholeNumber(days, SHELF_LIFE_DAYS_MAX);
  const copyCount = wholeNumber(copies, LABEL_COPIES_MAX);
  const today = todayIn(settings.timezone, new Date());
  const changed = resolved !== null && dayCount !== null && dayCount !== resolved.days;

  const chooseStorage = (location: StorageLocation) => {
    setError(null);
    setRemember(false);
    setCopies("1");
    setDays(info ? String(resolveShelfLife(info, location.id).days) : "");
    setStep({ kind: "storage", location });
  };

  const receive = async (locationId: string, shelfLifeDays: number | null, rememberRule: boolean): Promise<Lot | null> => {
    const outcome = await callLabelsApi("/api/lots/receive", "POST", {
      product_id: product.id,
      qty,
      storage_location_id: locationId,
      price,
      currency,
      fx_rate: fxRate,
      shelf_life_days: shelfLifeDays,
      remember: rememberRule,
    });
    const lot = outcome.ok ? parseLot(field(outcome.data, "lot")) : null;
    if (!lot) setError(outcome.ok ? "save_failed" : outcome.error);
    return lot;
  };

  const saveAndPrint = async () => {
    if (step.kind !== "storage" || dayCount === null || copyCount === null) {
      setError("invalid_input");
      return;
    }
    setPending(true);
    setError(null);
    const lot = await receive(step.location.id, changed ? dayCount : null, changed && remember);
    if (!lot) {
      setPending(false);
      return;
    }
    if (copyCount === 0) {
      setPending(false);
      onDone(lot);
      return;
    }
    const logged = await callLabelsApi("/api/labels/print", "POST", { lot_ids: [lot.id], copies: copyCount });
    setPending(false);
    if (!logged.ok) {
      setError(logged.error);
      onDone(lot);
      return;
    }
    setPrinting({ lot, label: { lot, productName: product.name, storageName: locationLabel(step.location) }, copies: copyCount });
  };

  const receiveForPrep = async () => {
    const locationId = prepLocation || ordered[0]?.id;
    if (!locationId) return;
    setPending(true);
    setError(null);
    const lot = await receive(locationId, null, false);
    setPending(false);
    if (!lot) return;
    const params = new URLSearchParams({ product: product.id, from: locationId, qty: String(qty) });
    router.push(`${ZAQOTOVKA_PATH}?${params.toString()}`);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={copy.where}
      description={copy.whereHint(`${formatQty(qty)} ${unit}`, product.name)}
      closeLabel={t.labels.prep.close}
    >
      {step.kind === "choose" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {ordered.map((location) => (
              <Button
                key={location.id}
                variant="outline"
                className="h-auto min-h-14 whitespace-normal rounded-[12px] py-3"
                disabled={!info}
                onClick={() => chooseStorage(location)}
              >
                {locationLabel(location)}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="border border-dashed border-line"
            onClick={() => {
              setError(null);
              setPrepLocation(ordered.find((location) => location.id === product.storageLocationId)?.id ?? ordered[0]?.id ?? "");
              setStep({ kind: "prep" });
            }}
          >
            {copy.prep}
          </Button>
        </div>
      )}

      {step.kind === "storage" && (
        <div className="flex flex-col gap-4">
          <p className="font-serif text-lg font-bold">{locationLabel(step.location)}</p>
          <div className="rounded-[12px] border border-line p-3">
            <p className="text-xs text-white/60">{copy.expiry}</p>
            <p className="text-2xl font-bold">{dayCount !== null ? addDays(today, dayCount).split("-").reverse().join(".") : "—"}</p>
            {resolved && <p className="text-xs text-white/50">{changed ? "" : copy.source[resolved.source]}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="birka-days">{copy.shelfLife}</Label>
              <Input
                id="birka-days"
                type="number"
                inputMode="numeric"
                min="0"
                max={SHELF_LIFE_DAYS_MAX}
                step="1"
                value={days}
                disabled={!info}
                onChange={(event) => setDays(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="birka-copies">{copy.copies}</Label>
              <Input
                id="birka-copies"
                type="number"
                inputMode="numeric"
                min="0"
                max={LABEL_COPIES_MAX}
                step="1"
                value={copies}
                onChange={(event) => setCopies(event.target.value)}
                autoFocus
              />
            </div>
          </div>
          {changed && canSetShelfLife(role) && (
            <label className="flex items-center gap-2 text-sm text-white/80">
              <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              {copy.remember}
            </label>
          )}
          {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
          <div className="flex justify-between gap-3">
            <Button variant="ghost" disabled={pending} onClick={() => setStep({ kind: "choose" })}>
              {copy.back}
            </Button>
            <Button disabled={pending || !info || dayCount === null || copyCount === null} onClick={() => void saveAndPrint()}>
              {pending ? copy.working : copy.print}
            </Button>
          </div>
        </div>
      )}

      {step.kind === "prep" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-white/70">{copy.prepHint}</p>
          <div>
            <Label htmlFor="birka-prep-location">{t.labels.prep.from}</Label>
            <Select id="birka-prep-location" value={prepLocation} onChange={(event) => setPrepLocation(event.target.value)}>
              {ordered.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
          <div className="flex justify-between gap-3">
            <Button variant="ghost" disabled={pending} onClick={() => setStep({ kind: "choose" })}>
              {copy.back}
            </Button>
            <Button disabled={pending || !prepLocation} onClick={() => void receiveForPrep()}>
              {pending ? copy.working : copy.prep}
            </Button>
          </div>
        </div>
      )}

      {step.kind === "choose" && error && <p role="alert" className="mt-3 text-sm text-red-400">{t.labels.errors[error]}</p>}

      {printing && (
        <BirkaPrintSheet
          labels={[{ label: printing.label, copies: printing.copies }]}
          settings={settings}
          onDone={() => onDone(printing.lot)}
        />
      )}
    </Dialog>
  );
}
