-- Block 1.1 catalog. Run after 20261006120000_multitenant_rls.sql.
-- products already stores name, barcode, expiry_date and quantity (column qty, used by move_stock).
-- This adds the filial column and the branches list (Nizami, 28 May, and later sites).
-- Safe to re-run.

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  created_at timestamptz default now(),
  unique (organization_id, name)
);

alter table public.products add column if not exists branch text;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'quantity'
  ) then
    alter table public.products
      add column quantity double precision generated always as (qty) stored;
  end if;
end;
$$;

create index if not exists idx_branches_organization_id on public.branches(organization_id);
create index if not exists idx_products_branch on public.products(organization_id, branch);

alter table public.branches enable row level security;

revoke all on public.branches from anon;
revoke truncate, references, trigger on public.branches from authenticated;

drop policy if exists branches_select on public.branches;
drop policy if exists branches_insert on public.branches;
drop policy if exists branches_update on public.branches;
drop policy if exists branches_delete on public.branches;

create policy branches_select on public.branches
  for select to authenticated
  using (organization_id = (select public.current_org_id()));

create policy branches_insert on public.branches
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()));

create policy branches_update on public.branches
  for update to authenticated
  using (organization_id = (select public.current_org_id()))
  with check (organization_id = (select public.current_org_id()));

create policy branches_delete on public.branches
  for delete to authenticated
  using (organization_id = (select public.current_org_id()));
