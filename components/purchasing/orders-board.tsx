"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, SUPPLIERS_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { callPurchasingApi } from "@/lib/purchasing/client";
import { dateLabel, formatQty } from "@/lib/purchasing/format";
import type { PurchaseRequest } from "@/lib/purchasing/model";

export type OrderProduct = { name: string; unit: string };
export type OrderSupplier = { name: string; code: string; contact: string | null };

type Lookup = {
  products: Record<string, OrderProduct>;
  suppliers: Record<string, OrderSupplier>;
};

function useLabels({ products, suppliers }: Lookup) {
  const { t } = useT();
  return {
    product: (id: string) => products[id]?.name ?? id,
    unit: (unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit),
    supplier: (id: string) => suppliers[id] ?? null,
  };
}

function SupplierHeading({ request, lookup }: { request: PurchaseRequest; lookup: Lookup }) {
  const { t } = useT();
  const supplier = useLabels(lookup).supplier(request.supplierId);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CardTitle>{supplier?.name ?? request.supplierId}</CardTitle>
      {supplier && <span className="font-mono text-xs text-white/40">{supplier.code}</span>}
      {request.autoCreated && <Badge className="border-amber-300/60 text-amber-200">{t.purchasing.orders.auto}</Badge>}
      <span className="text-xs text-white/50">{dateLabel(request.requestDate, t.purchasing.locale)}</span>
      {supplier?.contact && (
        <span className="text-xs text-white/60">
          {t.purchasing.orders.contact}: {supplier.contact}
        </span>
      )}
    </div>
  );
}

/** A draft: quantities stay editable until the chef approves and sends it. */
function DraftCard({ request, lookup, canEdit, onDone }: { request: PurchaseRequest; lookup: Lookup; canEdit: boolean; onDone: () => void }) {
  const { t } = useT();
  const copy = t.purchasing.orders;
  const labels = useLabels(lookup);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => ReturnType<typeof callPurchasingApi>) => {
    setPending(true);
    setError(null);
    const outcome = await call();
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    onDone();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const items = request.items.map((item) => ({ product_id: item.productId, qty: String(data.get(`qty-${item.productId}`) ?? "") }));
    void run(() => callPurchasingApi(`/api/purchase-requests/${request.id}/send`, "POST", { items }));
  };

  const discard = () => {
    if (!window.confirm(copy.confirmDiscard)) return;
    void run(() => callPurchasingApi(`/api/purchase-requests/${request.id}`, "DELETE"));
  };

  return (
    <Card className="flex flex-col gap-3">
      <SupplierHeading request={request} lookup={lookup} />
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.product}</TableHead>
              <TableHead>{copy.qty}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {request.items.map((item) => (
              <TableRow key={item.productId}>
                <TableCell className="text-white">{labels.product(item.productId)}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`${copy.qty}: ${labels.product(item.productId)}`}
                        name={`qty-${item.productId}`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        required
                        defaultValue={formatQty(item.qty)}
                        className="w-28"
                      />
                      <span className="text-xs text-white/60">{labels.unit(item.unit)}</span>
                    </div>
                  ) : (
                    `${formatQty(item.qty)} ${labels.unit(item.unit)}`
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {copy.approve}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={discard}>
              {copy.discard}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function SentCard({ request, lookup, canEdit, onDone }: { request: PurchaseRequest; lookup: Lookup; canEdit: boolean; onDone: () => void }) {
  const { t } = useT();
  const copy = t.purchasing.orders;
  const labels = useLabels(lookup);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receive = async () => {
    setPending(true);
    setError(null);
    const outcome = await callPurchasingApi(`/api/purchase-requests/${request.id}/receive`, "POST");
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    onDone();
  };

  return (
    <Card className="flex flex-col gap-3">
      <SupplierHeading request={request} lookup={lookup} />
      {request.sentAt && (
        <p className="text-xs text-white/50">
          {copy.sentAt}: {new Date(request.sentAt).toLocaleString(t.purchasing.locale)}
        </p>
      )}
      <ul className="flex flex-col gap-1 text-sm text-white/80">
        {request.items.map((item) => (
          <li key={item.productId}>
            {labels.product(item.productId)}: {formatQty(item.qty)} {labels.unit(item.unit)}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {canEdit && (
        <div>
          <Button variant="outline" disabled={pending} onClick={receive}>
            {copy.receive}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Purchase requests: auto-created drafts to approve, sent orders waiting for delivery. */
export default function OrdersBoard({
  drafts,
  sent,
  products,
  suppliers,
  canEdit,
}: {
  drafts: PurchaseRequest[];
  sent: PurchaseRequest[];
  canEdit: boolean;
} & Lookup) {
  const { t } = useT();
  const copy = t.purchasing.orders;
  const router = useRouter();
  const lookup = { products, suppliers };
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: string } | null>(null);
  const refresh = () => router.refresh();

  const check = async () => {
    setChecking(true);
    setMessage(null);
    const outcome = await callPurchasingApi("/api/purchase-requests/auto-check", "POST");
    setChecking(false);
    if (!outcome.ok) {
      setMessage({ kind: "error", text: t.purchasing.errors[outcome.error] });
      return;
    }
    const changed = (outcome.data as { changed?: unknown } | null)?.changed;
    setMessage({ kind: "notice", text: copy.checked(typeof changed === "number" ? changed : 0) });
    refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.title}
          </Link>
          <Link href={SUPPLIERS_PATH} className={buttonVariants("outline", "sm")}>
            {t.purchasing.suppliers.open}
          </Link>
          {canEdit && (
            <Button size="sm" disabled={checking} onClick={check}>
              {copy.check}
            </Button>
          )}
        </div>
      </div>

      {!canEdit && <p className="text-sm text-white/60">{copy.readOnly}</p>}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
          {message.text}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">{copy.drafts}</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-white/60">{copy.empty}</p>
        ) : (
          drafts.map((request) => <DraftCard key={request.id} request={request} lookup={lookup} canEdit={canEdit} onDone={refresh} />)
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-white">{copy.sent}</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-white/60">{copy.noSent}</p>
        ) : (
          sent.map((request) => <SentCard key={request.id} request={request} lookup={lookup} canEdit={canEdit} onDone={refresh} />)
        )}
      </section>
    </div>
  );
}
