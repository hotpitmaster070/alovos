-- Storage place codes no longer carry the branch: {TYPE_CODE}-{number} (SOY-1, DON-1, ANB-1).
-- The branch is linked only through storage_locations.branch_id -> branches.id and shown by a join.
-- * The numbering trigger derives the new code; codes are unique per branch instead of per tenant.
-- * Existing codes are rebuilt; a leading "<branch code>-" in place names is removed using each
--   place's own branch code from the database (no literal branch codes here).
-- * Branch code changes no longer touch place codes.
-- Run after 20261015_storage_numbering.sql. Idempotent.

begin;

do $$
begin
  if to_regprocedure('public.storage_type_code(text)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'storage_locations' and column_name = 'code'
     ) then
    raise exception 'Run 20261015_storage_numbering.sql first';
  end if;
end;
$$;

create or replace function public.storage_location_numbering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.number is not distinct from old.number
     and (new.type is distinct from old.type or new.branch_id is distinct from old.branch_id) then
    new.number := null;
  end if;
  if not exists (select 1 from public.branches where id = new.branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('storage_location_number'), hashtext(new.branch_id::text || ':' || new.type));
    select coalesce(max(number), 0) + 1 into new.number
    from public.storage_locations
    where branch_id = new.branch_id and type = new.type and id is distinct from new.id;
  end if;
  new.code := public.storage_type_code(new.type) || '-' || new.number;
  return new;
end;
$$;
revoke execute on function public.storage_location_numbering() from public, anon, authenticated;

-- SOY-1 exists in every branch now, so uniqueness moves from the tenant to the branch.
drop index if exists public.uniq_location_code_per_tenant;
create unique index if not exists uniq_location_code_per_branch on public.storage_locations (branch_id, code);

drop trigger if exists trg_branch_code_cascade on public.branches;
drop function if exists public.branch_code_cascade();

-- Rebuild codes (the trigger derives them from type and number).
update public.storage_locations
set code = null
where code is distinct from public.storage_type_code(type) || '-' || number;

-- Strip "<branch code>-" from names, unless that would collide with another place's name in the branch.
update public.storage_locations sl
set name = btrim(substr(sl.name, length(b.code) + 2))
from public.branches b
where b.id = sl.branch_id
  and upper(sl.name) like upper(b.code) || '-%'
  and btrim(substr(sl.name, length(b.code) + 2)) <> ''
  and not exists (
    select 1 from public.storage_locations o
    where o.branch_id = sl.branch_id and o.id <> sl.id
      and o.name = btrim(substr(sl.name, length(b.code) + 2))
  );

do $$
begin
  if exists (
    select 1 from public.storage_locations
    where code is distinct from public.storage_type_code(type) || '-' || number
  ) then
    raise exception 'storage codes still carry a branch prefix';
  end if;
  if to_regclass('public.uniq_location_code_per_branch') is null then
    raise exception 'uniq_location_code_per_branch missing';
  end if;
end;
$$;

commit;
