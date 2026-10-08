"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/lib/i18n/useT";
import { pageCount } from "@/lib/pagination";

/** "Shown 51–100 of 1247" with previous/next links that keep the other search params. */
export function Pager({
  path,
  query,
  page,
  pageSize,
  total,
  shown,
  param = "page",
}: {
  path: string;
  query: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
  /** Rows on this page. */
  shown: number;
  param?: string;
}) {
  const { t } = useT();
  const pages = pageCount(total, pageSize);
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = shown === 0 ? 0 : from + shown - 1;

  const href = (next: number) => {
    const params = new URLSearchParams(query);
    if (next > 1) params.set(param, String(next));
    else params.delete(param);
    const search = params.toString();
    return search ? `${path}?${search}` : path;
  };

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t.pagination.page(page)}>
      {page > 1 ? (
        <Link href={href(Math.min(page - 1, pages))} className={buttonVariants("outline", "sm")}>
          {t.pagination.previous}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted">{t.pagination.shown(from, to, total)}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className={buttonVariants("outline", "sm")}>
          {t.pagination.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
