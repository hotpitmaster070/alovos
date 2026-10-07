"use client";

import { Loader2, Package, Plus, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { lookupCodeAction } from "@/lib/anbar/actions";
import { expiryStatus, isLowStock } from "@/lib/anbar/catalog-status";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type CatalogLine, type CatalogProduct } from "@/lib/anbar/types";
import { ANBAR_RECEIPT_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import BarcodeScanner from "./barcode-scanner";
import { useExpiryLabel } from "./catalog/expiry-label";
import { ProductImage, SECONDARY_BUTTON, StatusDot } from "./catalog/primitives";
import ProductCreateForm from "./catalog/product-create-form";
import ProductDetails from "./catalog/product-details";

type Panel = { kind: "found"; product: CatalogProduct } | { kind: "create"; code: string | null } | null;

const CHIP = "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors";
const CHIP_ON = "bg-neutral-900 text-white";
const CHIP_OFF = "bg-white text-neutral-600 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:text-neutral-900";

function ProductCard({ line, now, onOpen }: { line: CatalogLine; now: Date; onOpen: () => void }) {
  const { t } = useT();
  const expiryLabel = useExpiryLabel();
  const status = expiryStatus(line.nearestExpiry, now);
  const unit = isUnit(line.unit) ? t.anbar.units[line.unit] : line.unit;
  const low = isLowStock(line.stock, line.minStock);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full flex-col rounded-[22px] bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_rgba(0,0,0,0.05)] transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_14px_34px_rgba(0,0,0,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 active:scale-[0.98]"
    >
      {status.dot && (
        <StatusDot dot={status.dot} label={expiryLabel(status)} className="absolute right-4 top-4 z-10" />
      )}
      <ProductImage url={line.photoUrl} name={line.name} className="aspect-square w-full rounded-[16px]" />
      <div className="px-1.5 pb-1.5 pt-3">
        <p className="line-clamp-2 text-[15px] font-medium leading-snug tracking-[-0.01em] text-neutral-900">
          {line.name}
        </p>
        <p className="mt-1 truncate text-[13px] text-neutral-500">
          <span className={cn(low && "font-medium text-neutral-900")}>
            {line.stock} {unit}
          </span>
          {line.category ? ` · ${line.category}` : ""}
        </p>
      </div>
    </button>
  );
}

