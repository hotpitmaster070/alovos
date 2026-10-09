"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isUnit } from "@/lib/anbar/types";
import { ORDERS_PATH, SUPPLIERS_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";
import { dateLabel, formatQty } from "@/lib/purchasing/format";
import { callPurchasingApi } from "@/lib/purchasing/client";
import type { ForecastRow, ForecastStatus, Supplier } from "@/lib/purchasing/model";
import { cn } from "@/lib/utils";

const BADGE_CLASSES: Record<ForecastStatus, string> = {
  critical: "border-red-400/60 text-red-300",
  order: "border-amber-300/60 text-amber-200",
  ok: "border-emerald-400/60 text-emerald-300",
  no_limits: "border-white/20 text-white/50",
};

function useUnitLabel() {
  const { t } = useT();
  return (unit: string) => (isUnit(unit) ? t.anbar.units[unit] : unit);
}

/** Status badge with the line a chef acts on: next delivery / what to order / projection. */
export function ForecastStatusCell({ row }: { row: ForecastRow }) {
  const { t } = useT();
  const copy = t.purchasing.forecast;
  const unitLabel = useUnitLabel();
  const qty = (value: number) => `${formatQty(value)} ${unitLabel(row.unit)}`;
  const delivery = row.nextDeliveryDate ? copy.nextDelivery(dateLabel(row.nextDeliveryDate, t.purchasing.locale)) : null;

  return (
    <div className="flex flex-col items-start gap-1 text-xs text-white/60">
      <Badge className={BADGE_CLASSES[row.status]}>{copy.status[row.status]}</Badge>
      {row.status === "critical" && (
        <span className="text-red-300">
          {delivery ?? copy.noDelivery}
          {row.willRunOut && `, ${copy.willRunOut}`}
        </span>
      )}
      {row.status === "order" && row.needToOrder !== null && (
        <span className="text-amber-200">
          {copy.orderQty(qty(row.needToOrder), row.daysUntilDelivery)}
          {row.willRunOut && ` · ${copy.willRunOut}`}
        </span>
      )}
      {row.projectedStock !== null && <span>{copy.projected(qty(row.projectedStock))}</span>}
      {row.avgDailyUsage > 0 && <span>{copy.usage(qty(row.avgDailyUsage))}</span>}
      {row.onOrder > 0 && <span>{copy.onOrder(qty(row.onOrder))}</span>}
    </div>
  );
}

function LimitsForm({ row, suppliers, onSaved }: { row: ForecastRow; suppliers: Supplier[]; onSaved: () => void }) {
  const { t } = useT();
  const copy = t.purchasing.limits;
  const unitLabel = useUnitLabel();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const outcome = await callPurchasingApi(`/api/products/${row.productId}/par-level`, "PATCH", {
      par_level: String(data.get("par_level") ?? ""),
      min_stock: String(data.get("min_stock") ?? ""),
      supplier_id: String(data.get("supplier_id") ?? ""),
    });
    setPending(false);
    if (!outcome.ok) {
      setError(t.purchasing.errors[outcome.error]);
      return;
    }
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-xs text-white/50">{copy.unit(unitLabel(row.unit))}</p>
      <div>
        <Label htmlFor="limit-par">{copy.par}</Label>
        <Input id="limit-par" name="par_level" type="number" min="0" step="any" inputMode="decimal" defaultValue={row.parLevel ?? ""} />
        <p className="mt-1 text-xs text-white/50">{copy.parHint}</p>
      </div>
      <div>
        <Label htmlFor="limit-min">{copy.min}</Label>
        <Input id="limit-min" name="min_stock" type="number" min="0" step="any" inputMode="decimal" defaultValue={row.minStock ?? ""} />
        <p className="mt-1 text-xs text-white/50">{copy.minHint}</p>
      </div>
      <div>
        <Label htmlFor="limit-supplier">{copy.supplier}</Label>
        <Select id="limit-supplier" name="supplier_id" defaultValue={row.supplierId ?? ""}>
          <option value="">{copy.noSupplier}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name} ({supplier.code})
            </option>
          ))}
        </Select>
        <Link href={SUPPLIERS_PATH} className="mt-1 inline-block text-xs text-beige underline-offset-2 hover:underline">
          {t.purchasing.suppliers.open}
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? copy.working : copy.save}
      </Button>
    </form>
  );
}

/** "Limit qoy" button with its dialog; refreshes the page after saving. */
export function LimitsButton({ row, suppliers }: { row: ForecastRow; suppliers: Supplier[] }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t.purchasing.limits.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t.purchasing.limits.title(row.name)} closeLabel={t.purchasing.limits.cancel}>
        <LimitsForm
          row={row}
          suppliers={suppliers}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}

/** Products that need the chef: out of stock, below par or running out before the next delivery. */
export function ForecastPanel({
  rows,
  suppliers,
  canEdit,
  showAll,
  allHref,
  attentionHref,
}: {
  rows: ForecastRow[];
  suppliers: Supplier[];
  canEdit: boolean;
  showAll: boolean;
  allHref: string;
  attentionHref: string;
}) {
  const { t } = useT();
  const copy = t.purchasing.forecast;
  const unitLabel = useUnitLabel();

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{copy.title}</CardTitle>
          <p className="mt-1 text-xs text-white/50">{copy.hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={showAll ? attentionHref : allHref} className={buttonVariants("ghost", "sm")}>
            {showAll ? copy.attention : copy.all}
          </Link>
          <Link href={ORDERS_PATH} className={buttonVariants("outline", "sm")}>
            {t.purchasing.orders.open}
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-white/60">{copy.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.product}</TableHead>
              <TableHead>{copy.stock}</TableHead>
              <TableHead>{copy.state}</TableHead>
              {canEdit && <TableHead>{t.anbar.fields.actions}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.productId}>
                <TableCell>
                  <span className="text-white">{row.name}</span>
                  {row.supplierName && <span className="block text-xs text-white/40">{row.supplierName}</span>}
                </TableCell>
                <TableCell className={cn(row.status === "critical" && "text-red-300")}>
                  {formatQty(row.currentStock)} {unitLabel(row.unit)}
                  {row.parLevel !== null && <span className="text-white/40"> / {formatQty(row.parLevel)}</span>}
                </TableCell>
                <TableCell>
                  <ForecastStatusCell row={row} />
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <LimitsButton row={row} suppliers={suppliers} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
