"use client";

import { getBlock, getBlockLabel } from "@/lib/blocks";
import type { BlockSlug } from "@/lib/block-slugs";
import { useT } from "@/lib/i18n/useT";

export default function BlockView({ slug }: { slug: BlockSlug }) {
  const { t, lang } = useT();
  const block = getBlock(slug);
  if (!block) return null;

  const Icon = block.icon;
  const details = t.blockDetails[block.slug];

  return (
    <div className="rounded-[18px] border border-line bg-card p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-7 w-7 text-beige" strokeWidth={1.5} aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
          {t.blockNumber} {block.id}
          {block.killer ? ` · ${t.sidebar.killer}` : ""}
        </span>
      </div>
      <h1 className="mt-5 font-serif text-[28px] font-bold leading-[1.15] tracking-tight">
        {t.moduleStub.replace("{name}", getBlockLabel(block, lang))}
      </h1>
      <p className="mt-3 text-sm text-muted">{details.spec}</p>
      {details.killers.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {details.killers.map((killer) => (
            <li
              key={killer}
              className="rounded-full border border-beige px-3 py-1 text-xs text-beige"
            >
              {killer}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
