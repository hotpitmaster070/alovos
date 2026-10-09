-- Invited users no longer get a restaurant of their own, and abandoned empty restaurants are removed.
-- Invited users no longer get a restaurant of their own, and abandoned empty tenants are removed.
-- * Signup with raw_user_meta_data.invite_token (a valid, unused, unexpired invitation) joins the
--   inviting tenant with the invited role and marks the invitation used. No tenant, branch or storage
--   place is provisioned. Any other signup is unchanged (provision_tenant).
-- * Every signup provisions a main branch, storage places, settings, a profile and an owner membership,
--   so "no branches" never matches. A tenant is empty when
--     a) it has no products, b) no suppliers, c) no stock movements, d) no product lots (each checked
--        only when the table exists),
--     plus no row in any other table that references tenants (found through the foreign keys, so new
--        tables count without changing this file); the rows provisioned at signup do not count,
--     e) nobody works in it: no profile has it as the current tenant (profiles.tenant_id). A membership
--        left behind by a user who moved to another tenant does not keep it,
--     f) it has no pending invitation (unused and not expired).
-- * Only tenants created more than 7 and less than 30 days ago are deleted: fresh ones may still be
--   filling in, old ones are never touched. The same window is used once here and daily by
--   cleanup_empty_tenants() (pg_cron at 03:00 where installed).
-- * Replaces cleanup_empty_organizations() / the 'cleanup-empty-orgs' job of the first version of this
--   file (20261017_cleanup_empty_orgs.sql) where that was applied.
-- Run after 20261016_parlevel_forecast.sql. Idempotent.

begin;

do $$
begin
  if to_regclass('public.invitations') is null or to_regprocedure('public.accept_invitation(text)') is null then
    raise exception 'Run 20261016_parlevel_forecast.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Joining a tenant through an invitation (shared by signup and accept_invitation)
-- ---------------------------------------------------------------------------
-- Locks the invitation; returns it when it can be used, raises the stable error otherwise.
create or replace function public.lock_usable_invitation(p_token text)
returns public.invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.used_at is not null then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;
  return v_inv;
end;
$$;

-- The user works in the invitation's tenant from now on; an existing membership keeps its role.
create or replace function public.join_invitation_tenant(p_user_id uuid, p_email text, p_invitation public.invitations)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, tenant_id, role, email)
  values (p_user_id, p_invitation.tenant_id, p_invitation.role, p_email)
  on conflict (id) do update set tenant_id = excluded.tenant_id;

  insert into public.memberships (user_id, tenant_id, role)
  values (p_user_id, p_invitation.tenant_id, p_invitation.role)
  on conflict (user_id, tenant_id) do nothing;

  update public.invitations set used_at = now(), used_by = p_user_id where id = p_invitation.id;
  return p_invitation.tenant_id;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return public.join_invitation_tenant(
    v_user,
    (select email from auth.users where id = v_user),
    public.lock_usable_invitation(p_token)
  );
end;
$$;

-- New auth user: an invitation token in the signup metadata joins that tenant; otherwise (no token, or
-- the link is used, expired or unknown) the user gets a tenant of their own as before.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'invite_token', '')), '');
  v_inv public.invitations;
