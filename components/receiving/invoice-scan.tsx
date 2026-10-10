"use client";

import { Camera, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { createReceivingProductAction } from "@/lib/receiving/actions";
import { bestMatch, unitFromInvoice } from "@/lib/receiving/match";
import { RECEIVING_MAX_PRICE, RECEIVING_MAX_QUANTITY, type ReceivingProduct } from "@/lib/receiving/model";
import { parseDecimal, toJpeg } from "@/lib/receiving/photo";
import { parseScanResponse } from "@/lib/scanner/model";
import { proofPath, uploadProof } from "@/lib/supabase/upload";
import { cn } from "@/lib/utils";

/** A checked invoice line handed to the receiving table; scanRows point into the server-side price cache. */
export type ScannedLine = { product: ReceivingProduct; qty: number; price: number | null; scanRows: number[] };

type Row = {
  key: string;
  index: number;
  name: string;
  unit: string;
  qty: string;
  price: string;
  productId: string;
  matched: boolean;
};

type ScanErrorKey = "ai_not_configured" | "rate_limited" | "scan_failed" | "invalid_input" | "no_items" | "unknown";

function readError(payload: unknown): ScanErrorKey {
  const code = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).error : null;
  if (code === "ai_not_configured" || code === "rate_limited" || code === "scan_failed" || code === "no_items") return code;
  if (code === "invalid_input" || code === "photo_required") return "invalid_input";
  return "unknown";
}

const decimalText = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * "Scan invoice": the photo goes to the AI route (and doubles as the invoice proof), recognized lines
 * are matched to catalog products and shown for a person to correct before they reach the table.
 * Those who cannot see costs never receive prices at all: the route keeps them server-side under the
 * scan id, and the receipt prices the lines from there.
 */
