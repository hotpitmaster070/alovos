import type { BlockSlug } from "@/lib/block-slugs";
import type { Lang } from "@/lib/i18n/dictionaries";
import {
  BookOpen,
  Calculator,
  ChefHat,
  Network,
  Package,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Block = {
  id: number;
  slug: BlockSlug;
  labelAZ: string;
  labelRU: string;
  labelEN: string;
  icon: LucideIcon;
  killer: boolean;
};

// KILLER 1: 3.1 AI scan invoice 99%
// KILLER 2: 5.2 + 11.3 AI Tani bucket Vision API
// KILLER 3: 4.4 Allergens auto 14 + KBJU
// KILLER 4: 8.4 Stars/Horses/Dogs + "Remove dog - lose $500" + 8.5 AI 1g coffee = $200 loss
// KILLER 5: 10.1 IoT temp Shelly + WhatsApp alert + Bazar Benchmark 2.4 average price Baku

export const BLOCKS: Block[] = [
  {
    id: 1,
    slug: "anbar",
    labelAZ: "ANBAR",
    labelRU: "СКЛАД",
    labelEN: "STOCK",
    icon: Package,
    killer: false,
  },
  {
    id: 2,
    slug: "techizat",
    labelAZ: "TƏCHIZAT",
    labelRU: "ПОСТАВКИ",
    labelEN: "SUPPLY",
    icon: Truck,
    killer: false,
  },
  {
    id: 3,
    slug: "hesablar",
    labelAZ: "HESABLAR",
    labelRU: "СЧЕТА",
    labelEN: "INVOICES",
    icon: ReceiptText,
    killer: true,
    // KILLER 1: 3.1 AI scan invoice 99%
  },
  {
    id: 4,
    slug: "reseptler",
    labelAZ: "RESEPTLƏR",
    labelRU: "РЕЦЕПТЫ",
    labelEN: "RECIPES",
    icon: BookOpen,
    killer: false,
    // KILLER 3: 4.4 Allergens auto 14 + KBJU
  },
  {
    id: 5,
    slug: "tullanti",
    labelAZ: "TULLANTI",
    labelRU: "СПИСАНИЕ",
    labelEN: "WASTE",
    icon: Trash2,
    killer: true,
    // KILLER 2: 5.2 + 11.3 AI Tani bucket Vision API
  },
  {
    id: 6,
    slug: "hazirliq",
    labelAZ: "HAZIRLIQ",
    labelRU: "ЗАГОТОВКИ",
    labelEN: "PREP",
    icon: ChefHat,
    killer: false,
  },
  {
    id: 7,
    slug: "pos",
    labelAZ: "POS",
    labelRU: "Касса",
    labelEN: "POS",
    icon: Calculator,
    killer: false,
  },
  {
    id: 8,
    slug: "analitika",
    labelAZ: "ANALITIKA",
    labelRU: "АНАЛИТИКА",
    labelEN: "ANALYTICS",
    icon: TrendingUp,
    killer: true,
    // KILLER 4: 8.4 Stars/Horses/Dogs + "Remove dog - lose $500" + 8.5 AI 1g coffee = $200 loss
  },
  {
    id: 9,
    slug: "komanda",
    labelAZ: "KOMANDA",
    labelRU: "КОМАНДА",
    labelEN: "TEAM",
    icon: Users,
    killer: false,
  },
  {
    id: 10,
    slug: "haccp",
    labelAZ: "HACCP",
    labelRU: "ХАССП",
    labelEN: "HACCP",
    icon: ShieldCheck,
    killer: true,
    // KILLER 5: 10.1 IoT temp Shelly + WhatsApp alert + Bazar Benchmark 2.4 average price Baku
  },
  {
    id: 11,
    slug: "ai-skaner",
    labelAZ: "AI SKANER",
    labelRU: "AI СКАНЕР",
    labelEN: "AI SCANNER",
    icon: ScanLine,
    killer: true,
  },
  {
    id: 12,
    slug: "sebeke",
    labelAZ: "ŞƏBƏKƏ",
    labelRU: "СЕТЬ",
    labelEN: "NETWORK",
    icon: Network,
    killer: false,
  },
];

const LABEL_KEYS = {
  AZ: "labelAZ",
  RU: "labelRU",
  EN: "labelEN",
} as const satisfies Record<Lang, keyof Block>;

export const getBlockLabel = (block: Block, lang: Lang): string =>
  block[LABEL_KEYS[lang]];

export const getBlock = (slug: string) => BLOCKS.find((b) => b.slug === slug);
export const blockHref = (b: Block) => `/app/${b.slug}`;
