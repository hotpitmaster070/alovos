"use client";

import { motion } from "framer-motion";
import { AlertTriangle, FileSearch, Filter, Gauge, TrendingDown, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { Branch } from "@/lib/anbar/types";
import { CHEF_INVENTORY_PATH } from "@/lib/auth-redirect";
import { setDiscrepancyReasonAction } from "@/lib/inventory/actions";
import type { BoardTask, InventoryErrorCode, TaskLine } from "@/lib/inventory/model";
import {
  accuracy,
  DISCREPANCY_REASONS,
  discrepancyRow,
  isDiscrepancyReason,
  isSignificant,
  PARALLEL_REVIEW_THRESHOLD,
  PARALLEL_VARIANCE_THRESHOLD,
  SIGNIFICANT_QUANTITY,
  SIGNIFICANT_VALUE_SHARE,
  taskPhase,
  totals,
  type DiscrepancyReason,
} from "@/lib/inventory/modes";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { cn } from "@/lib/utils";
import CloseTaskButton from "./close-task-dialog";
import { CountUp, displayName, EmptyState, formatPercent, formatQuantity, ModeBadge, PhaseBadge, StatTile, ZONE_ICON } from "./ui";

export type ReportFilters = { branchId: string | null; taskId: string | null; from: string; to: string; significant: boolean };

export default function DiscrepancyReport({
  allowed,
  path,
  branches,
  tasks,
  selectedTask,
  filters,
  lines,
  currency,
}: {
  allowed: boolean;
  path: string;
  branches: Branch[];
  tasks: BoardTask[];
  selectedTask: BoardTask | null;
  filters: ReportFilters;
  lines: TaskLine[];
  currency: CurrencyInfo;
}) {
  const { t } = useT();
  const copy = t.inventory.report;
  const locale = currency.locale ?? undefined;
  const qty = (value: number) => formatQuantity(value, locale);
  const [reasons, setReasons] = useState<Record<string, DiscrepancyReason | null>>({});
  const [error, setError] = useState<InventoryErrorCode | null>(null);
  const [toast, setToast] = useState<{ token: number; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const all = useMemo(
    () => lines.map((line) => ({ line, row: discrepancyRow({ expected: line.expected, counts: line.counts, unitCost: line.unitCost }) })),
    [lines],
  );
  const shown = useMemo(
    () =>
      all
        .filter((item) => !filters.significant || isSignificant(item.row, item.line.unitCost))
        .sort((a, b) => (b.row.discrepancy?.cost ?? -Infinity) - (a.row.discrepancy?.cost ?? -Infinity)),
    [all, filters.significant],
  );
  const sum = totals(shown.map((item) => item.row));
  const precision = accuracy(all.map((item) => ({ row: item.row, unitCost: item.line.unitCost })));
  const over = all.filter((item) => item.line.counts.length >= 2 && (item.row.variance?.spreadRatio ?? 0) > PARALLEL_VARIANCE_THRESHOLD).length;
  const taskLoss = selectedTask ? totals(all.filter((item) => item.line.task?.id === selectedTask.id).map((item) => item.row)).lost : 0;
  const showParallel = all.some((item) => item.line.task?.mode === "control_parallel");

  if (!allowed) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <Card>
          <p className="text-sm text-white/60">{t.inventory.common.forbidden}</p>
        </Card>
      </div>
    );
  }

  const changeReason = (line: TaskLine, value: string) => {
    const key = `${line.countId}:${line.productId}`;
    const reason = isDiscrepancyReason(value) ? value : null;
    const previous = key in reasons ? reasons[key] : line.reason;
    setReasons((current) => ({ ...current, [key]: reason }));
    setError(null);
    startTransition(async () => {
      try {
        const result = await setDiscrepancyReasonAction(line.countId, line.productId, reason);
        if (!result.ok) {
          setReasons((current) => ({ ...current, [key]: previous }));
          setError(result.error);
          return;
        }
        setToast({ token: Date.now(), text: copy.reasonSaved });
      } catch {
        setReasons((current) => ({ ...current, [key]: previous }));
        setError("save_failed");
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">{copy.subtitle}</p>
        </div>
        <Link href={CHEF_INVENTORY_PATH} className={buttonVariants("outline", "sm")}>
          {t.inventory.chef.title}
        </Link>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          index={0}
          icon={TrendingDown}
          label={copy.kpi.loss}
          value={<CountUp value={sum.lost} format={(value) => formatMoney(value, currency)} />}
          hint={copy.kpi.lossHint}
          tone={sum.lost > 0 ? "bad" : "good"}
        />
        <StatTile
          index={1}
          icon={TrendingUp}
          label={copy.kpi.surplus}
          value={<CountUp value={sum.surplus} format={(value) => formatMoney(value, currency)} />}
          hint={copy.kpi.surplusHint}
          tone="good"
        />
        <StatTile
          index={2}
          icon={Gauge}
          label={copy.kpi.accuracy}
          value={precision === null ? "—" : <CountUp value={precision} format={(value) => formatPercent(value, locale)} />}
          hint={copy.kpi.accuracyHint}
          tone={precision === null ? "neutral" : precision >= 95 ? "good" : precision >= 85 ? "warn" : "bad"}
        />
        <StatTile
          index={3}
          icon={Users}
          label={copy.kpi.over(formatPercent(PARALLEL_VARIANCE_THRESHOLD * 100, locale))}
          value={<CountUp value={over} format={(value) => String(Math.round(value))} />}
          hint={copy.kpi.overHint}
          tone={over > 0 ? "warn" : "neutral"}
        />
      </div>

      <Card>
        <form method="get" action={path} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_auto_auto]">
          {branches.length > 1 && (
            <label className="flex flex-col gap-1 text-xs text-white/55">
              {copy.filters.branch}
              <Select name="branch" defaultValue={filters.branchId ?? ""}>
                <option value="">{t.inventory.common.all}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-white/55">
            {copy.filters.task}
            <Select name="task" defaultValue={filters.taskId ?? ""}>
              <option value="">{copy.filters.allTasks}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {`#${task.id.slice(0, 6)} · ${task.title} · ${t.inventory.phases[taskPhase(task.status)]}`}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/55">
            {copy.filters.from}
            <Input type="date" name="from" defaultValue={filters.from} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/55">
            {copy.filters.to}
            <Input type="date" name="to" defaultValue={filters.to} />
          </label>
          <label className="flex items-center gap-2 text-sm text-white/75 sm:col-span-2 lg:col-span-3">
            <input type="checkbox" name="significant" value="1" defaultChecked={filters.significant} className="h-4 w-4 accent-[rgb(232,213,183)]" />
            {copy.filters.significant(qty(SIGNIFICANT_QUANTITY), formatPercent(SIGNIFICANT_VALUE_SHARE * 100, locale))}
          </label>
          <div className="flex items-end justify-end gap-2">
            <Link href={path} className={buttonVariants("ghost", "sm")}>
              {t.inventory.common.reset}
            </Link>
            <Button type="submit" size="sm" variant="outline">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              {t.inventory.common.apply}
            </Button>
          </div>
        </form>
      </Card>

      {selectedTask && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge mode={selectedTask.mode} />
            <PhaseBadge phase={taskPhase(selectedTask.status)} />
            <Link href={`${CHEF_INVENTORY_PATH}/${selectedTask.id}`} className="text-sm font-medium hover:text-beige">
              {selectedTask.title}
            </Link>
          </div>
          {selectedTask.status === "completed" && <CloseTaskButton taskId={selectedTask.id} estimatedLoss={taskLoss} currency={currency} />}
        </motion.div>
      )}
      {!selectedTask && tasks.some((task) => task.status === "completed") && <p className="text-xs text-white/45">{copy.close.pickTask}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t.inventory.errors[error]}
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={FileSearch} title={copy.empty} hint={copy.emptyHint} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-white/45">
                  <th className="px-4 py-3 font-medium">{copy.table.product}</th>
                  <th className="px-3 py-3 font-medium">{copy.table.zone}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.table.expected}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.table.counted}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.table.diffQty}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.table.unitCost}</th>
                  <th className="px-3 py-3 text-right font-medium">{copy.table.diffMoney}</th>
                  {showParallel && <th className="px-3 py-3 text-right font-medium">{copy.table.variance}</th>}
                  <th className="px-4 py-3 font-medium">{copy.table.reason}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ line, row }, index) => {
                  const key = `${line.countId}:${line.productId}`;
                  const reason = key in reasons ? reasons[key] : line.reason;
                  const variance = row.variance;
                  const parallel = line.task?.mode === "control_parallel" && line.counts.length >= 2;
                  const ratio = variance?.spreadRatio ?? 0;
                  const review = parallel && ratio > PARALLEL_VARIANCE_THRESHOLD;
                  const difference = row.discrepancy?.difference ?? null;
                  const cost = row.discrepancy?.cost ?? null;
                  const ZoneIcon = ZONE_ICON[line.zone.type];
                  return (
                    <motion.tr
                      key={key}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index, 20) * 0.02 }}
                      className={cn("border-b border-line/50 align-top last:border-0", review && "bg-amber-400/[0.08]")}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-beige/25 to-beige/5 text-sm font-semibold text-beige">
                            {line.productName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium">{line.productName}</p>
                            <p className="text-[11px] text-white/40">
                              {line.unit}
                              {line.task && !filters.taskId && ` · ${line.task.title}`}
                            </p>
                            {review && (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-300">
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                {copy.review}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-white/70">
                        <span className="inline-flex items-center gap-1.5">
                          <ZoneIcon className="h-3.5 w-3.5 text-beige" aria-hidden />
                          {line.zone.name}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-white/70">{line.expected === null ? "—" : qty(line.expected)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <span className="font-medium">{row.counted === null ? "—" : qty(row.counted)}</span>
                        {parallel && (
                          <span className="mt-0.5 block text-[11px] text-white/45">
                            {line.counts.map((count) => (
                              <span key={count.userId} title={count.label} className={cn("ml-1.5", variance?.outlier?.userId === count.userId && "font-semibold text-red-400")}>
                                {displayName(count.label).split(" ")[0]}: {qty(count.quantity)}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right font-medium tabular-nums",
                          difference !== null && difference < 0 && "text-red-400",
                          difference !== null && difference > 0 && "text-emerald-400",
                        )}
                      >
                        {difference === null ? "—" : `${difference > 0 ? "+" : ""}${qty(difference)}`}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-white/60">{line.unitCost === null ? "—" : formatMoney(line.unitCost, currency)}</td>
                      <td className={cn("px-3 py-3 text-right text-base font-bold tabular-nums", cost !== null && cost > 0 && "text-red-400", cost !== null && cost < 0 && "text-emerald-400")}>
                        {cost === null ? "—" : formatMoney(-cost, currency)}
                      </td>
                      {showParallel && (
                        <td className="px-3 py-3 text-right">
                          {parallel && variance ? (
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                                ratio > PARALLEL_REVIEW_THRESHOLD ? "border-red-400/50 bg-red-500/15 text-red-300" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
                              )}
                            >
                              {Number.isFinite(ratio) ? formatPercent(ratio * 100, locale) : "∞"}
                            </span>
                          ) : (
                            <span className="text-white/30">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Select
                          aria-label={copy.table.reason}
                          value={reason ?? ""}
                          disabled={pending}
                          onChange={(event) => changeReason(line, event.target.value)}
                          className="min-w-[10rem] py-1.5 text-xs"
                        >
                          <option value="">{copy.table.noReason}</option>
                          {DISCREPANCY_REASONS.map((value) => (
                            <option key={value} value={value}>
                              {t.inventory.reasons[value]}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-white/[0.03] text-sm">
                  <td className="px-4 py-3 font-semibold" colSpan={2}>
                    {copy.totals.lines}: <span className="tabular-nums">{shown.length}</span>
                  </td>
                  <td colSpan={showParallel ? 7 : 6} className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-x-6 gap-y-1">
                      <span>
                        {copy.totals.loss}: <span className="font-bold text-red-400 tabular-nums">{formatMoney(sum.lost, currency)}</span>
                      </span>
                      <span>
                        {copy.totals.surplus}: <span className="font-bold text-emerald-400 tabular-nums">{formatMoney(sum.surplus, currency)}</span>
                      </span>
                      <span>
                        {copy.totals.net}:{" "}
                        <span className={cn("font-bold tabular-nums", sum.surplus - sum.lost < 0 ? "text-red-400" : "text-emerald-400")}>
                          {formatMoney(Math.round((sum.surplus - sum.lost) * 100) / 100, currency)}
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
      <Toast token={toast?.token ?? null} text={toast?.text ?? ""} />
    </div>
  );
}
