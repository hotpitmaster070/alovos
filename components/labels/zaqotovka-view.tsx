"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KITCHEN_STOCK_PATH } from "@/lib/auth-redirect";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { isUnit, type Branch, type StorageLocation } from "@/lib/anbar/types";
import { getExpiryInfo } from "@/lib/expiry";
import { useT } from "@/lib/i18n/useT";
import { callLabelsApi, field } from "@/lib/labels/client";
import {
  LABEL_COPIES_MAX,
  PREPARATION_NAME_MAX,
  parseLot,
  parseShelfLifeInfo,
  portionsFor,
  resolveShelfLife,
  scalePreparation,
  type ExpiringLot,
  type LabelsErrorCode,
  type Lot,
  type Preparation,
  type ShelfLifeInfo,
  WASTE_ITEM_NAME_MAX,
} from "@/lib/labels/model";
import type { LabelProduct } from "@/lib/labels/repository";
import {
  calculateBalance,
  causeToWaste,
  PREP_WASTE_CAUSES,
  trimNormOf,
  trimPlan,
  unitBase,
  WASTE_NOTE_MAX,
  wasteNorm,
  wasteNormOf,
  type PrepWasteCause,
  type WasteItem,
} from "@/lib/labels/waste";
import { formatQty } from "@/lib/purchasing/format";
import type { ExpirySettings, PrepBalanceTolerance, TenantSettings } from "@/lib/tenant-settings/parse";
import { PERCENT_MAX } from "@/lib/tenant-settings/validation";
import { addDays, todayIn } from "@/lib/tenant-settings/time";
import { BirkaPrintSheet, type BirkaLabel } from "./birka-print";

type Start = { productId: string; fromLocationId: string | null; qty: number | null };
type Printing = { labels: { label: BirkaLabel; copies: number }[]; onDone: () => void };

const labelDate = (iso: string): string => iso.slice(0, 10).split("-").reverse().join(".");

type PrepBalanceSettings = PrepBalanceTolerance & Pick<TenantSettings, "defaultPortionWeightKg" | "defaultDensityKgPerL">;

function useLookups(products: LabelProduct[], branches: Branch[], locations: StorageLocation[], balanceSettings: PrepBalanceSettings) {
  const { t } = useT();
  const productById = new Map(products.map((product) => [product.id, product]));
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const showBranch = new Set(locations.map((location) => location.branchId)).size > 1;
  const locationById = new Map(locations.map((location) => [location.id, location]));
  return {
    productName: (id: string) => productById.get(id)?.name ?? "—",
    rawUnit: (id: string) => productById.get(id)?.unit ?? "",
    /** kg of one portion: the product's, else the tenant default. */
    portionWeight: (id: string) => productById.get(id)?.portionWeightKg ?? balanceSettings.defaultPortionWeightKg,
    /** kg per litre: the product's, else the tenant default. */
    density: (id: string) => productById.get(id)?.densityKgPerL ?? balanceSettings.defaultDensityKgPerL,
    trimProducts: products.filter((product) => product.productType === "trim"),
    unit: (id: string) => {
      const unit = productById.get(id)?.unit ?? "";
      return isUnit(unit) ? t.anbar.units[unit] : unit;
    },
    locationName: (id: string) => {
      const location = locationById.get(id);
      if (!location) return "—";
      const branch = showBranch ? branchName.get(location.branchId) : null;
      return branch ? `${branch} · ${location.name}` : location.name;
    },
  };
}

type Lookups = ReturnType<typeof useLookups>;

