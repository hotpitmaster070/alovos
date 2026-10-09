"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { StorageOverview } from "@/lib/anbar/repository";
import { STORAGE_TYPES, type StorageType } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import StorageIcon from "./storage-icon";

/** Icon, name, code, product count and count status of one storage place; actions go in children. */
export function StorageCard({
  location,
  selected = false,
  children,
}: {
  location: StorageOverview;
  selected?: boolean;
  children?: ReactNode;
}) {
  const { t } = useT();
  const copy = t.anbar.saxlama;
  const open = location.openCount;
  const status = !location.active
    ? copy.inactive
    : open === null
      ? copy.noCount
      : open.status === "merging"
        ? t.anbar.sayim.status.merging
        : copy.counting(open.counters);

  return (
    <Card
      className={cn("flex flex-col gap-3", selected && "border-beige", !location.active && "opacity-60")}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        <StorageIcon type={location.type} className="mt-0.5 h-6 w-6 shrink-0 text-beige" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{location.name}</p>
          <p className="font-mono text-xs text-white/50">{location.code}</p>
        </div>
        <Badge className={cn(open && location.active ? "border-beige text-beige" : "border-white/20 text-white/60")}>{status}</Badge>
      </div>
      <p className="text-sm text-white/70">{copy.products(location.productCount)}</p>
      {children}
    </Card>
  );
}

/** Places grouped by type in display order (soyuducu, dondurucu, anbar, other), numbers ascending. */
export function StorageGrid({
  locations,
  renderCard,
}: {
  locations: StorageOverview[];
  renderCard: (location: StorageOverview) => ReactNode;
}) {
  const { t } = useT();
  const groups = STORAGE_TYPES.map((type) => [type, locations.filter((location) => location.type === type)] as const).filter(
    ([, items]) => items.length > 0,
  );
  return (
    <div className="flex flex-col gap-5">
      {groups.map(([type, items]: readonly [StorageType, StorageOverview[]]) => (
        <section key={type} className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-muted">{t.anbar.storage.types[type]}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(renderCard)}</div>
        </section>
      ))}
    </div>
  );
}
