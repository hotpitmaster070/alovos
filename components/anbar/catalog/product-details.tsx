"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { updateExpiryAction } from "@/lib/anbar/actions";
import { expiryStatus, isLowStock } from "@/lib/anbar/catalog-status";
import { isUnit, type CatalogProduct } from "@/lib/anbar/types";
import { ANBAR_RECEIPT_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { formatMoney } from "@/lib/money";
import { useAction } from "../use-action";
import { useExpiryLabel } from "./expiry-label";
import {
  ErrorText,
  LightInput,
  PRIMARY_BUTTON,
  ProductImage,
  SECONDARY_BUTTON,
  StatusDot,
} from "./primitives";

type Stock = { stock: number; nearestExpiry: string | null; value: number };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[15px] text-neutral-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-[15px] text-neutral-900">{children}</span>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-black/[0.06] rounded-[16px] bg-[#F5F5F7]">{children}</div>;
}

/** What the phone shows after a scan: photo, stock, expiry, codes, and the next actions. */
export default function ProductDetails({
  product,
  stock,
  currencySymbol,
  now,
  onSaved,
}: {
  product: CatalogProduct;
  stock: Stock | null;
  currencySymbol: string | null;
  now: Date;
  onSaved: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const shelf = t.anbar.shelf;
  const expiryLabel = useExpiryLabel();
  const { pending, result, onSubmit } = useAction(updateExpiryAction, { onSuccess: onSaved });

  const unit = isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit;
  const qty = stock?.stock ?? 0;
  const expiryDate = stock?.nearestExpiry ?? product.expiryDate;
  const status = expiryStatus(expiryDate, now);
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
          {isLowStock(qty, product.minStock) && <span className="text-neutral-500">· {shelf.lowStock}</span>}
        </Row>
        <Row label={copy.value}>{formatMoney(stock?.value ?? 0, currencySymbol)}</Row>
        <Row label={t.anbar.fields.expiry}>
          {status.dot && <StatusDot dot={status.dot} label={expiryLabel(status)} />}
          <span className="truncate">{expiryDate ? `${expiryDate} · ${expiryLabel(status)}` : shelf.noExpiry}</span>
        </Row>
        {product.shelfLifeDays !== null && (
          <Row label={shelf.shelfLifeDays}>{shelf.days(product.shelfLifeDays)}</Row>
        )}
        {product.minStock !== null && (
          <Row label={shelf.minStock}>
            {product.minStock} {unit}
          </Row>
        )}
        {product.pricePerUnit !== null && (
          <Row label={copy.price}>{formatMoney(product.pricePerUnit, currencySymbol)}</Row>
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

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input type="hidden" name="productId" value={product.id} />
        <label htmlFor="sheet-expiry" className="text-[13px] text-neutral-500">
          {copy.updateExpiry}
        </label>
        <div className="flex gap-2">
          <LightInput
            id="sheet-expiry"
            name="expiryDate"
            type="date"
            defaultValue={product.expiryDate ?? ""}
            className="flex-1"
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {pending ? t.anbar.working : copy.save}
          </button>
        </div>
        {result && !result.ok && <ErrorText>{t.anbar.errors[result.error]}</ErrorText>}
      </form>

      <Link href={receiveHref} className={PRIMARY_BUTTON}>
        {copy.receive}
      </Link>
    </div>
  );
}
