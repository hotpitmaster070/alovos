"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { KitchenBranch, KitchenLocation, StockLine } from "@/lib/anbar/stock-view";
import { formatMoney } from "@/lib/money";
import { useT } from "@/lib/i18n/useT";
import { WASTE_REASONS, type WasteCard, type WasteReason } from "@/lib/wastage/model";

function wasteError(
  code: string | undefined,
  errors: {
    invalid_input: string;
    unauthenticated: string;
    no_tenant: string;
    product_not_found: string;
    location_not_found: string;
    insufficient_stock: string;
    photo_required: string;
    save_failed: string;
  },
): string {
  if (code && code in errors) return errors[code as keyof typeof errors];
  return errors.save_failed;
}

export default function WasteBoard({
  lines,
  locations,
  branches,
  locationId,
  branchId,
  cards,
  symbol,
}: {
  lines: StockLine[];
  locations: KitchenLocation[];
  branches: KitchenBranch[];
  locationId: string | "all";
  branchId: string | "all";
  cards: WasteCard[];
  symbol: string | null;
}) {
  const { t } = useT();
  const copy = t.waste;
  const place = t.anbar.kitchen;
  const router = useRouter();
  const pathname = usePathname();
  const base = pathname.startsWith("/app/wastage") ? "/app/wastage" : "/app/tullanti";
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<number | null>(null);
  const total = cards.reduce((sum, card) => sum + card.cost, 0);

  const href = (nextBranch: string | "all", nextLocation: string | "all") => {
    const params = new URLSearchParams();
    if (nextBranch !== "all") params.set("branch", nextBranch);
    if (nextLocation !== "all") params.set("location", nextLocation);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.today}</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {copy.writeOff}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="waste-branch">{place.branch}</Label>
          <Select
            id="waste-branch"
            value={branchId === "all" ? "" : branchId}
            onChange={(event) => {
              const next = event.target.value || "all";
              const keep =
                next === "all" ||
                locations.some((location) => location.id === locationId && location.branchId === next);
              router.push(href(next, keep ? locationId : "all"));
            }}
          >
            <option value="">{place.places.all}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="waste-location">{place.storage}</Label>
          <Select
            id="waste-location"
            value={locationId === "all" ? "" : locationId}
            onChange={(event) => router.push(href(branchId, event.target.value || "all"))}
          >
            <option value="">{place.places.all}</option>
            {locations
              .filter((location) => branchId === "all" || location.branchId === branchId)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </Select>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-white/60">{copy.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <Card key={card.id} className="flex items-center gap-4">
              {card.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-[12px] object-cover" />
              ) : (
                <div className="h-16 w-16 shrink-0 rounded-[12px] border border-line bg-bg" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{card.productName}</p>
                <p className="mt-1 text-sm text-white/70">
                  {card.quantity}
                  {card.unit ? ` ${card.unit}` : ""} · {copy.reasons[card.reason]}
                </p>
                {card.actor ? (
                  <p className="mt-1 text-xs text-white/50">
                    {copy.who}: {card.actor}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-sm text-beige">{formatMoney(card.cost, symbol)}</p>
            </Card>
          ))}
        </div>
      )}

      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.total}</p>
        <p className="mt-1 font-serif text-3xl font-bold text-white">{formatMoney(total, symbol)}</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title={copy.writeOff} closeLabel={copy.cancel}>
        <WriteOffForm
          lines={lines}
          onDone={() => {
            setOpen(false);
            setToast(Date.now());
            router.refresh();
          }}
        />
      </Dialog>
      <Toast token={toast} text={copy.saved} />
    </div>
  );
}

function WriteOffForm({ lines, onDone }: { lines: StockLine[]; onDone: () => void }) {
  const { t } = useT();
  const copy = t.waste;
  const [reason, setReason] = useState<WasteReason>("spoiled");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = lines[0];
  const [stock, setStock] = useState(first ? `${first.productId}|${first.locationId}` : "");
  const selected = lines.find((line) => `${line.productId}|${line.locationId}` === stock) ?? first;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch("/api/wastage", { method: "POST", body: new FormData(event.currentTarget) });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(wasteError(payload?.error, copy.errors));
      return;
    }
    onDone();
  };

  if (!selected) return <p className="text-sm text-white/60">{copy.noStock}</p>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="waste-product">{copy.product}</Label>
        <Select id="waste-product" name="stock" value={stock} onChange={(event) => setStock(event.target.value)} required>
          {lines.map((line) => (
            <option key={`${line.productId}|${line.locationId}`} value={`${line.productId}|${line.locationId}`}>
              {line.productName} · {line.locationName}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="waste-qty">{copy.quantity}</Label>
        <Input
          id="waste-qty"
          name="quantity"
          type="number"
          min="0.001"
          max={selected.quantity}
          step="any"
          required
        />
      </div>
      <div>
        <Label htmlFor="waste-reason">{copy.reason}</Label>
        <Select
          id="waste-reason"
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as WasteReason)}
        >
          {WASTE_REASONS.map((value) => (
            <option key={value} value={value}>
              {copy.reasons[value]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="waste-photo">{copy.photo}</Label>
        <Input id="waste-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required={reason === "theft"} />
        {reason === "theft" ? <p className="mt-1.5 text-xs text-white/50">{copy.photoTheft}</p> : null}
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? copy.working : copy.submit}
      </Button>
    </form>
  );
}