/** "10 kg Baranina → 5 kg Shashlik + 8 por. Koreyka + 2 kg Farsh". */
function RecipeLine({ preparation, lookups }: { preparation: Preparation; lookups: Lookups }) {
  const { t } = useT();
  const part = (productId: string, qty: number, portions: number | null, name: string | null) =>
    `${formatQty(qty)} ${lookups.unit(productId)} ${name ?? lookups.productName(productId)}${portions !== null ? ` (${t.labels.birka.portions(portions)})` : ""}`;
  return (
    <p className="text-sm text-white/80">
      {preparation.inputs.map((input) => part(input.productId, input.qty, null, null)).join(" + ")}
      <span className="px-2 text-beige">→</span>
      {preparation.outputs.map((output) => part(output.productId, output.qty, output.portions, output.name)).join(" + ")}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Recipe editor
// ---------------------------------------------------------------------------
/** weight: kg of one portion, for products counted in pieces (saved on the product). */
type Row = { productId: string; qty: string; portions: string; name: string; weight: string };
/** A norm item; usable items are trim (productId: the trim product it is returned as). */
type ItemRow = { name: string; percent: string; usable: boolean; productId: string };

function RecipeEditor({
  preparation,
  initialInput,
  products,
  defaultPortionWeightKg,
  onClose,
  onSaved,
}: {
  preparation: Preparation | null;
  initialInput: string | null;
  products: LabelProduct[];
  defaultPortionWeightKg: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const copy = t.labels.prep;
  const productById = new Map(products.map((product) => [product.id, product]));
  const inPieces = (productId: string) => {
    const product = productById.get(productId);
    return Boolean(product) && unitBase(product?.unit ?? "") === null;
  };
  const weightOf = (productId: string): string => {
    const weight = productById.get(productId)?.portionWeightKg ?? defaultPortionWeightKg;
    return weight === null ? "" : formatQty(weight);
  };
  const emptyRow = (productId = ""): Row => ({ productId, qty: "", portions: "", name: "", weight: weightOf(productId) });
  const [name, setName] = useState(preparation?.name ?? "");
  const [inputs, setInputs] = useState<Row[]>(
    preparation ? preparation.inputs.map((input) => ({ ...emptyRow(input.productId), qty: formatQty(input.qty) })) : [emptyRow(initialInput ?? "")],
  );
  const [outputs, setOutputs] = useState<Row[]>(
    preparation
      ? preparation.outputs.map((output) => ({
          productId: output.productId,
          qty: formatQty(output.qty),
          portions: output.portions === null ? "" : String(output.portions),
          name: output.name ?? "",
          weight: weightOf(output.productId),
        }))
      : [emptyRow()],
  );
  const [norm, setNorm] = useState(preparation ? formatQty(preparation.wastageNormPercent) : "");
  const [evaporation, setEvaporation] = useState(preparation && preparation.evaporationPercent > 0 ? formatQty(preparation.evaporationPercent) : "");
  const [items, setItems] = useState<ItemRow[]>(
    preparation?.wastageItems.map((item) => ({
      name: item.name,
      percent: formatQty(item.normPercent),
      usable: item.usable,
      productId: item.productId ?? "",
    })) ?? [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const wasteCopy = t.labels.waste;
  const trimCopy = t.labels.trim;
  const trimProducts = products.filter((product) => product.productType === "trim");
  const parsedItems: WasteItem[] = items.map((item) => ({
    name: item.name,
    normPercent: Number(item.percent.replace(",", ".")) || 0,
    usable: item.usable,
    productId: item.usable && item.productId ? item.productId : null,
  }));
  const itemsSum = wasteNormOf(0, parsedItems);
  const trimSum = trimNormOf(parsedItems);

  const update = (setter: typeof setInputs, index: number, patch: Partial<Row>) =>
    setter((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const updateItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body = {
      name,
      inputs: inputs.map((row) => ({ product_id: row.productId, qty: row.qty })),
      outputs: outputs.map((row) => ({ product_id: row.productId, qty: row.qty, portions: row.portions, name: row.name })),
      wastage_norm_percent: items.length > 0 ? null : norm,
      wastage_items: items.map((item) => ({
        name: item.name,
        norm_percent: item.percent,
        usable: item.usable,
        product_id: item.usable && item.productId ? item.productId : null,
      })),
      evaporation_percent: evaporation.trim() === "" ? 0 : evaporation,
      portion_weights: Array.from(
        new Map(
          [...inputs, ...outputs]
            .filter((row) => inPieces(row.productId) && row.weight.trim() !== "")
            .map((row) => [row.productId, { product_id: row.productId, portion_weight_kg: row.weight }]),
        ).values(),
      ),
    };
    const outcome = preparation
      ? await callLabelsApi(`/api/preparations/${preparation.id}`, "PATCH", body)
      : await callLabelsApi("/api/preparations", "POST", body);
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    onSaved();
  };

  const productSelect = (row: Row, onChange: (productId: string) => void, label: string) => (
    <Select aria-label={label} value={row.productId} required onChange={(event) => onChange(event.target.value)}>
      <option value="">{copy.choose}</option>
      {products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.name}
        </option>
      ))}
    </Select>
  );

  const weightField = (row: Row, setter: typeof setInputs, index: number, required: boolean) =>
    inPieces(row.productId) && (
      <div className="col-span-full grid grid-cols-[1fr_6rem] items-center gap-2">
        <Label htmlFor={`weight-${required ? "out" : "in"}-${index}`} className="text-xs text-white/70">
          {wasteCopy.portionWeight}
        </Label>
        <Input
          id={`weight-${required ? "out" : "in"}-${index}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          required={required}
          placeholder={defaultPortionWeightKg === null ? undefined : formatQty(defaultPortionWeightKg)}
          value={row.weight}
          onChange={(event) => update(setter, index, { weight: event.target.value })}
        />
      </div>
    );
  const pickProduct = (setter: typeof setInputs, index: number, productId: string) =>
    update(setter, index, { productId, weight: weightOf(productId) });

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()} title={preparation ? copy.edit : copy.add} closeLabel={copy.close} className="max-w-xl">
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="prep-name">{copy.name}</Label>
          <Input id="prep-name" value={name} maxLength={PREPARATION_NAME_MAX} required onChange={(event) => setName(event.target.value)} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs uppercase tracking-widest text-white/60">{copy.inputs}</legend>
          {inputs.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
              {productSelect(row, (productId) => pickProduct(setInputs, index, productId), copy.product)}
              <Input
                aria-label={copy.qty}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                required
                value={row.qty}
                onChange={(event) => update(setInputs, index, { qty: event.target.value })}
              />
              <Button type="button" variant="ghost" size="sm" disabled={inputs.length === 1} onClick={() => setInputs((rows) => rows.filter((_, i) => i !== index))}>
                {copy.remove}
              </Button>
              {weightField(row, setInputs, index, false)}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setInputs((rows) => [...rows, emptyRow()])}>
            {copy.addInput}
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs uppercase tracking-widest text-white/60">{copy.outputs}</legend>
          {outputs.map((row, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 rounded-[12px] border border-line p-2 sm:grid-cols-[1fr_5rem_5rem]">
              <div className="col-span-2 sm:col-span-1">{productSelect(row, (productId) => pickProduct(setOutputs, index, productId), copy.product)}</div>
              <Input
                aria-label={copy.qty}
                placeholder={copy.qty}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                required
                value={row.qty}
                onChange={(event) => update(setOutputs, index, { qty: event.target.value })}
              />
              <Input
                aria-label={copy.portions}
                placeholder={copy.portions}
                type="number"
                inputMode="numeric"
                min="0"
                step="any"
                value={row.portions}
                onChange={(event) => update(setOutputs, index, { portions: event.target.value })}
              />
              <Input
                aria-label={copy.outputName}
                placeholder={copy.outputName}
                className="col-span-2"
                value={row.name}
                onChange={(event) => update(setOutputs, index, { name: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-end"
                disabled={outputs.length === 1}
                onClick={() => setOutputs((rows) => rows.filter((_, i) => i !== index))}
              >
                {copy.remove}
              </Button>
              {weightField(row, setOutputs, index, true)}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOutputs((rows) => [...rows, emptyRow()])}>
            {copy.addOutput}
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs uppercase tracking-widest text-white/60">{wasteCopy.items}</legend>
          <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
            <Label htmlFor="prep-waste-norm">{wasteCopy.norm}</Label>
            <Input
              id="prep-waste-norm"
              type="number"
              inputMode="decimal"
              min="0"
              max={PERCENT_MAX}
              step="any"
              required={items.length === 0}
              disabled={items.length > 0}
              value={items.length > 0 ? formatQty(itemsSum) : norm}
              onChange={(event) => setNorm(event.target.value)}
            />
          </div>
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2 rounded-[12px] border border-line p-2">
              <Input
                aria-label={wasteCopy.itemName}
                placeholder={wasteCopy.itemName}
                maxLength={WASTE_ITEM_NAME_MAX}
                required
                value={item.name}
                onChange={(event) => updateItem(index, { name: event.target.value })}
              />
              <Input
                aria-label={wasteCopy.itemPercent}
                placeholder={wasteCopy.itemPercent}
                type="number"
                inputMode="decimal"
                min="0"
                max={PERCENT_MAX}
                step="any"
                required
                value={item.percent}
                onChange={(event) => updateItem(index, { percent: event.target.value })}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}>
                {copy.remove}
              </Button>
              <label className="col-span-full flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={item.usable}
                  onChange={(event) => updateItem(index, { usable: event.target.checked })}
                />
                {trimCopy.usable}
              </label>
              {item.usable && (
                <Select
                  aria-label={trimCopy.usableProduct}
                  className="col-span-full"
                  value={item.productId}
                  onChange={(event) => updateItem(index, { productId: event.target.value })}
                >
                  <option value="">{trimProducts.length === 0 ? trimCopy.noProducts : trimCopy.usableProduct}</option>
                  {trimProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          ))}
          <p className="text-xs text-white/50">
            {wasteCopy.itemsHint}
            {trimSum > 0 && ` · ${trimCopy.section}: ${formatQty(trimSum)}%`}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setItems((rows) => [...rows, { name: "", percent: "", usable: false, productId: "" }])}
          >
            {wasteCopy.addItem}
          </Button>
          <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
            <Label htmlFor="prep-evaporation">{trimCopy.evaporation}</Label>
            <Input
              id="prep-evaporation"
              type="number"
              inputMode="decimal"
              min="0"
              max={PERCENT_MAX}
              step="any"
              value={evaporation}
              onChange={(event) => setEvaporation(event.target.value)}
            />
          </div>
        </fieldset>

        {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? copy.working : copy.save}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Running a recipe
// ---------------------------------------------------------------------------
type Yield = { productId: string; qty: string; storageId: string };
type TrimRow = { productId: string; qty: string; note: string };

const yieldsFor = (preparation: Preparation, sourceQty: number): Yield[] =>
  scalePreparation(preparation, sourceQty).map((output) => ({ productId: output.productId, qty: formatQty(output.qty), storageId: "" }));

function CookDialog({
  preparation,
  start,
  locations,
  lookups,
  settings,
  balanceSettings,
  onClose,
  onPrint,
  onDone,
}: {
  preparation: Preparation;
  start: Start | null;
  locations: StorageLocation[];
  lookups: Lookups;
  settings: ExpirySettings;
  balanceSettings: PrepBalanceSettings;
  onClose: () => void;
  onPrint: (printing: Printing) => void;
  onDone: (count: number) => void;
}) {
  const { t } = useT();
  const copy = t.labels.prep;
  const source = preparation.inputs[0];
  const initialQty = start?.qty ?? source.qty;
  const [sourceQty, setSourceQty] = useState(formatQty(initialQty));
  const [fromId, setFromId] = useState(start?.fromLocationId ?? "");
  const [toId, setToId] = useState(() => {
    const from = locations.find((location) => location.id === start?.fromLocationId);
    return (from && locations.find((location) => location.branchId === from.branchId)?.id) ?? locations[0]?.id ?? "";
  });
  const [yields, setYields] = useState<Yield[]>(() => yieldsFor(preparation, initialQty));
  const [infos, setInfos] = useState<Record<string, ShelfLifeInfo>>({});
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [wasteQty, setWasteQty] = useState("");
  const [cause, setCause] = useState<PrepWasteCause>(PREP_WASTE_CAUSES[0]);
  const [causeNote, setCauseNote] = useState("");
  const [trims, setTrims] = useState<TrimRow[]>(() =>
    preparation.wastageItems
      .filter((item) => item.usable && item.productId && lookups.trimProducts.some((product) => product.id === item.productId))
      .map((item) => ({ productId: item.productId ?? "", qty: "", note: "" })),
  );
  const [serverMismatch, setServerMismatch] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const today = todayIn(settings.timezone, new Date());
  const wasteCopy = t.labels.waste;
  const trimCopy = t.labels.trim;

  const amount = (value: string): number => {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const taken = amount(sourceQty);
  const scale = source.qty > 0 ? taken / source.qty : 0;
  const massLine = (productId: string, qty: number, portions: number | null) => ({
    qty,
    unit: lookups.rawUnit(productId),
    portions,
    portionWeightKg: lookups.portionWeight(productId),
    densityKgPerL: lookups.density(productId),
  });
  const recipeInputs = preparation.inputs.map((input) => massLine(input.productId, input.qty, null));
  const recipeOutputs = preparation.outputs.map((output) => massLine(output.productId, output.qty, output.portions));
  const takenInputs = recipeInputs.map((line) => ({ ...line, qty: line.qty * scale }));
  const plan = taken > 0 ? scalePreparation(preparation, taken) : [];
  const planWaste = wasteNorm(takenInputs, preparation.wastageNormPercent, preparation.wastageItems);
  const planTrims = trimPlan(takenInputs, preparation.wastageItems);
  const planTrimQty = planTrims.reduce((total, item) => total + item.qty, 0);
  const filledTrims = trims.filter((row) => row.productId !== "" && amount(row.qty) > 0);
  const balance = calculateBalance({
    inputs: recipeInputs,
    outputs: recipeOutputs,
    trims: filledTrims.map((row) => massLine(row.productId, amount(row.qty), null)),
    normPercent: preparation.wastageNormPercent,
    trimNormPercent: preparation.trimNormPercent,
    evaporationPercent: preparation.evaporationPercent,
    scale,
    actual: yields.map((item) => amount(item.qty)),
    waste: amount(wasteQty),
    tolerance: balanceSettings,
  });
  const updateTrim = (index: number, patch: Partial<TrimRow>) => {
    setServerMismatch(false);
    setTrims((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const needsConfirm = Boolean(balance?.exceeds) || serverMismatch;
  const baseUnitLabel = (unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit);

  useEffect(() => {
    let active = true;
    void Promise.all(
      preparation.outputs.map((output) => callLabelsApi(`/api/shelf-life-rules?product_id=${encodeURIComponent(output.productId)}`, "GET")),
    ).then((outcomes) => {
      if (!active) return;
      const found: Record<string, ShelfLifeInfo> = {};
      for (const outcome of outcomes) {
        const info = outcome.ok ? parseShelfLifeInfo(outcome.data) : null;
        if (info) found[info.productId] = info;
      }
      setInfos(found);
    });
    return () => {
      active = false;
    };
  }, [preparation]);

  const changeSource = (value: string) => {
    setSourceQty(value);
    setServerMismatch(false);
    const qty = Number(value.replace(",", "."));
    if (Number.isFinite(qty) && qty > 0) setYields((current) => yieldsFor(preparation, qty).map((item, i) => ({ ...item, storageId: current[i]?.storageId ?? "" })));
  };

  const run = async (confirmLoss: boolean) => {
    setPending(true);
    setError(null);
    const waste = causeToWaste(cause, causeNote);
    const outcome = await callLabelsApi("/api/lots/from-preparation", "POST", {
      preparation_id: preparation.id,
      source_qty: sourceQty,
      storage_location_id: toId,
      source_location_id: fromId || null,
      outputs: yields.map((item) => ({ product_id: item.productId, qty: item.qty, storage_location_id: item.storageId || null })),
      wastage: amount(wasteQty) > 0 ? { qty: wasteQty, reason: waste.reason, note: waste.note } : null,
      trims: filledTrims.map((row) => ({ product_id: row.productId, qty: row.qty, note: row.note.trim() || null })),
      confirm_loss: confirmLoss,
    });
    setPending(false);
    if (!outcome.ok) {
      setServerMismatch(outcome.error === "balance_mismatch");
      setError(outcome.error);
      return;
    }
    const created = (Array.isArray(field(outcome.data, "lots")) ? (field(outcome.data, "lots") as unknown[]) : []).flatMap((row) => parseLot(row) ?? []);
    setLots(created);
    setCopies(Object.fromEntries(created.map((lot) => [lot.id, String(Math.min(lot.portions ?? 1, LABEL_COPIES_MAX))])));
  };

  const outputName = (productId: string) => preparation.outputs.find((output) => output.productId === productId)?.name ?? lookups.productName(productId);
  const lotName = (lot: Lot) => (lot.lotType === "trim" ? `${lookups.productName(lot.productId)} · ${trimCopy.lot}` : outputName(lot.productId));

  const printAll = async (created: Lot[]) => {
    const wanted = created.map((lot) => ({ lot, copies: Number(copies[lot.id] ?? 0) })).filter((item) => Number.isInteger(item.copies) && item.copies > 0);
    if (wanted.some((item) => item.copies > LABEL_COPIES_MAX)) {
      setError("invalid_input");
      return;
    }
    if (wanted.length === 0) {
      onDone(created.length);
      return;
    }
    setPending(true);
    setError(null);
    const groups = new Map<number, string[]>();
    wanted.forEach((item) => groups.set(item.copies, [...(groups.get(item.copies) ?? []), item.lot.id]));
    const outcomes = await Promise.all(
      Array.from(groups, ([count, ids]) => callLabelsApi("/api/labels/print", "POST", { lot_ids: ids, copies: count })),
    );
    setPending(false);
    const failed = outcomes.find((outcome) => !outcome.ok);
    if (failed && !failed.ok) {
      setError(failed.error);
      return;
    }
    onPrint({
      labels: wanted.map((item) => ({
        label: { lot: item.lot, productName: lotName(item.lot), storageName: lookups.locationName(item.lot.storageLocationId) },
        copies: item.copies,
      })),
      onDone: () => onDone(created.length),
    });
  };

  const sourceUnit = lookups.unit(source.productId);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()} title={copy.cookTitle(preparation.name)} closeLabel={copy.close} className="max-w-xl">
      {!lots ? (
        <div className="flex flex-col gap-4">
          <RecipeLine preparation={preparation} lookups={lookups} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cook-qty">{copy.taken(sourceUnit)}</Label>
              <Input id="cook-qty" type="number" inputMode="decimal" min="0" step="any" value={sourceQty} autoFocus onChange={(event) => changeSource(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="cook-from">{copy.from}</Label>
              <Select id="cook-from" value={fromId} onChange={(event) => setFromId(event.target.value)}>
                <option value="">{copy.fromAuto}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {lookups.locationName(location.id)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="cook-to">{copy.to}</Label>
              <Select id="cook-to" value={toId} onChange={(event) => setToId(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {lookups.locationName(location.id)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {plan.length > 0 && (
            <div className="rounded-[12px] border border-line p-3 text-sm">
              <p className="text-xs uppercase tracking-widest text-white/60">{wasteCopy.plan}</p>
              <p className="mt-1 text-white/80">
                {plan
                  .map(
                    (output) =>
                      `${outputName(output.productId)} ${formatQty(output.qty)} ${lookups.unit(output.productId)}${output.portions !== null ? ` (${t.labels.birka.portions(output.portions)})` : ""}`,
                  )
                  .join(", ")}
                {`, ${wasteCopy.planNorm(`${formatQty(planWaste.qty)} ${sourceUnit}`)}`}
                {planTrimQty > 0 && `, ${trimCopy.planTrim(`${formatQty(planTrimQty)} ${sourceUnit}`)}`}
                {preparation.evaporationPercent > 0 &&
                  `, ${trimCopy.planEvaporation(`${formatQty((taken * preparation.evaporationPercent) / PERCENT_MAX)} ${sourceUnit}`)}`}
              </p>
              {planWaste.items.length > 0 && (
                <p className="mt-1 text-xs text-white/50">{planWaste.items.map((item) => `${item.name} ${formatQty(item.qty)} ${sourceUnit}`).join(" · ")}</p>
              )}
            </div>
          )}

          <fieldset className="flex flex-col gap-2 rounded-[12px] border border-orange-400/40 p-2">
            <legend className="px-1 text-xs uppercase tracking-widest text-orange-300">{trimCopy.section}</legend>
            <p className="text-xs text-white/50">{trimCopy.hint}</p>
            {trims.map((row, index) => {
              const plannedQty = planTrims.find((item) => item.productId === row.productId)?.qty;
              return (
                <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
                  <Select aria-label={trimCopy.product} value={row.productId} onChange={(event) => updateTrim(index, { productId: event.target.value })}>
                    <option value="">{trimCopy.product}</option>
                    {lookups.trimProducts
                      .filter((product) => product.id === row.productId || !trims.some((other) => other.productId === product.id))
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                  </Select>
                  <Input
                    aria-label={trimCopy.qty(row.productId ? lookups.unit(row.productId) : sourceUnit)}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder={plannedQty === undefined ? undefined : formatQty(plannedQty)}
                    value={row.qty}
                    onChange={(event) => updateTrim(index, { qty: event.target.value })}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setTrims((rows) => rows.filter((_, i) => i !== index))}>
                    {copy.remove}
                  </Button>
                  <Input
                    aria-label={trimCopy.note}
                    placeholder={trimCopy.note}
                    className="col-span-full"
                    maxLength={WASTE_NOTE_MAX}
                    value={row.note}
                    onChange={(event) => updateTrim(index, { note: event.target.value })}
                  />
                </div>
              );
            })}
            {lookups.trimProducts.length === 0 ? (
              <p className="text-xs text-white/50">{trimCopy.noProducts}</p>
            ) : (
              trims.length < lookups.trimProducts.length && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setTrims((rows) => [...rows, { productId: "", qty: "", note: "" }])}
                >
                  {trimCopy.add}
                </Button>
              )
            )}
            {balance && (
              <p className="text-sm text-white/80">
                {trimCopy.gross}: {formatQty(balance.input)} {baseUnitLabel(balance.baseUnit)} · {trimCopy.section}: {formatQty(balance.trim)}{" "}
                {baseUnitLabel(balance.baseUnit)} ·{" "}
                <span className="font-semibold text-white">
                  {trimCopy.net}: {formatQty(balance.net)} {baseUnitLabel(balance.baseUnit)}
                </span>
              </p>
            )}
          </fieldset>

          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-widest text-white/60">{wasteCopy.fact}</p>
            {yields.map((item, index) => {
              const output = preparation.outputs.find((candidate) => candidate.productId === item.productId);
              const storage = item.storageId || toId;
              const info = infos[item.productId];
              const qty = Number(item.qty.replace(",", "."));
              const portions = output && Number.isFinite(qty) ? portionsFor(output, qty) : null;
              return (
                <div key={item.productId} className="grid grid-cols-[1fr_6rem] items-center gap-2 rounded-[12px] border border-line p-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{outputName(item.productId)}</p>
                    <p className="text-xs text-white/60">
                      {info && storage ? copy.expiry(labelDate(addDays(today, resolveShelfLife(info, storage).days))) : "…"}
                      {portions !== null && ` · ${t.labels.birka.portions(portions)}`}
                    </p>
                    {balance && (balance.outputs[index]?.estimated || balance.outputs[index]?.mass === null) && (
                      <p className="text-xs text-amber-300">
                        {wasteCopy.weightUnknown(
                          portions !== null ? t.labels.birka.portions(portions) : `${formatQty(Number.isFinite(qty) ? qty : 0)} ${lookups.unit(item.productId)}`,
                          balance.outputs[index]?.mass === null
                            ? null
                            : `${formatQty(balance.outputs[index]?.mass ?? 0)} ${baseUnitLabel(balance.baseUnit)}`,
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`${copy.qty}: ${outputName(item.productId)}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={item.qty}
                      onChange={(event) => {
                        setServerMismatch(false);
                        setYields((rows) => rows.map((row, i) => (i === index ? { ...row, qty: event.target.value } : row)));
                      }}
                    />
                    <span className="text-xs text-white/60">{lookups.unit(item.productId)}</span>
                  </div>
                  <Select
                    aria-label={`${copy.to}: ${outputName(item.productId)}`}
                    className="col-span-2"
                    value={item.storageId}
                    onChange={(event) => setYields((rows) => rows.map((row, i) => (i === index ? { ...row, storageId: event.target.value } : row)))}
                  >
                    <option value="">{lookups.locationName(toId)}</option>
                    {locations
                      .filter((location) => location.id !== toId)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {lookups.locationName(location.id)}
                        </option>
                      ))}
                  </Select>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-[12px] border border-line p-2">
            <div>
              <Label htmlFor="cook-waste">{wasteCopy.qty(sourceUnit)}</Label>
              <Input
                id="cook-waste"
                type="number"
                inputMode="decimal"
                min="0"
                max={taken || undefined}
                step="any"
                placeholder={formatQty(planWaste.qty)}
                value={wasteQty}
                onChange={(event) => {
                  setWasteQty(event.target.value);
                  setServerMismatch(false);
                }}
              />
            </div>
            <div>
              <Label htmlFor="cook-cause">{wasteCopy.cause}</Label>
              <Select id="cook-cause" value={cause} onChange={(event) => setCause(event.target.value as PrepWasteCause)}>
                {PREP_WASTE_CAUSES.map((key) => (
                  <option key={key} value={key}>
                    {wasteCopy.causes[key]}
                  </option>
                ))}
              </Select>
            </div>
            {cause === "other" && (
              <div className="col-span-2">
                <Label htmlFor="cook-cause-note">{wasteCopy.causeNote}</Label>
                <Input id="cook-cause-note" maxLength={WASTE_NOTE_MAX} value={causeNote} onChange={(event) => setCauseNote(event.target.value)} />
              </div>
            )}
          </div>

          {balance ? (
            <p
              role={needsConfirm ? "alert" : "status"}
              className={
                needsConfirm
                  ? "rounded-[12px] border border-red-500/50 bg-red-500/10 p-3 text-sm font-semibold text-red-300"
                  : "rounded-[12px] border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
              }
            >
              {(() => {
                const unit = baseUnitLabel(balance.baseUnit);
                const qty = (value: number) => `${formatQty(value)} ${unit}`;
                return (
                  <>
                    <span className="block">
                      {trimCopy.balanceParts(qty(balance.net), qty(balance.output), qty(balance.waste), balance.evaporation > 0 ? qty(balance.evaporation) : null)}
                    </span>
                    <span className="block">{(needsConfirm ? wasteCopy.balanceOff : wasteCopy.balanceOk)(qty(balance.difference))}</span>
                  </>
                );
              })()}
            </p>
          ) : (
            <p className="text-xs text-white/50">{wasteCopy.balanceUnknown}</p>
          )}

          {error && error !== "balance_mismatch" && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
          {needsConfirm ? (
            <div className="flex flex-col gap-2">
              {serverMismatch && !balance?.exceeds && <p className="text-sm text-red-300">{t.labels.errors.balance_mismatch}</p>}
              <Button variant="outline" className="border-red-400/60 text-red-300" disabled={pending || !toId} onClick={() => void run(true)}>
                {pending ? copy.working : `${wasteCopy.confirmLoss} · ${copy.ready}`}
              </Button>
            </div>
          ) : (
            <Button disabled={pending || !toId} onClick={() => void run(false)}>
              {pending ? copy.working : copy.ready}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p role="status" className="rounded-[12px] border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400">
            {copy.done(lots.length)}
          </p>
          {lots.map((lot) => (
            <div key={lot.id} className="grid grid-cols-[1fr_6rem] items-center gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{lotName(lot)}</p>
                <p className="font-mono text-xs text-white/60">{lot.lotNumber}</p>
                <p className="text-xs text-white/60">
                  {formatQty(lot.quantity)} {lookups.unit(lot.productId)} · {lookups.locationName(lot.storageLocationId)} · {copy.expiry(labelDate(lot.expiryDate))}
                </p>
              </div>
              <div>
                <Label htmlFor={`copies-${lot.id}`} className="sr-only">
                  {copy.copiesFor(lotName(lot))}
                </Label>
                <Input
                  id={`copies-${lot.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={LABEL_COPIES_MAX}
                  step="1"
                  value={copies[lot.id] ?? ""}
                  onChange={(event) => setCopies((current) => ({ ...current, [lot.id]: event.target.value }))}
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-white/50">{t.labels.receipt.copies}</p>
          {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
          <Button disabled={pending} onClick={() => void printAll(lots)}>
            {pending ? copy.working : copy.printAll}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function ExpiringCard({
  lots,
  lookups,
  settings,
  onPrint,
}: {
  lots: ExpiringLot[];
  lookups: Lookups;
  settings: ExpirySettings;
  onPrint: (printing: Printing) => void;
}) {
  const { t } = useT();
  const copy = t.labels.expiring;
  const [error, setError] = useState<LabelsErrorCode | null>(null);

  const reprint = async (id: string) => {
    setError(null);
    const outcome = await callLabelsApi("/api/labels/print", "POST", { lot_ids: [id], copies: 1 });
    const rows = outcome.ok && Array.isArray(field(outcome.data, "lots")) ? (field(outcome.data, "lots") as unknown[]) : [];
    const found = rows.flatMap((row) => parseLot(row) ?? []);
    if (!outcome.ok || found.length === 0) {
      setError(outcome.ok ? "lot_not_found" : outcome.error);
      return;
    }
    onPrint({
      labels: found.map((lot) => ({
        label: { lot, productName: lookups.productName(lot.productId), storageName: lookups.locationName(lot.storageLocationId) },
        copies: 1,
      })),
      onDone: () => undefined,
    });
  };

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{copy.title}</CardTitle>
      {lots.length === 0 ? (
        <p className="text-sm text-white/60">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {lots.map((lot) => {
            const level = getExpiryInfo(lot.expiryDate, new Date(), settings).level;
            const urgent = level === "red" || level === "expired";
            return (
              <li key={lot.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{lot.productName}</p>
                  <p className="font-mono text-xs text-white/50">{lot.lotNumber}</p>
                  <p className="text-xs text-white/60">
                    {lot.storageName} · {copy.inStock}: {formatQty(lot.inStock)} {lookups.unit(lot.productId)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge className={urgent ? "border-red-400/60 text-red-300" : "border-amber-300/60 text-amber-200"}>
                    {labelDate(lot.expiryDate)} · {copy.daysLeft(lot.daysLeft)}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => void reprint(lot.id)}>
                    {copy.reprint}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}
    </Card>
  );
}

export default function ZaqotovkaView({
  preparations,
  products,
  branches,
  locations,
  expiring,
  settings,
  balanceSettings,
  canEdit,
  start,
}: {
  preparations: Preparation[];
  products: LabelProduct[];
  branches: Branch[];
  locations: StorageLocation[];
  expiring: ExpiringLot[];
  settings: ExpirySettings;
  balanceSettings: PrepBalanceSettings;
  canEdit: boolean;
  start: Start | null;
}) {
  const { t } = useT();
  const copy = t.labels.prep;
  const router = useRouter();
  const lookups = useLookups(products, branches, locations, balanceSettings);
  const startRecipe = start ? preparations.find((preparation) => preparation.inputs[0]?.productId === start.productId) ?? null : null;
  const [cooking, setCooking] = useState<{ preparation: Preparation; start: Start | null } | null>(
    startRecipe ? { preparation: startRecipe, start } : null,
  );
  const [editing, setEditing] = useState<{ preparation: Preparation | null; initialInput: string | null } | null>(
    start && !startRecipe && canEdit ? { preparation: null, initialInput: start.productId } : null,
  );
  const [printing, setPrinting] = useState<Printing | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<LabelsErrorCode | null>(null);

  const archive = async (preparation: Preparation) => {
    if (!window.confirm(copy.confirmArchive)) return;
    setError(null);
    const outcome = await callLabelsApi(`/api/preparations/${preparation.id}`, "PATCH", { is_active: false });
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.hint}</p>
          <Link href={KITCHEN_STOCK_PATH} className="mt-2 inline-block text-sm text-beige underline underline-offset-2">
            {t.labels.stock.title} →
          </Link>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing({ preparation: null, initialInput: null })}>
            {copy.add}
          </Button>
        )}
      </div>

      {done && (
        <p role="status" className="rounded-[12px] border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400">
          {done}
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{t.labels.errors[error]}</p>}

      <ExpiringCard lots={expiring} lookups={lookups} settings={settings} onPrint={setPrinting} />

      {preparations.length === 0 ? (
        <Card>
          <p className="text-sm text-white/60">{copy.empty}</p>
          {!canEdit && <p className="mt-1 text-xs text-white/40">{copy.readOnly}</p>}
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {preparations.map((preparation) => (
            <Card key={preparation.id} id={`prep-${preparation.id}`} className="flex flex-col gap-3">
              <CardTitle>{preparation.name}</CardTitle>
              <RecipeLine preparation={preparation} lookups={lookups} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setCooking({ preparation, start: null })}>
                  {copy.cook}
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ preparation, initialInput: null })}>
                      {copy.edit}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void archive(preparation)}>
                      {copy.archive}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <RecipeEditor
          preparation={editing.preparation}
          initialInput={editing.initialInput}
          products={products}
          defaultPortionWeightKg={balanceSettings.defaultPortionWeightKg}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {cooking && (
        <CookDialog
          preparation={cooking.preparation}
          start={cooking.start}
          locations={locations}
          lookups={lookups}
          settings={settings}
          balanceSettings={balanceSettings}
          onClose={() => setCooking(null)}
          onPrint={setPrinting}
          onDone={(count) => {
            setCooking(null);
            setPrinting(null);
            setDone(copy.done(count));
            router.refresh();
          }}
        />
      )}

      {printing && (
        <BirkaPrintSheet
          labels={printing.labels}
          settings={settings}
          onDone={() => {
            const finish = printing.onDone;
            setPrinting(null);
            finish();
          }}
        />
      )}
    </div>
  );
}
