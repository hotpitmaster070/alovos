"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { STORAGE_TYPES, type Branch, type StorageType } from "@/lib/anbar/types";
import { addZoneAction, createDefaultZonesAction, createInventoryTaskAction } from "@/lib/inventory/actions";
import type { InventoryErrorCode, StaffMember, Zone } from "@/lib/inventory/model";
import {
  INVENTORY_MODES,
  PARALLEL_DEFAULT_COUNTERS,
  PARALLEL_MAX_COUNTERS,
  PARALLEL_MIN_COUNTERS,
  PARALLEL_VARIANCE_THRESHOLD,
  type InventoryMode,
} from "@/lib/inventory/modes";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import { Avatar, displayName, formatPercent, MODE_ICON, ZONE_ICON } from "./ui";

const MODE_GRADIENT: Record<InventoryMode, string> = {
  fast_zones: "from-sky-500/25 via-sky-500/5 to-transparent",
  control_parallel: "from-violet-500/25 via-violet-500/5 to-transparent",
};
const MODE_ACCENT: Record<InventoryMode, string> = {
  fast_zones: "text-sky-300 bg-sky-400/15",
  control_parallel: "text-violet-300 bg-violet-400/15",
};

const slide = {
  enter: (direction: number) => ({ x: direction * 40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * -40, opacity: 0 }),
};

