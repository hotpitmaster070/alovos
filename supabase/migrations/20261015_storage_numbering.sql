-- Fixed storage numbering. Every storage place has a number per (branch, type) - Soyuducu #1, #2 ... -
-- and a code {BRANCH_CODE}-{TYPE_CODE}-{number} (NIZ-SOY-1). Branches get a code unique in the tenant.
-- * Numbers: existing places numbered by creation time; new places take MAX+1 of their branch and type
--   unless a free number is given. uniq_location_number_per_branch forbids two Soyuducu #1 in a branch.
-- * Codes are derived by the database and follow branch code changes.
-- * Display order: soyuducu, dondurucu, quru (Anbar), custom; then number.
-- * A place with an open stock count cannot be deactivated.
-- Run after 20261014_count_polish.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.approve_stock_count(uuid)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'storage_locations' and column_name = 'is_active'
     ) then
    raise exception 'Run 20261008020000_dynamic_storage_locations.sql .. 20261014_count_polish.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Type order and type codes (lib/anbar/types.ts mirrors them)
-- ---------------------------------------------------------------------------
create or replace function public.storage_type_rank(p_type text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_type when 'soyuducu' then 1 when 'dondurucu' then 2 when 'quru' then 3 else 4 end;
$$;

create or replace function public.storage_type_code(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type when 'soyuducu' then 'SOY' when 'dondurucu' then 'DON' when 'quru' then 'ANB' else 'DIG' end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Branch codes
-- ---------------------------------------------------------------------------
alter table public.branches add column if not exists code text;

-- First three Latin letters/digits of the name (Azerbaijani and Russian letters transliterated),
-- made unique in the tenant with a numeric suffix.
create or replace function public.suggest_branch_code(p_tenant_id uuid, p_name text, p_branch_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_code text;
  v_n integer := 1;
begin
  v_base := upper(translate(
    coalesce(p_name, ''),
    'əƏşŞçÇğĞıİöÖüÜабвгдеёжзийклмнопрстуфхцчшщыэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЫЭЮЯ',
    'EESSCCGGIIOOUUABVGDEEJZIYKLMNOPRSTUFXCCSSYEUYABVGDEEJZIYKLMNOPRSTUFXCCSSYEUY'
  ));
  v_base := left(regexp_replace(v_base, '[^A-Z0-9]', '', 'g'), 3);
  if v_base = '' then
    v_base := 'BR';
  end if;
  v_code := v_base;
  while exists (
    select 1 from public.branches
    where tenant_id = p_tenant_id and code = v_code and id is distinct from p_branch_id
  ) loop
    v_n := v_n + 1;
    v_code := v_base || v_n;
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.suggest_branch_code(uuid, text, uuid) from public, anon, authenticated;

do $$
declare
  b record;
begin
  for b in select id, tenant_id, name from public.branches where code is null order by created_at, id
  loop
    update public.branches set code = public.suggest_branch_code(b.tenant_id, b.name, b.id) where id = b.id;
  end loop;
end;
$$;

create or replace function public.branch_code_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := nullif(upper(btrim(coalesce(new.code, ''))), '');
  if new.code is null then
    new.code := public.suggest_branch_code(new.tenant_id, new.name, new.id);
  end if;
  return new;
end;
$$;
revoke execute on function public.branch_code_default() from public, anon, authenticated;

drop trigger if exists trg_branch_code_default on public.branches;
create trigger trg_branch_code_default
  before insert or update of code on public.branches
  for each row execute function public.branch_code_default();

alter table public.branches alter column code set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'branches_code_check') then
    alter table public.branches add constraint branches_code_check check (code ~ '^[A-Z0-9]{1,10}$');
  end if;
end;
$$;
create unique index if not exists uniq_branch_code_per_tenant on public.branches (tenant_id, code);

-- ---------------------------------------------------------------------------
-- 3. Location numbers and codes
-- ---------------------------------------------------------------------------
alter table public.storage_locations
  add column if not exists number integer,
  add column if not exists code text;

update public.storage_locations sl
set number = numbered.n
from (
  select id, row_number() over (partition by branch_id, type order by created_at, id) as n
  from public.storage_locations
) as numbered
where sl.id = numbered.id and sl.number is null
  and not exists (
    select 1 from public.storage_locations other
    where other.branch_id = sl.branch_id and other.type = sl.type and other.number is not null
  );
-- Places added to a (branch, type) that was already numbered continue after its highest number.
update public.storage_locations sl
set number = numbered.n
from (
  select l.id,
    (select coalesce(max(o.number), 0) from public.storage_locations o
      where o.branch_id = l.branch_id and o.type = l.type and o.number is not null)
    + row_number() over (partition by l.branch_id, l.type order by l.created_at, l.id) as n
  from public.storage_locations l
  where l.number is null
) as numbered
where sl.id = numbered.id;

-- Number (MAX+1 when not given, also after a type or branch change) and code; serialized per branch
-- and type so two inserts at once do not pick the same number.
create or replace function public.storage_location_numbering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code text;
begin
  if tg_op = 'UPDATE' and new.number is not distinct from old.number
     and (new.type is distinct from old.type or new.branch_id is distinct from old.branch_id) then
    new.number := null;
  end if;
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('storage_location_number'), hashtext(new.branch_id::text || ':' || new.type));
    select coalesce(max(number), 0) + 1 into new.number
    from public.storage_locations
    where branch_id = new.branch_id and type = new.type and id is distinct from new.id;
  end if;
  select code into v_branch_code from public.branches where id = new.branch_id;
  if v_branch_code is null then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  new.code := v_branch_code || '-' || public.storage_type_code(new.type) || '-' || new.number;
  return new;
end;
$$;
revoke execute on function public.storage_location_numbering() from public, anon, authenticated;

drop trigger if exists trg_storage_location_numbering on public.storage_locations;
create trigger trg_storage_location_numbering
  before insert or update of number, type, branch_id, code on public.storage_locations
  for each row execute function public.storage_location_numbering();

-- Fill codes of existing places (the trigger derives them).
update public.storage_locations set code = null where code is null;

alter table public.storage_locations alter column number set not null;
alter table public.storage_locations alter column code set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'storage_locations_number_check') then
    alter table public.storage_locations add constraint storage_locations_number_check check (number between 1 and 9999);
  end if;
