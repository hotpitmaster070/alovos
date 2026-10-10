"use client";

import { motion } from "framer-motion";
import { ArrowRight, Loader2, Plus, Printer, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Confetti from "@/components/anbar/import/confetti";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { VirtualRows } from "@/components/ui/virtual-rows";
import { compareStorageLocations, isUnit, type Branch, type StorageLocation } from "@/lib/anbar/types";
import { ANBAR_CATALOG_PATH, transferInvoicePath } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { transferOptionsAction } from "@/lib/transfer/actions";
import {
  addLine,
  applyShortages,
  buildTransferRequest,
  canSubmit,
  lineProblem,
  refreshAvailability,
  removeLine,
  setQuantity,
  type CartLine,
  type TransferOption,
} from "@/lib/transfer/cart";
import { TRANSFER_MAX_ITEMS, TRANSFER_NOTE_MAX } from "@/lib/transfer/model";
import { cn } from "@/lib/utils";
import { formatDay, formatQuantity } from "./format";

const ROW_HEIGHT = 68;
const CART_HEIGHT = 476;
const SEARCH_DELAY_MS = 250;
const REDIRECT_AFTER_MS = 5000;

type Done = { id: string; number: string | null; lines: number };
type ApiReply = {
  ok?: boolean;
  transfer_id?: string | null;
  number?: string | null;
  error?: string;
  message?: string;
  shortages?: { product_id: string; available: number }[];
};

export default function TransferForm({
  allowed,
  branches,
  locations,
}: {
  allowed: boolean;
  branches: Branch[];
  locations: StorageLocation[];
}) {
  const { t, lang } = useT();
  const copy = t.transfers;
  const router = useRouter();
  const unitLabel = useCallback((unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit), [t]);
  const placesOf = useCallback(
    (branchId: string) => locations.filter((item) => item.branchId === branchId).sort(compareStorageLocations),
    [locations],
  );

  const [fromBranch, setFromBranch] = useState(branches[0]?.id ?? "");
  const [toBranch, setToBranch] = useState(branches.find((item) => item.id !== branches[0]?.id)?.id ?? "");
  const [fromPlace, setFromPlace] = useState("");
  const [toPlace, setToPlace] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransferOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const searchSeq = useRef(0);
  const quantityRefs = useRef(new Map<string, HTMLInputElement>());

  const fromLocationId = fromPlace || null;
  const toLocationId = toPlace || null;
  const draft = { fromBranchId: fromBranch, toBranchId: toBranch, fromLocationId, toLocationId, lines, note };
  const ready = canSubmit(draft);
  const problems = useMemo(() => lines.filter((line) => lineProblem(line) !== null).length, [lines]);

  // Search: debounced; only the latest answer counts.
  useEffect(() => {
    const text = query.trim();
    if (!allowed || !fromBranch || text === "") {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const result = await transferOptionsAction({ branchId: fromBranch, locationId: fromLocationId, search: text }).catch(() => null);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (!result) return setMessage(copy.network);
      if (!result.ok) return setMessage(copy.optionsErrors[result.error]);
      setResults(result.options);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [allowed, query, fromBranch, fromLocationId, copy]);

  // New source: availability of the products already on the note.
  const productKey = lines.map((line) => line.productId).join(",");
  useEffect(() => {
    if (!allowed || !fromBranch || productKey === "") return;
    let live = true;
    void transferOptionsAction({ branchId: fromBranch, locationId: fromLocationId, productIds: productKey.split(",") })
      .then((result) => {
        if (live && result.ok) setLines((current) => refreshAvailability(current, result.options));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Only a change of source re-reads availability; adding a line already carries its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, fromBranch, fromLocationId]);

  const add = (option: TransferOption) => {
    const next = addLine(lines, option);
    if (!next.added && lines.length >= TRANSFER_MAX_ITEMS) setMessage(copy.tooMany(TRANSFER_MAX_ITEMS));
    setLines(next.lines);
    setQuery("");
    setResults(null);
    requestAnimationFrame(() => quantityRefs.current.get(option.productId)?.focus());
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (results && results.length > 0 && (results.length === 1 || [results[0].barcode, results[0].internalCode].includes(query.trim()))) {
      add(results[0]);
    }
  };

  const changeFromBranch = (next: string) => {
    setFromBranch(next);
    setFromPlace("");
    if (next === toBranch) {
      setToBranch(branches.find((item) => item.id !== next)?.id ?? "");
      setToPlace("");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = buildTransferRequest(draft);
    if (!body || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/transfer?lang=${lang.toLowerCase()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const reply = (await response.json().catch(() => null)) as ApiReply | null;
      if (!response.ok || !reply?.ok || !reply.transfer_id) {
        if (reply?.shortages) setLines((current) => applyShortages(current, reply.shortages ?? []));
        setMessage(reply?.message ?? copy.network);
        return;
      }
      const transferId = reply.transfer_id;
      setDone({ id: transferId, number: reply.number ?? null, lines: lines.length });
      setTimeout(() => router.push(transferInvoicePath(transferId)), REDIRECT_AFTER_MS);
    } catch {
      setMessage(copy.network);
    } finally {
      setSending(false);
    }
  };

  const otherBranches = branches.filter((item) => item.id !== fromBranch);
  const inCart = new Set(lines.map((line) => line.productId));

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-y-0 right-0 hidden bg-[#0A0A0A] lg:left-64 lg:block" />
      <div className="relative z-10 -mx-4 -my-8 flex min-h-screen flex-col gap-6 bg-[#0A0A0A] p-6 text-white lg:-mx-10">
        <div className="flex items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
            <p className="mt-2 text-sm text-white/60">{copy.subtitle}</p>
          </div>
          <Link href={ANBAR_CATALOG_PATH} className={buttonVariants("outline", "sm")}>
            {copy.back}
          </Link>
        </div>

        {!allowed ? (
          <p className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 text-white/70">{copy.forbidden}</p>
        ) : branches.length < 2 ? (
          <p className="rounded-[18px] border border-white/10 bg-white/[0.03] p-6 text-white/70">{copy.needTwoBranches}</p>
        ) : done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 text-center"
          >
            <Confetti />
            <p className="text-sm uppercase tracking-widest text-white/50">{copy.success.title}</p>
            <p className="font-serif text-[30px] font-bold leading-tight">{done.number ? copy.success.number(done.number) : copy.success.title}</p>
            <p className="text-white/70">{copy.success.moved(done.lines)}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link href={`${transferInvoicePath(done.id)}?print=1`} className={buttonVariants("default", "default")}>
                <Printer className="h-4 w-4" />
                {copy.success.print}
              </Link>
              <Link href={transferInvoicePath(done.id)} className={buttonVariants("outline", "default")}>
                {copy.success.open}
              </Link>
            </div>
            <p className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.success.redirecting}
            </p>
          </motion.div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            <div className="grid items-end gap-4 lg:grid-cols-[1fr_auto_1fr]">
              <fieldset className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium uppercase tracking-widest text-white/50">{copy.from}</legend>
                <div className="space-y-1.5">
                  <Label htmlFor="from-branch">{copy.branch}</Label>
                  <Select id="from-branch" value={fromBranch} onChange={(event) => changeFromBranch(event.target.value)} disabled={sending}>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="from-place">{copy.place}</Label>
                  <Select id="from-place" value={fromPlace} onChange={(event) => setFromPlace(event.target.value)} disabled={sending}>
                    <option value="">{copy.anyPlace}</option>
                    {placesOf(fromBranch).map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.code} · {place.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </fieldset>
              <ArrowRight aria-hidden className="mx-auto hidden h-6 w-6 text-white/40 lg:block" />
              <fieldset className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium uppercase tracking-widest text-white/50">{copy.to}</legend>
                <div className="space-y-1.5">
                  <Label htmlFor="to-branch">{copy.branch}</Label>
                  <Select
                    id="to-branch"
                    value={toBranch}
                    onChange={(event) => {
                      setToBranch(event.target.value);
                      setToPlace("");
                    }}
                    disabled={sending}
                  >
                    {otherBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to-place">{copy.place}</Label>
                  <Select id="to-place" value={toPlace} onChange={(event) => setToPlace(event.target.value)} disabled={sending}>
                    <option value="">{copy.autoPlace}</option>
                    {placesOf(toBranch).map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.code} · {place.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </fieldset>
            </div>

            <div className="relative space-y-1.5">
              <Label htmlFor="transfer-search">{copy.search.label}</Label>
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  id="transfer-search"
                  type="search"
                  autoComplete="off"
                  value={query}
                  maxLength={100}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder={copy.search.placeholder}
                  disabled={sending}
                  className="w-full rounded-[12px] border border-line bg-bg py-2.5 pl-9 pr-9 text-sm text-white placeholder:text-white/35 focus:border-beige focus:outline-none"
                />
                {searching && <Loader2 aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/50" />}
              </div>
              {results && (
                <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-[14px] border border-white/10 bg-[#141414] p-1 shadow-2xl">
                  {results.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-white/50">{copy.search.empty(query.trim())}</li>
                  ) : (
                    results.map((option) => {
                      const added = inCart.has(option.productId);
                      return (
                        <li key={option.productId}>
                          <button
                            type="button"
                            disabled={added}
                            onClick={() => add(option)}
                            className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{option.name}</span>
                              <span className="block truncate text-xs text-white/45">
                                {[option.internalCode, option.barcode].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <span className="shrink-0 text-right text-xs text-white/60">
                              <span className="block">{copy.available(formatQuantity(option.available, lang), unitLabel(option.unit))}</span>
                              <span className="block text-white/40">
                                {option.nearestExpiry ? formatDay(option.nearestExpiry, lang) : copy.noExpiry}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-beige">{added ? copy.search.added : <Plus className="h-4 w-4" aria-label={copy.search.add} />}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>

            <section className="overflow-x-auto rounded-[18px] border border-white/10 bg-white/[0.02]">
              <div className="min-w-[640px]">
                <div
                  role="row"
                  className="grid grid-cols-[minmax(180px,2fr)_minmax(110px,1fr)_minmax(110px,1fr)_150px_44px] gap-3 border-b border-white/10 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-white/50"
                >
                  <span>{copy.table.product}</span>
                  <span>{copy.table.available}</span>
                  <span>{copy.table.expiry}</span>
                  <span>{copy.table.quantity}</span>
                  <span className="sr-only">{copy.table.remove}</span>
                </div>
                {lines.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-white/45">{copy.empty}</p>
                ) : (
                  <VirtualRows
                    items={lines}
                    rowHeight={ROW_HEIGHT}
                    maxHeight={CART_HEIGHT}
                    getKey={(line) => line.productId}
                    renderRow={(line) => {
                      const problem = lineProblem(line);
                      const touched = line.quantity.trim() !== "";
                      const bad = problem === "exceeds" || (problem === "quantity" && touched);
                      return (
                        <div
                          role="row"
                          className={cn(
                            "grid h-full grid-cols-[minmax(180px,2fr)_minmax(110px,1fr)_minmax(110px,1fr)_150px_44px] items-center gap-3 border-b border-white/5 px-4 text-sm",
                            bad && "bg-red-500/[0.07]",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{line.name}</span>
                            <span className="block truncate text-xs text-white/45">{line.internalCode ?? line.barcode ?? ""}</span>
                          </span>
                          <span className={cn("tabular-nums", line.available <= 0 ? "text-red-300" : "text-white/80")}>
                            {copy.available(formatQuantity(line.available, lang), unitLabel(line.unit))}
                          </span>
                          <span className="tabular-nums text-white/60">
                            {line.nearestExpiry ? formatDay(line.nearestExpiry, lang) : copy.noExpiry}
                          </span>
                          <span>
                            <input
                              ref={(node) => {
                                if (node) quantityRefs.current.set(line.productId, node);
                                else quantityRefs.current.delete(line.productId);
                              }}
                              inputMode="decimal"
                              aria-label={`${copy.table.quantity}: ${line.name}`}
                              aria-invalid={bad}
                              value={line.quantity}
                              onChange={(event) => setLines((current) => setQuantity(current, line.productId, event.target.value))}
                              disabled={sending}
                              className={cn(
                                "w-full rounded-[10px] border bg-bg px-3 py-2 text-sm tabular-nums text-white focus:outline-none",
                                bad ? "border-red-400/60 focus:border-red-300" : "border-line focus:border-beige",
                              )}
                            />
                            {bad && (
                              <span className="mt-0.5 block truncate text-[11px] text-red-300">
                                {problem === "exceeds"
                                  ? copy.lineErrors.exceeds(formatQuantity(line.available, lang))
                                  : copy.lineErrors.quantity}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => setLines((current) => removeLine(current, line.productId))}
                            disabled={sending}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                            aria-label={`${copy.table.remove}: ${line.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    }}
                  />
                )}
              </div>
            </section>

            <div className="space-y-1.5">
              <Label htmlFor="transfer-note">{copy.note}</Label>
              <textarea
                id="transfer-note"
                value={note}
                maxLength={TRANSFER_NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                placeholder={copy.notePlaceholder}
                rows={2}
                disabled={sending}
                className="w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-beige focus:outline-none"
              />
            </div>

            {message && (
              <p role="alert" className="whitespace-pre-line rounded-[14px] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {message}
              </p>
            )}

            <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-[#0A0A0A]/90 px-6 py-4 backdrop-blur-xl">
              <span className="mr-auto text-sm text-white/50">
                {lines.length > 0 && copy.lines(lines.length)}
                {problems > 0 && lines.some((line) => line.quantity.trim() !== "") ? ` · ${copy.fixLines}` : ""}
              </span>
              <Button type="submit" disabled={!ready || sending}>
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                {sending ? copy.submitting : copy.submit(lines.length)}
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
