import Link from "next/link";
import { BLOCKS, blockHref } from "@/lib/blocks";

const languages = ["AZ", "RU", "EN"];

function Logo() {
  return (
    <div
      className="text-[26px] font-medium leading-none tracking-tight text-[#D9C5A5]"
      aria-label="alovOS"
    >
      al
      <svg
        aria-hidden="true"
        style={{
          display: "inline-block",
          height: "0.85em",
          width: "0.6em",
          margin: "0 1px",
          verticalAlign: "baseline",
        }}
        viewBox="0 0 24 34"
        fill="none"
        stroke="#D9C5A5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 C 8 12, 4 16, 4 23 C 4 28, 7.6 32, 12 32 C 16.4 32, 20 28, 20 23 C 20 16, 16 12, 12 2Z" />
      </svg>
      vOS
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] px-4 pt-6">
      <header className="mx-auto flex max-w-[390px] items-center justify-between">
        <Logo />
        <div
          className="flex items-center gap-1 rounded-full border border-[#222] p-1"
          role="group"
          aria-label="Dil"
        >
          {languages.map((lang, i) => (
            <button
              key={lang}
              type="button"
              aria-pressed={i === 0}
              className={
                i === 0
                  ? "rounded-full bg-[#D9C5A5] px-3 py-1 text-xs font-medium text-black"
                  : "rounded-full px-3 py-1 text-xs font-medium text-[#888] transition-colors hover:text-white"
              }
            >
              {lang}
            </button>
          ))}
        </div>
      </header>

      <section className="mx-auto mt-12 max-w-[390px] text-center">
        <h1 className="font-serif text-[44px] font-bold leading-[1.1] tracking-tight text-white">
          Mətbəx üçün OS
        </h1>
        <p className="mt-3 text-base text-[#888]">
          Stok. Sifariş. Tullantı — bir yerdə.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="#"
            className="rounded-full bg-[#D9C5A5] px-8 py-3 text-sm font-medium text-black"
          >
            Pulsuz Başla
          </a>
          <a
            href="#"
            className="rounded-full border border-[#D9C5A5] px-8 py-3 text-sm text-[#D9C5A5]"
          >
            Panelə bax
          </a>
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

      <footer className="mb-20 mt-12 text-center text-[18px] font-semibold text-white">
        Hər şey daxil — 79 AZN/ay
      </footer>
    </main>
  );
}
