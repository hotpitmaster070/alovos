"use client";

import { ArrowRightLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LOW_STOCK_THRESHOLD } from "@/lib/anbar/constants";
import type { Location, Product } from "@/lib/anbar/types";
import { useT } from "@/lib/i18n/useT";
import ExpiryBadge from "./expiry-badge";

type ProductListProps = {
  products: Product[];
  locations: Location[];
  now: Date;
  onMove: (product: Product) => void;
};

const LOW_STOCK_CLASSES = "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";

export default function ProductList({ products, locations, now, onMove }: ProductListProps) {
  const { t } = useT();
  const copy = t.anbar;
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));

  const locationName = (product: Product): string =>
    (product.locationId ? locationNames.get(product.locationId) : undefined) ?? copy.fields.noLocation;
  const unitLabel = (product: Product): string =>
    copy.units[product.unit as keyof typeof copy.units] ?? product.unit;
  const qtyText = (product: Product): string => `${product.qty} ${unitLabel(product)}`;
  const costText = (product: Product): string =>
    product.cost === null ? "-" : `${product.cost.toFixed(2)} ${t.price.currency}`;
  const isLow = (product: Product): boolean => product.qty < LOW_STOCK_THRESHOLD;

  const moveButton = (product: Product) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onMove(product)}
      aria-label={`${copy.move.open}: ${product.name}`}
    >
      <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
      {copy.move.open}
    </Button>
  );

  return (
    <>
      <ul className="flex flex-col gap-3 md:hidden">
        {products.map((product) => (
          <li key={product.id}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-medium text-white">{product.name}</h3>
                  <p className="mt-1 text-xs text-white/50">
                    {product.barcode ?? copy.fields.noBarcode}
                  </p>
                </div>
                <ExpiryBadge expiryDate={product.expiryDate} now={now} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/50">
                    {copy.fields.qty}
                  </dt>
                  <dd className="mt-1 flex items-center gap-2 text-white">
                    {qtyText(product)}
                    {isLow(product) && <Badge className={LOW_STOCK_CLASSES}>{copy.lowStockBadge}</Badge>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/50">
                    {copy.fields.location}
                  </dt>
                  <dd className="mt-1 text-white">{locationName(product)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/50">
                    {copy.fields.cost}
                  </dt>
                  <dd className="mt-1 text-white">{costText(product)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-widest text-white/50">
                    {copy.fields.expiry}
                  </dt>
                  <dd className="mt-1 text-white">{product.expiryDate ?? copy.fields.noExpiry}</dd>
                </div>
              </dl>
              <div className="mt-4">{moveButton(product)}</div>
            </Card>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.fields.name}</TableHead>
              <TableHead>{copy.fields.barcode}</TableHead>
              <TableHead>{copy.fields.location}</TableHead>
              <TableHead>{copy.fields.qty}</TableHead>
              <TableHead>{copy.fields.cost}</TableHead>
              <TableHead>{copy.fields.expiry}</TableHead>
              <TableHead>
                <span className="sr-only">{copy.fields.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="text-white/60">
                  {product.barcode ?? copy.fields.noBarcode}
                </TableCell>
                <TableCell>{locationName(product)}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {qtyText(product)}
                    {isLow(product) && <Badge className={LOW_STOCK_CLASSES}>{copy.lowStockBadge}</Badge>}
                  </span>
                </TableCell>
                <TableCell>{costText(product)}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {product.expiryDate ?? copy.fields.noExpiry}
                    <ExpiryBadge expiryDate={product.expiryDate} now={now} />
                  </span>
                </TableCell>
                <TableCell className="text-right">{moveButton(product)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
