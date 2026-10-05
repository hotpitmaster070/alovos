"use client";

import { LANGS } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/useT";

const active = "bg-[#E8DCC6] text-black";
const inactive = "text-white/50 hover:text-white";

export default function LangSwitcher() {
  const { t, lang, setLang } = useT();

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-line p-1"
      role="group"
      aria-label={t.languageLabel}
    >
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            lang === code ? active : inactive
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
