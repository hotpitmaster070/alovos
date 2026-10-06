import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlockView from "@/components/block-view";
import { BLOCK_SLUGS, IMPLEMENTED_SLUGS } from "@/lib/block-slugs";
import { getBlock } from "@/lib/blocks";

type Props = { params: { slug: string } };

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOCK_SLUGS.filter((slug) => !IMPLEMENTED_SLUGS.includes(slug)).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const block = getBlock(params.slug);
  return { title: block ? `${block.labelAZ} — alovOS` : "alovOS" };
}

export default function BlockPage({ params }: Props) {
  const block = getBlock(params.slug);
  if (!block) notFound();
  return <BlockView slug={block.slug} />;
}
