"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n/useT";
import { formatQty } from "@/lib/purchasing/format";
import { cn } from "@/lib/utils";

/** Red when the balance is below the minimum (par_levels, else the product's limits); nothing otherwise. */
export default function ParAlertBadge({
  quantity,
  min,
  unit,
  className,
}: {
  quantity: number;
  /** null or 0: not tracked. */
  min: number | null;
  unit: string;
  className?: string;
}) {
  const { t } = useT();
  if (min === null || min <= 0 || quantity >= min) return null;
  const out = quantity <= 0;
  return (
    <Badge
      role="status"
      className={cn(
        "border-red-400/60 font-semibold uppercase tracking-wide",
        out ? "bg-red-500 text-white" : "bg-red-500/10 text-red-300",
        className,
      )}
    >
      {out ? t.owner.par.out : t.owner.par.order(`${formatQty(quantity)} ${unit}`, `${formatQty(min)} ${unit}`)}
    </Badge>
  );
}
