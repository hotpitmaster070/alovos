"use client";

import { Camera, Check, LoaderCircle, PackageCheck, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { Branch } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import type { StaffMember, Zone } from "@/lib/inventory/model";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { orderLinesAction, receiveGoodsAction, receivingProductsAction } from "@/lib/receiving/actions";
import {
  lineVariance,
  RECEIVING_MAX_QUANTITY,
  type Delegation,
  type ReceivingErrorCode,
  type ReceivingOrder,
  type ReceivingProduct,
} from "@/lib/receiving/model";
import { toJpeg } from "@/lib/receiving/photo";
import { proofPath, uploadProof } from "@/lib/supabase/upload";
import { cn } from "@/lib/utils";
import { DelegateButton, DelegationBanner } from "./delegation";
import InvoiceScan, { type ScannedLine } from "./invoice-scan";

type Line = ReceivingProduct & {
  actual: string;
  expectedInput: string;
  photoPath: string | null;
  /** Unit price read from the supplier invoice; only ever set for those who see costs. */
  invoicePrice: number | null;
  /** Rows of the current invoice scan; the server prices them from its cache. */
  scanRows: number[];
};
type Source = { kind: "order"; orderId: string } | { kind: "free" } | null;

/** Parses a typed quantity ("1,5" or "1.5"); null when empty or out of range. */
function parseQty(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= RECEIVING_MAX_QUANTITY ? parsed : null;
}

function formatQty(value: number | null, locale: string | undefined): string {
  if (value === null) return "—";
  return value.toLocaleString(locale, { maximumFractionDigits: 3 });
}

export type DelegationProps = {
  canDelegate: boolean;
  candidates: StaffMember[];
  incoming: Delegation | null;
  outgoing: Delegation | null;
};

export default function ReceivingView({
  allowed,
  showCosts,
  path,
  tenantId,
  branches,
  branchId,
  orders,
  zones,
  currency,
  timeZone,
  delegation,
}: {
  allowed: boolean;
  /** False for a delegate: purchase prices and money columns are hidden. */
  showCosts: boolean;
  path: string;
  tenantId: string;
  branches: Branch[];
  branchId: string | null;
  orders: ReceivingOrder[];
  zones: Zone[];
  currency: CurrencyInfo;
  timeZone: string;
  delegation: DelegationProps;
}) {
  const { t } = useT();
  const copy = t.receiving;
  const router = useRouter();
  const locale = currency.locale ?? undefined;
  const [source, setSource] = useState<Source>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [catalog, setCatalog] = useState<ReceivingProduct[] | null>(null);
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [invoicePath, setInvoicePath] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReceivingErrorCode | null>(null);
  const [toast, setToast] = useState<{ token: number; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const actualRefs = useRef<(HTMLInputElement | null)[]>([]);

  const rows = useMemo(
    () =>
      lines.map((line) => {
        const expected = source?.kind === "order" ? line.expected : parseQty(line.expectedInput);
        const actual = parseQty(line.actual);
        return { line, expected, actual, variance: lineVariance(expected, actual, line.unitCost ?? line.invoicePrice) };
      }),
    [lines, source],
  );

  const totals = useMemo(() => {
    let expected = 0;
    let received = 0;
    let flagged = 0;
    for (const row of rows) {
      const cost = row.line.unitCost ?? row.line.invoicePrice ?? 0;
      expected += (row.expected ?? 0) * cost;
      received += (row.actual ?? 0) * cost;
      if (row.variance.flagged) flagged += 1;
    }
    return { expected, received, difference: received - expected, flagged };
  }, [rows]);

  if (!allowed || !branchId) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <Card>
          <p className="text-sm text-white/60">{allowed ? copy.noBranches : copy.forbidden}</p>
        </Card>
      </div>
    );
  }

  const branch: string = branchId;
  const hasActual = rows.some((row) => row.actual !== null && row.actual > 0);
  const busy = pending || loading || uploading !== null;
  const canAccept = invoicePath !== null && hasActual && zoneId !== "" && !busy;
  const usedIds = new Set(lines.map((line) => line.productId));

  const notify = (text: string) => setToast({ token: Date.now(), text });

  const reset = () => {
    setSource(null);
    setLines([]);
    setInvoicePath(null);
    setScanId(null);
  };

  const chooseOrder = async (orderId: string) => {
    setError(null);
    if (!orderId) {
      setSource(null);
      setLines([]);
      return;
    }
    setSource({ kind: "order", orderId });
    setLines([]);
    setLoading(true);
    try {
      const result = await orderLinesAction(branch, orderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLines(result.value.map((product) => ({ ...product, actual: "", expectedInput: "", photoPath: null, invoicePrice: null, scanRows: [] })));
    } catch {
      setError("save_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadCatalog = async (): Promise<ReceivingProduct[] | null> => {
    if (catalog) return catalog;
    const result = await receivingProductsAction(branch);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setCatalog(result.value);
    return result.value;
  };

  const addToCatalog = (product: ReceivingProduct) =>
    setCatalog((current) => (current ? [...current.filter((item) => item.productId !== product.productId), product] : [product]));

  /** Invoice lines into the table: fills the order's actual quantities, or adds lines when receiving without one. */
  const applyScan = (scanned: ScannedLine[], newScanId: string | null): number => {
    const merged = new Map<string, ScannedLine>();
    for (const item of scanned) {
      const previous = merged.get(item.product.productId);
      merged.set(
        item.product.productId,
        previous ? { ...previous, qty: previous.qty + item.qty, scanRows: [...previous.scanRows, ...item.scanRows] } : item,
      );
    }
    setScanId(newScanId);
    const text = (value: number) => String(Math.round(value * 1000) / 1000);
    if (source?.kind === "order") {
      const inOrder = new Set(lines.map((line) => line.productId));
      setLines((current) =>
        current.map((line) => {
          const item = merged.get(line.productId);
          return item
            ? { ...line, actual: text(item.qty), invoicePrice: item.price, scanRows: item.scanRows }
            : { ...line, scanRows: [] };
        }),
      );
      return scanned.filter((item) => inOrder.has(item.product.productId)).length;
    }
    setSource({ kind: "free" });
    setLines((current) => {
      const next = current.map((line) => ({ ...line, scanRows: [] as number[] }));
      merged.forEach((item) => {
        const index = next.findIndex((line) => line.productId === item.product.productId);
        const filled = { actual: text(item.qty), expectedInput: text(item.qty), invoicePrice: item.price, scanRows: item.scanRows };
        if (index >= 0) next[index] = { ...next[index], ...filled };
        else next.push({ ...item.product, expected: null, photoPath: null, ...filled });
      });
      return next;
    });
    return scanned.length;
  };

  const chooseFree = async () => {
    setError(null);
    setSource({ kind: "free" });
    setLines([]);
    if (catalog) return;
    setLoading(true);
    try {
      const result = await receivingProductsAction(branch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCatalog(result.value);
    } catch {
      setError("save_failed");
    } finally {
      setLoading(false);
    }
  };

  const addProduct = (productId: string) => {
    const product = catalog?.find((item) => item.productId === productId);
    if (!product || usedIds.has(productId)) return;
    setLines((current) => [...current, { ...product, expected: null, actual: "", expectedInput: "", photoPath: null, invoicePrice: null, scanRows: [] }]);
  };

  const updateLine = (productId: string, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));

  const upload = async (key: string, productId: string, type: string, event: ChangeEvent<HTMLInputElement>, done: (path: string) => void) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(key);
    try {
      const { path: stored } = await uploadProof(await toJpeg(file), proofPath({ tenantId, branchId: branch, productId, type }));
      done(stored);
    } catch {
      setError("upload_failed");
    } finally {
      setUploading(null);
    }
  };

  const focusNext = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    actualRefs.current[index + 1]?.focus();
  };

  const accept = () => {
    if (!canAccept || !invoicePath || !source) return;
    const isOrder = source.kind === "order";
    const orderId = source.kind === "order" ? source.orderId : null;
    const payload = rows
      .filter((row) => isOrder || row.actual !== null)
      .map((row) => ({
        productId: row.line.productId,
        receivedQty: row.actual ?? 0,
        expectedQty: isOrder ? null : row.expected,
        photoPath: row.line.photoPath,
        price: row.line.invoicePrice,
        scanRows: row.line.scanRows,
      }));
    setError(null);
    startTransition(async () => {
      try {
        const result = await receiveGoodsAction({
          branchId: branch,
          orderId,
          locationId: zoneId,
          invoicePath,
          lines: payload,
          scanId,
        });
        if (!result.ok) {
          if (result.error === "scan_expired") {
            setScanId(null);
            setLines((current) => current.map((line) => ({ ...line, scanRows: [] })));
          }
          setError(result.error);
          return;
        }
        notify(
          result.value.total === null
            ? copy.successNoTotal(result.value.lines)
            : copy.success(result.value.lines, formatMoney(result.value.total, currency)),
        );
        reset();
        router.refresh();
      } catch {
        setError("save_failed");
      }
    });
  };

  const orderDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, { timeZone, day: "2-digit", month: "short" });
  };

  return (
    <div className="flex flex-col gap-6">
      {delegation.incoming && <DelegationBanner delegation={delegation.incoming} onEnded={notify} />}
      {delegation.outgoing && <DelegationBanner delegation={delegation.outgoing} onEnded={notify} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">{copy.subtitle}</p>
        </div>
        {delegation.canDelegate && (
          <DelegateButton branchId={branch} candidates={delegation.candidates} onDone={notify} />
        )}
      </div>

      <Card className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/60">{copy.branch}</span>
          <Select value={branchId} disabled={busy} onChange={(event) => router.push(`${path}?branch=${encodeURIComponent(event.target.value)}`)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/60">{copy.order}</span>
          <div className="flex gap-2">
            <Select
              value={source?.kind === "order" ? source.orderId : ""}
              disabled={busy || orders.length === 0}
              onChange={(event) => void chooseOrder(event.target.value)}
            >
              <option value="">{orders.length === 0 ? copy.noOrders : copy.chooseOrder}</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {copy.orderOption(order.supplierName, orderDate(order.orderedAt), order.itemCount)}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant={source?.kind === "free" ? "default" : "outline"}
              disabled={busy}
              onClick={() => void chooseFree()}
              className="shrink-0"
            >
              {copy.withoutOrder}
            </Button>
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/60">{copy.zone}</span>
          {zones.length === 0 ? (
            <span className="py-2.5 text-white/55">{copy.noZones}</span>
          ) : (
            <Select value={zoneId} disabled={busy} onChange={(event) => setZoneId(event.target.value)}>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </Select>
          )}
          <span className="text-xs text-white/40">{copy.zoneHint}</span>
        </label>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <label
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-[12px] border px-4 py-2.5 text-sm font-medium transition",
            invoicePath ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-beige/60 bg-beige/10 text-beige",
            busy && "pointer-events-none opacity-60",
          )}
        >
          {uploading === "invoice" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : invoicePath ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : null}
          {uploading === "invoice" ? copy.uploading : invoicePath ? `${copy.invoiceDone} · ${copy.retake}` : copy.invoicePhoto}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void upload("invoice", "invoice", "invoice", event, setInvoicePath)}
          />
        </label>
        {source?.kind === "free" && catalog && (
          <div className="flex min-w-[240px] items-center gap-2">
            <Plus className="h-4 w-4 text-white/50" aria-hidden />
            <Select value="" disabled={busy} aria-label={copy.addProduct} onChange={(event) => addProduct(event.target.value)}>
              <option value="">{copy.addProductPlaceholder}</option>
              {catalog
                .filter((product) => !usedIds.has(product.productId))
                .map((product) => (
                  <option key={product.productId} value={product.productId}>
                    {product.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </div>

      <InvoiceScan
        tenantId={tenantId}
        branchId={branch}
        showCosts={showCosts}
        disabled={busy}
        currency={currency}
        loadCatalog={loadCatalog}
        onProductCreated={addToCatalog}
        onInvoicePhoto={setInvoicePath}
        onApply={applyScan}
        notify={notify}
      />

      {error && (
        <p role="alert" className="rounded-[12px] border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {copy.errors[error]}
        </p>
      )}

      <Card className="overflow-x-auto p-0">
        {loading ? (
          <p className="flex items-center gap-2 p-6 text-sm text-white/60">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {copy.loading}
          </p>
        ) : lines.length === 0 ? (
          <p className="p-6 text-sm text-white/55">{copy.empty}</p>
        ) : (
          <table className={cn("w-full text-sm", showCosts ? "min-w-[760px]" : "min-w-[560px]")}>
            <thead className="text-left text-xs uppercase tracking-wide text-white/45">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">{copy.table.product}</th>
                <th className="px-4 py-3 text-right font-medium">{copy.table.expected}</th>
                <th className="px-4 py-3 text-right font-medium">{copy.table.actual}</th>
                <th className="px-4 py-3 text-right font-medium">{copy.table.diffQty}</th>
                {showCosts && <th className="px-4 py-3 text-right font-medium">{copy.table.diffMoney}</th>}
                <th className="px-4 py-3 font-medium">{copy.table.photo}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, expected, variance }, index) => (
                <tr
                  key={line.productId}
                  className={cn("border-b border-line/60 last:border-0", variance.flagged && "bg-red-500/15")}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{line.name}</div>
                    <div className="text-xs text-white/45">
                      {line.unit}
                      {showCosts && line.unitCost !== null && ` · ${formatMoney(line.unitCost, currency)}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {source?.kind === "order" ? (
                      formatQty(expected, locale)
                    ) : (
                      <Input
                        inputMode="decimal"
                        value={line.expectedInput}
                        disabled={busy}
                        aria-label={`${copy.table.expected}: ${line.name}`}
                        onChange={(event) => updateLine(line.productId, { expectedInput: event.target.value })}
                        className="ml-auto w-24 text-right"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Input
                      ref={(element) => {
                        actualRefs.current[index] = element;
                      }}
                      inputMode="decimal"
                      enterKeyHint="next"
                      value={line.actual}
                      disabled={busy}
                      aria-label={`${copy.table.actual}: ${line.name}`}
                      onChange={(event) => updateLine(line.productId, { actual: event.target.value })}
                      onKeyDown={focusNext(index)}
                      className="ml-auto w-24 text-right"
                    />
                  </td>
                  <td className={cn("px-4 py-3 text-right tabular-nums", variance.flagged && "font-semibold text-red-300")}>
                    {variance.qty === null ? "—" : `${variance.qty > 0 ? "+" : ""}${formatQty(variance.qty, locale)}`}
                  </td>
                  {showCosts && (
                    <td className={cn("px-4 py-3 text-right tabular-nums", variance.flagged && "font-semibold text-red-300")}>
                      {formatMoney(variance.money, currency)}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs transition",
                          line.photoPath ? "border-emerald-400/50 text-emerald-200" : "border-line text-white/70 hover:border-beige",
                          busy && "pointer-events-none opacity-60",
                        )}
                        title={line.photoPath ? copy.table.photoTaken : copy.table.takePhoto}
                      >
                        {uploading === line.productId ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                        ) : line.photoPath ? (
                          <Check className="h-4 w-4" aria-hidden />
                        ) : (
                          <Camera className="h-4 w-4" aria-hidden />
                        )}
                        <span className="sr-only">{line.photoPath ? copy.table.photoTaken : copy.table.takePhoto}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          disabled={busy}
                          onChange={(event) =>
                            void upload(line.productId, line.productId, "receiving", event, (stored) =>
                              updateLine(line.productId, { photoPath: stored }),
                            )
                          }
                        />
                      </label>
                      {source?.kind === "free" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          aria-label={copy.table.remove}
                          onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {lines.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          {showCosts ? (
            <dl className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <dt className="text-white/50">{copy.totals.expected}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{formatMoney(totals.expected, currency)}</dd>
              </div>
              <div>
                <dt className="text-white/50">{copy.totals.received}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{formatMoney(totals.received, currency)}</dd>
              </div>
              <div>
                <dt className="text-white/50">{copy.totals.difference}</dt>
                <dd className={cn("mt-1 font-semibold tabular-nums", totals.difference < 0 && "text-red-300")}>
                  {formatMoney(totals.difference, currency)}
                </dd>
              </div>
            </dl>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-end gap-1.5">
            <Button type="button" disabled={!canAccept} onClick={accept}>
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <PackageCheck className="h-4 w-4" aria-hidden />}
              {pending ? copy.accepting : copy.accept}
            </Button>
            <span className="text-xs text-white/45">
              {totals.flagged > 0 ? copy.totals.flagged(totals.flagged) : !canAccept ? copy.acceptHint : source?.kind === "order" ? copy.orderHint : ""}
            </span>
          </div>
        </Card>
      )}

      <Toast token={toast?.token ?? null} text={toast?.text ?? ""} />
    </div>
  );
}
