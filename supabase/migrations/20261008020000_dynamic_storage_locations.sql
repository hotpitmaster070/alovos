-- Dynamic storage locations: every location belongs to a branch, has one of four types and can be
-- deactivated instead of deleted (stock, movements, counts and logs reference it).
-- Legacy rows created by 20261007120000 with transliterated codes are renamed to Azerbaijani names.
-- New branches get Quru anbar, Soyuducu and Dondurucu. Idempotent. Run after 20261008010000.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.storage_locations
  add column if not exists is_active boolean not null default true;

alter table public.products
  add column if not exists storage_location_id uuid references public.storage_locations(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Every location gets a branch. Tenants with branchless locations and no branch get one first.
-- Triggers are skipped for that insert so the branch receives the legacy rows, not new defaults.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;

insert into public.branches (tenant_id, name)
select distinct sl.tenant_id, 'Əsas filial'
from public.storage_locations sl
where sl.branch_id is null
  and not exists (select 1 from public.branches b where b.tenant_id = sl.tenant_id)
on conflict (tenant_id, name) do nothing;

set local session_replication_role = origin;

update public.storage_locations sl
set branch_id = (
  select b.id from public.branches b
  where b.tenant_id = sl.tenant_id
  order by b.created_at, b.id
  limit 1
)
where sl.branch_id is null;

-- ---------------------------------------------------------------------------
-- 3. Types and names
-- ---------------------------------------------------------------------------
alter table public.storage_locations drop constraint if exists storage_locations_type_check;

update public.storage_locations
set type = case lower(trim(type))
  when 'sklad' then 'quru'
  when 'quru' then 'quru'
  when 'holodilnik' then 'soyuducu'
  when 'soyuducu' then 'soyuducu'
  when 'morozilka' then 'dondurucu'
  when 'morozilnik' then 'dondurucu'
  when 'dondurucu' then 'dondurucu'
  else 'custom'
end
where type not in ('quru', 'soyuducu', 'dondurucu', 'custom');

update public.storage_locations
set name = case lower(trim(name))
  when 'sklad' then 'Quru anbar'
  when 'holodilnik' then 'Soyuducu'
  when 'morozilka' then 'Dondurucu'
  when 'morozilnik' then 'Dondurucu'
end
where lower(trim(name)) in ('sklad', 'holodilnik', 'morozilka', 'morozilnik');

update public.storage_locations set name = trim(name) where name <> trim(name);

-- Duplicate names inside one branch get a numeric suffix so the unique key can be added.
with ranked as (
  select id, row_number() over (partition by branch_id, name order by created_at, id) as position
  from public.storage_locations
)
update public.storage_locations sl
set name = sl.name || ' (' || ranked.position || ')'
from ranked
where ranked.id = sl.id and ranked.position > 1;

alter table public.storage_locations alter column type set default 'custom';
alter table public.storage_locations
  add constraint storage_locations_type_check check (type in ('quru', 'soyuducu', 'dondurucu', 'custom'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'storage_locations_name_check') then
    alter table public.storage_locations
      add constraint storage_locations_name_check check (char_length(trim(name)) between 1 and 80);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Branch is required, cascades with the branch, names are unique per branch
-- ---------------------------------------------------------------------------
alter table public.storage_locations alter column branch_id set not null;

alter table public.storage_locations drop constraint if exists storage_locations_branch_id_fkey;
alter table public.storage_locations
  add constraint storage_locations_branch_id_fkey
  foreign key (branch_id) references public.branches(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'storage_locations_branch_id_name_key') then
    alter table public.storage_locations
      add constraint storage_locations_branch_id_name_key unique (branch_id, name);
  end if;
end;
$$;

create index if not exists idx_storage_locations_branch_active
  on public.storage_locations (branch_id, is_active);

-- ---------------------------------------------------------------------------
-- 5. The branch and the default storage of a product must belong to the row's tenant
-- ---------------------------------------------------------------------------
create or replace function public.check_storage_location_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.branches where id = new.branch_id and tenant_id = new.tenant_id
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_storage_location_branch() from public, anon, authenticated;

drop trigger if exists trg_storage_location_branch on public.storage_locations;
create trigger trg_storage_location_branch
  before insert or update of branch_id, tenant_id on public.storage_locations
  for each row execute function public.check_storage_location_branch();

create or replace function public.check_product_storage_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.storage_location_id is not null and not exists (
    select 1 from public.storage_locations
    where id = new.storage_location_id and tenant_id = new.tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_product_storage_location() from public, anon, authenticated;

drop trigger if exists trg_product_storage_location on public.products;
create trigger trg_product_storage_location
  before insert or update of storage_location_id on public.products
  for each row execute function public.check_product_storage_location();

-- ---------------------------------------------------------------------------
-- 6. Default storage for new branches, and for existing branches that have none
-- ---------------------------------------------------------------------------
create or replace function public.create_default_storage_for_branch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_locations (tenant_id, branch_id, name, type)
  values
    (new.tenant_id, new.id, 'Quru anbar', 'quru'),
    (new.tenant_id, new.id, 'Soyuducu', 'soyuducu'),
    (new.tenant_id, new.id, 'Dondurucu', 'dondurucu')
  on conflict (branch_id, name) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_default_storage_for_branch() from public, anon, authenticated;

drop trigger if exists trg_branch_default_storage on public.branches;
create trigger trg_branch_default_storage
  after insert on public.branches
  for each row execute function public.create_default_storage_for_branch();

insert into public.storage_locations (tenant_id, branch_id, name, type)
select b.tenant_id, b.id, defaults.name, defaults.type
from public.branches b
cross join (
  values ('Quru anbar', 'quru'), ('Soyuducu', 'soyuducu'), ('Dondurucu', 'dondurucu')
) as defaults(name, type)
where not exists (select 1 from public.storage_locations sl where sl.branch_id = b.id)
on conflict (branch_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- 7. RLS: same tenant policies as branches. Locations are deactivated, never deleted.
-- ---------------------------------------------------------------------------
alter table public.storage_locations enable row level security;

revoke all on table public.storage_locations from anon;
revoke delete, truncate, references, trigger on table public.storage_locations from authenticated;
grant select, insert, update on table public.storage_locations to authenticated;

drop policy if exists storage_locations_select on public.storage_locations;
drop policy if exists storage_locations_insert on public.storage_locations;
drop policy if exists storage_locations_update on public.storage_locations;
drop policy if exists storage_locations_delete on public.storage_locations;
create policy storage_locations_select on public.storage_locations
  for select to authenticated using (tenant_id = (select public.my_tenant_id()));
create policy storage_locations_insert on public.storage_locations
  for insert to authenticated with check (tenant_id = (select public.my_tenant_id()));
create policy storage_locations_update on public.storage_locations
  for update to authenticated
  using (tenant_id = (select public.my_tenant_id()))
  with check (tenant_id = (select public.my_tenant_id()));

commit;
