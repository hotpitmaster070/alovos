-- FIX branches.sql
-- Run this first in the Supabase SQL Editor when public.branches is missing.
-- Requires public.tenants. Safe to run twice. Inserts no branch names.

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null,
  address text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.branches
  add column if not exists address text;

alter table public.branches
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.branches
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_tenant_id_name_key'
      and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches
      add constraint branches_tenant_id_name_key unique (tenant_id, name);
  end if;
end;
$$;

create index if not exists idx_branches_tenant_id on public.branches(tenant_id);
