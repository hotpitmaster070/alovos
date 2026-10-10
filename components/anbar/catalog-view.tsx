"use client";

import { Loader2, Package, Plus, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Sheet } from "@/components/ui/sheet";
import { lookupCatalogLineAction } from "@/lib/anbar/actions";
import { expiryStatus, isLowStock } from "@/lib/anbar/catalog-status";
import type { AnbarErrorCode } from "@/lib/anbar/errors";
import { isUnit, type Branch, type CatalogLine, type CatalogProduct, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, ANBAR_IMPORT_PATH, ANBAR_RECEIPT_PATH, ZAQOTOVKA_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { TenantSettings } from "@/lib/tenant-settings/parse";
import { cn } from "@/lib/utils";
import BarcodeScanner from "./barcode-scanner";
import { useExpiryLabel } from "./catalog/expiry-label";
import { ProductImage, StatusDot } from "./catalog/primitives";
import ProductCreateForm from "./catalog/product-create-form";
import ProductDetails from "./catalog/product-details";

type Panel =
  | { kind: "found"; product: CatalogProduct; stock: CatalogLine | null }
  | { kind: "create"; code: string | null }
  | null;

const chip = (active: boolean) => cn(buttonVariants("outline", "sm"), "shrink-0", active && "bg-beige text-black");

function ProductCard({
  line,
  now,
  settings,
  onOpen,
}: {
  line: CatalogLine;
  now: Date;
  settings: TenantSettings;
  onOpen: () => void;
}) {
  const { t } = useT();
  const expiryLabel = useExpiryLabel();
  const status = expiryStatus(line.nearestExpiry, now, settings);
  const unit = isUnit(line.unit) ? t.anbar.units[line.unit] : line.unit;
  const low = isLowStock(line.stock, line.minStock, settings);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full flex-col rounded-[22px] border border-white/10 bg-white/[0.03] p-2.5 text-left transition duration-300 ease-out hover:-translate-y-0.5 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.98]"
    >
      {status.dot && (
        <StatusDot dot={status.dot} label={expiryLabel(status)} className="absolute right-4 top-4 z-10" />
      )}
      <ProductImage url={line.photoUrl} name={line.name} className="aspect-square w-full rounded-[16px] !bg-white/5" />
      <div className="px-1.5 pb-1.5 pt-3">
        <p className="line-clamp-2 text-[15px] font-medium leading-snug tracking-[-0.01em] text-white">
          {line.name}
        </p>
        <p className="mt-1 truncate text-[13px] text-white/50">
          <span className={cn(low && "font-medium text-white")}>
            {line.stock} {unit}
          </span>
          {line.category ? ` · ${line.category}` : ""}
        </p>
      </div>
    </button>
  );
}

/**
 * Catalog on the same dark shell as sayım: search, branch and category filters, receipt, and the
 * product grid, with a text link back to Anbar.
 */
type Filters = { branch: string | null; q: string; category: string | null; low: boolean };

