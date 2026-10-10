"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { getBlock, getBlockLabel } from "@/lib/blocks";
import type { BlockSlug } from "@/lib/block-slugs";
import { useT } from "@/lib/i18n/useT";

export type RecordGroup = {
  label: string;
  /** Query parameter holding this group's page. */
  param: string;
  rows: Record<string, unknown>[];
  page: number;
  hasMore: boolean;
  failed?: boolean;
};

export function RecordList({
  slug,
  groups,
  query,
}: {
  slug: BlockSlug;
  groups: RecordGroup[];
  /** Current search params, kept when one group changes page. */
  query: Record<string, string>;
}) {
  const { lang, t } = useT();
  const pathname = usePathname();
  const block = getBlock(slug);
  const title = block ? getBlockLabel(block, lang) : slug;

  const pageHref = (param: string, page: number) => {
    const params = new URLSearchParams(query);
    if (page > 1) params.set(param, String(page));
    else params.delete(param);
    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-white">{title}</h1>
      {groups.map((group) => (
        <Card key={group.label}>
          <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{group.label}</CardTitle>
          {group.rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t.noData}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {group.rows.map((row) => (
                <li key={String(row.id)} className="border-t border-line pt-3 text-sm text-white first:border-t-0 first:pt-0">
                  {lineText(row)}
                </li>
              ))}
            </ul>
          )}
          {(group.page > 1 || group.hasMore) && (
            <nav className="mt-4 flex items-center justify-between gap-3" aria-label={group.label}>
              {group.page > 1 ? (
                <Link href={pageHref(group.param, group.page - 1)} className={buttonVariants("outline", "sm")}>
                  {t.pagination.previous}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted">{t.pagination.page(group.page)}</span>
              {group.hasMore ? (
                <Link href={pageHref(group.param, group.page + 1)} className={buttonVariants("outline", "sm")}>
                  {t.pagination.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </Card>
      ))}
    </div>
  );
}

function lineText(row: Record<string, unknown>): string {
  const parts = Object.entries(row)
    .filter(([key]) => key !== "id")
    .map(([, value]) => (value === null || value === undefined || value === "" ? null : String(value)))
    .filter((value): value is string => value !== null);
  return parts.join(" · ") || String(row.id ?? "");
}
