import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BLOCKS, getBlock } from "@/lib/blocks";

type Props = { params: { slug: string } };

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOCKS.map((b) => ({ slug: b.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const block = getBlock(params.slug);
  return { title: block ? `${block.labelAZ} — alovOS` : "alovOS" };
}

export default function BlockPage({ params }: Props) {
  const block = getBlock(params.slug);
  if (!block) notFound();
  const Icon = block.icon;

  return (
    <div className="rounded-[18px] border border-line bg-card p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-7 w-7 text-beige" strokeWidth={1.5} aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-[#888]">
          Block {block.id}
          {block.killer ? " · KILLER" : ""}
        </span>
      </div>
      <h1 className="mt-5 font-serif text-[28px] font-bold leading-[1.15] tracking-tight">
        Module {block.labelAZ} - spec implemented, UI next
      </h1>
      <p className="mt-3 text-sm text-[#888]">{block.spec}</p>
      {block.killers.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {block.killers.map((k) => (
            <li
              key={k}
              className="rounded-full border border-beige px-3 py-1 text-xs text-beige"
            >
              {k}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
