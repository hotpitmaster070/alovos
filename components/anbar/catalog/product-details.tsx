"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { updateExpiryAction } from "@/lib/anbar/actions";
import { expiryStatus, isLowStock } from "@/lib/anbar/catalog-status";
import { isUnit, type CatalogLine, type CatalogProduct, type StorageLocation } from "@/lib/anbar/types";
import { EXPIRY_MAX_YEARS, addCalendarYears, validateExpiryInput } from "@/lib/anbar/validation";
import { ANBAR_RECEIPT_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { currencyOf, formatMoney } from "@/lib/money";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import { daysBetween, todayIn } from "@/lib/tenant-settings/time";
import { useAction } from "../use-action";
import { useExpiryLabel } from "./expiry-label";
import ProductEconomics from "./product-economics";
import ProductStorageNorms from "./product-storage-norms";
import {
  ErrorText,
  LightInput,
  PRIMARY_BUTTON,
  ProductImage,
  SECONDARY_BUTTON,
  StatusDot,
} from "./primitives";

type Stock = { stock: number; nearestExpiry: string | null; value: number };

const EXPIRY_MISMATCH_DAYS = 3;

function dayGap(left: string, right: string): number | null {
  const delta = daysBetween(left, right);
  return delta === null ? null : Math.abs(delta);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[15px] text-white/60">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-[15px] text-white">{children}</span>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-[16px] border border-line bg-bg">{children}</div>;
}

/** What the phone shows after a scan: photo, stock, expiry, codes, and the next actions. */
export default function ProductDetails({
  product,
  stock,
  settings,
  now,
  branchId,
  locations,
  onSaved,
}: {
  product: CatalogProduct;
  stock: Stock | null;
  settings: TenantSettings;
  now: Date;
  branchId: string | null;
  /** Storage places of all branches; the norms show those of the product's branch. */
  locations: StorageLocation[];
  onSaved: (line: CatalogLine | null) => void;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const shelf = t.anbar.shelf;
  const expiryLabel = useExpiryLabel();
  const today = todayIn(settings.timezone, now);
  const latest = addCalendarYears(today, EXPIRY_MAX_YEARS);
  const [notice, setNotice] = useState<number | null>(null);
  const [expiry, setExpiry] = useState(product.expiryDate ?? stock?.nearestExpiry ?? "");
  const { pending, result, onSubmit } = useAction(updateExpiryAction, {
    resetOnSuccess: false,
    validate: (data) => {
      const parsed = validateExpiryInput(data, today);
      return parsed.ok ? null : parsed.error;
    },
    onSuccess: (saved) => {
      setNotice(saved.lotsUpdated);
      if (saved.line) setExpiry(saved.line.expiryDate ?? saved.line.nearestExpiry ?? "");
      onSaved(saved.line);
    },
  });

  useEffect(() => {
    setExpiry(product.expiryDate ?? stock?.nearestExpiry ?? "");
  }, [product.id, product.expiryDate, stock?.nearestExpiry]);

  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;
  const qty = stock?.stock ?? 0;
  const productExpiry = product.expiryDate;
  const lotExpiry = stock?.nearestExpiry ?? null;
  const mismatch = productExpiry !== null && lotExpiry !== null && (dayGap(productExpiry, lotExpiry) ?? 0) > EXPIRY_MISMATCH_DAYS;
  const status = expiryStatus(productExpiry, now, settings);
  const currency = currencyOf(settings);
  const normBranch = product.branchId ?? branchId;
  const normLocations = locations.filter((location) => location.active && location.branchId === normBranch);
  const receiveHref = `${ANBAR_RECEIPT_PATH}?code=${encodeURIComponent(product.barcode ?? product.internalCode)}`;

  return (
    <div className="flex flex-col gap-5">
      {product.photoUrl && (
        <ProductImage url={product.photoUrl} name={product.name} className="aspect-[4/3] w-full rounded-[20px]" />
      )}

      <Group>
        <Row label={copy.stock}>
          <span className="font-medium">
            {qty} {unit}
          </span>
          {isLowStock(qty, product.minStock, settings) && <span className="text-white/60">· {shelf.lowStock}</span>}
        </Row>
        <Row label={copy.value}>{formatMoney(stock?.value ?? 0, currency)}</Row>
        <Row label={t.anbar.fields.expiry}>
          {status.dot && <StatusDot dot={status.dot} label={expiryLabel(status)} />}
          <span className="truncate">{productExpiry ? `${productExpiry} · ${expiryLabel(status)}` : shelf.noExpiry}</span>
        </Row>
        {lotExpiry && (
          <div className={mismatch ? "px-4 py-3 text-[13px] text-amber-300" : "px-4 py-3 text-[13px] text-white/50"}>
            <p>{copy.nearestLotExpiry(lotExpiry)}</p>
            {mismatch && <p className="mt-1">{copy.expiryMismatch}</p>}
          </div>
        )}
        {product.shelfLifeDays !== null && (
          <Row label={shelf.shelfLifeDays}>{shelf.days(product.shelfLifeDays)}</Row>
        )}
        {product.minStock !== null && (
          <Row label={shelf.minStock}>
            {product.minStock} {unit}
          </Row>
        )}
        {product.pricePerUnit !== null && (
          <Row label={copy.price}>{formatMoney(product.pricePerUnit, currency)}</Row>
        )}
      </Group>

      <Group>
        <Row label={t.anbar.fields.barcode}>
          <span className="truncate font-mono text-[14px]">{product.barcode ?? t.anbar.fields.noBarcode}</span>
        </Row>
        <Row label={copy.internalCode}>
          <span className="truncate font-mono text-[14px]">{product.internalCode}</span>
        </Row>
      </Group>

      <ProductEconomics productId={product.id} />

      <ProductStorageNorms productId={product.id} locations={normLocations} />

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="branchId" value={branchId ?? ""} />
        <label htmlFor="sheet-expiry" className="text-[13px] text-white/60">
          {copy.updateExpiry}
        </label>
        <div className="flex gap-2">
          <LightInput
            id="sheet-expiry"
            name="expiryDate"
            type="date"
            min={today}
            max={latest ?? undefined}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className="flex-1"
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {pending ? t.anbar.working : copy.save}
          </button>
        </div>
        {notice !== null && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-[12px] border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[13px] text-emerald-300">
            <span>{copy.expiryUpdated(notice)}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline-offset-2 hover:underline">
              {copy.close}
            </button>
          </div>
        )}
        {result && !result.ok && <ErrorText>{t.anbar.errors[result.error]}</ErrorText>}
      </form>

      <Link href={receiveHref} className={PRIMARY_BUTTON}>
        {copy.receive}
      </Link>
    </div>
  );
}
