"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EXPIRY_FILTERS, LOW_STOCK_THRESHOLD } from "@/lib/anbar/constants";
import type { Location } from "@/lib/anbar/types";
import type { ProductFilters } from "@/lib/anbar/validation";
import { useT } from "@/lib/i18n/useT";
import BarcodeField from "./barcode-field";

export const ANBAR_HREF = "/app/anbar";

export default function FiltersBar({
  filters,
  locations,
}: {
  filters: ProductFilters;
  locations: Location[];
}) {
  const { t } = useT();
  const copy = t.anbar;
  const expiryLabels = {
    week: copy.filters.expiryWeek,
    month: copy.filters.expiryMonth,
    ok: copy.filters.expiryOk,
  } as const;

  return (
    <form method="get" action={ANBAR_HREF} role="search" className="flex flex-col gap-4">
      <BarcodeField
        id="anbar-barcode"
        name="barcode"
        label={copy.searchLabel}
        defaultValue={filters.barcode}
        placeholder={copy.searchPlaceholder}
        autoFocus
        submitOnScan
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="anbar-location">{copy.filters.location}</Label>
          <Select id="anbar-location" name="location" defaultValue={filters.locationId ?? ""}>
            <option value="">{copy.filters.allLocations}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="anbar-expiry">{copy.filters.expiry}</Label>
          <Select id="anbar-expiry" name="expiry" defaultValue={filters.expiry ?? ""}>
            <option value="">{copy.filters.expiryAll}</option>
            {EXPIRY_FILTERS.map((value) => (
              <option key={value} value={value}>
                {expiryLabels[value]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-white/80">
          <Checkbox name="expired" value="1" defaultChecked={filters.expiredOnly} />
          {copy.filters.expiredOnly}
        </label>
        <label className="flex items-center gap-2 text-sm text-white/80">
          <Checkbox name="low" value="1" defaultChecked={filters.lowStock} />
          {copy.filters.lowStock(LOW_STOCK_THRESHOLD)}
        </label>
      </div>

      <div className="flex gap-3">
        <Button type="submit">{copy.searchButton}</Button>
        <Link href={ANBAR_HREF} className="inline-flex items-center px-3 text-sm text-beige underline underline-offset-4">
          {copy.filters.reset}
        </Link>
      </div>
    </form>
  );
}
