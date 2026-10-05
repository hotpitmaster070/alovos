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
  slug: string;
  labelAZ: string;
  labelRU?: string;
  labelEN?: string;
  icon: LucideIcon;
  spec: string;
  killer: boolean;
  killers: string[];
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
    spec: "Inventory: products, barcodes, expiry, stock counts, transfers.",
    killer: false,
    killers: [],
  },
  {
    id: 2,
    slug: "techizat",
    labelAZ: "TƏCHIZAT",
    labelRU: "ПОСТАВКИ",
    labelEN: "SUPPLY",
    icon: Truck,
    spec: "Suppliers, supplier price lists, purchase requests.",
    killer: false,
    killers: [],
  },
  {
    id: 3,
    slug: "hesablar",
    labelAZ: "HESABLAR",
    labelRU: "СЧЕТА",
    labelEN: "INVOICES",
    icon: ReceiptText,
    spec: "Invoices with AI scanning (ai_scan_json).",
    killer: true,
    // KILLER 1: 3.1 AI scan invoice 99%
    killers: ["3.1 AI scan invoice 99%"],
  },
  {
    id: 4,
    slug: "reseptler",
    labelAZ: "RESEPTLƏR",
    labelRU: "РЕЦЕПТЫ",
    labelEN: "RECIPES",
    icon: BookOpen,
    spec: "Recipes: gross/net/waste/yield, live cost, 14 allergens, KBJU.",
    killer: false,
    // KILLER 3: 4.4 Allergens auto 14 + KBJU
    killers: ["4.4 Allergens auto 14 + KBJU"],
  },
  {
    id: 5,
    slug: "tullanti",
    labelAZ: "TULLANTI",
    labelRU: "СПИСАНИЕ",
    labelEN: "WASTE",
    icon: Trash2,
    spec: "Wastage log: reason, photo, weight, AI Tani.",
    killer: true,
    // KILLER 2: 5.2 + 11.3 AI Tani bucket Vision API
    killers: ["5.2 Photo + AI Tani Vision API"],
  },
  {
    id: 6,
    slug: "hazirliq",
    labelAZ: "HAZIRLIQ",
    labelRU: "ЗАГОТОВКИ",
    labelEN: "PREP",
    icon: ChefHat,
    spec: "Prep planning and production.",
    killer: false,
    killers: [],
  },
  {
    id: 7,
    slug: "pos",
    labelAZ: "POS",
    icon: Calculator,
    spec: "POS sales sync.",
    killer: false,
    killers: [],
  },
  {
    id: 8,
    slug: "analitika",
    labelAZ: "ANALITIKA",
    labelRU: "АНАЛИТИКА",
    labelEN: "ANALYTICS",
    icon: TrendingUp,
    spec: "Analytics reports, menu engineering, auto-advice.",
    killer: true,
    // KILLER 4: 8.4 Stars/Horses/Dogs + "Remove dog - lose $500" + 8.5 AI 1g coffee = $200 loss
    killers: ["8.4 Stars/Horses/Dogs + Auto-advice"],
  },
  {
    id: 9,
    slug: "komanda",
    labelAZ: "KOMANDA",
    labelRU: "КОМАНДА",
    labelEN: "TEAM",
    icon: Users,
    spec: "Employees with QR and photo.",
    killer: false,
    killers: [],
  },
  {
    id: 10,
    slug: "haccp",
    labelAZ: "HACCP",
    icon: ShieldCheck,
    spec: "Temperature logs (manual + IoT Shelly) and checklists.",
    killer: true,
    // KILLER 5: 10.1 IoT temp Shelly + WhatsApp alert + Bazar Benchmark 2.4 average price Baku
    killers: ["10.1 IoT Shelly + WhatsApp alert"],
  },
  {
    id: 11,
    slug: "ai-skaner",
    labelAZ: "AI SKANER",
    labelRU: "AI СКАНЕР",
    labelEN: "AI SCANNER",
    icon: ScanLine,
    spec: "AI scanner: invoices and waste bucket recognition.",
    killer: true,
    killers: ["11.3 AI Tani bucket Vision API"],
  },
  {
    id: 12,
    slug: "sebeke",
    labelAZ: "ŞƏBƏKƏ",
    labelRU: "СЕТЬ",
    labelEN: "NETWORK",
    icon: Network,
    spec: "Network and franchise management.",
    killer: false,
    killers: [],
  },
];

const LABEL_KEYS = {
  AZ: "labelAZ",
  RU: "labelRU",
  EN: "labelEN",
} as const satisfies Record<Lang, keyof Block>;

export const getBlockLabel = (block: Block, lang: Lang): string =>
  block[LABEL_KEYS[lang]] ?? block.labelAZ;

export const getBlock = (slug: string) => BLOCKS.find((b) => b.slug === slug);
export const blockHref = (b: Block) => `/app/${b.slug}`;
