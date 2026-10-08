"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pager } from "@/components/ui/pager";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { KitchenBranch, KitchenLocation, StockLine } from "@/lib/anbar/stock-view";
import { formatMoney } from "@/lib/money";
import { useT } from "@/lib/i18n/useT";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { searchWasteStockAction } from "@/lib/wastage/actions";
import type { WasteErrorCode } from "@/lib/wastage/create";
import { WASTE_REASONS, type WasteCard, type WasteReason } from "@/lib/wastage/model";

function wasteError(code: string | undefined, errors: Record<WasteErrorCode, string>): string {
  if (code && code in errors) return errors[code as WasteErrorCode];
  return errors.save_failed;
}

const stockKey = (line: StockLine) => `${line.productId}|${line.locationId}`;

export default function WasteBoard({
  locations,
  branches,
  locationId,
  branchId,
  cards,
  count,
  page,
  pageSize,
  total,
  symbol,
}: {
  locations: KitchenLocation[];
  branches: KitchenBranch[];
  locationId: string | "all";
  branchId: string | "all";
  cards: WasteCard[];
  /** Today's logs in the filter (all pages). */
  count: number;
  page: number;
  pageSize: number;
  /** Value of today's logs in the filter; null when the role may not see costs. */
  total: number | null;
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
  const money = (amount: number | null) => (amount === null ? "—" : formatMoney(amount, symbol));

  const filterQuery = (nextBranch: string | "all", nextLocation: string | "all") => {
    const query: Record<string, string> = {};
    if (nextBranch !== "all") query.branch = nextBranch;
    if (nextLocation !== "all") query.location = nextLocation;
    return query;
  };

  const href = (nextBranch: string | "all", nextLocation: string | "all") => {
    const query = new URLSearchParams(filterQuery(nextBranch, nextLocation)).toString();
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
              .filter((location) => location.active && (branchId === "all" || location.branchId === branchId))
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
              <p className="shrink-0 text-sm text-beige">{money(card.cost)}</p>
            </Card>
          ))}
        </div>
      )}

      <Pager
        path={base}
        query={filterQuery(branchId, locationId)}
        page={page}
        pageSize={pageSize}
        total={count}
        shown={cards.length}
      />

      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.total}</p>
        <p className="mt-1 font-serif text-3xl font-bold text-white">{money(total)}</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title={copy.writeOff} closeLabel={copy.cancel}>
        <WriteOffForm
          branchId={branchId}
          locationId={locationId}
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

function WriteOffForm({
  branchId,
  locationId,
  onDone,
}: {
  branchId: string | "all";
  locationId: string | "all";
  onDone: () => void;
}) {
  const { t } = useT();
  const copy = t.waste;
  const [reason, setReason] = useState<WasteReason>("spoiled");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const [lines, setLines] = useState<StockLine[] | null>(null);
  const [stock, setStock] = useState("");
  const selected = lines?.find((line) => stockKey(line) === stock) ?? null;

  useEffect(() => {
    let live = true;
    void searchWasteStockAction({ search, branchId, locationId }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(copy.errors.save_failed);
        return;
      }
      setLines(result.lines);
      setStock((current) =>
        result.lines.some((line) => stockKey(line) === current) ? current : result.lines[0] ? stockKey(result.lines[0]) : "",
      );
    });
    return () => {
      live = false;
    };
  }, [search, branchId, locationId, copy.errors.save_failed]);

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

  if (lines !== null && lines.length === 0 && search === "") {
    return <p className="text-sm text-white/60">{copy.noStock}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="waste-search">{copy.product}</Label>
        <Input
          id="waste-search"
          type="search"
          value={query}
          placeholder={copy.search}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        {lines !== null && lines.length === 0 ? (
          <p className="mt-1.5 text-xs text-white/50">{copy.noMatches}</p>
        ) : (
          <Select
            id="waste-product"
            aria-label={copy.product}
            className="mt-2"
            name="stock"
            value={stock}
            onChange={(event) => setStock(event.target.value)}
            required
          >
            {(lines ?? []).map((line) => (
              <option key={stockKey(line)} value={stockKey(line)}>
                {line.productName} · {line.locationName} · {line.quantity} {line.unit}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div>
        <Label htmlFor="waste-qty">{copy.quantity}</Label>
        <Input
          id="waste-qty"
          name="quantity"
          type="number"
          min="0.001"
          max={selected?.quantity}
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
      <Button type="submit" disabled={pending || !selected}>
        {pending ? copy.working : copy.submit}
      </Button>
    </form>
  );
}
