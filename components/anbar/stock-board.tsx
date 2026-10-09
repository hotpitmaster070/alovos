"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pager } from "@/components/ui/pager";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ANBAR_CATALOG_PATH, ANBAR_COUNT_PATH, ANBAR_MOVEMENTS_PATH, ANBAR_STORAGE_PATH } from "@/lib/auth-redirect";
import {
  MOVEMENT_TYPES,
  type KitchenBranch,
  type KitchenLocation,
  type MovementType,
  type StockLine,
} from "@/lib/anbar/stock-view";
import { ForecastPanel, ForecastStatusCell, LimitsButton } from "@/components/purchasing/forecast";
import { useT } from "@/lib/i18n/useT";
import type { ForecastRow, Supplier } from "@/lib/purchasing/model";
import AddStorageLocation from "./add-storage-location";

function unitLabel(unit: string, units: { kg: string; litr: string; sht: string }): string {
  if (unit === "kg" || unit === "litr" || unit === "sht") return units[unit];
  return unit;
}

function kitchenError(
  code: string | undefined,
  errors: {
    invalid_input: string;
    unauthenticated: string;
    no_tenant: string;
    product_not_found: string;
    location_not_found: string;
    insufficient_stock: string;
    save_failed: string;
  },
): string {
  if (code && code in errors) return errors[code as keyof typeof errors];
  return errors.save_failed;
}

function movementLabel(
  type: string,
  types: { prihod: string; spisanie: string; peremeshchenie: string; waste: string; task: string },
): string {
  if (type in types) return types[type as keyof typeof types];
  return type;
}

type Draft = {
  line: StockLine;
  movementType: MovementType;
};

