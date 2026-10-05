"use client";

import Link from "next/link";
import { blockHref, getBlockLabel, type Block } from "@/lib/blocks";
import { useT } from "@/lib/i18n/useT";

export default function ModuleCard({ block }: { block: Block }) {
  const { lang } = useT();
  const Icon = block.icon;

  return (
    <Link
      href={blockHref(block)}
      className="flex cursor-pointer flex-col items-center gap-2.5 rounded-[18px] border border-line bg-card px-2 py-5 transition-colors hover:border-beige"
    >
      <Icon className="h-7 w-7 text-beige" strokeWidth={1.5} aria-hidden="true" />
      <span className="whitespace-nowrap text-center text-[10px] font-medium uppercase tracking-widest text-white">
        {getBlockLabel(block, lang)}
      </span>
    </Link>
  );
}