export default function CatalogView({
  lines,
  total,
  page,
  pageSize,
  search,
  category,
  lowOnly,
  categories,
  branches,
  locations,
  branchId,
  settings,
  canImport,
}: {
  lines: CatalogLine[];
  /** Products matching the filters, all pages. */
  total: number;
  page: number;
  pageSize: number;
  search: string;
  category: string | null;
  lowOnly: boolean;
  categories: string[];
  branches: Branch[];
  locations: StorageLocation[];
  branchId: string | null;
  settings: TenantSettings;
  /** Owners and chefs: link to the CSV/Excel import. */
  canImport: boolean;
}) {
  const { t } = useT();
  const copy = t.anbar.barcode;
  const shelf = t.anbar.shelf;
  const router = useRouter();
  const pathname = usePathname();
  const [panel, setPanel] = useState<Panel>(null);
  const [lookupError, setLookupError] = useState<AnbarErrorCode | null>(null);
  const [looking, startLookup] = useTransition();
  /** Code submitted with Enter while the list still showed another search. */
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const filtered = search !== "" || category !== null || lowOnly;

  const current: Filters = { branch: branchId, q: search, category, low: lowOnly };
  const filterQuery = (next: Partial<Filters>) => {
    const merged = { ...current, ...next };
    const params: Record<string, string> = {};
    if (merged.branch) params.branch = merged.branch;
    if (merged.q) params.q = merged.q;
    if (merged.category) params.category = merged.category;
    if (merged.low) params.low = "1";
    return params;
  };
  const filterHref = (next: Partial<Filters>) => {
    const params = new URLSearchParams(filterQuery(next)).toString();
    return params ? `${pathname}?${params}` : pathname;
  };

  const openLine = (line: CatalogLine) => setPanel({ kind: "found", product: line, stock: line });

  /**
   * Scan or Enter on a code: its product (barcode or internal code); otherwise, with the list of that
   * search, the only match or a new product when nothing matches.
   */
  const resolveCode = useCallback(
    (code: string, matches: { lines: CatalogLine[]; total: number } | null) => {
      setLookupError(null);
      startLookup(async () => {
        const found = await lookupCatalogLineAction(code, branchId);
        if (!found.ok) {
          setLookupError(found.error);
          return;
        }
        if (found.line) setPanel({ kind: "found", product: found.line, stock: found.line });
        else if (matches === null || matches.total === 0) setPanel({ kind: "create", code: found.code });
        else if (matches.total === 1 && matches.lines[0]) {
          setPanel({ kind: "found", product: matches.lines[0], stock: matches.lines[0] });
        }
      });
    },
    [branchId],
  );

  useEffect(() => {
    if (pendingCode === null || pendingCode !== search) return;
    setPendingCode(null);
    resolveCode(pendingCode, { lines, total });
  }, [pendingCode, search, lines, total, resolveCode]);

  const submitSearch = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    if (code === search) resolveCode(code, { lines, total });
    else {
      setPendingCode(code);
      router.replace(filterHref({ q: code }));
    }
  };

  const sheetTitle =
    panel?.kind === "found" ? panel.product.name : panel?.kind === "create" ? shelf.newProduct : "";
  const sheetDescription =
    panel?.kind === "found"
      ? (panel.product.category ?? shelf.uncategorized)
      : panel?.kind === "create" && panel.code
        ? copy.notFound(panel.code)
        : undefined;

  return (
    <>
    <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 hidden bg-[#0A0A0A] lg:left-64 lg:block" />
    <div className="relative z-10 -mx-4 -my-8 flex min-h-screen flex-col gap-6 bg-[#0A0A0A] p-6 text-white lg:-mx-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{t.anbar.catalog.title}</h1>
          <p className="mt-2 text-sm text-white/60">{shelf.shown(lines.length, total)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={ANBAR_RECEIPT_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.qebul.open}
          </Link>
          {canImport && (
            <Link href={ANBAR_IMPORT_PATH} className={buttonVariants("outline", "sm")}>
              {t.catalogImport.open}
            </Link>
          )}
          <Link href={ZAQOTOVKA_PATH} className={buttonVariants("outline", "sm")}>
            {t.labels.prep.nav}
          </Link>
          <button
            type="button"
            onClick={() => setPanel({ kind: "create", code: null })}
            aria-label={copy.add}
            title={copy.add}
            className={buttonVariants("outline", "sm")}
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
          <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.title}
          </Link>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-6 bg-[#0A0A0A]/90 px-6 py-3 backdrop-blur-xl">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch(String(new FormData(event.currentTarget).get("q") ?? ""));
          }}
          className="relative"
        >
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-white/40"
            strokeWidth={2}
            aria-hidden="true"
          />
          <SearchField
            unstyled
            type="search"
            name="q"
            value={search}
            onSearch={(text) => router.replace(filterHref({ q: text }))}
            placeholder={copy.search}
            aria-label={copy.search}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 w-full appearance-none rounded-[12px] border border-white/10 bg-white/5 pl-10 pr-4 text-[17px] text-white outline-none transition placeholder:text-white/40 focus:border-white/20"
          />
        </form>

        {(total > 0 || filtered) && (
          <div className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none]">
            <Link href={filterHref({ low: !lowOnly })} aria-current={lowOnly ? "true" : undefined} className={chip(lowOnly)}>
              {shelf.lowStock}
            </Link>
            {(branches.length > 0 || categories.length > 0) && (
              <span className="mx-1 w-px shrink-0 self-stretch bg-white/10" aria-hidden="true" />
            )}
            {branches.length > 0 && (
              <>
                <Link href={filterHref({ branch: null, category: null })} className={chip(branchId === null)}>
                  {copy.allBranches}
                </Link>
                {branches.map((branch) => (
                  <Link
                    key={branch.id}
                    href={filterHref({ branch: branch.id, category: null })}
                    className={chip(branchId === branch.id)}
                  >
                    {branch.name}
                  </Link>
                ))}
              </>
            )}
            {branches.length > 0 && categories.length > 0 && (
              <span className="mx-1 w-px shrink-0 self-stretch bg-white/10" aria-hidden="true" />
            )}
            {categories.map((name) => (
              <Link
                key={name}
                href={filterHref({ category: category === name ? null : name })}
                aria-current={category === name ? "true" : undefined}
                className={chip(category === name)}
              >
                {name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {total === 0 && !filtered ? (
        <div className="mx-auto mt-20 flex max-w-xs flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <Package className="h-9 w-9 text-white/30" strokeWidth={1.25} aria-hidden="true" />
          </div>
          <p className="mt-6 text-[20px] font-semibold tracking-[-0.015em]">{copy.empty}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-white/50">{t.anbar.qebul.hint}</p>
          <button
            type="button"
            onClick={() => setPanel({ kind: "create", code: null })}
            className={cn(buttonVariants("outline", "sm"), "mt-6")}
          >
            {copy.add}
          </button>
        </div>
      ) : lines.length === 0 ? (
        <p className="mt-20 text-center text-[15px] text-white/50">{copy.noMatch}</p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:gap-6">
          {lines.map((line) => (
            <li key={line.id}>
              <ProductCard line={line} now={now} settings={settings} onOpen={() => openLine(line)} />
            </li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <div className="mb-32">
          <Pager path={pathname} query={filterQuery({})} page={page} pageSize={pageSize} total={total} shown={lines.length} />
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/85 to-transparent pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-12 lg:left-64">
        {lookupError && (
          <p
            role="alert"
            className="pointer-events-auto rounded-full bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white shadow-lg"
          >
            {t.anbar.errors[lookupError]}
          </p>
        )}
        <BarcodeScanner
          onScan={(code) => resolveCode(code, null)}
          disabled={looking}
          renderTrigger={({ open, disabled, label }) => (
            <button
              type="button"
              onClick={open}
              disabled={disabled}
              aria-label={shelf.scan}
              title={label}
              className="pointer-events-auto h-[78px] w-[78px] rounded-full border border-white/20 bg-white/10 p-[5px] shadow-[0_10px_34px_rgba(0,0,0,0.35)] backdrop-blur-xl transition duration-200 active:scale-95 disabled:opacity-70"
            >
              <span className="block h-full w-full rounded-full border-[3px] border-white/70 p-[3px]">
                <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-black">
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
            stock={panel.stock}
            settings={settings}
            now={now}
            branchId={branchId}
            locations={locations}
            onSaved={(line) => {
              if (line) setPanel({ kind: "found", product: line, stock: line });
              router.refresh();
            }}
          />
        )}
        {panel?.kind === "create" && (
          <ProductCreateForm
            code={panel.code}
            branches={branches}
            locations={locations}
            categories={categories}
            defaultBranchId={branchId}
            onCancel={() => setPanel(null)}
            onCreated={(product) => {
              setPanel({ kind: "found", product, stock: null });
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </div>
    </>
  );
}
