"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { getBlock, getBlockLabel } from "@/lib/blocks";
import type { BlockSlug } from "@/lib/block-slugs";
import { useT } from "@/lib/i18n/useT";

export function RecordList({
  slug,
  groups,
}: {
  slug: BlockSlug;
  groups: { label: string; rows: Record<string, unknown>[] }[];
}) {
  const { lang } = useT();
  const block = getBlock(slug);
  const title = block ? getBlockLabel(block, lang) : slug;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-white">{title}</h1>
      {groups.map((group) => (
        <Card key={group.label}>
          <CardTitle className="text-[10px] uppercase tracking-widest text-muted">{group.label}</CardTitle>
          {group.rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">—</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {group.rows.map((row) => (
                <li key={String(row.id)} className="border-t border-line pt-3 text-sm text-white first:border-t-0 first:pt-0">
                  {lineText(row)}
                </li>
              ))}
            </ul>
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
