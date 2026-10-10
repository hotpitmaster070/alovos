"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import { Package, Refrigerator, Snowflake, Target, Wine, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StorageType } from "@/lib/anbar/types";
import type { Zone } from "@/lib/inventory/model";
import type { InventoryMode, TaskPhase } from "@/lib/inventory/modes";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export const MODE_ICON: Record<InventoryMode, LucideIcon> = { fast_zones: Zap, control_parallel: Target };
export const ZONE_ICON: Record<StorageType, LucideIcon> = {
  quru: Package,
  soyuducu: Refrigerator,
  dondurucu: Snowflake,
  custom: Wine,
};

const MODE_TONE: Record<InventoryMode, string> = {
  fast_zones: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  control_parallel: "border-violet-400/40 bg-violet-400/10 text-violet-300",
};

const PHASE_TONE: Record<TaskPhase, string> = {
  active: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  done: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  closed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  cancelled: "border-white/15 bg-white/5 text-white/50",
};

export function ModeBadge({ mode, className }: { mode: InventoryMode; className?: string }) {
  const { t } = useT();
  const Icon = MODE_ICON[mode];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium", MODE_TONE[mode], className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t.inventory.modes[mode].title}
    </span>
  );
}

export function PhaseBadge({ phase, className }: { phase: TaskPhase; className?: string }) {
  const { t } = useT();
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium", PHASE_TONE[phase], className)}>
      {phase === "active" && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-300 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-300" />
        </span>
      )}
      {t.inventory.phases[phase]}
    </span>
  );
}

export function ZoneChip({ zone, className }: { zone: Zone; className?: string }) {
  const Icon = ZONE_ICON[zone.type];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-white/5 px-2 py-0.5 text-[11px] text-white/80", className)}>
      <Icon className="h-3 w-3 text-beige" aria-hidden />
      {zone.name}
    </span>
  );
}

const AVATAR_TONES = [
  "from-sky-500 to-indigo-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-fuchsia-500 to-pink-500",
  "from-violet-500 to-purple-500",
  "from-rose-500 to-red-500",
];

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

/** "anna.k@site.az" -> "Anna K" (people have no names in profiles; the e-mail is the name). */
export function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (words.length === 0) return email;
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const initials = (email: string) =>
  displayName(email)
    .split(" ")
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Avatar({ id, email, size = "md", ring, className }: { id: string; email: string; size?: "sm" | "md" | "lg"; ring?: string; className?: string }) {
  return (
    <span
      title={email}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ring-2 ring-card",
        AVATAR_TONES[hash(id) % AVATAR_TONES.length],
        size === "sm" && "h-7 w-7 text-[10px]",
        size === "md" && "h-9 w-9 text-xs",
        size === "lg" && "h-12 w-12 text-sm",
        ring,
        className,
      )}
    >
      {initials(email)}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: { id: string; email: string; done?: boolean }[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((person) => (
        <Avatar key={person.id} id={person.id} email={person.email} size="sm" ring={person.done ? "ring-emerald-400" : undefined} />
      ))}
      {rest > 0 && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/70 ring-2 ring-card">+{rest}</span>
      )}
    </span>
  );
}

export function ProgressBar({ value, total, tone = "beige", className }: { value: number; total: number; tone?: "beige" | "emerald" | "sky"; className?: string }) {
  const share = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/10", className)} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <motion.div
        className={cn(
          "h-full rounded-full",
          tone === "beige" && "bg-beige",
          tone === "emerald" && "bg-gradient-to-r from-emerald-500 to-emerald-300",
          tone === "sky" && "bg-gradient-to-r from-sky-500 to-sky-300",
        )}
        initial={{ width: 0 }}
        animate={{ width: `${share * 100}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

/** Animates a number from its previous value; format turns it into text. */
export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(latest),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

export type Tone = "good" | "bad" | "warn" | "neutral" | "info";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-400",
  bad: "text-red-400",
  warn: "text-amber-300",
  neutral: "text-white",
  info: "text-sky-300",
};
const TONE_GLOW: Record<Tone, string> = {
  good: "from-emerald-500/15",
  bad: "from-red-500/15",
  warn: "from-amber-400/15",
  neutral: "from-white/5",
  info: "from-sky-500/15",
};

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  index = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-[18px] border border-line bg-card p-4"
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", TONE_GLOW[tone])} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-widest text-white/50">{label}</p>
        {Icon && <Icon className={cn("h-4 w-4", TONE_TEXT[tone])} aria-hidden />}
      </div>
      <p className={cn("relative mt-2 font-serif text-[26px] font-bold leading-tight tabular-nums", TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="relative mt-1 text-xs text-white/50">{hint}</p>}
    </motion.div>
  );
}

const CONFETTI_COLORS = ["#E8D5B7", "#34D399", "#60A5FA", "#F472B6", "#FBBF24", "#A78BFA"];

/** A short burst of paper; skipped for people who asked for reduced motion. */
export function Confetti({ burst }: { burst: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, index) => {
        const seed = hash(`${burst}:${index}`);
        return {
          id: index,
          x: ((seed % 200) - 100) * 3.2,
          y: -((seed >> 3) % 260) - 160,
          rotate: (seed % 720) - 360,
          delay: (seed % 25) / 100,
          color: CONFETTI_COLORS[seed % CONFETTI_COLORS.length],
          size: 6 + (seed % 7),
          round: seed % 3 === 0,
        };
      }),
    [burst],
  );
  if (reduce || burst === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center overflow-hidden" aria-hidden>
      {pieces.map((piece) => (
        <motion.span
          key={`${burst}-${piece.id}`}
          className={cn("absolute", piece.round ? "rounded-full" : "rounded-[2px]")}
          style={{ width: piece.size, height: piece.size * (piece.round ? 1 : 0.5), backgroundColor: piece.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: piece.x, y: [0, piece.y, piece.y + 520], opacity: [1, 1, 0], rotate: piece.rotate, scale: 1 }}
          transition={{ duration: 2.2, delay: piece.delay, ease: "easeOut", times: [0, 0.35, 1] }}
        />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: string; children?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-line px-6 py-12 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-beige/10">
        <Icon className="h-6 w-6 text-beige" aria-hidden />
      </span>
      <p className="text-base font-medium">{title}</p>
      <p className="max-w-xs text-sm text-white/55">{hint}</p>
      {children}
    </motion.div>
  );
}

export function formatQuantity(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

export function formatPercent(value: number, locale?: string, signed = false): string {
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return `${signed && value > 0 ? "+" : ""}${text}%`;
}
