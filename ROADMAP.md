# alovOS — роадмэп

## Блок 1. ANBAR

```text
app/
  anbar/
    page.tsx      главный склад, стоимость в манатах live
    kataloq/      каталог: баркод и срок годности
    sayim/        слепой подсчёт
    kecirme/      Nizami -> 28 May
  api/
    anbar/

supabase/
  tables: products, stock, stock_movements, branches (Nizami, 28 May)
```

Каталог (`products`): `name`, `barcode`, `expiry_date`, `quantity` (колонка `qty`), `branch`.

Список филиалов — таблица `branches` с `tenant_id`. Имена филиалов живут в данных, не в коде страницы.

## Сейчас

`/app/anbar` и `/app/anbar/kataloq` без cookie сессии отвечают 307 на `/login`. Каталог — серверный компонент: сессия берётся из cookies через `@supabase/ssr`.

Ключи приложения: `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` в `.env.local`. Файл не коммитится.

Миграция: `supabase/migrations/20261006120004_anbar_catalog.sql`. В ней `tenants`, `branches`, `tenant_id` на products/stock/stock_movements, колонка `quantity numeric` и `stock_ledger` с триггером. RLS: `auth.uid()` → `profiles.tenant_id` → `current_tenant_id()`. Локальный seed одного dev-тенанта — `supabase/seed.sql`, его не применяет hosted-проект.