/**
 * Block 1.1 catalog, Apple-style: light surface, Spotlight search, a grid of product cards with a
 * small expiry dot, one shutter button for the camera, and an iOS sheet with the scanned product.
 */
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
  const shelf = t.anbar.shelf;
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [lookupError, setLookupError] = useState<AnbarErrorCode | null>(null);
  const [looking, startLookup] = useTransition();
  const now = useMemo(() => new Date(), []);

  const stockById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const categories = useMemo(
    () => Array.from(new Set(lines.flatMap((line) => (line.category ? [line.category] : [])))).sort(),
    [lines],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (category && line.category !== category) return false;
      if (!needle) return true;
      return [line.name, line.barcode ?? "", line.internalCode, line.category ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      );
    });
  }, [lines, query, category]);

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

  const branchHref = (id: string | null) => (id ? `${pathname}?branch=${id}` : pathname);

  const sheetTitle =
    panel?.kind === "found" ? panel.product.name : panel?.kind === "create" ? shelf.newProduct : "";
  const sheetDescription =
    panel?.kind === "found"
      ? (panel.product.category ?? shelf.uncategorized)
      : panel?.kind === "create" && panel.code
        ? copy.notFound(panel.code)
        : undefined;

  return (
    <div
      data-surface="light"
      className="-mx-4 -mt-8 min-h-[100dvh] bg-[#F5F5F7] px-5 pb-44 pt-10 font-system text-[#1d1d1f] antialiased lg:-mx-10 lg:px-10"
    >
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-neutral-400">{t.anbar.title}</p>
          <h1 className="mt-1 text-[34px] font-semibold leading-[1.1] tracking-[-0.025em]">{t.anbar.catalog.title}</h1>
          <p className="mt-1.5 text-[15px] text-neutral-500">{shelf.products(lines.length)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={ANBAR_RECEIPT_PATH}
            className="rounded-full px-3.5 py-2 text-[15px] font-medium text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-900"
          >
            {t.anbar.qebul.open}
          </Link>
          <button
            type="button"
            onClick={() => setPanel({ kind: "create", code: null })}
            aria-label={copy.add}
            title={copy.add}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.06)] transition hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.1)]"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="sticky top-0 z-20 -mx-5 mt-7 bg-[#F5F5F7]/80 px-5 py-3 backdrop-blur-xl lg:-mx-10 lg:px-10">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const code = query.trim();
            if (!code) return;
            if (visible.length === 1) setPanel({ kind: "found", product: visible[0] });
            else if (visible.length === 0) lookup(code);
          }}
          className="relative"
        >
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-neutral-400"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            aria-label={copy.search}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 w-full appearance-none rounded-[12px] bg-black/[0.06] pl-10 pr-4 text-[17px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.05)]"
          />
        </form>

        {(branches.length > 0 || categories.length > 0) && (
          <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-10 lg:px-10">
            {branches.length > 0 && (
              <>
                <Link href={branchHref(null)} className={cn(CHIP, branchId === null ? CHIP_ON : CHIP_OFF)}>
                  {copy.allBranches}
                </Link>
                {branches.map((branch) => (
                  <Link
                    key={branch.id}
                    href={branchHref(branch.id)}
                    className={cn(CHIP, branchId === branch.id ? CHIP_ON : CHIP_OFF)}
                  >
                    {branch.name}
                  </Link>
                ))}
              </>
            )}
            {branches.length > 0 && categories.length > 0 && (
              <span className="mx-1 w-px shrink-0 self-stretch bg-black/10" aria-hidden="true" />
            )}
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(category === name ? null : name)}
                className={cn(CHIP, category === name ? CHIP_ON : CHIP_OFF)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="mx-auto mt-20 flex max-w-xs flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
            <Package className="h-9 w-9 text-neutral-300" strokeWidth={1.25} aria-hidden="true" />
          </div>
          <p className="mt-6 text-[20px] font-semibold tracking-[-0.015em]">{copy.empty}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">{t.anbar.qebul.hint}</p>
          <button
            type="button"
            onClick={() => setPanel({ kind: "create", code: null })}
            className={cn(SECONDARY_BUTTON, "mt-6")}
          >
            {copy.add}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-20 text-center text-[15px] text-neutral-500">{copy.noMatch}</p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:gap-6">
          {visible.map((line) => (
            <li key={line.id}>
              <ProductCard line={line} now={now} onOpen={() => setPanel({ kind: "found", product: line })} />
            </li>
          ))}
        </ul>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 bg-gradient-to-t from-[#F5F5F7] via-[#F5F5F7]/85 to-transparent pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-12 lg:pl-64">
        {lookupError && (
          <p
            role="alert"
            className="pointer-events-auto rounded-full bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white shadow-lg"
          >
            {t.anbar.errors[lookupError]}
          </p>
        )}
        <BarcodeScanner
          onScan={lookup}
          disabled={looking}
          renderTrigger={({ open, disabled, label }) => (
            <button
              type="button"
              onClick={open}
              disabled={disabled}
              aria-label={shelf.scan}
              title={label}
              className="pointer-events-auto h-[78px] w-[78px] rounded-full bg-white/80 p-[5px] shadow-[0_10px_34px_rgba(0,0,0,0.14)] ring-1 ring-black/5 backdrop-blur-xl transition duration-200 active:scale-95 disabled:opacity-70"
            >
              <span className="block h-full w-full rounded-full border-[3px] border-neutral-900 p-[3px]">
                <span className="flex h-full w-full items-center justify-center rounded-full bg-neutral-900 text-white">
                  {looking ? (
                    <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <ScanLine className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </span>
              </span>
            </button>
          )}
        />
      </div>

      <Sheet
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        title={sheetTitle}
        description={sheetDescription}
        closeLabel={copy.close}
      >
        {panel?.kind === "found" && (
          <ProductDetails
            product={panel.product}
            stock={stockById.get(panel.product.id) ?? null}
            currencySymbol={currencySymbol}
            now={now}
            onSaved={() => {
              setPanel(null);
              router.refresh();
            }}
          />
        )}
        {panel?.kind === "create" && (
          <ProductCreateForm
            code={panel.code}
            branches={branches}
            categories={categories}
            defaultBranchId={branchId}
            onCancel={() => setPanel(null)}
            onCreated={(product) => {
              setPanel({ kind: "found", product });
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