end;
$$;
create unique index if not exists uniq_location_number_per_branch on public.storage_locations (branch_id, type, number);
create unique index if not exists uniq_location_code_per_tenant on public.storage_locations (tenant_id, code);

-- A branch code change renames its places' codes.
create or replace function public.branch_code_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is distinct from old.code then
    update public.storage_locations set code = null where branch_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.branch_code_cascade() from public, anon, authenticated;

drop trigger if exists trg_branch_code_cascade on public.branches;
create trigger trg_branch_code_cascade
  after update of code on public.branches
  for each row execute function public.branch_code_cascade();

-- Not while somebody counts there.
create or replace function public.storage_location_deactivate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active and exists (
    select 1 from public.stock_counts
    where location_id = new.id and status in ('draft', 'counting', 'merging')
  ) then
    raise exception 'open_count' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function public.storage_location_deactivate_guard() from public, anon, authenticated;

drop trigger if exists trg_storage_location_deactivate_guard on public.storage_locations;
create trigger trg_storage_location_deactivate_guard
  before update of is_active on public.storage_locations
  for each row execute function public.storage_location_deactivate_guard();

-- ---------------------------------------------------------------------------
-- 4. Bulk creation and overview
-- ---------------------------------------------------------------------------
-- Creates p_count places of one type in a branch. Numbers continue after the highest one unless
-- p_number is given (one place only). Name: p_name for a single place, else "<p_name_prefix> #<n>".
-- Runs with the caller's rights: the tenant policies and the branch check apply.
create or replace function public.create_storage_locations_bulk(
  p_branch_id uuid,
  p_type text,
  p_count integer default 1,
  p_number integer default null,
  p_name text default null,
  p_name_prefix text default null
)
returns setof public.storage_locations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_prefix text := nullif(btrim(regexp_replace(coalesce(p_name_prefix, ''), '\s+', ' ', 'g')), '');
  v_row public.storage_locations;
  v_number integer;
  i integer;
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('soyuducu', 'dondurucu', 'quru', 'custom')
     or p_count is null or p_count < 1 or p_count > 50
     or (p_number is not null and (p_count <> 1 or p_number < 1 or p_number > 9999))
     or (v_name is null and v_prefix is null)
     or (v_name is not null and p_count <> 1) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('storage_location_number'), hashtext(p_branch_id::text || ':' || p_type));
  if p_number is not null and exists (
    select 1 from public.storage_locations where branch_id = p_branch_id and type = p_type and number = p_number
  ) then
    raise exception 'number_taken' using errcode = '23505';
  end if;

  for i in 1 .. p_count loop
    v_number := coalesce(p_number, (
      select coalesce(max(number), 0) + 1 from public.storage_locations where branch_id = p_branch_id and type = p_type
    ));
    if exists (
      select 1 from public.storage_locations
      where branch_id = p_branch_id and name = coalesce(v_name, v_prefix || ' #' || v_number)
    ) then
      raise exception 'duplicate_name' using errcode = '23505';
    end if;
    insert into public.storage_locations (tenant_id, branch_id, type, number, name)
    values (v_tenant, p_branch_id, p_type, v_number, coalesce(v_name, v_prefix || ' #' || v_number))
    returning * into v_row;
    return next v_row;
  end loop;
end;
$$;

-- Places in display order with their product count (default place or a lot there, as the count
-- page lists them) and the open stock count, if any.
create or replace function public.storage_locations_overview(p_branch_id uuid default null, p_include_inactive boolean default false)
returns table (
  id uuid,
  name text,
  type text,
  number integer,
  code text,
  branch_id uuid,
  is_active boolean,
  product_count bigint,
  open_count integer,
  open_count_id uuid,
  open_status text,
  open_counters integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select sl.id, sl.name, sl.type, sl.number, sl.code, sl.branch_id, sl.is_active,
    (select count(*) from public.products p
      where p.tenant_id = sl.tenant_id
        and (p.storage_location_id = sl.id
          or exists (select 1 from public.product_stocks ps where ps.product_id = p.id and ps.location_id = sl.id))),
    (case when oc.id is null then 0 else 1 end)::integer,
    oc.id, oc.status, coalesce(cardinality(oc.counted_by), 0)
  from public.storage_locations sl
  left join public.stock_counts oc
    on oc.location_id = sl.id and oc.status in ('draft', 'counting', 'merging')
  where sl.tenant_id = (select public.current_tenant_id())
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and (p_include_inactive or sl.is_active)
  order by public.storage_type_rank(sl.type), sl.number, sl.branch_id, sl.id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_storage_locations_bulk(uuid, text, integer, integer, text, text)',
    'public.storage_locations_overview(uuid, boolean)',
    'public.storage_type_rank(text)',
    'public.storage_type_code(text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.storage_locations where number is null or code is null)
     or exists (select 1 from public.branches where code is null) then
    raise exception 'storage numbering incomplete';
  end if;
  if to_regclass('public.uniq_location_number_per_branch') is null or to_regclass('public.uniq_branch_code_per_tenant') is null then
    raise exception 'storage numbering indexes missing';
  end if;
end;
$$;

commit;
