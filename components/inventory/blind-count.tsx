"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronLeft, EyeOff, LoaderCircle, PartyPopper, Search, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { COOK_TASKS_PATH } from "@/lib/auth-redirect";
import { startAssignmentAction, submitAssignmentAction } from "@/lib/inventory/actions";
import { COUNT_MAX_QUANTITY, type BlindLine, type InventoryErrorCode, type MyTask } from "@/lib/inventory/model";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { Confetti, formatQuantity, ModeBadge, ProgressBar, ZONE_ICON } from "./ui";

const DRAFT_PREFIX = "alovos-blind-count:";

/** "1,5" and "1.5" both mean one and a half; empty means not counted. */
function parseQuantity(raw: string): number | null | "invalid" {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= COUNT_MAX_QUANTITY ? value : "invalid";
}

export default function BlindCount({ task, lines, locale }: { task: MyTask; lines: BlindLine[]; locale: string | undefined }) {
  const { t } = useT();
  const copy = t.inventory.count;
  const router = useRouter();
  const sent = task.status === "submitted" || task.taskStatus === "closed" || task.taskStatus === "completed";
  const draftKey = `${DRAFT_PREFIX}${task.assignmentId}`;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.filter((line) => line.mine !== null).map((line) => [line.productId, String(line.mine)])),
  );
  const [query, setQuery] = useState("");
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<InventoryErrorCode | null>(null);
  const [burst, setBurst] = useState(0);
  const [justSent, setJustSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const sendButton = useRef<HTMLButtonElement>(null);
  const Icon = ZONE_ICON[task.zone.type];
  const qty = (value: number) => formatQuantity(value, locale);

  useEffect(() => {
    if (sent) return;
    if (task.status === "pending") void startAssignmentAction(task.assignmentId).catch(() => undefined);
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (parsed && typeof parsed === "object") {
        const known = new Set(lines.map((line) => line.productId));
        const draft = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(([id, value]) => known.has(id) && typeof value === "string"),
        ) as Record<string, string>;
        if (Object.keys(draft).length > 0) {
          setValues((current) => ({ ...draft, ...current }));
          setRestored(true);
        }
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
    // Runs once per assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.assignmentId]);

  useEffect(() => {
    if (sent) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(values));
    } catch {
      // Private mode: the draft is only kept in memory.
    }
  }, [values, draftKey, sent]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? lines.filter((line) => line.name.toLowerCase().includes(needle)) : lines;
  }, [lines, query]);

  const filled = lines.filter((line) => {
    const parsed = parseQuantity(values[line.productId] ?? "");
    return parsed !== null && parsed !== "invalid";
  }).length;
  const invalid = lines.some((line) => parseQuantity(values[line.productId] ?? "") === "invalid");

  const focusNext = (productId: string) => {
    const index = visible.findIndex((line) => line.productId === productId);
    const next = visible[index + 1];
    if (next) {
      const element = inputs.current.get(next.productId);
      element?.focus();
      element?.select();
    } else {
      sendButton.current?.focus();
    }
  };

  const send = () => {
    if (invalid || filled === 0) return;
    const missing = lines.length - filled;
    if (!window.confirm(missing > 0 ? copy.confirmMissing(missing) : copy.confirmSend)) return;
    const items = lines.flatMap((line) => {
      const parsed = parseQuantity(values[line.productId] ?? "");
      return parsed === null || parsed === "invalid" ? [] : [{ productId: line.productId, quantity: parsed }];
    });
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitAssignmentAction(task.assignmentId, items);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([40, 60, 40]);
        setBurst((value) => value + 1);
        setJustSent(true);
        router.refresh();
      } catch {
        setError("save_failed");
      }
    });
  };

  const peerBanner = task.mode === "control_parallel" && task.peersSubmitted > 0 && task.taskStatus !== "closed";
  const revealed = lines.some((line) => line.expected !== null);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-28">
      <Confetti burst={burst} />

      <Link href={COOK_TASKS_PATH} className="inline-flex w-fit items-center gap-1 text-sm text-white/55 hover:text-beige">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {copy.back}
      </Link>

      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-bg/90 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-sky-400/15 text-sky-200">
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">{task.zone.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <ModeBadge mode={task.mode} className="px-2 py-0.5 text-[10px]" />
              <span className="text-sm tabular-nums text-white/60">{copy.progress(sent ? lines.filter((line) => line.mine !== null).length : filled, lines.length)}</span>
            </div>
          </div>
          {!sent && (
            <Button type="button" size="sm" variant="outline" disabled={pending || filled === 0 || invalid} onClick={send}>
              {copy.finish}
            </Button>
          )}
        </div>
        <ProgressBar className="mt-3" value={sent ? lines.length : filled} total={lines.length} tone={sent ? "emerald" : "sky"} />
      </div>

      <AnimatePresence>
        {(justSent || sent) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="flex flex-col items-center gap-2 rounded-[22px] border border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 to-transparent p-6 text-center"
          >
            <motion.span initial={{ rotate: -20, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.15, type: "spring" }}>
              {justSent ? <PartyPopper className="h-10 w-10 text-emerald-300" aria-hidden /> : <CheckCircle2 className="h-10 w-10 text-emerald-300" aria-hidden />}
            </motion.span>
            <p className="text-xl font-semibold">{copy.sentTitle}</p>
            <p className="text-sm text-white/65">{copy.sentText}</p>
            {!revealed && <p className="text-xs text-white/45">{copy.hiddenUntilClose}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {peerBanner && (
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-[14px] border border-violet-400/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-200"
        >
          <Users className="h-4 w-4 shrink-0" aria-hidden />
          {copy.peerSent}
        </motion.p>
      )}

      {!sent && (
        <>
          <p className="flex items-center gap-2 rounded-[14px] border border-line bg-card px-4 py-3 text-sm text-white/65">
            <EyeOff className="h-4 w-4 shrink-0 text-beige" aria-hidden />
            {copy.blindNote}
          </p>
          {restored && <p className="text-xs text-emerald-300/80">{copy.restored}</p>}
          {lines.length > 8 && (
            <label className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
              <span className="sr-only">{copy.search}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
                className="w-full rounded-full border border-line bg-card py-3 pl-11 pr-4 text-base text-white placeholder:text-white/35 focus:border-beige focus:outline-none"
              />
            </label>
          )}
        </>
      )}

      {lines.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-line p-8 text-center text-sm text-white/55">{copy.nothing}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((line, index) => {
            const raw = values[line.productId] ?? "";
            const parsed = parseQuantity(raw);
            const done = parsed !== null && parsed !== "invalid";
            const difference = sent && line.expected !== null && line.mine !== null ? line.mine - line.expected : null;
            return (
              <motion.li
                key={line.productId}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * 0.025 }}
                className={cn(
                  "flex items-center gap-3 rounded-[18px] border bg-card p-3 transition-colors",
                  parsed === "invalid" ? "border-red-400/60" : done && !sent ? "border-emerald-400/40" : "border-line",
                )}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-beige/25 to-beige/5 text-lg font-semibold text-beige">
                  {line.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="text-xs uppercase tracking-wider text-white/45">{line.unit}</p>
                  {sent && line.expected !== null && (
                    <p className="mt-0.5 text-xs text-white/55">
                      {copy.expected}: <span className="tabular-nums">{qty(line.expected)}</span>
                      {difference !== null && (
                        <span className={cn("ml-2 font-semibold tabular-nums", difference < 0 && "text-red-400", difference > 0 && "text-emerald-400")}>
                          {difference > 0 ? "+" : ""}
                          {qty(Math.round(difference * 1000) / 1000)}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                {sent ? (
                  <span className="min-w-[4.5rem] text-right text-2xl font-semibold tabular-nums">{line.mine === null ? "—" : qty(line.mine)}</span>
                ) : (
                  <input
                    ref={(element) => {
                      if (element) inputs.current.set(line.productId, element);
                      else inputs.current.delete(line.productId);
                    }}
                    aria-label={`${line.name}, ${line.unit}`}
                    inputMode="decimal"
                    enterKeyHint={index === visible.length - 1 ? "done" : "next"}
                    autoComplete="off"
                    value={raw}
                    placeholder="0"
                    onChange={(event) => setValues((current) => ({ ...current, [line.productId]: event.target.value }))}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        focusNext(line.productId);
                      }
                    }}
                    className={cn(
                      "h-14 w-28 rounded-[14px] border bg-bg text-center text-2xl font-semibold tabular-nums text-white placeholder:text-white/20 focus:outline-none",
                      parsed === "invalid" ? "border-red-400" : "border-line focus:border-beige",
                    )}
                  />
                )}
              </motion.li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t.inventory.errors[error]}
        </p>
      )}

      {!sent && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:left-64">
          <div className="mx-auto max-w-xl">
            <motion.button
              ref={sendButton}
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={pending || filled === 0 || invalid}
              onClick={send}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-beige py-4 text-base font-semibold text-black shadow-[0_0_30px_rgba(232,213,183,0.25)] transition-opacity disabled:opacity-40"
            >
              {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
              {pending ? t.inventory.common.working : `${copy.send} · ${filled}/${lines.length}`}
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
}
