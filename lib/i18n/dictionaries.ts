export type Dictionary = {
  languageLabel: string;
  hero: {
    title: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  modulesLabel: string;
  price: {
    amount: number;
    currency: string;
    period: string;
    included: string;
    trialDays: number;
    trial: (days: number) => string;
    cta: string;
  };
  footer: {
    tagline: string;
  };
  app: {
    dashboard: string;
    openMenu: string;
    closeMenu: string;
    killer: string;
  };
};

const AZ: Dictionary = {
  languageLabel: "Dil",
  hero: {
    title: "Mətbəx üçün əməliyyat sistemi",
    subtitle: "12 blok. Bir mətbəx əməliyyat sistemi.",
    ctaPrimary: "Pulsuz Başla",
    ctaSecondary: "Panelə bax",
  },
  modulesLabel: "Modullar",
  price: {
    amount: 79,
    currency: "AZN",
    period: "ay",
    included: "Hər şey daxil.",
    trialDays: 14,
    trial: (days) => `${days} gün pulsuz sınaq.`,
    cta: "Başla - pulsuz",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  app: {
    dashboard: "Panel",
    openMenu: "Menyunu aç",
    closeMenu: "Menyunu bağla",
    killer: "KILLER",
  },
};

const RU: Dictionary = {
  languageLabel: "Язык",
  hero: {
    title: "Операционная система для кухни",
    subtitle: "12 блоков. Одна операционная система для кухни.",
    ctaPrimary: "Начать бесплатно",
    ctaSecondary: "Смотреть панель",
  },
  modulesLabel: "Модули",
  price: {
    amount: 79,
    currency: "AZN",
    period: "мес",
    included: "Всё включено.",
    trialDays: 14,
    trial: (days) => `${days} дней бесплатного пробного периода.`,
    cta: "Начать - бесплатно",
  },
  footer: {
    tagline: "Создано для современных кухонь · Баку, AZ.",
  },
  app: {
    dashboard: "Панель",
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    killer: "KILLER",
  },
};

const EN: Dictionary = {
  languageLabel: "Language",
  hero: {
    title: "The operating system for kitchens",
    subtitle: "12 blocks. One kitchen operating system.",
    ctaPrimary: "Start free",
    ctaSecondary: "View dashboard",
  },
  modulesLabel: "Modules",
  price: {
    amount: 79,
    currency: "AZN",
    period: "mo",
    included: "Everything included.",
    trialDays: 14,
    trial: (days) => `${days}-day free trial.`,
    cta: "Start - free",
  },
  footer: {
    tagline: "Built for modern kitchens · Baku, AZ.",
  },
  app: {
    dashboard: "Dashboard",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    killer: "KILLER",
  },
};

export const dictionaries = { AZ, RU, EN } satisfies Record<string, Dictionary>;

export type Lang = keyof typeof dictionaries;

export const LANGS = ["AZ", "RU", "EN"] as const satisfies readonly Lang[];

export const DEFAULT_LANG: Lang = "AZ";

export const isLang = (value: unknown): value is Lang =>
  typeof value === "string" && (LANGS as readonly string[]).includes(value);
