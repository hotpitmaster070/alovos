"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MovementRow } from "@/lib/anbar/kitchen";
import { ANBAR_APP_PATH, ANBAR_MOVEMENTS_PATH } from "@/lib/auth-redirect";
import { MOVEMENT_TYPES, type MovementType } from "@/lib/anbar/stock-view";
import { useT } from "@/lib/i18n/useT";

function movementLabel(
  type: string,
  types: { prihod: string; spisanie: string; peremeshchenie: string; waste: string; task: string },
): string {
  if (type in types) return types[type as keyof typeof types];
  return type;
}

export default function MovementsTable({
  rows,
  total,
  page,
  pageSize,
  date,
  type,
}: {
  rows: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
  date: string | null;
  type: MovementType | null;
}) {
  const { t } = useT();
  const copy = t.anbar.kitchen;
  const query: Record<string, string> = {};
  if (date) query.date = date;
  if (type) query.type = type;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">{copy.movements}</h1>
        <Link href={ANBAR_APP_PATH} className={buttonVariants("outline", "sm")}>
          {t.anbar.title}
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-white/50">
          {copy.date}
          <input
            type="date"
            name="date"
            defaultValue={date ?? ""}
            className="rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm normal-case tracking-normal text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-white/50">
          {copy.type}
          <select
            name="type"
            defaultValue={type ?? ""}
            className="rounded-[12px] border border-line bg-bg px-3 py-2.5 text-sm normal-case tracking-normal text-white"
          >
            <option value="">{copy.allTypes}</option>
            {MOVEMENT_TYPES.map((item) => (
            <option key={item} value={item}>
              {movementLabel(item, copy.types)}
            </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants("default", "sm")}>
          {copy.apply}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-white/60">{copy.noMovements}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.when}</TableHead>
              <TableHead>{copy.who}</TableHead>
              <TableHead>{copy.what}</TableHead>
              <TableHead>{copy.type}</TableHead>
              <TableHead>{copy.from}</TableHead>
              <TableHead>{copy.to}</TableHead>
              <TableHead>{copy.qty}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.createdAt.slice(0, 16).replace("T", " ")}</TableCell>
                <TableCell>{row.actor ?? "—"}</TableCell>
                <TableCell>{row.productName}</TableCell>
                <TableCell>{movementLabel(row.movementType, copy.types)}</TableCell>
                <TableCell>{row.fromLocation ?? "—"}</TableCell>
                <TableCell>{row.toLocation ?? "—"}</TableCell>
                <TableCell>{row.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pager path={ANBAR_MOVEMENTS_PATH} query={query} page={page} pageSize={pageSize} total={total} shown={rows.length} />
    </div>
  );
}
