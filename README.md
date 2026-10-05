# alovOS

Landing page and SaaS skeleton for **alovOS** — "Mətbəx üçün OS" (an operating system for kitchens): stock, orders and waste in one place.

Next.js 14 (App Router), TypeScript, Tailwind CSS, Inter (`next/font`), `lucide-react`, Supabase. Flat, minimal, dark; mobile-first.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: Supabase URL + anon key
npm run dev -- -p 4317       # http://localhost:4317
```

Production build: `npm run build && npm start -- -p 4317`. Lint: `npm run lint`.

The app builds and runs without Supabase env vars (`lib/supabase.ts` returns `null` when they are missing). Apply `supabase/schema.sql` to a Supabase project to create the database (tables, enums, indexes, triggers, RLS).

## The 12 BLOCKS FINAL

Single source of truth: `lib/blocks.ts` (landing page and app sidebar). Each block lives at `/app/<slug>`; `/app/dashboard` is the app home.

| # | Block | Slug | Scope |
|---|-------|------|-------|
| 1 | ANBAR | `anbar` | Inventory: products (barcode, expiry), stock counts, transfers |
| 2 | TƏCHIZAT | `techizat` | Suppliers, supplier prices, purchase requests |
| 3 | HESABLAR (KILLER) | `hesablar` | Invoices, **3.1 AI scan** |
| 4 | RESEPTLƏR | `reseptler` | Recipes: gross/net/waste/yield, live cost, **4.4 Allergens auto** |
| 5 | TULLANTI (KILLER) | `tullanti` | Wastage log, **5.2 Photo + AI Tani Vision API** |
| 6 | HAZIRLIQ | `hazirliq` | Preps / production planning |
| 7 | POS | `pos` | POS sales sync |
| 8 | ANALITIKA (KILLER) | `analitika` | Analytics, **8.4 Stars/Horses/Dogs + Auto-advice** |
| 9 | KOMANDA | `komanda` | Employees (QR, photo) |
| 10 | HACCP (KILLER) | `haccp` | Temperatures and checklists, **10.1 IoT Shelly + WhatsApp alert** |
| 11 | AI SKANER (KILLER) | `ai-skaner` | AI scanner (11.3 AI Tani bucket Vision API) |
| 12 | ŞƏBƏKƏ | `sebeke` | Network / franchise |

## The 5 KILLERS

1. **3.1 AI scan** — invoice scanning, 99% target accuracy (`invoices.ai_scan_json`)
2. **5.2 Photo + AI Tani Vision API** — waste bucket recognition (`wastage.photo_url`, `wastage.ai_tani`; also 11.3)
3. **4.4 Allergens auto** — all 14 allergens derived from ingredients, plus KBJU (kcal/protein/fat/carbs)
4. **8.4 Stars/Horses/Dogs + Auto-advice** — menu engineering with advice such as "Remove dog - lose $500" (also 8.5 AI: 1g coffee = $200 loss)
5. **10.1 IoT Shelly + WhatsApp alert** — fridge temperature from Shelly sensors with WhatsApp alerts (with Bazar Benchmark 2.4: average price in Baku)

## Status

The 12 module pages are placeholders ("spec implemented, UI next"). The schema, routing, navigation and Supabase client are in place.