export default function InvoiceScan({
  tenantId,
  branchId,
  showCosts,
  disabled,
  currency,
  loadCatalog,
  onProductCreated,
  onInvoicePhoto,
  onApply,
  notify,
}: {
  tenantId: string;
  branchId: string;
  showCosts: boolean;
  disabled: boolean;
  currency: CurrencyInfo;
  loadCatalog: () => Promise<ReceivingProduct[] | null>;
  onProductCreated: (product: ReceivingProduct) => void;
  onInvoicePhoto: (path: string) => void;
  /** Returns how many lines reached the table. */
  onApply: (lines: ScannedLine[], scanId: string | null) => number;
  notify: (text: string) => void;
}) {
  const { t } = useT();
  const copy = t.receiving.scan;
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [products, setProducts] = useState<ReceivingProduct[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || scanning || creating !== null;

  const errorText = (key: ScanErrorKey) => (key === "no_items" ? copy.no_items_found : copy.errors[key]);

  const scan = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setScanning(true);
    try {
      const photo = await toJpeg(file);
      const body = new FormData();
      body.set("photo", photo);
      const [response, catalog, proof] = await Promise.all([
        fetch("/api/scan-invoice", { method: "POST", body }),
        loadCatalog(),
        uploadProof(photo, proofPath({ tenantId, branchId, productId: "invoice", type: "invoice" })).catch(() => null),
      ]);
      if (proof) onInvoicePhoto(proof.path);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorText(readError(payload)));
        return;
      }
      const { items, scanId: id } = parseScanResponse(payload);
      if (items.length === 0) {
        setError(copy.no_items_found);
        return;
      }
      const known = catalog ?? [];
      setProducts(known);
      setScanId(id);
      setRows(
        items.map((item, index) => {
          const match = bestMatch(item.name, known);
          return {
            key: `${index}-${item.name}`,
            index,
            name: item.name,
            unit: item.unit,
            qty: decimalText(item.qty),
            price: item.price === null ? "" : decimalText(item.price),
            productId: match?.item.productId ?? "",
            matched: match !== null,
          };
        }),
      );
    } catch {
      setError(copy.errors.unknown);
    } finally {
      setScanning(false);
    }
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const create = async (row: Row) => {
    setError(null);
    setCreating(row.key);
    try {
      const result = await createReceivingProductAction(branchId, row.name, unitFromInvoice(row.unit));
      if (!result.ok) {
        setError(t.receiving.errors[result.error]);
        return;
      }
      setProducts((current) => [...current, result.value]);
      onProductCreated(result.value);
      update(row.key, { productId: result.value.productId, matched: true });
      notify(copy.created(result.value.name));
    } catch {
      setError(t.receiving.errors.save_failed);
    } finally {
      setCreating(null);
    }
  };

  const apply = () => {
    const byId = new Map(products.map((product) => [product.productId, product]));
    const lines: ScannedLine[] = [];
    for (const row of rows) {
      const product = byId.get(row.productId);
      const qty = parseDecimal(row.qty, RECEIVING_MAX_QUANTITY);
      if (!product || qty === null || qty <= 0) continue;
      lines.push({
        product,
        qty,
        price: showCosts ? parseDecimal(row.price, RECEIVING_MAX_PRICE) : null,
        scanRows: [row.index],
      });
    }
    const applied = onApply(lines, scanId);
    notify(copy.applied(applied));
    if (applied < rows.length) setError(copy.skipped(rows.length - applied));
    setRows([]);
    setScanId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        className={cn(
          "inline-flex w-fit cursor-pointer items-center gap-2 rounded-[12px] border border-beige/60 bg-beige/10 px-4 py-2.5 text-sm font-medium text-beige transition hover:bg-beige/20",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {scanning ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
        {scanning ? copy.scanning : copy.scan_invoice}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void scan(file);
          }}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-[12px] border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <Card className="flex flex-col gap-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div>
              <h2 className="font-semibold">{copy.title}</h2>
              <p className="text-xs text-white/50">{copy.hint}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => {
                  setRows([]);
                  setScanId(null);
                }}>
                {copy.discard}
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={apply}>
                {copy.apply}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className={cn("w-full text-sm", showCosts ? "min-w-[820px]" : "min-w-[620px]")}>
              <thead className="text-left text-xs uppercase tracking-wide text-white/45">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">{copy.invoiceName}</th>
                  <th className="px-4 py-2 font-medium">{copy.dbProduct}</th>
                  <th className="px-4 py-2 text-right font-medium">{copy.quantity}</th>
                  {showCosts && <th className="px-4 py-2 text-right font-medium">{copy.price}</th>}
                  {showCosts && <th className="px-4 py-2 text-right font-medium">{copy.total}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qty = parseDecimal(row.qty, RECEIVING_MAX_QUANTITY);
                  const price = parseDecimal(row.price, RECEIVING_MAX_PRICE);
                  const found = row.productId !== "";
                  return (
                    <tr key={row.key} className={cn("border-b border-line/60 last:border-0", !found && "bg-amber-400/5")}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-white">{row.name}</div>
                        <div
                          className={cn(
                            "mt-0.5 inline-flex items-center gap-1 text-xs",
                            found ? "text-emerald-300" : "text-amber-300",
                          )}
                        >
                          {found ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <CircleAlert className="h-3.5 w-3.5" aria-hidden />}
                          {found ? copy.matched : copy.not_matched}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={row.productId}
                            disabled={busy}
                            aria-label={`${copy.dbProduct}: ${row.name}`}
                            onChange={(event) => update(row.key, { productId: event.target.value })}
                            className="min-w-[180px] flex-1"
                          >
                            <option value="">{copy.choose}</option>
                            {products.map((product) => (
                              <option key={product.productId} value={product.productId}>
                                {product.name}
                              </option>
                            ))}
                          </Select>
                          {!found && (
                            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void create(row)}>
                              {creating === row.key && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                              {copy.createProduct}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Input
                            inputMode="decimal"
                            value={row.qty}
                            disabled={busy}
                            aria-label={`${copy.quantity}: ${row.name}`}
                            onChange={(event) => update(row.key, { qty: event.target.value })}
                            className={cn("w-24 text-right", qty === null && "border-red-400/60")}
                          />
                          <span className="w-8 text-left text-xs text-white/45">{row.unit}</span>
                        </div>
                      </td>
                      {showCosts && (
                        <td className="px-4 py-2 text-right">
                          <Input
                            inputMode="decimal"
                            value={row.price}
                            disabled={busy}
                            aria-label={`${copy.price}: ${row.name}`}
                            onChange={(event) => update(row.key, { price: event.target.value })}
                            className={cn("ml-auto w-28 text-right", row.price.trim() !== "" && price === null && "border-red-400/60")}
                          />
                        </td>
                      )}
                      {showCosts && (
                        <td className="px-4 py-2 text-right tabular-nums">
                          {qty !== null && price !== null ? formatMoney(qty * price, currency) : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
