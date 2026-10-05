import Link from "next/link";
import { BLOCKS, blockHref } from "@/lib/blocks";

export const metadata = { title: "Dashboard — alovOS" };

export default function DashboardPage() {
  return (
    <>
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">
        Dashboard
      </h1>
      <p className="mt-3 text-base text-[#888]">12 blok. Bir mətbəx əməliyyat sistemi.</p>
      <section
        aria-label="Modullar"
        className="mt-8 grid grid-cols-3 gap-3 lg:grid-cols-4"
      >
        {BLOCKS.map((block) => {
          const Icon = block.icon;
          return (
            <Link
              key={block.slug}
              href={blockHref(block)}
              className="flex flex-col items-center gap-2.5 rounded-[18px] border border-[#222] bg-[#151515] px-2 py-5 transition-colors hover:border-[#D9C5A5]"
            >
              <Icon size={28} strokeWidth={1.5} color="#D9C5A5" aria-hidden="true" />
              <span className="whitespace-nowrap text-center text-[10px] font-medium uppercase tracking-widest">
                {block.label}
              </span>
            </Link>
          );
        })}
      </section>
    </>
  );
}
