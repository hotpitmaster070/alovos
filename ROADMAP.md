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

Список филиалов — таблица `branches`. Имена филиалов живут в данных, не в коде страницы.

## Сейчас

`/app/anbar` без cookie сессии больше не уходит на `/login`. Страница склада и `/app/anbar/kataloq` открываются без входа, чтобы их можно было смотреть в браузере. Запись по-прежнему требует сессию и организацию.

Ключи приложения: `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` в `.env.local`. `NEXT_PUBLIC_SUPABASE_ANON_KEY` лежит рядом.

Миграция каталога: `supabase/migrations/20261006120004_anbar_catalog.sql`. Её нужно прогнать в SQL Editor после предыдущих миграций, иначе колонки `branch` и `quantity` на живой базе ещё нет.
