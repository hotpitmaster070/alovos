"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { filtersToSearch, type ProductFilters } from "@/lib/anbar/validation";
import { useT } from "@/lib/i18n/useT";
import { ANBAR_HREF } from "./filters-bar";

export default function Pagination({
  filters,
  hasNext,
}: {
  filters: ProductFilters;
  hasNext: boolean;
}) {
  const { t } = useT();
  const hasPrevious = filters.page > 1;
  if (!hasPrevious && !hasNext) return null;

  return (
    <nav aria-label={t.anbar.pagination.page(filters.page)} className="flex items-center justify-between gap-3">
      {hasPrevious ? (
        <Link
          href={`${ANBAR_HREF}${filtersToSearch(filters, filters.page - 1)}`}
          className={buttonVariants("outline", "sm")}
          rel="prev"
        >
          {t.anbar.pagination.previous}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-white/50" aria-current="page">
        {t.anbar.pagination.page(filters.page)}
      </span>
      {hasNext ? (
        <Link
          href={`${ANBAR_HREF}${filtersToSearch(filters, filters.page + 1)}`}
          className={buttonVariants("outline", "sm")}
          rel="next"
        >
          {t.anbar.pagination.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
