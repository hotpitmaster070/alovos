"use client";

import ModuleCard from "@/components/module-card";
import { BLOCKS } from "@/lib/blocks";
import { useT } from "@/lib/i18n/useT";

export default function DashboardView() {
  const { t } = useT();

  return (
    <>
      <h1 className="font-serif text-[32px] font-bold leading-[1.1] tracking-tight">
        {t.sidebar.dashboard}
      </h1>
      <p className="mt-3 text-base text-white/60">{t.hero.subtitle}</p>
      <section
        aria-label={t.modulesLabel}
        className="mt-8 grid grid-cols-3 gap-2 lg:grid-cols-4"
      >
        {BLOCKS.map((block) => (
          <ModuleCard key={block.slug} block={block} />
        ))}
      </section>
    </>
  );
}
