"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { lookupCodeAction, receiveStockAction } from "@/lib/anbar/actions";
import { receiptExpiryDefault } from "@/lib/anbar/catalog-status";
import { BARCODE_MAX_LENGTH } from "@/lib/anbar/constants";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type CatalogProduct, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import ActionMessage from "./action-message";
import BarcodeProductForm from "./barcode-product-form";
import BarcodeScanner from "./barcode-scanner";
import { useAction } from "./use-action";

type Step =
  | { kind: "scan" }
  | { kind: "create"; code: string }
  | { kind: "receive"; product: CatalogProduct };

function ReceiptForm({
  product,
  branches,
  locations,
  onDone,
  onCancel,
}: {
  product: CatalogProduct;
  branches: Branch[];
  locations: StorageLocation[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.qebul;
  const { pending, result, onSubmit } = useAction(receiveStockAction, { onSuccess: onDone });
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const ordered = [...locations].sort((a, b) => {
    const first = a.branchId === product.branchId ? 0 : 1;
    const second = b.branchId === product.branchId ? 0 : 1;
    return first - second;
  });
  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;

  if (locations.length === 0) {
    return <p className="text-sm text-white/70">{copy.noLocations}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
      <input type="hidden" name="productId" value={product.id} />
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
          defaultValue={product.pricePerUnit ?? ""}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor="receipt-expiry">{copy.expiry}</Label>
        <Input
          id="receipt-expiry"
          name="expiryDate"
          type="date"
          defaultValue={receiptExpiryDefault(product, new Date()) ?? ""}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor="receipt-location">{copy.location}</Label>
        <Select id="receipt-location" name="locationId" required defaultValue={ordered[0]?.id ?? ""}>
          {ordered.map((location) => {
            const branch = location.branchId ? branchName.get(location.branchId) : null;
            return (
              <option key={location.id} value={location.id}>
                {branch ? `${branch} · ${location.name}` : location.name}
              </option>
            );
          })}
        </Select>
      </div>
      <div className="col-span-2">
        <ActionMessage result={result} />
      </div>
      <div className="col-span-2 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t.anbar.addProduct.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.anbar.working : copy.submit}
        </Button>
      </div>
    </form>
  );
}

export default function ReceiptView({
  branches,
  locations,
  initialCode,
}: {
  branches: Branch[];
  locations: StorageLocation[];
  initialCode: string | null;
}) {
  const { t } = useT();
  const copy = t.anbar.qebul;
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
        <Link href={ANBAR_CATALOG_PATH} className={buttonVariants("outline", "sm")}>
          {t.anbar.catalog.title}
        </Link>
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
            onCancel={() => setStep({ kind: "scan" })}
            onDone={() => {
              setDone(step.product.name);
              setStep({ kind: "scan" });
            }}
          />
        )}
      </Card>
    </div>
  );
}
