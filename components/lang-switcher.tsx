"use client";

import { LANGS } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/useT";

const active = "border-b border-white/90 pb-1 text-white/90";
const inactive = "border-b border-transparent pb-1 text-white/30 hover:text-white/60";

export default function LangSwitcher() {
  const { t, lang, setLang } = useT();

  return (
    <div
      className="flex gap-4 text-[11px] font-light uppercase tracking-[0.2em]"
      role="group"
      aria-label={t.languageLabel}
    >
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`transition-colors ${
            lang === code ? active : inactive
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
