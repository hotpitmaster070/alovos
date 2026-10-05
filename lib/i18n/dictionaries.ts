import type { BlockSlug } from "@/lib/block-slugs";

export type BlockDetails = {
  spec: string;
  killers: readonly string[];
};

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
  moduleStub: string;
  blockNumber: string;
  sidebar: {
    dashboard: string;
    openMenu: string;
    closeMenu: string;
    killer: string;
  };
  blockDetails: Record<BlockSlug, BlockDetails>;
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
  moduleStub: "Modul {name} - spek hazırdır, UI növbəti",
  blockNumber: "Blok",
  sidebar: {
    dashboard: "Panel",
    openMenu: "Menyunu aç",
    closeMenu: "Menyunu bağla",
    killer: "KILLER",
  },
  blockDetails: {
    anbar: {
      spec: "Ehtiyatlar: məhsullar, barkodlar, son istifadə tarixi, inventarizasiya, transferlər.",
      killers: [],
    },
    techizat: {
      spec: "Təchizatçılar, qiymət siyahıları, satınalma sorğuları.",
      killers: [],
    },
    hesablar: {
      spec: "AI skan ilə qaimələr (ai_scan_json).",
      killers: ["3.1 AI skan qaimə 99%"],
    },
    reseptler: {
      spec: "Reseptlər: brutto/netto/itki/çıxım, canlı maya dəyəri, 14 allergen, KBJU.",
      killers: ["4.4 Avtomatik allergenlər 14 + KBJU"],
    },
    tullanti: {
      spec: "Tullantı jurnalı: səbəb, foto, çəki, AI Tani.",
      killers: ["5.2 Foto + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Hazırlıq planlaşdırması və istehsal.",
      killers: [],
    },
    pos: {
      spec: "POS satışlarının sinxronizasiyası.",
      killers: [],
    },
    analitika: {
      spec: "Analitik hesabatlar, menyu mühəndisliyi, avto-məsləhətlər.",
      killers: ["8.4 Ulduzlar/Atlar/İtlər + Avto-məsləhət"],
    },
    komanda: {
      spec: "QR və fotoşəkilli əməkdaşlar.",
      killers: [],
    },
    haccp: {
      spec: "Temperatur jurnalları (əl ilə + IoT Shelly) və yoxlama siyahıları.",
      killers: ["10.1 IoT Shelly + WhatsApp xəbərdarlığı"],
    },
    "ai-skaner": {
      spec: "AI skaner: qaimələr və tullantı vedrəsinin tanınması.",
      killers: ["11.3 AI Tani vedrə Vision API"],
    },
    sebeke: {
      spec: "Şəbəkə və françayzinq idarəetməsi.",
      killers: [],
    },
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
  moduleStub: "Модуль {name} - спек готов, UI далее",
  blockNumber: "Блок",
  sidebar: {
    dashboard: "Панель",
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    killer: "KILLER",
  },
  blockDetails: {
    anbar: {
      spec: "Запасы: продукты, штрихкоды, сроки годности, инвентаризация, перемещения.",
      killers: [],
    },
    techizat: {
      spec: "Поставщики, прайс-листы, заявки на закупку.",
      killers: [],
    },
    hesablar: {
      spec: "Счета с AI-сканированием (ai_scan_json).",
      killers: ["3.1 AI-скан счёта 99%"],
    },
    reseptler: {
      spec: "Рецепты: брутто/нетто/потери/выход, живая себестоимость, 14 аллергенов, КБЖУ.",
      killers: ["4.4 Аллергены авто 14 + КБЖУ"],
    },
    tullanti: {
      spec: "Журнал списаний: причина, фото, вес, AI Tani.",
      killers: ["5.2 Фото + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Планирование заготовок и производство.",
      killers: [],
    },
    pos: {
      spec: "Синхронизация продаж с кассой.",
      killers: [],
    },
    analitika: {
      spec: "Аналитические отчёты, инженерия меню, авто-советы.",
      killers: ["8.4 Звёзды/Лошади/Собаки + Авто-советы"],
    },
    komanda: {
      spec: "Сотрудники с QR и фото.",
      killers: [],
    },
    haccp: {
      spec: "Журналы температур (вручную + IoT Shelly) и чек-листы.",
      killers: ["10.1 IoT Shelly + уведомление в WhatsApp"],
    },
    "ai-skaner": {
      spec: "AI-сканер: счета и распознавание мусорного ведра.",
      killers: ["11.3 AI Tani ведро Vision API"],
    },
    sebeke: {
      spec: "Управление сетью и франшизой.",
      killers: [],
    },
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
  moduleStub: "Module {name} - spec ready, UI next",
  blockNumber: "Block",
  sidebar: {
    dashboard: "Dashboard",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    killer: "KILLER",
  },
  blockDetails: {
    anbar: {
      spec: "Inventory: products, barcodes, expiry, stock counts, transfers.",
      killers: [],
    },
    techizat: {
      spec: "Suppliers, supplier price lists, purchase requests.",
      killers: [],
    },
    hesablar: {
      spec: "Invoices with AI scanning (ai_scan_json).",
      killers: ["3.1 AI scan invoice 99%"],
    },
    reseptler: {
      spec: "Recipes: gross/net/waste/yield, live cost, 14 allergens, KBJU.",
      killers: ["4.4 Allergens auto 14 + KBJU"],
    },
    tullanti: {
      spec: "Wastage log: reason, photo, weight, AI Tani.",
      killers: ["5.2 Photo + AI Tani Vision API"],
    },
    hazirliq: {
      spec: "Prep planning and production.",
      killers: [],
    },
    pos: {
      spec: "POS sales sync.",
      killers: [],
    },
    analitika: {
      spec: "Analytics reports, menu engineering, auto-advice.",
      killers: ["8.4 Stars/Horses/Dogs + Auto-advice"],
    },
    komanda: {
      spec: "Employees with QR and photo.",
      killers: [],
    },
    haccp: {
      spec: "Temperature logs (manual + IoT Shelly) and checklists.",
      killers: ["10.1 IoT Shelly + WhatsApp alert"],
    },
    "ai-skaner": {
      spec: "AI scanner: invoices and waste bucket recognition.",
      killers: ["11.3 AI Tani bucket Vision API"],
    },
    sebeke: {
      spec: "Network and franchise management.",
      killers: [],
    },
  },
};

export const dictionaries = { AZ, RU, EN } satisfies Record<string, Dictionary>;

export type Lang = keyof typeof dictionaries;

export const LANGS = ["AZ", "RU", "EN"] as const satisfies readonly Lang[];

export const DEFAULT_LANG: Lang = "AZ";

export const isLang = (value: unknown): value is Lang =>
  typeof value === "string" && (LANGS as readonly string[]).includes(value);
