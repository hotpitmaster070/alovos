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

The landing page runs without Supabase env vars; `/login`, `/app/*` and the middleware require `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Database

Run the migrations in `supabase/migrations/` in order in the Supabase SQL Editor (all are idempotent):

1. `20261006120000_multitenant_rls.sql` - organizations, profiles, org-scoped data tables, per-operation RLS, hardened signup trigger.
2. `20261006120001_storage.sql` - private `invoices` bucket; objects must live under `<organization_id>/`.
3. `20261006120002_ensure_org_rpc.sql` - `ensure_my_organization()` recovery RPC.
4. `20261006120003_move_stock.sql` - atomic `move_stock()` RPC and the indexes the ANBAR page needs.
5. `20261006120004_anbar_catalog.sql` - tenants, branches, `tenant_id` on anbar tables, `quantity`, stock ledger trigger, RLS.

The old draft schema is kept only as `supabase/_legacy/schema.sql.bak` and is not used.

## ANBAR (warehouse)

`/app/anbar`: server-rendered, org-scoped inventory with barcode search (keyboard scanners and, where supported, camera), filters (location, expired, low stock, expiry), pagination (50 per page), expiry badges, add product/location and stock moves through the `move_stock` RPC. The organization id is resolved on the server from the verified session and is never taken from the URL, props or storage.

Auth: `middleware.ts` and server components use `@supabase/ssr` (`createServerClient`) and the request cookies. A visit to `/app/anbar` without a session is redirected to `/login?next=...`. The browser client still stores the session in that same cookie layout.

## Checks

```bash
npm run lint && npx tsc --noEmit
npm test                      # pure logic + org-scope + actions with a fake client
npm run check:org-scope       # every products/locations query carries organization_id
PGLITE_DIR=<dir with @electric-sql/pglite> node supabase/tests/move_stock.test.mjs
```

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

The 12 module pages are placeholders ("spec implemented, UI next"). Routing, navigation, the multitenant migration and the Supabase auth client are in place.
