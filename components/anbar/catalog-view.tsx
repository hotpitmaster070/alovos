"use client";

import { ImageOff, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { lookupCodeAction, updateExpiryAction } from "@/lib/anbar/actions";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type CatalogLine, type CatalogProduct } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, ANBAR_RECEIPT_PATH } from "@/lib/auth-redirect";
import { getExpiryInfo } from "@/lib/expiry";
import { useT } from "@/lib/i18n/useT";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import ActionMessage from "./action-message";
import BarcodeProductForm from "./barcode-product-form";
import BarcodeScanner from "./barcode-scanner";
import { useAction } from "./use-action";

const EXPIRY_ALERT_DAYS = 3;

type Panel =
  | { kind: "found"; product: CatalogProduct }
  | { kind: "create"; code: string | null }
  | null;

function useUnitLabel() {
  const { t } = useT();
  return (unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit);
}

function ExpiryText({ date, now }: { date: string | null; now: Date }) {
  const { t } = useT();
  if (!date) return <span className="text-white/40">{t.anbar.fields.noExpiry}</span>;
  const { daysLeft } = getExpiryInfo(date, now);
  const alert = daysLeft !== null && daysLeft < EXPIRY_ALERT_DAYS;
  return <span className={cn(alert ? "font-semibold text-red-400" : "text-white/70")}>{date}</span>;
}

function FoundProduct({
  product,
  onClose,
  onSaved,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const unitLabel = useUnitLabel();
  const { pending, result, onSubmit } = useAction(updateExpiryAction, { onSuccess: onSaved });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <ProductPhoto url={product.photoUrl} name={product.name} />
        <div className="min-w-0">
          <p className="font-serif text-lg font-bold">{product.name}</p>
          <p className="text-xs text-white/60">
            {copy.internalCode}: {product.internalCode}
          </p>
          <p className="text-xs text-white/60">
            {t.anbar.fields.barcode}: {product.barcode ?? t.anbar.fields.noBarcode}
          </p>
          <p className="text-xs text-white/60">
            {copy.unit}: {unitLabel(product.unit)}
            {product.pricePerUnit !== null ? ` · ${copy.price}: ${product.pricePerUnit}` : ""}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <input type="hidden" name="productId" value={product.id} />
        <div className="flex-1">
          <Label htmlFor="found-expiry">{copy.updateExpiry}</Label>
          <Input id="found-expiry" name="expiryDate" type="date" defaultValue={product.expiryDate ?? ""} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t.anbar.working : copy.save}
        </Button>
      </form>
      <ActionMessage result={result} />

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          {copy.close}
        </Button>
        <Link
          href={`${ANBAR_RECEIPT_PATH}?code=${encodeURIComponent(product.barcode ?? product.internalCode)}`}
          className={buttonVariants("default")}
        >
          {copy.receive}
        </Link>
      </div>
    </div>
  );
}

function ProductPhoto({ url, name }: { url: string | null; name: string }) {
  const { t } = useT();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- photos come from arbitrary storage URLs
    return <img src={url} alt={name} className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />;
  }
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white/5"
      title={t.anbar.barcode.noPhoto}
    >
      <ImageOff className="h-5 w-5 text-white/30" strokeWidth={1.5} aria-hidden="true" />
    </div>
  );
}

export default function CatalogView({
  lines,
  branches,
  branchId,
  currencySymbol,
}: {
  lines: CatalogLine[];
  branches: Branch[];
  branchId: string | null;
  currencySymbol: string | null;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const unitLabel = useUnitLabel();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [lookupError, setLookupError] = useState<AnbarErrorCode | null>(null);
  const [looking, startLookup] = useTransition();
  const now = useMemo(() => new Date(), []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((line) =>
      [line.name, line.barcode ?? "", line.internalCode].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [lines, query]);

  const lookup = (code: string) => {
    setLookupError(null);
    startLookup(async () => {
      const found = await lookupCodeAction(code);
      if (!found.ok) {
        setLookupError(found.error);
        return;
      }
      setPanel(found.product ? { kind: "found", product: found.product } : { kind: "create", code: found.code });
    });
  };

  const onBranchChange = (value: string) => {
    router.push(value ? `${pathname}?branch=${value}` : pathname);
  };

  const panelTitle =
    panel?.kind === "found" ? copy.found : panel?.kind === "create" && panel.code ? copy.createWithCode : copy.createTitle;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{t.anbar.catalog.title}</h1>
        <div className="flex gap-2">
          <Link href={ANBAR_RECEIPT_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.qebul.open}
          </Link>
          <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.title}
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const code = query.trim();
            if (!code) return;
            if (visible.length === 1) setPanel({ kind: "found", product: visible[0] });
            else if (visible.length === 0) lookup(code);
          }}
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
              autoComplete="off"
              className="pl-9"
            />
          </div>
          <BarcodeScanner onScan={lookup} disabled={looking} />
        </form>
        {lookupError && <ActionMessage result={{ ok: false, error: lookupError }} />}

        <div className="flex gap-2">
          <Select
            aria-label={copy.branch}
            value={branchId ?? ""}
            onChange={(event) => onBranchChange(event.target.value)}
            className="flex-1"
          >
            <option value="">{copy.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => setPanel({ kind: "create", code: null })}
            className="inline-flex shrink-0 items-center gap-2"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {copy.add}
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <Card>
          <CardTitle>{copy.empty}</CardTitle>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardTitle>{copy.noMatch}</CardTitle>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((line) => (
            <li key={line.id}>
              <button
                type="button"
                onClick={() => setPanel({ kind: "found", product: line })}
                className="flex w-full items-center gap-4 rounded-[14px] border border-line bg-card p-3 text-left transition-colors hover:border-beige/60"
              >
                <ProductPhoto url={line.photoUrl} name={line.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="truncate text-xs text-white/50">
                    {line.barcode ?? line.internalCode}
                    {line.branchName ? ` · ${line.branchName}` : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    <ExpiryText date={line.nearestExpiry} now={now} />
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold">
                    {line.stock} {unitLabel(line.unit)}
                  </p>
                  <p className="text-xs text-beige">{formatMoney(line.value, currencySymbol)}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        title={panelTitle}
        description={panel?.kind === "create" && panel.code ? copy.notFound(panel.code) : undefined}
        closeLabel={copy.close}
      >
        {panel?.kind === "found" && (
          <FoundProduct
            product={panel.product}
            onClose={() => setPanel(null)}
            onSaved={() => {
              setPanel(null);
              router.refresh();
            }}
          />
        )}
        {panel?.kind === "create" && (
          <BarcodeProductForm
            code={panel.code}
            branches={branches}
            defaultBranchId={branchId}
            onCancel={() => setPanel(null)}
            onCreated={(product) => {
              setPanel({ kind: "found", product });
              router.refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
