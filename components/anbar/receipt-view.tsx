"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import ReceiptWhereDialog from "@/components/labels/receipt-where-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { lookupCodeAction } from "@/lib/anbar/actions";
import { convertPrice, currencyName, type Currency } from "@/lib/currency/model";
import { formatRate, type CurrencyInfo } from "@/lib/money";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type CatalogProduct, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH, ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { Lot } from "@/lib/labels/model";
import type { ExpirySettings } from "@/lib/tenant-settings/parse";
import ActionMessage from "./action-message";
import BarcodeProductForm from "./barcode-product-form";
import BarcodeScanner from "./barcode-scanner";

/** The restaurant's currency and the ones a supplier may invoice in. */
export type ReceiptMoney = { base: CurrencyInfo; currencies: Currency[] };

type Step =
  | { kind: "scan" }
  | { kind: "create"; code: string }
  | { kind: "receive"; product: CatalogProduct };

/** Quantity and price; "Qəbul et" asks where the goods go, then receipt and lot are saved together. */
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
  product: CatalogProduct;
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
  const fxCopy = t.labels.currency;
  const [entered, setEntered] = useState<{ qty: number; price: number | null; fxRate: number | null } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [currency, setCurrency] = useState(money.base.code);
  const [price, setPrice] = useState(product.pricePerUnit === null ? "" : String(product.pricePerUnit));
  const [rate, setRate] = useState("");
  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;
  const foreign = money.currencies.find((item) => item.code === currency && item.code !== money.base.code) ?? null;
  const number = (raw: string) => (raw.trim() === "" ? null : Number(raw.trim().replace(",", ".")));
  const priceValue = number(price);
  const rateValue = number(rate);
  const preview =
    foreign && priceValue !== null && rateValue !== null && Number.isFinite(priceValue) && Number.isFinite(rateValue) && rateValue > 0
      ? fxCopy.converted(formatRate(priceValue, foreign), formatRate(convertPrice(priceValue, rateValue), money.base))
      : null;

  if (locations.length === 0) {
    return <p className="text-sm text-white/70">{copy.noLocations}</p>;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const qty = Number(String(data.get("qty") ?? "").replace(",", "."));
    const amount = priceValue;
    const fxRate = foreign ? rateValue : null;
    const ok =
      Number.isFinite(qty) &&
      qty > 0 &&
      (amount === null || (Number.isFinite(amount) && amount >= 0)) &&
      (!foreign || (amount !== null && fxRate !== null && Number.isFinite(fxRate) && fxRate > 0));
    setInvalid(!ok);
    if (ok) setEntered({ qty, price: amount, fxRate });
  };

  return (
    <>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <p className="font-serif text-lg font-bold">{product.name}</p>
          <p className="text-xs text-white/50">{product.barcode ?? product.internalCode}</p>
        </div>
        <div>
          <Label htmlFor="receipt-qty">
            {copy.qty} ({unit})
          </Label>
          <Input
            id="receipt-qty"
            name="qty"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="receipt-price">{copy.price}</Label>
          <Input
            id="receipt-price"
            name="pricePerUnit"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
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
                <Input
                  id="receipt-rate"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  required
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
              </div>
            )}
            {preview && <p className="col-span-2 text-xs text-amber-200">{preview}</p>}
          </div>
        )}
        <div className="col-span-2">{invalid && <ActionMessage result={{ ok: false, error: "invalidQty" }} />}</div>
        <div className="col-span-2 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t.anbar.addProduct.cancel}
          </Button>
          <Button type="submit">{t.labels.receipt.next}</Button>
        </div>
      </form>
      {entered && (
        <ReceiptWhereDialog
          product={product}
          qty={entered.qty}
          price={entered.price}
          currency={foreign ? foreign.code : null}
          fxRate={entered.fxRate}
          branches={branches}
          locations={locations}
          settings={settings}
          role={role}
          onClose={() => setEntered(null)}
          onDone={onDone}
        />
      )}
    </>
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
  const [step, setStep] = useState<Step>({ kind: "scan" });
  const [code, setCode] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<AnbarErrorCode | null>(null);
  const [looking, startLookup] = useTransition();
  const initialLookup = useRef(false);

  const lookup = (raw: string) => {
    setError(null);
    setDone(null);
    startLookup(async () => {
      const found = await lookupCodeAction(raw);
      if (!found.ok) {
        setError(found.error);
        return;
      }
      setCode("");
      setStep(found.product ? { kind: "receive", product: found.product } : { kind: "create", code: found.code });
    });
  };

  useEffect(() => {
    if (initialCode && !initialLookup.current) {
      initialLookup.current = true;
      lookup(initialCode);
    }
  });

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
        {step.kind === "scan" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-white/70">{copy.hint}</p>
            <BarcodeScanner onScan={lookup} disabled={looking} className="w-full py-4 text-base" />
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.trim()) lookup(code);
              }}
            >
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={BARCODE_MAX_LENGTH}
                placeholder={t.anbar.searchPlaceholder}
                aria-label={t.anbar.searchLabel}
                autoComplete="off"
              />
              <Button type="submit" disabled={looking}>
                {looking ? t.anbar.working : t.anbar.searchButton}
              </Button>
            </form>
            {error && <ActionMessage result={{ ok: false, error }} />}
          </div>
        )}

        {step.kind === "create" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-white/70">{t.anbar.barcode.notFound(step.code)}</p>
            <BarcodeProductForm
              code={step.code}
              branches={branches}
              defaultBranchId={null}
              onCancel={() => setStep({ kind: "scan" })}
              onCreated={(product) => setStep({ kind: "receive", product })}
            />
          </div>
        )}

        {step.kind === "receive" && (
          <ReceiptForm
            product={step.product}
            branches={branches}
            locations={locations}
            settings={settings}
            role={role}
            money={money}
            onCancel={() => setStep({ kind: "scan" })}
            onDone={(lot) => {
              setDone(`${step.product.name} · ${lot.lotNumber}`);
              setStep({ kind: "scan" });
              router.refresh();
            }}
          />
        )}
      </Card>
    </div>
  );
}
