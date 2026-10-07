"use client";

import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KitchenBranch, KitchenLocation } from "@/lib/anbar/stock-view";
import { useT } from "@/lib/i18n/useT";
import {
  SCAN_MIME,
  isRecord,
  parseScanItems,
  type CatalogProduct,
  type ScanItem,
} from "@/lib/scanner/model";

type Draft = ScanItem & { key: string; qtyText: string; priceText: string; productId: string; query: string };

type ScanError = {
  invalid_input: string;
  unauthenticated: string;
  no_tenant: string;
  location_not_found: string;
  photo_required: string;
  scan_failed: string;
  no_items: string;
  save_failed: string;
};

function scanError(code: string | undefined, errors: ScanError): string {
  if (code && code in errors) return errors[code as keyof ScanError];
  return errors.save_failed;
}

function readPhotoPath(value: unknown): string | null {
  if (!isRecord(value) || typeof value.photoPath !== "string") return null;
  return value.photoPath;
}

function readError(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.error !== "string") return undefined;
  return value.error;
}

function matchProduct(name: string, products: CatalogProduct[]): string {
  const needle = name.trim().toLowerCase();
  const found = products.find((product) => product.name.trim().toLowerCase() === needle);
  return found ? found.id : "";
}

export default function ScannerView({
  locations,
  products,
  branches,
  locationId,
  branchId,
}: {
  locations: KitchenLocation[];
  products: CatalogProduct[];
  branches: KitchenBranch[];
  locationId: string | "all";
  branchId: string | "all";
}) {
  const { t } = useT();
  const copy = t.scanner;
  const place = t.anbar.kitchen;
  const router = useRouter();
  const pathname = usePathname();
  const base = pathname.startsWith("/app/hesablar") ? "/app/hesablar" : "/app/scanner";
  const [mode, setMode] = useState<"upload" | "review">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const href = (nextBranch: string | "all", nextLocation: string | "all") => {
    const params = new URLSearchParams();
    if (nextBranch !== "all") params.set("branch", nextBranch);
    if (nextLocation !== "all") params.set("location", nextLocation);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };

  const takeFile = (next: File | null) => {
    if (!next || !SCAN_MIME[next.type]) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setError(null);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag(false);
    takeFile(event.dataTransfer.files.item(0));
  };

  const recognize = async () => {
    if (!file) return;
    setPending(true);
    setError(null);
    const body = new FormData();
    body.set("photo", file);
    const response = await fetch("/api/scan-invoice", { method: "POST", body });
    const payload: unknown = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok) {
      setError(scanError(readError(payload), copy.errors));
      return;
    }
    const items = parseScanItems(payload);
    const path = readPhotoPath(payload);
    if (items.length === 0 || !path) {
      setError(copy.errors.no_items);
      return;
    }
    setPhotoPath(path);
    setRows(
      items.map((item, index) => {
        const productId = matchProduct(item.name, products);
        const selected = products.find((product) => product.id === productId);
        return {
          ...item,
          key: `${index}-${item.name}`,
          qtyText: String(item.qty),
          priceText: String(item.price),
          productId,
          query: selected ? selected.name : "",
        };
      }),
    );
    setMode("review");
  };

  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locationId === "all" || !photoPath) return;
    setPending(true);
    setError(null);
    const response = await fetch("/api/scan-invoice/receive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        location_id: locationId,
        photo_path: photoPath,
        items: rows.map((row) => ({
          name: row.name,
          qty: row.qtyText,
          unit: row.unit,
          price: row.priceText,
          product_id: row.productId,
        })),
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok) {
      setError(scanError(readError(payload), copy.errors));
      return;
    }
    setMode("upload");
    setRows([]);
    setPhotoPath(null);
    setFile(null);
    setPreview(null);
    setToast(Date.now());
    router.refresh();
  };

  const patch = (key: string, next: Partial<Draft>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.title}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="scan-branch">{place.branch}</Label>
          <Select
            id="scan-branch"
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
          <Label htmlFor="scan-location">{place.storage}</Label>
          <Select
            id="scan-location"
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

      {mode === "upload" ? (
        <Card
          onDragOver={(event) => {
            event.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={drag ? "border-beige" : undefined}
        >
          <p className="text-sm text-white/70">{copy.drop}</p>
          <label className="mt-4 inline-flex cursor-pointer items-center rounded-full border border-beige px-4 py-2 text-xs font-medium text-beige">
            {copy.browse}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => takeFile(event.target.files?.item(0) ?? null)}
            />
          </label>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="mt-4 h-40 w-full rounded-[12px] object-contain" />
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
          <Button className="mt-4" type="button" disabled={!file || pending} onClick={() => void recognize()}>
            {pending ? copy.working : copy.recognize}
          </Button>
        </Card>
      ) : (
        <form onSubmit={(event) => void receive(event)} className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <p className="text-sm text-white/60">{copy.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.name}</TableHead>
                  <TableHead>{copy.qty}</TableHead>
                  <TableHead>{copy.unit}</TableHead>
                  <TableHead>{copy.price}</TableHead>
                  <TableHead>{copy.product}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const needle = row.query.trim().toLowerCase();
                  const matches =
                    needle === ""
                      ? []
                      : products
                          .filter((product) => product.name.toLowerCase().includes(needle))
                          .slice(0, 6);
                  const selected = products.find((product) => product.id === row.productId);
                  return (
                    <TableRow key={row.key}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>
                        <Input
                          aria-label={copy.qty}
                          value={row.qtyText}
                          inputMode="decimal"
                          onChange={(event) => patch(row.key, { qtyText: event.target.value })}
                        />
                      </TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell>
                        <Input
                          aria-label={copy.price}
                          value={row.priceText}
                          inputMode="decimal"
                          onChange={(event) => patch(row.key, { priceText: event.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={copy.search}
                          value={row.query}
                          placeholder={copy.search}
                          onChange={(event) => patch(row.key, { query: event.target.value, productId: "" })}
                        />
                        {selected ? (
                          <p className="mt-1 text-xs text-beige">
                            {copy.selected}: {selected.name}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-white/50">{copy.create}</p>
                        )}
                        {matches.length > 0 ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {matches.map((product) => (
                              <li key={product.id}>
                                <button
                                  type="button"
                                  className="text-left text-sm text-beige underline underline-offset-4"
                                  onClick={() => patch(row.key, { productId: product.id, query: product.name })}
                                >
                                  {product.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {locationId === "all" ? <p className="text-sm text-white/60">{copy.pickLocation}</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || locationId === "all" || rows.length === 0}>
              {pending ? copy.working : copy.receive}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMode("upload");
                setError(null);
              }}
            >
              {copy.back}
            </Button>
          </div>
        </form>
      )}

      <Toast token={toast} text={copy.saved} />
    </div>
  );
}
