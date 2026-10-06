"use client";

import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import type { CatalogItem } from "@/lib/anbar/types";
import { ANBAR_APP_PATH } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/useT";

export default function CatalogView({ items }: { items: CatalogItem[] }) {
  const { t } = useT();
  const copy = t.anbar;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.catalog.title}</h1>
        <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
          {copy.title}
        </Link>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardTitle>{copy.catalog.empty}</CardTitle>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.fields.name}</TableHead>
              <TableHead>{copy.fields.barcode}</TableHead>
              <TableHead>{copy.fields.expiry}</TableHead>
              <TableHead>{copy.catalog.quantity}</TableHead>
              <TableHead>{copy.catalog.branch}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.barcode ?? "—"}</TableCell>
                <TableCell>{item.expiryDate ?? "—"}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.branch ?? copy.catalog.noBranch}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