export default function NewTaskDialog({
  open,
  onOpenChange,
  branches,
  defaultBranchId,
  zonesByBranch,
  staffByBranch,
  locale,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  defaultBranchId: string | null;
  zonesByBranch: Record<string, Zone[]>;
  staffByBranch: Record<string, StaffMember[]>;
  locale: string | undefined;
  onCreated: (taskId: string) => void;
}) {
  const { t } = useT();
  const copy = t.inventory.wizard;
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [mode, setMode] = useState<InventoryMode | null>(null);
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? "");
  const [extraZones, setExtraZones] = useState<Record<string, Zone[]>>({});
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [cookIds, setCookIds] = useState<string[]>([]);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [newZone, setNewZone] = useState<{ name: string; type: StorageType } | null>(null);
  const [error, setError] = useState<InventoryErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const zones = useMemo(() => {
    const merged = new Map<string, Zone>();
    for (const zone of [...(zonesByBranch[branchId] ?? []), ...(extraZones[branchId] ?? [])]) merged.set(zone.id, zone);
    return Array.from(merged.values());
  }, [zonesByBranch, extraZones, branchId]);
  const staff = staffByBranch[branchId] ?? [];
  const parallel = mode === "control_parallel";

  // fast_zones: each picked zone goes to a picked cook, round robin, unless changed by hand.
  const assignment = useMemo(() => {
    const result: Record<string, string> = {};
    zoneIds.forEach((zoneId, index) => {
      const chosen = manual[zoneId];
      result[zoneId] = chosen && cookIds.includes(chosen) ? chosen : cookIds.length ? cookIds[index % cookIds.length] : "";
    });
    return result;
  }, [zoneIds, cookIds, manual]);

  const valid =
    mode !== null &&
    branchId !== "" &&
    (parallel
      ? zoneIds.length === 1 && cookIds.length >= PARALLEL_MIN_COUNTERS && cookIds.length <= PARALLEL_MAX_COUNTERS
      : zoneIds.length > 0 && cookIds.length > 0 && zoneIds.every((zoneId) => assignment[zoneId]));

  const reset = () => {
    setStep(1);
    setMode(null);
    setZoneIds([]);
    setCookIds([]);
    setManual({});
    setTitle("");
    setDeadline("");
    setNewZone(null);
    setError(null);
  };

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const pickMode = (value: InventoryMode) => {
    setMode(value);
    if (value === "control_parallel") {
      setZoneIds((current) => current.slice(0, 1));
      setCookIds((current) => {
        if (current.length >= PARALLEL_MIN_COUNTERS) return current.slice(0, PARALLEL_MAX_COUNTERS);
        return staff.filter((person) => person.role === "cook").slice(0, PARALLEL_DEFAULT_COUNTERS).map((person) => person.userId);
      });
    }
    go(2);
  };

  const changeBranch = (value: string) => {
    setBranchId(value);
    setZoneIds([]);
    setCookIds([]);
    setManual({});
  };

  const toggleZone = (zoneId: string) => {
    setZoneIds((current) => {
      if (parallel) return current.includes(zoneId) ? [] : [zoneId];
      return current.includes(zoneId) ? current.filter((id) => id !== zoneId) : [...current, zoneId];
    });
  };

  const toggleCook = (userId: string) => {
    setCookIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId);
      if (parallel && current.length >= PARALLEL_MAX_COUNTERS) return current;
      return [...current, userId];
    });
  };

  const addZone = () => {
    if (!newZone || newZone.name.trim() === "") return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addZoneAction(branchId, newZone.type, newZone.name);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setExtraZones((current) => ({ ...current, [branchId]: [...(current[branchId] ?? []), result.value] }));
        setZoneIds((current) => (parallel ? [result.value.id] : [...current, result.value.id]));
        setNewZone(null);
      } catch {
        setError("save_failed");
      }
    });
  };

  const createDefaults = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createDefaultZonesAction(branchId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setExtraZones((current) => ({ ...current, [branchId]: result.value }));
      } catch {
        setError("save_failed");
      }
    });
  };

  const create = () => {
    if (!valid || !mode) return;
    const today = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date());
    const finalTitle = title.trim() || copy.defaultTitle(t.inventory.modes[mode].title, today);
    const assignments = parallel
      ? cookIds.map((assigneeId) => ({ zoneId: zoneIds[0], assigneeId }))
      : zoneIds.map((zoneId) => ({ zoneId, assigneeId: assignment[zoneId] }));
    setError(null);
    startTransition(async () => {
      try {
        const result = await createInventoryTaskAction({
          branchId,
          mode,
          title: finalTitle,
          scheduledAt: deadline ? new Date(deadline).toISOString() : null,
          assignments,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        reset();
        onCreated(result.value);
      } catch {
        setError("save_failed");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) reset();
      }}
      title={copy.title}
      description={copy.step(step, 2)}
      closeLabel={t.inventory.common.close}
      className="max-w-2xl"
    >
      <div className="mb-4 flex gap-1.5" aria-hidden>
        {[1, 2].map((index) => (
          <motion.span
            key={index}
            className="h-1 flex-1 rounded-full bg-white/10"
            animate={{ backgroundColor: index <= step ? "rgb(232 213 183)" : "rgba(255,255,255,0.1)" }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait" custom={direction} initial={false}>
        {step === 1 ? (
          <motion.div
            key="mode"
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="flex flex-col gap-3"
          >
            <p className="text-sm font-medium text-white/80">{copy.chooseMode}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {INVENTORY_MODES.map((value) => {
                const Icon = MODE_ICON[value];
                const info = t.inventory.modes[value];
                const selected = mode === value;
                return (
                  <motion.button
                    key={value}
                    type="button"
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => pickMode(value)}
                    className={cn(
                      "relative flex flex-col items-start gap-3 overflow-hidden rounded-[18px] border bg-card p-5 text-left transition-colors",
                      selected ? "border-beige" : "border-line hover:border-white/30",
                    )}
                  >
                    <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", MODE_GRADIENT[value])} />
                    <span className={cn("relative flex h-11 w-11 items-center justify-center rounded-[14px]", MODE_ACCENT[value])}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="relative">
                      <span className="block text-base font-semibold">{info.title}</span>
                      <span className="mt-0.5 block text-xs font-medium uppercase tracking-wider text-beige">{info.tagline}</span>
                    </span>
                    <span className="relative text-sm text-white/65">{info.description}</span>
                    <span className="relative mt-auto inline-flex items-center gap-1.5 text-xs text-white/50">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      {info.bestFor}
                    </span>
                    {value === "control_parallel" && (
                      <span className="relative text-xs text-violet-200/80">
                        {copy.varianceNote(formatPercent(PARALLEL_VARIANCE_THRESHOLD * 100, locale))}
                      </span>
                    )}
                    {selected && (
                      <motion.span layoutId="mode-check" className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-beige text-black">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </motion.span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="setup"
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="flex flex-col gap-5"
          >
            {branches.length > 1 && (
              <label className="flex flex-col gap-1.5 text-xs font-medium uppercase tracking-wider text-white/55">
                {copy.branch}
                <Select value={branchId} onChange={(event) => changeBranch(event.target.value)}>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <section className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-white/55">{parallel ? copy.zonesParallel : copy.zones}</p>
              {zones.length === 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-dashed border-line px-4 py-3">
                  <p className="text-sm text-white/55">{copy.noZones}</p>
                  <Button type="button" size="sm" disabled={pending} onClick={createDefaults}>
                    {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                    {copy.defaultZones}
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {zones.map((zone) => {
                  const Icon = ZONE_ICON[zone.type];
                  const selected = zoneIds.includes(zone.id);
                  return (
                    <motion.button
                      key={zone.id}
                      type="button"
                      layout
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleZone(zone.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex items-center gap-2 rounded-[14px] border px-3 py-2.5 text-left text-sm transition-colors",
                        selected ? "border-beige bg-beige/10 text-white" : "border-line text-white/75 hover:border-white/30",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-beige" : "text-white/50")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{zone.name}</span>
                        <span className="block text-[10px] uppercase tracking-wider text-white/40">{t.inventory.zoneTypes[zone.type]}</span>
                      </span>
                      {selected && <Check className="h-4 w-4 text-beige" aria-hidden />}
                    </motion.button>
                  );
                })}
                {newZone === null && (
                  <button
                    type="button"
                    onClick={() => setNewZone({ name: "", type: "soyuducu" })}
                    className="flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-line px-3 py-2.5 text-sm text-white/60 hover:border-beige hover:text-beige"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {copy.addZone}
                  </button>
                )}
              </div>
              <AnimatePresence>
                {newZone && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line p-3">
                      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-white/55">
                        {copy.zoneName}
                        <Input
                          autoFocus
                          maxLength={80}
                          value={newZone.name}
                          onChange={(event) => setNewZone({ ...newZone, name: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addZone();
                            }
                          }}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-white/55">
                        {copy.zoneType}
                        <Select value={newZone.type} onChange={(event) => setNewZone({ ...newZone, type: event.target.value as StorageType })}>
                          {STORAGE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {t.inventory.zoneTypes[type]}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <Button type="button" size="sm" disabled={pending || newZone.name.trim() === ""} onClick={addZone}>
                        {copy.add}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNewZone(null)}>
                        {t.inventory.common.cancel}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-white/55">{copy.cooks}</p>
                {parallel && <p className="text-xs text-white/45">{copy.cooksHint(PARALLEL_MIN_COUNTERS, PARALLEL_MAX_COUNTERS)}</p>}
              </div>
              {staff.length === 0 ? (
                <p className="text-sm text-white/55">{copy.noCooks}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {staff.map((person) => {
                    const selected = cookIds.includes(person.userId);
                    return (
                      <motion.button
                        key={person.userId}
                        type="button"
                        whileTap={{ scale: 0.96 }}
                        onClick={() => toggleCook(person.userId)}
                        aria-pressed={selected}
                        className={cn(
                          "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors",
                          selected ? "border-beige bg-beige/10" : "border-line hover:border-white/30",
                        )}
                      >
                        <span className="relative">
                          <Avatar id={person.userId} email={person.email} size="sm" />
                          <AnimatePresence>
                            {selected && (
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-beige text-black"
                              >
                                <Check className="h-2.5 w-2.5" aria-hidden />
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </span>
                        <span className="flex flex-col items-start leading-tight">
                          <span>{displayName(person.email)}</span>
                          <span className="text-[10px] uppercase tracking-wider text-white/40">{copy.roles[person.role] ?? person.role}</span>
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </section>

            {!parallel && zoneIds.length > 0 && cookIds.length > 0 && (
              <section className="flex flex-col gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-white/55">{copy.assign}</p>
                  <p className="text-xs text-white/40">{copy.assignHint}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {zoneIds.map((zoneId) => {
                    const zone = zones.find((item) => item.id === zoneId);
                    if (!zone) return null;
                    const Icon = ZONE_ICON[zone.type];
                    return (
                      <motion.div layout key={zoneId} className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2">
                        <Icon className="h-4 w-4 text-beige" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm">{zone.name}</span>
                        <Select
                          aria-label={zone.name}
                          value={assignment[zoneId]}
                          onChange={(event) => setManual((current) => ({ ...current, [zoneId]: event.target.value }))}
                          className="max-w-[12rem]"
                        >
                          {cookIds.map((userId) => {
                            const person = staff.find((item) => item.userId === userId);
                            return (
                              <option key={userId} value={userId}>
                                {person ? displayName(person.email) : userId.slice(0, 8)}
                              </option>
                            );
                          })}
                        </Select>
                      </motion.div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium uppercase tracking-wider text-white/55">
                {copy.taskTitle}
                <Input
                  maxLength={120}
                  value={title}
                  placeholder={mode ? copy.defaultTitle(t.inventory.modes[mode].title, "…") : ""}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium uppercase tracking-wider text-white/55">
                {copy.deadline}
                <Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-4 text-sm text-red-400">
          {t.inventory.errors[error]}
        </motion.p>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        {step === 2 ? (
          <Button type="button" variant="ghost" onClick={() => go(1)} disabled={pending}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t.inventory.common.back}
          </Button>
        ) : (
          <span />
        )}
        {step === 1 ? (
          <Button type="button" disabled={!mode} onClick={() => go(2)}>
            {t.inventory.common.next}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button type="button" disabled={!valid || pending} onClick={create}>
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {pending ? t.inventory.common.working : copy.create}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