begin
  if v_token is not null then
    begin
      v_inv := public.lock_usable_invitation(v_token);
    exception
      when others then
        v_inv := null;
    end;
    if v_inv.id is not null then
      perform public.join_invitation_tenant(new.id, new.email, v_inv);
      return new;
    end if;
  end if;
  perform public.provision_tenant(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- What the invite page shows. 'joined': the signed-in user already used this link (for example at signup).
create or replace function public.invitation_preview(p_token text)
returns table (tenant_name text, role text, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where token = p_token;
  if not found then
    return query select null::text, null::text, 'not_found'::text;
    return;
  end if;
  return query
  select t.name, v_inv.role,
    case
      when v_inv.used_at is not null and v_inv.used_by = auth.uid() then 'joined'
      when v_inv.used_at is not null then 'used'
      when v_inv.expires_at <= now() then 'expired'
      else 'valid'
    end
  from public.tenants t
  where t.id = v_inv.tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Empty tenants
-- ---------------------------------------------------------------------------
-- First version of this file.
drop function if exists public.cleanup_empty_organizations();
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-empty-orgs'$cron$;
  end if;
end;
$$;

-- Filled at signup (provision_tenant and tenant triggers); rows there do not make a tenant used. They
-- are deleted together with the tenant. invitations: only pending ones keep a tenant (rule f).
create or replace function public.tenant_provisioned_tables()
returns regclass[]
language sql
stable
set search_path = public
as $$
  select array[
    'public.branches'::regclass,
    'public.storage_locations'::regclass,
    'public.tenant_settings'::regclass,
    'public.memberships'::regclass,
    'public.profiles'::regclass,
    'public.invitations'::regclass
  ]
$$;

-- Rules a-d: business tables checked by name when they exist (to_regclass is null for a missing one).
create or replace function public.tenant_business_tables()
returns regclass[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(t order by ord), '{}')
  from unnest(array[
    to_regclass('public.products'),
    to_regclass('public.suppliers'),
    to_regclass('public.stock_movements'),
    to_regclass('public.product_lots')
  ]) with ordinality as x(t, ord)
  where t is not null
$$;

-- Empty tenants (rules a-f) created more than p_min_age and less than p_max_age ago.
create or replace function public.empty_tenant_ids(p_min_age interval, p_max_age interval)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_table regclass;
  fk record;
begin
  -- Age window, rule e (nobody works in it) and rule f (no pending invitation).
  select coalesce(array_agg(t.id order by t.id), '{}') into v_ids
  from public.tenants t
  where t.created_at < now() - p_min_age
    and t.created_at > now() - p_max_age
    and not exists (select 1 from public.profiles p where p.tenant_id = t.id)
    and not exists (
      select 1 from public.invitations i
      where i.tenant_id = t.id and i.used_at is null and i.expires_at > now()
    );

  -- Rules a-d.
  foreach v_table in array public.tenant_business_tables()
  loop
    exit when cardinality(v_ids) = 0;
    execute format(
      'select coalesce(array_agg(id order by id), ''{}'') from unnest($1) as u(id)
       where not exists (select 1 from %s x where x.tenant_id = u.id)',
      v_table
    ) into v_ids using v_ids;
  end loop;

  -- Every other table with a foreign key to tenants (pg_constraint is what information_schema's
  -- referential_constraints is built on, without its per-role visibility filter).
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.tenants'::regclass
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> all (public.tenant_provisioned_tables())
  loop
    exit when cardinality(v_ids) = 0;
    execute format(
      'select coalesce(array_agg(id order by id), ''{}'') from unnest($1) as u(id)
       where not exists (select 1 from %s x where x.%I = u.id)',
      fk.tbl, fk.col
    ) into v_ids using v_ids;
  end loop;
  return v_ids;
end;
$$;

-- Deletes the empty tenants of the window with their provisioned rows, children first; returns the count.
create or replace function public.delete_empty_tenants(p_min_age interval, p_max_age interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  -- Tenants of the window are locked so nobody joins one between the check and the delete.
  perform 1 from public.tenants
  where created_at < now() - p_min_age and created_at > now() - p_max_age
  for update;
  v_ids := public.empty_tenant_ids(p_min_age, p_max_age);
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  delete from public.memberships where tenant_id = any (v_ids);
  delete from public.branches where tenant_id = any (v_ids);
  delete from public.storage_locations where tenant_id = any (v_ids);
  delete from public.tenant_settings where tenant_id = any (v_ids);
  delete from public.invitations where tenant_id = any (v_ids);
  delete from public.tenants where id = any (v_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Daily: empty tenants created more than 7 and less than 30 days ago. Scheduler only (service role).
create or replace function public.cleanup_empty_tenants()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.delete_empty_tenants(interval '7 days', interval '30 days')
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.lock_usable_invitation(text)',
    'public.join_invitation_tenant(uuid, text, public.invitations)',
    'public.handle_new_user()',
    'public.tenant_provisioned_tables()',
    'public.tenant_business_tables()',
    'public.empty_tenant_ids(interval, interval)',
    'public.delete_empty_tenants(interval, interval)',
    'public.cleanup_empty_tenants()'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end;
$$;
grant execute on function public.cleanup_empty_tenants() to service_role;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to authenticated;

-- One-time cleanup with the same window.
select public.cleanup_empty_tenants();

-- Daily at 03:00 where pg_cron is installed (Supabase: Database -> Extensions -> pg_cron); without it
-- no job is created and the function can be run by the service role.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('cleanup-empty-tenants', '0 3 * * *', 'select public.cleanup_empty_tenants()')$cron$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.cleanup_empty_tenants()', 'execute')
     or has_function_privilege('anon', 'public.cleanup_empty_tenants()', 'execute')
     or has_function_privilege('authenticated', 'public.delete_empty_tenants(interval, interval)', 'execute')
     or has_function_privilege('authenticated', 'public.join_invitation_tenant(uuid, text, public.invitations)', 'execute')
     or has_function_privilege('anon', 'public.accept_invitation(text)', 'execute') then
    raise exception 'privileges too wide';
  end if;
  if not public.tenant_business_tables() @> array['public.products'::regclass, 'public.stock_movements'::regclass] then
    raise exception 'tenant_business_tables is missing products or stock_movements';
  end if;
  if exists (select 1 from public.profiles p where p.tenant_id is not null
             and not exists (select 1 from public.tenants t where t.id = p.tenant_id)) then
    raise exception 'a profile points at a deleted tenant';
  end if;
end;
$$;

commit;
