// The whole migration chain on a fresh database and on databases whose base tables predate it
// without organization_id, qty or tenant_id (create table if not exists keeps their old shape).
// Every file is applied twice in a row: each one must be re-runnable.
// Usage: PGLITE_DIR=/path/to/node_modules node supabase/tests/legacy_chain.test.mjs
import { freshDb, migrationFiles, readMigration, reporter } from "./pglite.mjs";

const { ok, done } = reporter();
const USER = "00000000-0000-0000-0000-000000000099";
const ORG = "00000000-0000-0000-0000-0000000000b1";
const FRIDGE = "00000000-0000-0000-0000-0000000000a1";

/** fresh | legacy (no organization_id, qty) | noqty (organization_id, no qty) | noorg (qty, no organization_id) */
async function seed(db, variant) {
  if (variant === "fresh") return;
  const org = variant === "noqty";
  const qty = variant === "noorg";
  const orgCol = org ? ", organization_id uuid references public.organizations(id)" : "";
  if (org) {
    await db.exec(`create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
      insert into public.organizations(id, name) values ('${ORG}', 'Old org');`);
  }
  await db.exec(`
    create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text default 'owner', email text${orgCol});
    create table public.locations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now()${orgCol});
    create table public.products (id uuid primary key default gen_random_uuid(), name text not null, barcode text, expiry_date date,
      location_id uuid references public.locations(id), cost numeric, unit text default 'kg', created_at timestamptz default now()${orgCol}${qty ? ", qty float default 0" : ""});
    create table public.suppliers (id uuid primary key default gen_random_uuid(), name text not null, contact text${orgCol});
    create table public.invoices (id uuid primary key default gen_random_uuid(), supplier_id uuid references public.suppliers(id),
      parsed_json jsonb, total numeric, created_at timestamptz default now()${orgCol});
    insert into auth.users(id, email) values ('${USER}', 'old@x.az');
    insert into public.profiles(id, email${org ? ", organization_id" : ""}) values ('${USER}', 'old@x.az'${org ? `, '${ORG}'` : ""});
    insert into public.locations(id, name${org ? ", organization_id" : ""}) values ('${FRIDGE}', 'Old fridge'${org ? `, '${ORG}'` : ""});
    insert into public.products(name, barcode, location_id${org ? ", organization_id" : ""}${qty ? ", qty" : ""})
      values ('Old milk', '4760001', '${FRIDGE}'${org ? `, '${ORG}'` : ""}${qty ? ", 3" : ""});`);
}

for (const variant of ["fresh", "legacy", "noqty", "noorg"]) {
  const { db, q } = await freshDb();
  await seed(db, variant);
  let failure = null;
  for (const file of migrationFiles) {
    try {
      const sql = readMigration(file);
      await db.exec(sql);
      await db.exec(sql);
    } catch (e) {
      await db.exec("rollback").catch(() => {});
      failure = `${file}: ${e.message}`;
      break;
    }
  }
  ok(`${variant}: every migration applies, twice`, failure === null, failure);
  if (failure) continue;

  const orgColumns = (await q(`select count(*)::int n from information_schema.columns where table_schema = 'public' and column_name = 'organization_id'`))[0].n;
  ok(`${variant}: organization_id is gone everywhere`, orgColumns === 0, orgColumns);
  if (variant === "fresh") continue;

  const profile = (await q(`select p.tenant_id, m.role from public.profiles p join public.memberships m on m.user_id = p.id where p.id = '${USER}'`))[0];
  ok(`${variant}: the old user has a tenant and an owner membership`, profile?.tenant_id && profile.role === "owner", profile);
  const product = (await q(`select tenant_id from public.products where name = 'Old milk'`))[0];
  ok(
    `${variant}: the old product is kept` + (variant === "noqty" ? " with its tenant" : " (no owner to take a tenant from)"),
    product !== undefined && (variant === "noqty" ? product.tenant_id !== null : product.tenant_id === null),
    product,
  );
}

done();
