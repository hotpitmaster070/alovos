"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ChevronLeft, Clock, FileBarChart, Hourglass } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CHEF_INVENTORY_PATH, DISCREPANCIES_PATH } from "@/lib/auth-redirect";
import type { BoardTask, TaskLine } from "@/lib/inventory/model";
import { discrepancyRow, PARALLEL_REVIEW_THRESHOLD, PARALLEL_VARIANCE_THRESHOLD, taskPhase, totals } from "@/lib/inventory/modes";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { localDateTime } from "@/lib/tenant-settings/time";
import { cn } from "@/lib/utils";
import CloseTaskButton from "./close-task-dialog";
import { Avatar, displayName, formatPercent, formatQuantity, ModeBadge, PhaseBadge, ProgressBar, StatTile, ZONE_ICON } from "./ui";

export default function TaskDetail({
  task,
  lines,
  currency,
  timeZone,
  autoClose,
}: {
  task: BoardTask;
  lines: TaskLine[];
  currency: CurrencyInfo;
  timeZone: string;
  autoClose: boolean;
}) {
  const { t } = useT();
  const copy = t.inventory.detail;
  const locale = currency.locale ?? undefined;
  const phase = taskPhase(task.status);
  const parallel = task.mode === "control_parallel";
  const qty = (value: number) => formatQuantity(value, locale);

  const computed = useMemo(
    () =>
      lines.map((line) => {
        const row = discrepancyRow({ expected: line.expected, counts: line.counts, unitCost: line.unitCost });
        return { line, row };
      }),
    [lines],
  );
  const sum = totals(computed.map((item) => item.row));
  const zones = useMemo(() => {
    const map = new Map<string, { zone: TaskLine["zone"]; items: typeof computed }>();
    for (const item of computed) {
      const entry = map.get(item.line.zone.id) ?? { zone: item.line.zone, items: [] };
      entry.items.push(item);
      map.set(item.line.zone.id, entry);
    }
    return Array.from(map.values());
  }, [computed]);

  // Parallel: one column per assignee, in a stable order.
  const counters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const assignee of task.assignees) seen.set(assignee.userId, assignee.email);
    return Array.from(seen.entries()).map(([id, email]) => ({ id, email }));
  }, [task.assignees]);

  const canClose = phase === "done" || (phase === "active" && task.submitted > 0);

  return (
    <div className="flex flex-col gap-6">
      <Link href={CHEF_INVENTORY_PATH} className="inline-flex w-fit items-center gap-1 text-sm text-white/55 hover:text-beige">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {copy.back}
      </Link>

      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge mode={task.mode} />
            <PhaseBadge phase={phase} />
            <span className="font-mono text-xs text-white/40">#{task.id.slice(0, 6)}</span>
          </div>
          <h1 className="mt-3 font-serif text-[30px] font-bold leading-[1.1] tracking-tight">{task.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
            <span>{task.branchName}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {copy.createdAt}: {localDateTime(task.createdAt, timeZone)}
            </span>
            {task.scheduledAt && (
              <span className="inline-flex items-center gap-1 text-amber-300/80">
                <Hourglass className="h-3.5 w-3.5" aria-hidden />
                {copy.deadline}: {localDateTime(task.scheduledAt, timeZone)}
              </span>
            )}
            {task.closedAt && (
              <span>
                {copy.closedAt}: {localDateTime(task.closedAt, timeZone)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(phase === "done" || phase === "closed") && (
            <Link href={`${DISCREPANCIES_PATH}?task=${task.id}`} className={buttonVariants("outline", "sm")}>
              <FileBarChart className="h-4 w-4" aria-hidden />
              {copy.report}
            </Link>
          )}
          {canClose && (
            <CloseTaskButton taskId={task.id} estimatedLoss={sum.lost} currency={currency} label={copy.closeAndWriteOff} autoOpen={autoClose} />
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} label={t.inventory.chef.table.progress} value={`${task.submitted}/${task.assigned}`} hint={copy.progress(task.submitted, task.assigned)} tone={task.submitted === task.assigned ? "good" : "info"} />
        <StatTile index={1} label={t.inventory.chef.table.zones} value={String(task.zones.length)} hint={task.zones.map((zone) => zone.name).join(", ")} />
        <StatTile
          index={2}
          label={copy.loss}
          value={formatMoney(task.totalLoss ?? sum.lost, currency)}
          tone={(task.totalLoss ?? sum.lost) > 0 ? "bad" : "good"}
        />
        <StatTile index={3} label={copy.surplus} value={formatMoney(task.totalSurplus ?? sum.surplus, currency)} tone="good" />
      </div>

      <Card>
        <div className="flex flex-col gap-3">
          {task.zones.map((zone) => {
            const Icon = ZONE_ICON[zone.type];
            const people = task.assignees.filter((assignee) => assignee.zoneId === zone.id);
            const sent = people.filter((person) => person.status === "submitted").length;
            return (
              <div key={zone.id} className="flex flex-wrap items-center gap-3">
                <span className="flex min-w-[9rem] items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-beige" aria-hidden />
                  {zone.name}
                </span>
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {people.map((person) => (
                    <span
                      key={person.id}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs",
                        person.status === "submitted" ? "border-emerald-400/40 text-emerald-200" : "border-line text-white/60",
                      )}
                    >
                      <Avatar id={person.userId} email={person.email} size="sm" ring={person.status === "submitted" ? "ring-emerald-400" : undefined} />
                      {displayName(person.email)}
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {person.status === "submitted" ? copy.sent : person.status === "in_progress" ? copy.waiting : copy.notSent}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="w-28">
                  <ProgressBar value={sent} total={people.length} tone={sent === people.length ? "emerald" : "sky"} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {computed.length === 0 ? (
        <Card>
          <p className="text-sm text-white/60">{copy.noLines}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-white/45">
                  <th className="px-4 py-3 font-medium">{copy.product}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.expected}</th>
                  {parallel ? (
                    counters.map((person) => (
                      <th key={person.id} className="px-3 py-3 text-right font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar id={person.id} email={person.email} size="sm" />
                          <span className="normal-case tracking-normal">{displayName(person.email)}</span>
                        </span>
                      </th>
                    ))
                  ) : (
                    <th className="px-3 py-3 text-right font-medium">{copy.result}</th>
                  )}
                  {parallel && <th className="px-3 py-3 text-right font-medium">{copy.result}</th>}
                  {parallel && <th className="px-3 py-3 text-right font-medium">{copy.variance}</th>}
                  <th className="px-3 py-3 text-right font-medium">{copy.difference}</th>
                  <th className="px-4 py-3 text-right font-medium">{copy.value}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((group) => {
                  const Icon = ZONE_ICON[group.zone.type];
                  return (
                    <Fragment key={group.zone.id}>
                      {zones.length > 1 && (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={99} className="px-4 py-2 text-xs font-medium uppercase tracking-widest text-white/55">
                            <span className="inline-flex items-center gap-1.5">
                              <Icon className="h-3.5 w-3.5 text-beige" aria-hidden />
                              {group.zone.name}
                            </span>
                          </td>
                        </tr>
                      )}
                      {group.items.map(({ line, row }, index) => {
                        const variance = row.variance;
                        const review = parallel && variance !== null && variance.spreadRatio > PARALLEL_VARIANCE_THRESHOLD;
                        const flagged = parallel && variance !== null && variance.spreadRatio > PARALLEL_REVIEW_THRESHOLD;
                        const difference = row.discrepancy?.difference ?? null;
                        const cost = row.discrepancy?.cost ?? null;
                        return (
                          <motion.tr
                            key={`${line.countId}:${line.productId}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: Math.min(index, 15) * 0.02 }}
                            className={cn("border-b border-line/50 last:border-0", review && "bg-amber-400/[0.07]")}
                          >
                            <td className="px-4 py-2.5">
                              <span className="font-medium">{line.productName}</span>
                              <span className="text-white/40"> · {line.unit}</span>
                              {review && (
                                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300">
                                  <AlertTriangle className="h-3 w-3" aria-hidden />
                                  {copy.needsReview}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-white/70">{line.expected === null ? "—" : qty(line.expected)}</td>
                            {parallel ? (
                              counters.map((person) => {
                                const count = line.counts.find((item) => item.userId === person.id);
                                const outlier = variance?.outlier?.userId === person.id;
                                return (
                                  <td key={person.id} className={cn("px-3 py-2.5 text-right tabular-nums", outlier && "font-semibold text-red-400")}>
                                    {count ? qty(count.quantity) : <span className="text-white/30">—</span>}
                                  </td>
                                );
                              })
                            ) : (
                              <td className="px-3 py-2.5 text-right tabular-nums">{row.counted === null ? "—" : qty(row.counted)}</td>
                            )}
                            {parallel && <td className="px-3 py-2.5 text-right font-medium tabular-nums">{row.counted === null ? "—" : qty(row.counted)}</td>}
                            {parallel && (
                              <td className="px-3 py-2.5 text-right">
                                {variance === null || line.counts.length < 2 ? (
                                  <span className="text-white/30">—</span>
                                ) : (
                                  <span
                                    className={cn(
                                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                                      flagged ? "border-red-400/50 bg-red-500/15 text-red-300" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
                                    )}
                                  >
                                    {Number.isFinite(variance.spreadRatio) ? formatPercent(variance.spreadRatio * 100, locale) : "∞"}
                                  </span>
                                )}
                              </td>
                            )}
                            <td
                              className={cn(
                                "px-3 py-2.5 text-right tabular-nums",
                                difference !== null && difference < 0 && "text-red-400",
                                difference !== null && difference > 0 && "text-emerald-400",
                              )}
                            >
                              {difference === null ? "—" : `${difference > 0 ? "+" : ""}${qty(difference)}`}
                            </td>
                            <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", cost !== null && cost > 0 && "text-red-400", cost !== null && cost < 0 && "text-emerald-400")}>
                              {cost === null ? "—" : formatMoney(-cost, currency)}
                            </td>
                          </motion.tr>
                        );
                      })}
                    </Fragment>
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
