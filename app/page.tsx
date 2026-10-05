import Link from "next/link";
import LangSwitcher from "@/components/lang-switcher";
import { BLOCKS, blockHref } from "@/lib/blocks";

function Logo() {
  return (
    <div
      className="text-[22px] font-bold leading-none tracking-tighter text-white"
      aria-label="alovOS"
    >
      al
      <svg
        aria-hidden="true"
        viewBox="4 1 9 13"
        fill="#FF4D00"
        style={{
          display: "inline-block",
          height: "0.85em",
          width: "0.59em",
          margin: "0 1px",
          verticalAlign: "baseline",
        }}
      >
        <path d="M12 2C8 6 6 9 8 13C5 12 3 8 12 2Z" />
      </svg>
      vOS
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] px-4">
      <header className="mx-auto flex max-w-[390px] items-center justify-between py-4">
        <Logo />
        <LangSwitcher />
      </header>

      <section className="mx-auto mt-12 max-w-[390px] text-center">
        <h1 className="font-serif text-[32px] font-bold leading-[1.15] tracking-tight text-white">
          Mətbəx üçün əməliyyat sistemi
        </h1>
        <p className="mt-3 text-base text-white/60">
          12 blok. Bir mətbəx əməliyyat sistemi.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="#"
            className="rounded-full bg-[#D9C5A5] px-8 py-3 text-sm font-medium text-black"
          >
            Pulsuz Başla
          </a>
          <Link
            href="/app/dashboard"
            className="rounded-full border border-[#D9C5A5] px-8 py-3 text-sm text-[#D9C5A5]"
          >
            Panelə bax
          </Link>
        </div>
      </section>

      <section
        aria-label="Modullar"
        className="mx-auto mt-10 grid max-w-[390px] grid-cols-3 gap-3"
      >
        {BLOCKS.map((block) => {
          const Icon = block.icon;
          return (
            <Link
              key={block.slug}
              href={blockHref(block)}
              className="flex cursor-pointer flex-col items-center gap-2.5 rounded-[18px] border border-[#222] bg-[#151515] px-2 py-5 transition-colors hover:border-[#D9C5A5]"
            >
              <Icon size={28} strokeWidth={1.5} color="#D9C5A5" aria-hidden="true" />
              <span className="whitespace-nowrap text-center text-[10px] font-medium uppercase tracking-widest text-white">
                {block.label}
              </span>
            </Link>
          );
        })}
      </section>

      <div className="mx-auto mb-20 mt-12 max-w-[390px] text-center">
        <p className="text-3xl font-bold text-white">79 AZN / ay</p>
        <p className="mt-2 text-sm text-white">
          Hər şey daxil. 14 gün pulsuz sınaq.
        </p>
        <Link
          href="/app/dashboard"
          className="mt-4 inline-block rounded-full border border-[#333] bg-black px-6 py-3 text-white"
        >
          Başla - pulsuz
        </Link>
        <p className="mt-3 text-[11px] text-[#666]">
          Built for modern kitchens · Baku, AZ.
        </p>
      </div>
    </main>
  );
}
