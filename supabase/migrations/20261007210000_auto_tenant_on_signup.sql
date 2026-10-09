-- Every auth.users row gets an organization, a tenant, an owner profile and a main branch.
-- Idempotent. Replaces handle_new_user() from 20261007195000_fix_auth.sql.
-- organizations and tenants share one id: app code scopes rows by organization_id = tenant_id,
-- and products.organization_id is a not-null FK to organizations.
-- ---------------------------------------------------------------------------

create or replace function public.provision_tenant(p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_name text := coalesce(nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''), 'My Restaurant');
begin
  -- Older profiles tables have no organization_id: the tenant alone, until 20261009_unify_tenant.
  -- PL/pgSQL plans a statement when it first runs, so the other branch never touches the column.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'organization_id'
  ) then
    select tenant_id into v_tenant from public.profiles where id = p_user_id;
    if v_tenant is not null then
      return v_tenant;
    end if;
    v_tenant := gen_random_uuid();
    insert into public.tenants (id, name) values (v_tenant, v_name);
    insert into public.profiles (id, tenant_id, role, email)
    values (p_user_id, v_tenant, 'owner', p_email)
    on conflict (id) do update
      set tenant_id = excluded.tenant_id,
          email = coalesce(public.profiles.email, excluded.email);
    insert into public.branches (tenant_id, name)
    values (v_tenant, 'Main Branch')
    on conflict (tenant_id, name) do nothing;
    return v_tenant;
  end if;

  select organization_id, tenant_id into v_org, v_tenant
  from public.profiles
  where id = p_user_id;

  if v_tenant is not null then
    return v_tenant;
  end if;

  if v_org is null then
    v_org := gen_random_uuid();
    insert into public.organizations (id, name) values (v_org, v_name);
  end if;
  v_tenant := v_org;

  insert into public.tenants (id, name)
  values (v_tenant, v_name)
  on conflict (id) do nothing;

  insert into public.profiles (id, organization_id, tenant_id, role, email)
  values (p_user_id, v_org, v_tenant, 'owner', p_email)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        tenant_id = excluded.tenant_id,
        email = coalesce(public.profiles.email, excluded.email);

  insert into public.branches (tenant_id, name)
  values (v_tenant, 'Main Branch')
  on conflict (tenant_id, name) do nothing;

  return v_tenant;
end;
$$;

revoke all on function public.provision_tenant(uuid, text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_tenant(new.id, new.email);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
    grant execute on function public.provision_tenant(uuid, text) to supabase_auth_admin;
  end if;
end;
$$;
