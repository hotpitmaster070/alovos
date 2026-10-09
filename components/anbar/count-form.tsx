"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lookupCodeAction } from "@/lib/anbar/actions";
import type { StorageOverview } from "@/lib/anbar/repository";
import type { Branch } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, ANBAR_COUNT_PATH, ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import { approveCountAction, cancelCountAction, mergeCountAction, type CountActionResult } from "@/lib/count/actions";
import type { CountErrorCode, CountProduct, StockCount } from "@/lib/count/model";
import { useT } from "@/lib/i18n/useT";
import { localDateTime } from "@/lib/tenant-settings/time";
import BarcodeScanner from "./barcode-scanner";
import { StorageCard, StorageGrid } from "./storage-card";

type Notice = "saved" | "finished" | "started" | "merged" | "approved" | "cancelled";
type Message = { kind: "notice"; key: Notice } | { kind: "error"; key: CountErrorCode } | { kind: "scan"; code: string };

const locationHref = (id: string) => `${ANBAR_COUNT_PATH}?location=${encodeURIComponent(id)}`;
const branchHref = (id: string) => `${ANBAR_COUNT_PATH}?branch=${encodeURIComponent(id)}`;

export default function CountForm({
  branches,
  branchId,
  locations,
  locationNames,
  locationId,
  count,
  finishedMine,
  canCount,
  canApprove,
  products,
  extraProducts,
  counters,
  total,
  page,
  pageSize,
  mine,
  notice,
  error,
  existingId,
  history,
  historyTotal,
  historyPage,
  timeZone,
}: {
  branches: Branch[];
  branchId: string | null;
  /** Active storage places of the branch in display order; counting is per place. */
  locations: StorageOverview[];
  /** "<code> · <name>" of every place, for the history. */
  locationNames: Record<string, string>;
  locationId: string | null;
  /** The open count of the place, if any. */
  count: StockCount | null;
  finishedMine: boolean;
  canCount: boolean;
  canApprove: boolean;
  /** One page of the products kept at the place. */
  products: CountProduct[];
  /** Products the user already entered that are not on this page (scanned ones included). */
  extraProducts: CountProduct[];
  /** People who entered each product, by product id. */
  counters: Record<string, number>;
  total: number;
  page: number;
  pageSize: number;
  /** The user's own entries, by product id. */
  mine: Record<string, number>;
  notice: "saved" | "finished" | "started" | null;
  error: CountErrorCode | null;
  /** Open count named by a failed start, when the server could resolve one. */
  existingId: string | null;
  history: StockCount[];
  historyTotal: number;
  historyPage: number;
  /** Tenant time zone for dates. */
  timeZone: string;
}) {
  const { t } = useT();
  const copy = t.anbar.sayim;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scanned, setScanned] = useState<CountProduct[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(
    error ? { kind: "error", key: error } : notice ? { kind: "notice", key: notice } : null,
  );

  useEffect(() => {
    if (!focusId) return;
    const input = document.getElementById(`count-${focusId}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
    setFocusId(null);
  }, [focusId, scanned]);

  /** Query a pager keeps: the place (or branch) and the other pager's page. */
  const pagerQuery = (otherParam: string, otherPage: number): Record<string, string> => ({
    ...(locationId ? { location: locationId } : branchId ? { branch: branchId } : {}),
    ...(otherPage > 1 ? { [otherParam]: String(otherPage) } : {}),
  });

  const counting = count?.status === "counting";
  const editable = counting && canCount && !finishedMine;
  const rows = [...products, ...extraProducts, ...scanned].filter(
    (row, index, all) => all.findIndex((other) => other.id === row.id) === index,
  );

  const act = (run: () => Promise<CountActionResult>, done: Notice, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await run();
        setMessage(result.ok ? { kind: "notice", key: done } : { kind: "error", key: result.error });
        if (result.ok) router.refresh();
      } catch {
        setMessage({ kind: "error", key: "save_failed" });
      }
    });
  };

  const onScan = (code: string) => {
    setMessage(null);
    startTransition(async () => {
      const found = await lookupCodeAction(code);
      if (!found.ok) {
        setMessage({ kind: "error", key: "save_failed" });
        return;
      }
      if (!found.product) {
        setMessage({ kind: "scan", code: found.code });
        return;
      }
      const product = found.product;
      if (!rows.some((row) => row.id === product.id)) {
        setScanned((current) => [...current, { id: product.id, name: product.name, unit: product.unit }]);
      }
      setFocusId(product.id);
    });
  };

  const messageText = (value: Message) =>
    value.kind === "notice"
      ? copy.notices[value.key]
      : value.kind === "error"
        ? copy.errors[value.key]
        : `${copy.scanNotFound}: ${value.code}`;

  const dismissMessage = () => {
    setMessage(null);
    const params = new URLSearchParams(window.location.search);
    if (!params.has("error") && !params.has("notice") && !params.has("existingId") && !params.has("countId")) return;
    params.delete("error");
    params.delete("notice");
    params.delete("existingId");
    params.delete("countId");
    const query = params.toString();
    router.replace(query ? `${ANBAR_COUNT_PATH}?${query}` : ANBAR_COUNT_PATH, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.hiddenUntilMerge}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link
            href={branchId ? `${ANBAR_STORAGE_PATH}?branch=${encodeURIComponent(branchId)}` : ANBAR_STORAGE_PATH}
            className={buttonVariants("outline", "sm")}
          >
            {t.anbar.saxlama.open}
          </Link>
          <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.title}
          </Link>
        </div>
      </div>

      {branches.length > 1 && (
        <div className="max-w-xs">
          <Label htmlFor="count-branch">{t.anbar.saxlama.branch}</Label>
          <Select
            id="count-branch"
            value={branchId ?? ""}
            disabled={pending}
            onChange={(event) => router.push(branchHref(event.target.value))}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </Select>
        </div>
      )}

      {locations.length === 0 ? (
        <p className="text-sm text-white/60">{copy.noLocations}</p>
      ) : (
        <StorageGrid
          locations={locations}
          renderCard={(location) => {
            const open = location.openCount;
            const startable = canCount && (open === null || open.status === "draft" || open.status === "counting");
            return (
              <StorageCard key={location.id} location={location} selected={location.id === locationId}>
                <div className="flex flex-wrap gap-2">
                  {startable && (
                    <form action="/api/stock/count" method="post">
                      <input type="hidden" name="location_id" value={location.id} />
                      <Button type="submit" size="sm" disabled={pending}>
                        {open?.status === "counting" ? t.anbar.saxlama.join : t.anbar.saxlama.startCount}
                      </Button>
                    </form>
                  )}
                  {open?.status === "merging" && (
                    <Link href={`${ANBAR_COUNT_PATH}/${open.id}`} className={buttonVariants("outline", "sm")}>
                      {copy.discrepancies}
                    </Link>
                  )}
                  {location.id !== locationId && (
                    <Link href={locationHref(location.id)} className={buttonVariants("ghost", "sm")}>
                      {t.anbar.saxlama.view}
                    </Link>
                  )}
                </div>
              </StorageCard>
            );
          }}
        />
      )}

      {message && (
        <div
          role={message.kind === "notice" ? "status" : "alert"}
          className={
            message.kind === "notice"
              ? "flex items-start justify-between gap-3 rounded-[12px] border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300"
              : "flex items-start justify-between gap-3 rounded-[12px] border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300"
          }
        >
          <div>
            <p>{messageText(message)}</p>
            {message.kind === "error" && message.key === "count_already_open" && existingId && (
              <Link href={`${ANBAR_COUNT_PATH}/${existingId}`} className="mt-1 inline-block underline-offset-2 hover:underline">
                {copy.openExisting}
              </Link>
            )}
          </div>
          <button type="button" onClick={dismissMessage} className="shrink-0 underline-offset-2 hover:underline">
            {copy.dismiss}
          </button>
        </div>
      )}

      {locationId && (
        <Card className="flex flex-col gap-4">
          <CardTitle>{locationNames[locationId]}</CardTitle>
          {count ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-white">
                {copy.status[count.status]}
                {count.groupKey && <span className="text-white/50"> · {count.groupKey}</span>}
              </span>
              <Badge>{copy.countersBadge(count.counters.length)}</Badge>
              <span className="text-white/60">
                {copy.finishedCount(count.finishedBy.length)} · {copy.mergeMode}: {copy.mergeModes[count.mergeMode]}
              </span>
              <Link href={`${ANBAR_COUNT_PATH}/${count.id}`} className={buttonVariants("outline", "sm")}>
                {copy.discrepancies}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-white/60">{copy.noCount}</p>
          )}

          {!canCount && <p className="text-sm text-white/60">{copy.readOnly}</p>}

          {counting && finishedMine && <p className="text-sm text-white/60">{copy.finishedMine} {copy.waitMerge}</p>}
          {count?.status === "merging" && <p className="text-sm text-white/60">{copy.waitApprove}</p>}

          {counting && (
            <form action="/api/stock/count" method="post" className="flex flex-col gap-4">
              <input type="hidden" name="count_id" value={count.id} />
              {editable && (
                <BarcodeScanner onScan={onScan} disabled={pending} className="self-start" />
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-white/60">{copy.empty}</p>
              ) : (
                rows.map((product) => (
                  <div key={product.id} className="flex items-center justify-between gap-3">
                    <label htmlFor={`count-${product.id}`} className="min-w-0 text-sm text-white">
                      {product.name}
                      <span className="text-white/40"> · {product.unit}</span>
                      {(counters[product.id] ?? 0) > 0 && (
                        <span className="block text-xs text-white/40">
                          {copy.counters}: {counters[product.id]}
                        </span>
                      )}
                    </label>
                    <Input
                      id={`count-${product.id}`}
                      className="max-w-[120px]"
                      name={`qty_${product.id}`}
                      inputMode="decimal"
                      defaultValue={mine[product.id] ?? ""}
                      disabled={!editable}
                      aria-label={`${product.name}, ${copy.counted}`}
                    />
                  </div>
                ))
              )}
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="intent" value="save" disabled={pending}>
                    {copy.submit}
                  </Button>
                  <Button type="submit" name="intent" value="finish" variant="outline" disabled={pending}>
                    {copy.finish}
                  </Button>
                </div>
              )}
            </form>
          )}

          {count && canApprove && (
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
              {counting && (
                <Button type="button" disabled={pending} onClick={() => act(() => mergeCountAction(count.id), "merged")}>
                  {copy.merge}
                </Button>
              )}
              {count.status === "merging" && (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => approveCountAction(count.id), "approved", copy.confirmApprove)}
                >
                  {copy.approve}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => act(() => cancelCountAction(count.id), "cancelled", copy.confirmCancel)}
              >
                {copy.cancel}
              </Button>
            </div>
          )}
        </Card>
      )}

      {counting && (
        <Pager
          path={ANBAR_COUNT_PATH}
          query={pagerQuery("h", historyPage)}
          page={page}
          pageSize={pageSize}
          total={total}
          shown={products.length}
        />
      )}

      <Card>
        <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{copy.history}</CardTitle>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">{copy.noHistory}</p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>{copy.startedAt}</TableHead>
                <TableHead>{copy.location}</TableHead>
                <TableHead>{copy.state}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`${ANBAR_COUNT_PATH}/${item.id}`} className="underline-offset-2 hover:underline">
                      {localDateTime(item.createdAt, timeZone)}
                    </Link>
                  </TableCell>
                  <TableCell>{locationNames[item.locationId] ?? "—"}</TableCell>
                  <TableCell>{copy.status[item.status]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager
          path={ANBAR_COUNT_PATH}
          query={pagerQuery("page", page)}
          page={historyPage}
          pageSize={pageSize}
          total={historyTotal}
          shown={history.length}
          param="h"
        />
      </Card>
    </div>
  );
}
