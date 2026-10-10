"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { BirkaPrintSheet, type BirkaLabel } from "@/components/labels/birka-print";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { searchReceiptProductsAction } from "@/lib/anbar/actions";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type ReceiptProduct, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH, ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { convertPrice, currencyName, type Currency } from "@/lib/currency/model";
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
import { formatRate, type CurrencyInfo } from "@/lib/money";
import type { ExpirySettings } from "@/lib/tenant-settings/parse";
import { addDays, daysBetween, todayIn } from "@/lib/tenant-settings/time";
import ActionMessage from "./action-message";
import BarcodeProductForm from "./barcode-product-form";
import BarcodeScanner from "./barcode-scanner";

/** The restaurant's currency and the ones a supplier may invoice in. */
export type ReceiptMoney = { base: CurrencyInfo; currencies: Currency[] };

type Step =
  | { kind: "search" }
  | { kind: "results"; query: string; products: ReceiptProduct[] }
  | { kind: "create"; code: string | null }
  | { kind: "receive"; product: ReceiptProduct };

const decimal = (raw: string): number | null => {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

const wholeNumber = (value: string, max: number): number | null =>
  /^\d+$/.test(value.trim()) && Number(value) <= max ? Number(value) : null;

/**
 * Quantity, price, use-by date and place for one product. "Qəbul et" saves the 'prihod' movement and
 * the lot (LOT-YYYYMMDD-NNNN from the database) in one transaction, then prints the labels.
 */
function ReceiptForm({
  product,
  branches,
  locations,
  settings,
  role,
  money,
  onDone,
  onCancel,
}: {
  product: ReceiptProduct;
  branches: Branch[];
  locations: StorageLocation[];
  settings: ExpirySettings;
  role: string | null;
  money: ReceiptMoney;
  onDone: (lot: Lot) => void;
  onCancel: () => void;
}) {
  const { lang, t } = useT();
  const copy = t.anbar.qebul;
  const receiptCopy = t.labels.receipt;
  const fxCopy = t.labels.currency;
  const router = useRouter();

  const ordered = [...locations].sort(
    (a, b) => (a.branchId === product.branchId ? 0 : 1) - (b.branchId === product.branchId ? 0 : 1),
  );
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const showBranch = new Set(locations.map((location) => location.branchId)).size > 1;
  const locationLabel = (location: StorageLocation) => {
    const branch = showBranch ? branchName.get(location.branchId) : null;
    return branch ? `${branch} · ${location.name}` : location.name;
  };

  const defaultPrice = product.lastLotPrice ?? product.pricePerUnit;
  const [today] = useState(() => todayIn(settings.timezone, new Date()));
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(defaultPrice === null ? "" : String(defaultPrice));
  const [currency, setCurrency] = useState(money.base.code);
  const [rate, setRate] = useState("");
  const [locationId, setLocationId] = useState(
    ordered.find((location) => location.id === product.storageLocationId)?.id ?? ordered[0]?.id ?? "",
  );
  const [info, setInfo] = useState<ShelfLifeInfo | null>(null);
  const [expiry, setExpiry] = useState("");
  const [expiryEdited, setExpiryEdited] = useState(false);
  const [remember, setRemember] = useState(false);
  const [copies, setCopies] = useState("1");
  const [invalid, setInvalid] = useState<"qty" | "expiry" | null>(null);
  const [error, setError] = useState<LabelsErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [printing, setPrinting] = useState<{ lot: Lot; label: BirkaLabel; copies: number } | null>(null);

  useEffect(() => {
    let active = true;
    void callLabelsApi(`/api/shelf-life-rules?product_id=${encodeURIComponent(product.id)}`, "GET").then((outcome) => {
      if (!active) return;
      const parsed = outcome.ok ? parseShelfLifeInfo(outcome.data) : null;
      if (parsed) setInfo(parsed);
      else setError(outcome.ok ? "save_failed" : outcome.error);
    });
    return () => {
      active = false;
    };
  }, [product.id]);

  const norm = info && locationId ? resolveShelfLife(info, locationId) : null;
  const normDays = norm?.days ?? null;
  useEffect(() => {
    if (normDays !== null && !expiryEdited) setExpiry(addDays(today, normDays));
  }, [normDays, expiryEdited, today]);

  if (ordered.length === 0) {
    return <p className="text-sm text-white/70">{copy.noLocations}</p>;
  }

  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;
  const foreign = money.currencies.find((item) => item.code === currency && item.code !== money.base.code) ?? null;
  const priceValue = decimal(price);
  const rateValue = decimal(rate);
  const preview =
    foreign && priceValue !== null && rateValue !== null && rateValue > 0
      ? fxCopy.converted(formatRate(priceValue, foreign), formatRate(convertPrice(priceValue, rateValue), money.base))
      : null;
  const priceSource =
    product.lastLotPrice !== null ? copy.priceSource.lot : product.pricePerUnit !== null ? copy.priceSource.product : null;
  const shelfDays = expiry ? daysBetween(today, expiry) : null;
  const changed = norm !== null && shelfDays !== null && shelfDays !== norm.days;
  const location = ordered.find((item) => item.id === locationId) ?? null;

  /** The lot for the form, or null with the reason shown. */
  const receive = async (): Promise<Lot | null> => {
    const amount = decimal(qty);
    if (amount === null || amount <= 0 || (priceValue !== null && priceValue < 0)) {
      setInvalid("qty");
      return null;
    }
    if (foreign && (priceValue === null || rateValue === null || rateValue <= 0)) {
      setInvalid("qty");
      return null;
    }
    if (shelfDays === null || shelfDays < 0 || shelfDays > SHELF_LIFE_DAYS_MAX) {
      setInvalid("expiry");
      return null;
    }
    setInvalid(null);
    setError(null);
    const outcome = await callLabelsApi("/api/lots/receive", "POST", {
      product_id: product.id,
      qty: amount,
      storage_location_id: locationId,
      price: priceValue,
      currency: foreign ? foreign.code : null,
      fx_rate: foreign ? rateValue : null,
      production_date: today,
      shelf_life_days: shelfDays,
      remember: changed && remember && canSetShelfLife(role),
    });
    const lot = outcome.ok ? parseLot(field(outcome.data, "lot")) : null;
    if (!lot) setError(outcome.ok ? "save_failed" : outcome.error);
    return lot;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const copyCount = wholeNumber(copies, LABEL_COPIES_MAX);
    if (copyCount === null || !location) {
      setError("invalid_input");
      return;
    }
    setPending(true);
    const lot = await receive();
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
    setPrinting({ lot, label: { lot, productName: product.name, storageName: locationLabel(location) }, copies: copyCount });
  };

  const receiveForPrep = async () => {
    setPending(true);
    const lot = await receive();
    setPending(false);
    if (!lot) return;
    const params = new URLSearchParams({ product: product.id, from: locationId, qty: String(lot.quantity) });
    router.push(`${ZAQOTOVKA_PATH}?${params.toString()}`);
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid grid-cols-2 gap-4">
      <div className="col-span-2 flex flex-wrap items-start justify-between gap-2 rounded-[12px] border border-line p-3">
        <div>
          <p className="font-serif text-lg font-bold">{product.name}</p>
          <p className="text-xs text-white/50">
            {[product.internalCode, product.barcode, product.category, unit].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          {copy.other}
        </Button>
      </div>

      <div>
        <Label htmlFor="receipt-qty">
          {copy.qty} ({unit})
        </Label>
        <Input
          id="receipt-qty"
          inputMode="decimal"
          required
          autoFocus
          value={qty}
          onChange={(event) => setQty(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="receipt-price">{copy.price}</Label>
        <Input id="receipt-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        {priceSource && price === String(defaultPrice) && <p className="mt-1 text-xs text-white/45">{priceSource}</p>}
      </div>

      {money.currencies.length > 1 && (
        <div className="col-span-2 grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="receipt-currency">{fxCopy.receipt}</Label>
            <Select id="receipt-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {money.currencies.map((item) => (
                <option key={item.code} value={item.code}>
                  {currencyName(item, lang)}
                </option>
              ))}
            </Select>
          </div>
          {foreign && (
            <div>
              <Label htmlFor="receipt-rate">{fxCopy.fxRate(foreign.code, money.base.code)}</Label>
              <Input id="receipt-rate" inputMode="decimal" required value={rate} onChange={(event) => setRate(event.target.value)} />
            </div>
          )}
          {preview && <p className="col-span-2 text-xs text-amber-200">{preview}</p>}
        </div>
      )}

      <div>
        <Label htmlFor="receipt-location">{copy.location}</Label>
        <Select id="receipt-location" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          {ordered.map((item) => (
            <option key={item.id} value={item.id}>
              {locationLabel(item)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="receipt-expiry">{copy.expiry}</Label>
        <Input
          id="receipt-expiry"
          type="date"
          required
          min={today}
          max={addDays(today, SHELF_LIFE_DAYS_MAX)}
          value={expiry}
          disabled={!info}
          onChange={(event) => {
            setExpiryEdited(true);
            setExpiry(event.target.value);
          }}
        />
        {shelfDays !== null && shelfDays >= 0 && (
          <p className="mt-1 text-xs text-white/45">
            {copy.expiryHint(shelfDays)}
            {norm && !changed && ` · ${receiptCopy.source[norm.source]}`}
          </p>
        )}
      </div>

      {changed && canSetShelfLife(role) && (
        <label className="col-span-2 flex items-center gap-2 text-sm text-white/80">
          <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          {receiptCopy.remember}
        </label>
      )}

      <div>
        <Label htmlFor="receipt-copies">{receiptCopy.copies}</Label>
        <Input
          id="receipt-copies"
          type="number"
          inputMode="numeric"
          min="0"
          max={LABEL_COPIES_MAX}
          step="1"
          value={copies}
          onChange={(event) => setCopies(event.target.value)}
        />
      </div>

      <div className="col-span-2">
        {invalid === "qty" && <ActionMessage result={{ ok: false, error: "invalidQty" }} />}
        {invalid === "expiry" && (
          <p role="alert" className="text-sm text-red-400">
            {copy.expiryPast}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {t.labels.errors[error]}
          </p>
        )}
      </div>

      <div className="col-span-2 flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" disabled={pending || !info} onClick={() => void receiveForPrep()}>
          {receiptCopy.prep}
        </Button>
        <Button type="submit" disabled={pending || !info || !location}>
          {pending ? receiptCopy.working : copy.submit}
        </Button>
      </div>

      {printing && (
        <BirkaPrintSheet
          labels={[{ label: printing.label, copies: printing.copies }]}
          settings={settings}
          onDone={() => onDone(printing.lot)}
        />
      )}
    </form>
  );
}

export default function ReceiptView({
  branches,
  locations,
  initialCode,
  settings,
  role,
  money,
}: {
  branches: Branch[];
  locations: StorageLocation[];
  initialCode: string | null;
  settings: ExpirySettings;
  role: string | null;
  money: ReceiptMoney;
}) {
  const { t } = useT();
  const copy = t.anbar.qebul;
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<AnbarErrorCode | null>(null);
  const [looking, startLookup] = useTransition();
  const initialLookup = useRef(false);

  /** scanned: a code from the camera; a miss then offers a new product with that barcode. */
  const search = (raw: string, scanned: boolean) => {
    setError(null);
    setDone(null);
    startLookup(async () => {
      const found = await searchReceiptProductsAction(raw);
      if (!found.ok) {
        setError(found.error);
        return;
      }
      setText("");
      if (found.products.length === 1 && (found.exact || !scanned)) {
        setStep({ kind: "receive", product: found.products[0] });
      } else if (found.products.length === 0 && scanned) {
        setStep({ kind: "create", code: found.query });
      } else {
        setStep({ kind: "results", query: found.query, products: found.products });
      }
    });
  };

  useEffect(() => {
    if (initialCode && !initialLookup.current) {
      initialLookup.current = true;
      search(initialCode, true);
    }
  });

  const searchForm = (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) search(text, false);
      }}
    >
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={BARCODE_MAX_LENGTH}
        placeholder={copy.searchPlaceholder}
        aria-label={copy.searchLabel}
        autoComplete="off"
        autoFocus
      />
      <Button type="submit" disabled={looking}>
        {looking ? t.anbar.working : copy.find}
      </Button>
    </form>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={ZAQOTOVKA_PATH} className={buttonVariants("outline", "sm")}>
            {t.labels.prep.nav}
          </Link>
          <Link href={ANBAR_CATALOG_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.catalog.title}
          </Link>
        </div>
      </div>

      {done && (
        <p role="status" className="rounded-[12px] border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-400">
          {copy.done(done)}
        </p>
      )}

      <Card>
        {(step.kind === "search" || step.kind === "results") && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-white/70">{copy.hint}</p>
            {searchForm}
            <BarcodeScanner onScan={(code) => search(code, true)} disabled={looking} className="w-full py-4 text-base" />
            {error && <ActionMessage result={{ ok: false, error }} />}
          </div>
        )}

        {step.kind === "results" && (
          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            {step.products.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white/70">{copy.notFound(step.query)}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep({ kind: "create", code: null })}>
                  {copy.createProduct}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-xs text-white/50">{copy.results(step.products.length)}</p>
                <ul className="flex flex-col gap-2">
                  {step.products.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3 text-left transition hover:border-beige"
                        onClick={() => setStep({ kind: "receive", product })}
                      >
                        <span className="font-medium">{product.name}</span>
                        <span className="text-xs text-white/50">
                          {[product.internalCode, product.category].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {step.kind === "create" && (
          <div className="flex flex-col gap-4">
            {step.code && <p className="text-sm text-white/70">{t.anbar.barcode.notFound(step.code)}</p>}
            <BarcodeProductForm
              code={step.code}
              branches={branches}
              defaultBranchId={null}
              onCancel={() => setStep({ kind: "search" })}
              onCreated={(product) => setStep({ kind: "receive", product: { ...product, lastLotPrice: null } })}
            />
          </div>
        )}

        {step.kind === "receive" && (
          <ReceiptForm
            key={step.product.id}
            product={step.product}
            branches={branches}
            locations={locations}
            settings={settings}
            role={role}
            money={money}
            onCancel={() => setStep({ kind: "search" })}
            onDone={(lot) => {
              setDone(`${step.product.name} · ${lot.lotNumber}`);
              setStep({ kind: "search" });
              router.refresh();
            }}
          />
        )}
      </Card>
    </div>
  );
}
