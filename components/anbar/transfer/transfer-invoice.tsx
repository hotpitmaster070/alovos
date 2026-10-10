"use client";

import { ArrowRight, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { isUnit } from "@/lib/anbar/types";
import { ANBAR_TRANSFER_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import type { TransferInvoice } from "@/lib/transfer/invoice";
import { formatDay, formatMoment, formatQuantity } from "./format";

export default function TransferInvoiceView({ invoice, timeZone }: { invoice: TransferInvoice | null; timeZone: string }) {
  const { t, lang } = useT();
  const copy = t.transfers;
  const search = useSearchParams();
  const autoPrint = invoice !== null && search.get("print") === "1";

  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  const unitLabel = (unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit);

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 hidden bg-[#0A0A0A] print:hidden lg:left-64 lg:block" />
      <div className="relative z-10 -mx-4 -my-8 flex min-h-screen flex-col gap-6 bg-[#0A0A0A] p-6 text-white print:m-0 print:min-h-0 print:bg-white print:p-0 print:text-black lg:-mx-10">
        {!invoice ? (
          <p className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 text-white/70">{copy.forbidden}</p>
        ) : (
          <article className="mx-auto w-full max-w-4xl space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
              <Link href={ANBAR_TRANSFER_PATH} className={buttonVariants("outline", "sm")}>
                {copy.invoice.back}
              </Link>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                {copy.invoice.print}
              </Button>
            </div>

            <header className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-white/50 print:text-black/60">{copy.invoice.title}</p>
              <h1 className="font-serif text-[32px] font-bold leading-tight tracking-tight">{invoice.number}</h1>
              <p className="flex flex-wrap items-center gap-2 text-lg">
                <span>{invoice.from}</span>
                <ArrowRight aria-label="→" className="h-5 w-5 text-white/40 print:text-black/50" />
                <span>{invoice.to}</span>
              </p>
            </header>

            <dl className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-sm sm:grid-cols-2 print:border-black/20 print:bg-transparent lg:grid-cols-4">
              {[
                [copy.invoice.number, invoice.number],
                [copy.invoice.date, formatMoment(invoice.createdAt, lang, timeZone)],
                [copy.invoice.createdBy, invoice.createdBy ?? "—"],
                [copy.invoice.status, copy.invoice.statuses[invoice.status] ?? invoice.status],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-white/50 print:text-black/60">{label}</dt>
                  <dd className="mt-0.5 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/15 text-left text-[11px] uppercase tracking-wide text-white/50 print:border-black/30 print:text-black/60">
                  <th className="w-10 py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">{copy.invoice.product}</th>
                  <th className="py-2 pr-3 font-medium">{copy.invoice.code}</th>
                  <th className="py-2 pr-3 text-right font-medium">{copy.invoice.quantity}</th>
                  <th className="py-2 font-medium">{copy.invoice.lots}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, index) => (
                  <tr key={item.productId} className="break-inside-avoid border-b border-white/5 align-top print:border-black/10">
                    <td className="py-2.5 pr-2 tabular-nums text-white/50 print:text-black/60">{index + 1}</td>
                    <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                    <td className="py-2.5 pr-3 text-white/70 print:text-black/70">{item.internalCode ?? "—"}</td>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums">
                      {formatQuantity(item.quantity, lang)} {unitLabel(item.unit)}
                    </td>
                    <td className="py-2.5 text-xs text-white/60 print:text-black/70">
                      {item.lots.map((lot, i) => (
                        <span key={i} className="block">
                          {copy.invoice.lot(
                            formatQuantity(lot.quantity, lang),
                            lot.expiryDate ? formatDay(lot.expiryDate, lang) : copy.noExpiry,
                            lot.fromPlace ?? "—",
                            lot.toPlace ?? "—",
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {invoice.note && (
              <p className="text-sm">
                <span className="text-white/50 print:text-black/60">{copy.invoice.note}: </span>
                {invoice.note}
              </p>
            )}

            <div className="grid gap-10 pt-10 sm:grid-cols-2">
              {[copy.invoice.sent, copy.invoice.received].map((label) => (
                <div key={label} className="break-inside-avoid">
                  <p className="text-sm">{label}</p>
                  <div className="mt-10 border-b border-white/30 print:border-black/50" />
                  <p className="mt-1 text-xs text-white/40 print:text-black/50">{copy.invoice.signature}</p>
                </div>
              ))}
            </div>
          </article>
        )}
      </div>
    </>
  );
}
