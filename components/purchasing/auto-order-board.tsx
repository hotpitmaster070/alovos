"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH, AUTO_ORDER_PATH, ORDERS_PATH, SUPPLIERS_PATH } from "@/lib/auth-redirect";
import { supplierCount, type AutoOrderGroup } from "@/lib/auto-order/model";
import type { ProductOption } from "@/lib/auto-order/repository";
import type { OrderMessage } from "@/lib/auto-order/send";
import { useT } from "@/lib/i18n/useT";
import { callPurchasingApi } from "@/lib/purchasing/client";
import { formatQty } from "@/lib/purchasing/format";
import type { PurchaseRequest } from "@/lib/purchasing/model";

export type BoardDraft = OrderMessage & { request: PurchaseRequest };
type Notice = { kind: "ok" | "error"; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
      {notice.text}
    </p>
  );
}

function SentList({ sent }: { sent: OrderMessage[] }) {
  const { t } = useT();
  const copy = t.autoOrder.board;
  if (sent.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 border-emerald-400/40">
      <CardTitle>{copy.sent(sent.length)}</CardTitle>
      <ul className="flex flex-col gap-3">
        {sent.map((order) => (
          <li key={order.requestId} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-white">{order.supplierName}</span>
            <span className="text-xs text-white/60">{order.message}</span>
            <span className="flex flex-wrap gap-2">
              {order.whatsapp && (
                <a href={order.whatsapp} target="_blank" rel="noreferrer" className={buttonVariants("default", "sm")}>
                  {copy.whatsapp}
                </a>
              )}
              {order.mailto && (
                <a href={order.mailto} className={buttonVariants("outline", "sm")}>
                  {copy.email}
                </a>
              )}
              {!order.whatsapp && !order.mailto && <span className="text-xs text-amber-200">{copy.noContact}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ExtraForm({ draft, products, onDone }: { draft: PurchaseRequest; products: ProductOption[]; onDone: () => void }) {
  const { t } = useT();
  const copy = t.autoOrder.board;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inDraft = new Set(draft.items.map((item) => item.productId));
  const options = products.filter((product) => !inDraft.has(product.id));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const outcome = await callPurchasingApi(`/api/purchase-requests/${draft.id}/add-extra`, "POST", {
      product_id: String(data.get("product_id") ?? ""),
      qty: String(data.get("qty") ?? ""),
    });
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    setOpen(false);
    onDone();
  };

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={options.length === 0}>
          {copy.addExtra}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px] flex-1">
        <Label htmlFor={`extra-product-${draft.id}`}>{copy.extraProduct}</Label>
        <Select id={`extra-product-${draft.id}`} name="product_id" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {options.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({isUnit(product.unit) ? t.anbar.units[product.unit] : product.unit})
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`extra-qty-${draft.id}`}>{copy.extraQty}</Label>
        <Input id={`extra-qty-${draft.id}`} name="qty" type="number" min="0" step="any" inputMode="decimal" required className="w-28" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {copy.add}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {copy.cancel}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Auto-order by supplier: today's drafts as tabs (auto lines and extras), what is still needed,
 * products without a supplier, and sending each supplier its list.
 */
export default function AutoOrderBoard({
  canEdit,
  branches,
  branchId,
  groups,
  drafts,
  products,
}: {
  canEdit: boolean;
  branches: { id: string; name: string }[];
  branchId: string | null;
  groups: AutoOrderGroup[];
  drafts: BoardDraft[];
  products: ProductOption[];
}) {
  const { t } = useT();
  const copy = t.autoOrder.board;
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(drafts[0]?.requestId ?? null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sent, setSent] = useState<OrderMessage[]>([]);
  const unit = (value: string) => (isUnit(value) ? t.anbar.units[value] : value);
  const names = useMemo(() => Object.fromEntries(products.map((product) => [product.id, product.name])), [products]);
  const stock = useMemo(() => {
    const map: Record<string, number> = {};
    for (const group of groups) for (const item of group.items) map[item.productId] = item.quantity;
    return map;
  }, [groups]);
  const current = drafts.find((draft) => draft.requestId === selected) ?? drafts[0] ?? null;
  const withSupplier = supplierCount(groups);

  const build = async () => {
    if (!branchId) return;
    setPending("build");
    setNotice(null);
    const outcome = await callPurchasingApi("/api/auto-order/create-drafts", "POST", { branch_id: branchId });
    setPending(null);
    if (!outcome.ok) {
      setNotice({ kind: "error", text: t.purchasing.errors[outcome.error] });
      return;
    }
    const count = (outcome.data as { drafts?: unknown } | null)?.drafts;
    setNotice({ kind: "ok", text: copy.built(typeof count === "number" ? count : 0) });
    router.refresh();
  };

  const send = async (ids: string[], key: string) => {
    setPending(key);
    setNotice(null);
    const outcome = await callPurchasingApi("/api/purchase-requests/send-all", "POST", { ids });
    setPending(null);
    if (!outcome.ok) {
      setNotice({ kind: "error", text: t.purchasing.errors[outcome.error] });
      return;
    }
    const result = outcome.data as { sent?: OrderMessage[]; failed?: unknown[] } | null;
    setSent(result?.sent ?? []);
    if (result?.failed?.length) setNotice({ kind: "error", text: t.purchasing.errors.invalid_status });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-white/60">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={ORDERS_PATH} className={buttonVariants("outline", "sm")}>
            {copy.oldBoard}
          </Link>
          <Link href={SUPPLIERS_PATH} className={buttonVariants("outline", "sm")}>
            {t.purchasing.suppliers.open}
          </Link>
        </div>
      </div>

      {branches.length > 1 && (
        <div className="max-w-xs">
          <Label htmlFor="auto-order-branch">{copy.branch}</Label>
          <Select id="auto-order-branch" value={branchId ?? ""} onChange={(event) => router.push(`${AUTO_ORDER_PATH}?branch=${encodeURIComponent(event.target.value)}`)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!canEdit && <p className="text-sm text-white/60">{copy.readOnly}</p>}

      {drafts.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-emerald-400/40 bg-emerald-500/10">
          <span className="text-lg font-semibold text-emerald-100">{copy.ready(drafts.length)}</span>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {withSupplier > 0 && (
                <Button size="sm" variant="outline" disabled={pending !== null} onClick={build}>
                  {pending === "build" ? copy.building : copy.build}
                </Button>
              )}
              <Button size="sm" disabled={pending !== null} onClick={() => void send(drafts.map((draft) => draft.requestId), "all")}>
                {pending === "all" ? copy.sending : copy.sendAll(drafts.length)}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-white/70">{withSupplier > 0 ? copy.noDrafts : copy.nothing}</span>
          {canEdit && withSupplier > 0 && (
            <Button size="sm" disabled={pending !== null} onClick={build}>
              {pending === "build" ? copy.building : copy.build}
            </Button>
          )}
        </Card>
      )}

      <NoticeLine notice={notice} />
      <SentList sent={sent} />

      {current && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-white">{copy.drafts}</h2>
          <div role="tablist" aria-label={copy.drafts} className="flex flex-wrap gap-2">
            {drafts.map((draft) => (
              <button
                key={draft.requestId}
                type="button"
                role="tab"
                aria-selected={draft.requestId === current.requestId}
                onClick={() => setSelected(draft.requestId)}
                className={buttonVariants(draft.requestId === current.requestId ? "default" : "outline", "sm")}
              >
                {draft.supplierName} · {draft.request.items.length}
              </button>
            ))}
          </div>
          <Card role="tabpanel" className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.product}</TableHead>
                  <TableHead>{copy.qty}</TableHead>
                  <TableHead>{copy.left}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.request.items.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell className="text-white">
                      {names[item.productId] ?? item.productId}{" "}
                      {item.extra ? (
                        <Badge className="ml-1 border-sky-300/60 text-sky-200">{copy.extra}</Badge>
                      ) : current.request.autoCreated ? (
                        <Badge className="ml-1 border-amber-300/60 text-amber-200">{copy.auto}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {formatQty(item.qty)} {unit(item.unit)}
                    </TableCell>
                    <TableCell className="text-white/60">{stock[item.productId] === undefined ? "" : `${formatQty(stock[item.productId])} ${unit(item.unit)}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canEdit && <ExtraForm key={current.requestId} draft={current.request} products={products} onDone={() => router.refresh()} />}
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-white/50">{copy.message}</span>
              <p className="rounded-[12px] border border-line bg-bg px-3 py-2 text-sm text-white/80">{current.message}</p>
            </div>
            {canEdit && (
              <div>
                <Button disabled={pending !== null} onClick={() => void send([current.requestId], current.requestId)}>
                  {pending === current.requestId ? copy.sending : copy.sendOne}
                </Button>
              </div>
            )}
          </Card>
        </section>
      )}

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-white">{copy.preview}</h2>
          {groups.map((group) => (
            <Card key={group.supplierId ?? "none"} className={group.supplierId ? "flex flex-col gap-2" : "flex flex-col gap-2 border-amber-300/50"}>
              <CardTitle>{group.supplierId ? group.name : copy.noSupplier}</CardTitle>
              {!group.supplierId && (
                <p className="text-sm text-amber-200">
                  {copy.noSupplierHint}{" "}
                  <Link href={ANBAR_CATALOG_PATH} className="underline">
                    {copy.setSupplier}
                  </Link>
                </p>
              )}
              <ul className="flex flex-col gap-1 text-sm text-white/80">
                {group.items.map((item) => (
                  <li key={item.productId}>
                    {item.name}: {formatQty(item.need)} {unit(item.unit)}{" "}
                    <span className="text-xs text-white/50">
                      ({copy.left} {formatQty(item.quantity)})
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
