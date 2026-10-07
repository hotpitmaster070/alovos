"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";

export default function CountForm({
  products,
  locations,
}: {
  products: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const { t } = useT();
  const copy = t.anbar.sayim;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-white/60">{copy.blind}</p>
        </div>
        <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
          {t.anbar.title}
        </Link>
      </div>

      <Card>
        <form action="/api/stock/count" method="post" className="flex flex-col gap-4">
          <div>
            <Label htmlFor="count-group">{copy.groupKey}</Label>
            <Input id="count-group" name="group_key" maxLength={80} autoComplete="off" />
            <p className="mt-1.5 text-xs text-white/50">{copy.groupHint}</p>
          </div>
          <div>
            <Label htmlFor="count-location">{copy.location}</Label>
            <Select id="count-location" name="location_id" required defaultValue={locations[0]?.id ?? ""}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </div>
          {products.length === 0 ? (
            <p className="text-sm text-white/60">{copy.empty}</p>
          ) : (
            products.map((product) => (
              <div key={product.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`count-${product.id}`} className="text-sm text-white">
                  {product.name}
                </label>
                <Input
                  id={`count-${product.id}`}
                  className="max-w-[120px]"
                  name={`qty_${product.id}`}
                  inputMode="decimal"
                  aria-label={`${product.name}, ${copy.counted}`}
                />
              </div>
            ))
          )}
          <Button type="submit">{copy.submit}</Button>
        </form>
      </Card>
    </div>
  );
}