export default function StockBoard({
  lines,
  total,
  page,
  pageSize,
  search,
  locations,
  branches,
  locationId,
  branchId,
  money,
  updated,
  forecast,
  attention,
  forecastAll,
  suppliers,
  canSetLimits,
}: {
  lines: StockLine[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  locations: KitchenLocation[];
  branches: KitchenBranch[];
  locationId: string | "all";
  branchId: string | "all";
  money: string;
  updated: boolean;
  /** Forecast of the products on this page and of those needing attention. */
  forecast: ForecastRow[];
  /** Out of stock / to order (every product with ?forecast=all). */
  attention: ForecastRow[];
  forecastAll: boolean;
  suppliers: Supplier[];
  canSetLimits: boolean;
}) {
  const { t } = useT();
  const copy = t.anbar.kitchen;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<number | null>(null);
  const flashed = useRef(false);

  useEffect(() => {
    if (!updated || flashed.current) return;
    flashed.current = true;
    setToast(Date.now());
    const id = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      params.delete("notice");
      const query = params.toString();
      router.replace(query ? `/app/anbar?${query}` : "/app/anbar");
    }, 3000);
    return () => window.clearTimeout(id);
  }, [updated, router]);

  const filterQuery = (nextBranch: string | "all", nextLocation: string | "all", nextSearch: string) => {
    const query: Record<string, string> = {};
    if (nextBranch !== "all") query.branch = nextBranch;
    if (nextLocation !== "all") query.location = nextLocation;
    if (nextSearch) query.q = nextSearch;
    return query;
  };

  const href = (nextBranch: string | "all", nextLocation: string | "all", nextSearch: string = search) => {
    const query = new URLSearchParams(filterQuery(nextBranch, nextLocation, nextSearch)).toString();
    return query ? `/app/anbar?${query}` : "/app/anbar";
  };
  const forecastHref = (all: boolean) => {
    const query = new URLSearchParams({ ...filterQuery(branchId, locationId, search), ...(all ? { forecast: "all" } : {}) }).toString();
    return query ? `/app/anbar?${query}` : "/app/anbar";
  };
  const forecastByProduct = new Map(forecast.map((row) => [row.productId, row]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{t.anbar.title}</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={ANBAR_CATALOG_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.catalog.open}
          </Link>
          <Link href={ANBAR_COUNT_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.sayim.open}
          </Link>
          <Link href={ANBAR_STORAGE_PATH} className={buttonVariants("outline", "sm")}>
            {t.anbar.saxlama.open}
          </Link>
          <Link href={ANBAR_MOVEMENTS_PATH} className={buttonVariants("outline", "sm")}>
            {copy.movements}
          </Link>
        </div>
      </div>

      <ForecastPanel
        rows={attention}
        suppliers={suppliers}
        canEdit={canSetLimits}
        showAll={forecastAll}
        allHref={forecastHref(true)}
        attentionHref={forecastHref(false)}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="stock-branch">{copy.branch}</Label>
          <Select
            id="stock-branch"
            value={branchId === "all" ? "" : branchId}
            onChange={(event) => {
              const next = event.target.value || "all";
              const keep =
                next === "all" ||
                locations.some((location) => location.id === locationId && location.branchId === next);
              router.push(href(next, keep ? locationId : "all"));
            }}
          >
            <option value="">{copy.places.all}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="stock-location">{copy.storage}</Label>
          <div className="flex items-center gap-2">
            <Select
              id="stock-location"
              value={locationId === "all" ? "" : locationId}
              onChange={(event) => router.push(href(branchId, event.target.value || "all"))}
            >
              <option value="">{copy.places.all}</option>
              {locations
                .filter((location) => location.active && (branchId === "all" || location.branchId === branchId))
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </Select>
            <AddStorageLocation
              branches={branches}
              branchId={branchId === "all" ? null : branchId}
              onCreated={(location) => router.push(href(branchId === "all" ? "all" : location.branchId, location.id))}
            />
          </div>
        </div>
      </div>

      <SearchField
        id="stock-search"
        type="search"
        aria-label={copy.search}
        placeholder={copy.search}
        value={search}
        onSearch={(text) => router.replace(href(branchId, locationId, text))}
      />

      {lines.length === 0 ? (
        <p className="text-sm text-white/60">{copy.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.anbar.fields.name}</TableHead>
              <TableHead>{copy.place}</TableHead>
              <TableHead>{copy.qty}</TableHead>
              <TableHead>{t.purchasing.forecast.state}</TableHead>
              <TableHead>{t.anbar.fields.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const lineForecast = forecastByProduct.get(line.productId);
              return (
              <TableRow key={`${line.productId}-${line.locationId}`}>
                <TableCell>{line.productName}</TableCell>
                <TableCell>{line.locationName}</TableCell>
                <TableCell>
                  {line.quantity} {unitLabel(line.unit, copy.units)}
                </TableCell>
                <TableCell>{lineForecast && <ForecastStatusCell row={lineForecast} />}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {canSetLimits && lineForecast && <LimitsButton row={lineForecast} suppliers={suppliers} />}
                    <Button size="sm" variant="outline" onClick={() => setDraft({ line, movementType: "spisanie" })}>
                      {copy.writeOff}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDraft({ line, movementType: "peremeshchenie" })}>
                      {copy.transfer}
                    </Button>
                    <Button size="sm" onClick={() => setDraft({ line, movementType: "prihod" })}>
                      {copy.receipt}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Pager
        path="/app/anbar"
        query={filterQuery(branchId, locationId, search)}
        page={page}
        pageSize={pageSize}
        total={total}
        shown={lines.length}
      />

      <div>
        <p className="text-[10px] font-medium uppercase tracking-widest text-white/50">{copy.total}</p>
        <p className="mt-1 font-serif text-3xl font-bold text-white">{money}</p>
      </div>

      <StockMoveDialog
        draft={draft}
        locations={locations}
        onClose={() => setDraft(null)}
        onDone={() => {
          setDraft(null);
          setToast(Date.now());
          router.refresh();
        }}
      />
      <Toast token={toast} text={copy.updated} />
    </div>
  );
}

function StockMoveDialog({
  draft,
  locations,
  onClose,
  onDone,
}: {
  draft: Draft | null;
  locations: KitchenLocation[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.kitchen;
  const line = draft?.line;

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()} title={copy.dialogTitle} closeLabel={copy.cancel}>
      {draft && line ? (
        <MoveForm
          key={`${line.productId}-${line.locationId}-${draft.movementType}`}
          draft={draft}
          locations={locations}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  );
}

function MoveForm({
  draft,
  locations,
  onDone,
}: {
  draft: Draft;
  locations: KitchenLocation[];
  onDone: () => void;
}) {
  const { t } = useT();
  const copy = t.anbar.kitchen;
  const [movementType, setMovementType] = useState<MovementType>(draft.movementType);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draws = movementType !== "prihod";
  const needsTo = movementType === "prihod" || movementType === "peremeshchenie";

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const response = await fetch("/api/stock/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: draft.line.productId,
        from_location_id: draws ? String(data.get("from_location_id") ?? "") : "",
        to_location_id: needsTo ? String(data.get("to_location_id") ?? "") : "",
        quantity: String(data.get("quantity") ?? ""),
        movement_type: movementType,
        reason: String(data.get("reason") ?? ""),
      }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(kitchenError(payload?.error, copy.errors));
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-white/70">{draft.line.productName}</p>
      <div>
        <Label htmlFor="move-type">{copy.type}</Label>
        <Select
          id="move-type"
          value={movementType}
          onChange={(event) => setMovementType(event.target.value as MovementType)}
        >
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
                {movementLabel(type, copy.types)}
            </option>
          ))}
        </Select>
      </div>
      {draws ? (
        <div>
          <Label htmlFor="move-from">{copy.from}</Label>
          <Select id="move-from" name="from_location_id" defaultValue={draft.line.locationId} required>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {needsTo ? (
        <div>
          <Label htmlFor="move-to">{copy.to}</Label>
          <Select id="move-to" name="to_location_id" defaultValue={movementType === "prihod" ? draft.line.locationId : ""} required>
            <option value="" disabled>
              {copy.choose}
            </option>
            {locations
              .filter((location) => location.active)
              .filter((location) => movementType !== "peremeshchenie" || location.id !== draft.line.locationId)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </Select>
        </div>
      ) : null}
      <div>
        <Label htmlFor="move-qty">{copy.qty}</Label>
        <Input id="move-qty" name="quantity" type="number" min="0.001" step="any" required />
      </div>
      <div>
        <Label htmlFor="move-reason">{copy.reason}</Label>
        <Input id="move-reason" name="reason" maxLength={500} />
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? copy.working : copy.submit}
      </Button>
    </form>
  );
}
