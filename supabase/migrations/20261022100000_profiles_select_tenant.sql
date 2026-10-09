-- profiles_select as 20261009_unify_tenant leaves it: own profile and the profiles of the caller's tenant.
-- A database that got the tenant model by hand and then replayed 20261006120000 (no organization_id
-- to rewrite) was left with "own profile only", which hides the team. Idempotent.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = 'tenant_id'
     ) then
    raise notice 'profiles.tenant_id or current_tenant_id() missing: profiles_select unchanged';
    return;
  end if;

  drop policy if exists profiles_select on public.profiles;
  create policy profiles_select on public.profiles
    for select to authenticated
    using (id = (select auth.uid()) or tenant_id = (select public.current_tenant_id()));
end;
$$;
