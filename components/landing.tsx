"use client";

import Link from "next/link";
import LangSwitcher from "@/components/lang-switcher";
import Logo from "@/components/logo";
import ModuleCard from "@/components/module-card";
import { BLOCKS } from "@/lib/blocks";
import { useT } from "@/lib/i18n/useT";
import { planPrice } from "@/components/waste/photo-ai";
import type { BillingPlan } from "@/lib/waste/plan";

const CONTAINER = "mx-auto max-w-[390px] px-4";

/** Public landing; the price comes from billing_plans (null: not loaded, the price block is hidden). */
export default function Landing({ plan }: { plan: BillingPlan | null }) {
  const { t } = useT();
  const { hero, price, footer } = t;

  return (
    <>
      <header className={`${CONTAINER} flex items-center justify-between py-4`}>
        <Logo />
        <LangSwitcher />
      </header>

      <main className="pb-20">
        <section className={`${CONTAINER} mt-12 text-center`}>
          <h1 className="font-serif text-[32px] font-bold leading-[1.15] tracking-tight text-white">
            {hero.title}
          </h1>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/app/dashboard"
              className="rounded-full bg-beige px-8 py-3 text-sm font-medium text-black"
            >
              {hero.ctaPrimary}
            </Link>
            <Link
              href="/app/dashboard"
              className="rounded-full border border-beige px-8 py-3 text-sm text-beige"
            >
              {hero.ctaSecondary}
            </Link>
          </div>
        </section>

        <section
          aria-label={t.modulesLabel}
          className={`${CONTAINER} mt-10 grid grid-cols-3 gap-2`}
        >
          {BLOCKS.map((block) => (
            <ModuleCard key={block.slug} block={block} />
          ))}
        </section>

        <section className={`${CONTAINER} mt-12 text-center`}>
          {plan ? (
            <>
              <p className="text-3xl font-bold text-white">
                {planPrice(plan, t.labels.locale)} / {price.period}
              </p>
              <p className="mt-2 text-sm text-white">
                {price.included} {plan.trialDays > 0 ? price.trial(plan.trialDays) : ""}
              </p>
            </>
          ) : null}
          <Link
            href="/app/dashboard"
            className="mt-4 inline-block rounded-full border border-edge bg-black px-6 py-3 text-white"
          >
            {price.cta}
          </Link>
          <p className="mt-3 text-[11px] text-muted">{footer.tagline}</p>
        </section>
      </main>
    </>
  );
}
