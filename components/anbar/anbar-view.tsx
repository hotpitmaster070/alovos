"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { Location, Product } from "@/lib/anbar/types";
import { filtersToSearch, type ProductFilters } from "@/lib/anbar/validation";
import { useT } from "@/lib/i18n/useT";
import AddLocationDialog from "./add-location-dialog";
import AddProductDialog from "./add-product-dialog";
import FiltersBar, { ANBAR_HREF } from "./filters-bar";
import MoveDialog from "./move-dialog";
import Pagination from "./pagination";
import ProductList from "./product-list";

type AnbarViewProps = {
  products: Product[];
  locations: Location[];
  filters: ProductFilters;
  hasNext: boolean;
  nowIso: string;
};

export default function AnbarView({ products, locations, filters, hasNext, nowIso }: AnbarViewProps) {
  const { t } = useT();
  const copy = t.anbar;
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [moving, setMoving] = useState<Product | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const filtering = filtersToSearch({ ...filters, page: 1 }) !== "";
  const noData = products.length === 0 && !filtering && filters.page === 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddingLocation(true)}>
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {copy.addLocation.open}
          </Button>
          <Button size="sm" onClick={() => setAddingProduct(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {copy.addProduct.open}
          </Button>
        </div>
      </div>

      <Card>
        <FiltersBar filters={filters} locations={locations} />
      </Card>

      {notice && (
        <p role="status" className="text-sm text-beige">
          {notice}
        </p>
      )}

      {products.length > 0 ? (
        <ProductList products={products} locations={locations} now={now} onMove={setMoving} />
      ) : (
        <Card className="text-center" aria-live="polite">
          <CardTitle>{noData ? copy.emptyTitle : copy.noMatchTitle}</CardTitle>
          <p className="mt-2 text-sm text-white/60">{noData ? copy.emptyHint : copy.noMatchHint}</p>
          {!noData && (
            <Link href={ANBAR_HREF} className={`${buttonVariants("outline")} mt-4`}>
              {copy.filters.reset}
            </Link>
          )}
        </Card>
      )}

      <Pagination filters={filters} hasNext={hasNext} />

      <MoveDialog
        product={moving}
        locations={locations}
        onClose={() => setMoving(null)}
        onMoved={() => {
          setMoving(null);
          setNotice(copy.move.success);
        }}
      />
      <AddProductDialog
        open={addingProduct}
        locations={locations}
        onClose={() => setAddingProduct(false)}
        onDone={() => {
          setAddingProduct(false);
          setNotice(copy.addProduct.success);
        }}
      />
      <AddLocationDialog
        open={addingLocation}
        onClose={() => setAddingLocation(false)}
        onDone={() => {
          setAddingLocation(false);
          setNotice(copy.addLocation.success);
        }}
      />
    </div>
  );
}
