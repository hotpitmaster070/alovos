-- Signup provisioning. Idempotent.
-- handle_new_user() already existed; this replaces it so a new auth.users row
-- gets a tenant named with the user's email and an owner profile.
-- SECURITY DEFINER: the insert runs as the function owner, so it succeeds while
-- Confirm email is on (the new user has no session yet) and while RLS blocks
-- client inserts of tenant_id / role.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid := gen_random_uuid();
  tenant_name text := coalesce(nullif(btrim(new.email), ''), 'owner');
begin
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  insert into public.organizations (id, name)
  values (new_tenant_id, tenant_name);

  insert into public.tenants (id, name)
  values (new_tenant_id, tenant_name);

  insert into public.profiles (id, organization_id, tenant_id, role, email)
  values (new.id, new_tenant_id, new_tenant_id, 'owner', new.email);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Owner reads their own tenant. Clients cannot insert tenants or profiles;
-- service_role bypasses RLS, and the trigger above inserts as definer.
revoke insert, delete on public.tenants from anon, authenticated;
revoke insert on public.profiles from anon, authenticated;

drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select public.current_tenant_id()));

grant select on public.tenants to authenticated;
grant select on public.profiles to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.tenants to service_role;
    grant select, insert, update, delete on public.profiles to service_role;
    grant select, insert, update, delete on public.organizations to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end;
$$;
