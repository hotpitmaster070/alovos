"use client";

import { useEffect, useState } from "react";

const LANGS = ["AZ", "RU", "EN"] as const;
type Lang = (typeof LANGS)[number];

const STORAGE_KEY = "alovos-lang";

export default function LangSwitcher() {
  const [lang, setLang] = useState<Lang>("AZ");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) {
      setLang(saved as Lang);
    }
  }, []);

  const select = (next: Lang) => {
    setLang(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-[#222] p-1"
      role="group"
      aria-label="Dil"
    >
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => select(code)}
          aria-pressed={lang === code}
          className={
            lang === code
              ? "rounded-full bg-[#E8DCC6] px-3 py-1 text-xs font-medium text-black"
              : "rounded-full px-3 py-1 text-xs font-medium text-white/50 transition-colors hover:text-white"
          }
        >
          {code}
        </button>
      ))}
    </div>
  );
}
