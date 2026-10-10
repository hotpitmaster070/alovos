"use client";

import { motion, useMotionValue, useTransform } from "framer-motion";
import { ChevronRight, ClipboardCheck, Clock, Hourglass, ListChecks, Lock, Target, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { COOK_TASKS_PATH } from "@/lib/auth-redirect";
import type { MyStats, MyTask } from "@/lib/inventory/model";
import { useT } from "@/lib/i18n/useT";
import { localDateTime } from "@/lib/tenant-settings/time";
import { cn } from "@/lib/utils";
import { CountUp, displayName, EmptyState, formatPercent, ModeBadge, StatTile, ZONE_ICON } from "./ui";

type CardState = "active" | "sent" | "closed";

const CARD_TONE: Record<CardState, string> = {
  active: "border-sky-400/40 from-sky-500/20 via-sky-500/5",
  sent: "border-emerald-400/40 from-emerald-500/20 via-emerald-500/5",
  closed: "border-line from-white/5 via-transparent",
};

function TaskCard({ task, index, timeZone }: { task: MyTask; index: number; timeZone: string }) {
  const { t } = useT();
  const copy = t.inventory.cook;
  const router = useRouter();
  const x = useMotionValue(0);
  const hintOpacity = useTransform(x, [0, 120], [0, 1]);
  const state: CardState = task.taskStatus === "closed" ? "closed" : task.status === "submitted" ? "sent" : "active";
  const Icon = ZONE_ICON[task.zone.type];
  const href = `${COOK_TASKS_PATH}/${task.assignmentId}`;
  const overdue = state === "active" && task.scheduledAt !== null && new Date(task.scheduledAt).getTime() < Date.now();

  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      <motion.span style={{ opacity: hintOpacity }} className="absolute inset-y-0 left-4 flex items-center text-beige" aria-hidden>
        <ChevronRight className="h-6 w-6" />
      </motion.span>
      <motion.button
        type="button"
        drag={state === "active" ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.6 }}
        style={{ x }}
        onDragEnd={(_, info) => {
          if (info.offset.x > 110) router.push(href);
        }}
        onClick={() => router.push(href)}
        whileTap={{ scale: 0.985 }}
        className={cn(
          "relative flex w-full flex-col gap-4 overflow-hidden rounded-[22px] border bg-card bg-gradient-to-br to-transparent p-5 text-left",
          CARD_TONE[state],
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <ModeBadge mode={task.mode} />
          {state === "sent" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              {copy.waitingReview}
            </span>
          )}
          {state === "closed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {copy.closedCard}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px]",
              state === "active" ? "bg-sky-400/15 text-sky-200" : state === "sent" ? "bg-emerald-400/15 text-emerald-200" : "bg-white/5 text-white/50",
            )}
          >
            <Icon className="h-8 w-8" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold">{task.zone.name}</p>
            <p className="truncate text-sm text-white/55">
              {t.inventory.zoneTypes[task.zone.type]} · {task.branchName}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/70">
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-beige" aria-hidden />
            {copy.products(task.productCount)}
          </span>
          <span className={cn("inline-flex items-center gap-1.5", overdue && "text-red-300")}>
            {task.scheduledAt ? <Hourglass className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
            {task.scheduledAt ? `${copy.deadline}: ${localDateTime(task.scheduledAt, timeZone)}` : copy.noDeadline}
          </span>
          {task.mode === "control_parallel" && task.peersTotal > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-violet-300" aria-hidden />
              {copy.peers(task.peersSubmitted, task.peersTotal)}
            </span>
          )}
        </div>
        {state === "active" && (
          <span className="inline-flex items-center justify-center gap-2 rounded-full bg-beige px-5 py-3 text-sm font-semibold text-black">
            {copy.start}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </motion.button>
    </motion.li>
  );
}

export default function CookTasks({ email, tasks, stats, timeZone, locale }: { email: string; tasks: MyTask[]; stats: MyStats; timeZone: string; locale: string | undefined }) {
  const { t } = useT();
  const copy = t.inventory.cook;
  const active = tasks.filter((task) => task.taskStatus !== "closed" && task.status !== "submitted");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.hello(displayName(email))}</h1>
        <p className="mt-2 text-sm text-white/60">{copy.subtitle}</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile index={0} label={copy.open} value={<CountUp value={stats.open} format={(value) => String(Math.round(value))} />} tone={stats.open > 0 ? "info" : "neutral"} />
        <StatTile index={1} label={copy.sent} value={<CountUp value={stats.sent} format={(value) => String(Math.round(value))} />} tone="good" />
        <StatTile
          index={2}
          label={copy.accuracy}
          value={stats.accuracy === null ? "—" : <CountUp value={stats.accuracy} format={(value) => formatPercent(value, locale)} />}
          hint={stats.accuracy === null ? copy.accuracyEmpty : undefined}
          tone={stats.accuracy === null ? "neutral" : stats.accuracy >= 95 ? "good" : stats.accuracy >= 85 ? "warn" : "bad"}
        />
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon={Target} title={copy.empty} hint={copy.emptyHint} />
      ) : (
        <>
          {active.length > 0 && <p className="-mb-3 text-center text-xs text-white/40">{copy.swipeHint}</p>}
          <ul className="flex flex-col gap-3">
            {tasks.map((task, index) => (
              <TaskCard key={task.assignmentId} task={task} index={index} timeZone={timeZone} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
