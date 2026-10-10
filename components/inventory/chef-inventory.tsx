"use client";

import { motion } from "framer-motion";
import { Activity, ArrowRight, Ban, CheckCircle2, ClipboardList, Percent, Plus, Scale, TrendingDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { Branch } from "@/lib/anbar/types";
import { CHEF_INVENTORY_PATH, DISCREPANCIES_PATH } from "@/lib/auth-redirect";
import { cancelInventoryTaskAction } from "@/lib/inventory/actions";
import type { BoardTask, InventoryErrorCode, StaffMember, Zone } from "@/lib/inventory/model";
import { taskPhase } from "@/lib/inventory/modes";
import { useT } from "@/lib/i18n/useT";
import { formatMoney, type CurrencyInfo } from "@/lib/money";
import { localDateTime } from "@/lib/tenant-settings/time";
import { cn } from "@/lib/utils";
import NewTaskDialog from "./new-task-dialog";
import { AvatarStack, CountUp, EmptyState, formatPercent, ModeBadge, PhaseBadge, ProgressBar, StatTile, ZoneChip } from "./ui";

export type ChefStats = { active: number; awaiting: number; finished: number; share: number | null; losses: number };

export default function ChefInventory({
  allowed,
  branches,
  branchId,
  stats,
  tasks,
  total,
  page,
  pageSize,
  zonesByBranch,
  staffByBranch,
  currency,
  timeZone,
}: {
  allowed: boolean;
  branches: Branch[];
  branchId: string | null;
  stats: ChefStats;
  tasks: BoardTask[];
  total: number;
  page: number;
  pageSize: number;
  zonesByBranch: Record<string, Zone[]>;
  staffByBranch: Record<string, StaffMember[]>;
  currency: CurrencyInfo;
  timeZone: string;
}) {
  const { t } = useT();
  const copy = t.inventory.chef;
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ token: number; text: string } | null>(null);
  const [error, setError] = useState<InventoryErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const locale = currency.locale ?? undefined;

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

  const notify = (text: string) => setToast({ token: Date.now(), text });

  const cancel = (taskId: string) => {
    if (!window.confirm(copy.confirmCancel)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelInventoryTaskAction(taskId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        notify(copy.cancelledNotice);
        router.refresh();
      } catch {
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
        <div className="flex flex-wrap gap-2">
          <Link href={branchId ? `${DISCREPANCIES_PATH}?branch=${branchId}` : DISCREPANCIES_PATH} className={buttonVariants("outline", "sm")}>
            {copy.discrepancies}
          </Link>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Button type="button" size="sm" onClick={() => setCreating(true)} className="shadow-[0_0_24px_rgba(232,213,183,0.25)]">
              <Plus className="h-4 w-4" aria-hidden />
              {copy.newTask}
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {branches.length > 1 && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Select name="branch" defaultValue={branchId ?? ""} aria-label={t.inventory.wizard.branch} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
            <option value="">{t.inventory.common.all}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <noscript>
            <Button type="submit" size="sm" variant="outline">
              {t.inventory.common.apply}
            </Button>
          </noscript>
        </form>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          index={0}
          icon={Activity}
          label={copy.stats.active}
          value={<CountUp value={stats.active} format={(value) => String(Math.round(value))} />}
          hint={copy.stats.activeHint(stats.awaiting)}
          tone={stats.awaiting > 0 ? "warn" : "info"}
        />
        <StatTile
          index={1}
          icon={CheckCircle2}
          label={copy.stats.finished}
          value={<CountUp value={stats.finished} format={(value) => String(Math.round(value))} />}
          hint={copy.stats.finishedHint}
          tone="good"
        />
        <StatTile
          index={2}
          icon={Percent}
          label={copy.stats.share}
          value={stats.share === null ? "—" : <CountUp value={stats.share} format={(value) => formatPercent(value, locale, true)} />}
          hint={copy.stats.shareHint}
          tone={stats.share === null ? "neutral" : stats.share < 0 ? "bad" : "good"}
        />
        <StatTile
          index={3}
          icon={TrendingDown}
          label={copy.stats.losses}
          value={<CountUp value={stats.losses} format={(value) => formatMoney(value, currency)} />}
          hint={copy.stats.lossesHint}
          tone={stats.losses > 0 ? "bad" : "good"}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t.inventory.errors[error]}
        </p>
      )}

      {tasks.length === 0 ? (
        <EmptyState icon={ClipboardList} title={copy.table.empty} hint={copy.table.emptyHint}>
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {copy.newTask}
          </Button>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-widest text-white/45">
                  <th className="px-4 py-3 font-medium">{copy.table.task}</th>
                  <th className="px-3 py-3 font-medium">{copy.table.mode}</th>
                  {!branchId && <th className="px-3 py-3 font-medium">{copy.table.branch}</th>}
                  <th className="px-3 py-3 font-medium">{copy.table.zones}</th>
                  <th className="px-3 py-3 font-medium">{copy.table.cooks}</th>
                  <th className="px-3 py-3 font-medium">{copy.table.progress}</th>
                  <th className="px-3 py-3 font-medium">{copy.table.status}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, index) => {
                  const phase = taskPhase(task.status);
                  const people = new Map<string, { id: string; email: string; done: boolean }>();
                  for (const assignee of task.assignees) {
                    const known = people.get(assignee.userId);
                    people.set(assignee.userId, {
                      id: assignee.userId,
                      email: assignee.email,
                      done: (known?.done ?? true) && assignee.status === "submitted",
                    });
                  }
                  const detail = `${CHEF_INVENTORY_PATH}/${task.id}`;
                  return (
                    <motion.tr
                      key={task.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index, 10) * 0.03 }}
                      onClick={() => router.push(detail)}
                      className="group cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium group-hover:text-beige">{task.title}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-white/40">
                          #{task.id.slice(0, 6)} · {localDateTime(task.createdAt, timeZone)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <ModeBadge mode={task.mode} />
                      </td>
                      {!branchId && <td className="px-3 py-3 text-white/75">{task.branchName}</td>}
                      <td className="px-3 py-3">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {task.zones.slice(0, 3).map((zone) => (
                            <ZoneChip key={zone.id} zone={zone} />
                          ))}
                          {task.zones.length > 3 && <span className="text-[11px] text-white/45">+{task.zones.length - 3}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <AvatarStack people={Array.from(people.values())} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex w-32 flex-col gap-1">
                          <ProgressBar value={task.submitted} total={task.assigned} tone={task.submitted === task.assigned ? "emerald" : "sky"} />
                          <span className="text-[11px] tabular-nums text-white/50">
                            {task.submitted}/{task.assigned}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <PhaseBadge phase={phase} />
                        {phase === "closed" && task.totalLoss !== null && task.totalLoss > 0 && (
                          <p className="mt-1 text-[11px] font-semibold text-red-400">−{formatMoney(task.totalLoss, currency)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Link href={detail} className={cn(buttonVariants("ghost", "sm"), "px-2")}>
                            {copy.table.open}
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                          {(phase === "done" || (phase === "active" && task.submitted > 0)) && (
                            <Link href={`${detail}?close=1`} className={cn(buttonVariants("outline", "sm"), "border-red-400/60 px-3 text-red-300 hover:bg-red-500 hover:text-white")}>
                              <Scale className="h-3.5 w-3.5" aria-hidden />
                              {copy.table.close}
                            </Link>
                          )}
                          {phase === "active" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => cancel(task.id)}
                              title={copy.table.cancel}
                              className="rounded-full p-2 text-white/40 transition-colors hover:bg-white/5 hover:text-red-300"
                            >
                              <Ban className="h-4 w-4" aria-hidden />
                              <span className="sr-only">{copy.table.cancel}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {total > pageSize && (
        <Pager path={CHEF_INVENTORY_PATH} query={branchId ? { branch: branchId } : {}} page={page} pageSize={pageSize} total={total} shown={tasks.length} />
      )}

      <NewTaskDialog
        open={creating}
        onOpenChange={setCreating}
        branches={branches}
        defaultBranchId={branchId}
        zonesByBranch={zonesByBranch}
        staffByBranch={staffByBranch}
        locale={locale}
        onCreated={(taskId) => {
          setCreating(false);
          notify(copy.created);
          router.refresh();
          router.prefetch(`${CHEF_INVENTORY_PATH}/${taskId}`);
        }}
      />
      <Toast token={toast?.token ?? null} text={toast?.text ?? ""} />
    </div>
  );
}
