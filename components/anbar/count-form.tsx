"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lookupCodeAction } from "@/lib/anbar/actions";
import type { Branch, StorageLocation } from "@/lib/anbar/types";
import { ANBAR_APP_PATH, ANBAR_COUNT_PATH } from "@/lib/auth-redirect";
import {
  approveCountAction,
  cancelCountAction,
  mergeCountAction,
  startCountAction,
  type CountActionResult,
} from "@/lib/count/actions";
import { GROUP_KEY_MAX_LENGTH, type CountErrorCode, type CountProduct, type StockCount } from "@/lib/count/model";
import { useT } from "@/lib/i18n/useT";
import { localDateTime } from "@/lib/tenant-settings/time";
import AddStorageLocation from "./add-storage-location";
import BarcodeScanner from "./barcode-scanner";

type Notice = "saved" | "finished" | "started" | "merged" | "approved" | "cancelled";
type Message = { kind: "notice"; key: Notice } | { kind: "error"; key: CountErrorCode } | { kind: "scan"; code: string };

const locationHref = (id: string) => `${ANBAR_COUNT_PATH}?location=${encodeURIComponent(id)}`;

export default function CountForm({
  branches,
  locations,
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
  history,
  historyTotal,
  historyPage,
  timeZone,
}: {
  branches: Branch[];
  /** Active storage places; counting is per place. */
  locations: StorageLocation[];
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
  notice: "saved" | "finished" | null;
  error: CountErrorCode | null;
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
  const [list, setList] = useState(locations);
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

  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const locationName = new Map(list.map((location) => [location.id, location.name]));
  const label = (location: StorageLocation) =>
    branches.length > 1 ? `${branchName.get(location.branchId) ?? ""} · ${location.name}` : location.name;

  /** Query a pager keeps: the place and the other pager's page. */
  const pagerQuery = (otherParam: string, otherPage: number): Record<string, string> => ({
    ...(locationId ? { location: locationId } : {}),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.hiddenUntilMerge}</p>
        </div>
        <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
          {t.anbar.title}
        </Link>
      </div>

      <div>
        <Label htmlFor="count-location">{copy.location}</Label>
        <div className="flex items-center gap-2">
          <Select
            id="count-location"
            value={locationId ?? ""}
            disabled={pending || list.length === 0}
            onChange={(event) => router.push(locationHref(event.target.value))}
          >
            {list.length === 0 && <option value="">{copy.noLocations}</option>}
            {list.map((location) => (
              <option key={location.id} value={location.id}>
                {label(location)}
              </option>
            ))}
          </Select>
          <AddStorageLocation
            branches={branches}
            branchId={list.find((location) => location.id === locationId)?.branchId ?? null}
            onCreated={(location) => {
              setList((current) => [...current, location].sort((a, b) => a.name.localeCompare(b.name)));
              router.push(locationHref(location.id));
            }}
          />
        </div>
      </div>

      {message && (
        <p role={message.kind === "notice" ? "status" : "alert"} className={message.kind === "notice" ? "text-sm text-emerald-400" : "text-sm text-red-400"}>
          {messageText(message)}
        </p>
      )}

      {locationId && (
        <Card className="flex flex-col gap-4">
          {count ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-white">
                {copy.status[count.status]}
                {count.groupKey && <span className="text-white/50"> · {count.groupKey}</span>}
              </span>
              <span className="text-white/60">
                {copy.finishedCount(count.finishedBy.length)}
                {count.mergeMode && ` · ${copy.mergeMode}: ${copy.mergeModes[count.mergeMode]}`}
              </span>
              <Link href={`${ANBAR_COUNT_PATH}/${count.id}`} className={buttonVariants("outline", "sm")}>
                {copy.discrepancies}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-white/60">{copy.noCount}</p>
          )}

          {!canCount && <p className="text-sm text-white/60">{copy.readOnly}</p>}

          {canCount && (!count || count.status === "draft") && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const groupKey = String(new FormData(event.currentTarget).get("group_key") ?? "");
                act(() => startCountAction(locationId, groupKey), "started");
              }}
            >
              <div>
                <Label htmlFor="count-group">{copy.groupKey}</Label>
                <Input
                  id="count-group"
                  name="group_key"
                  maxLength={GROUP_KEY_MAX_LENGTH}
                  autoComplete="off"
                  defaultValue={count?.groupKey ?? ""}
                />
                <p className="mt-1.5 text-xs text-white/50">{copy.groupHint}</p>
              </div>
              <Button type="submit" disabled={pending}>
                {copy.start}
              </Button>
            </form>
          )}

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
                  <TableCell>{locationName.get(item.locationId) ?? "—"}</TableCell>
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
