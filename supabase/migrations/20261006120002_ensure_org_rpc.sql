-- Recovery path for users whose signup trigger (handle_new_user) failed and who therefore have
-- no profile, or a profile without an organization. The client calls it as
--   supabase.rpc('ensure_my_organization')
-- Requires 20261006120000_multitenant_rls.sql.
--
-- Access control: functions are not governed by RLS policies. The EXECUTE grant at the bottom is
-- what allows authenticated users to call it. The function runs as its owner (security definer),
-- so it needs no extra insert policies on organizations/profiles, and no existing policy or
-- privilege is loosened. Unlike handle_new_user it does not swallow errors: failures reach the client.

create or replace function public.ensure_my_organization()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  user_meta jsonb;
  org_id uuid;
  new_org_id uuid := gen_random_uuid();
  org_name text;
  affected integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Serialise concurrent calls for the same user: the second call waits, then sees the
  -- organization created by the first and returns it instead of creating another one.
  perform pg_advisory_xact_lock(hashtextextended('ensure_my_organization:' || uid::text, 0));

  select organization_id into org_id from public.profiles where id = uid;
  if org_id is not null then
    return org_id;
  end if;

  select email, raw_user_meta_data into user_email, user_meta
  from auth.users where id = uid;
  if not found then
    raise exception 'user % does not exist', uid using errcode = '28000';
  end if;

  org_name := coalesce(
    nullif(trim(user_meta ->> 'organization_name'), ''),
    nullif(trim(split_part(user_email, '@', 1)), ''),
    'My Restaurant'
  );

  insert into public.organizations (id, name)
  values (new_org_id, org_name);

  -- No profile: create it. Profile without organization: attach the new one.
  -- The WHERE clause keeps an already assigned organization untouched.
  insert into public.profiles (id, organization_id, role, email)
  values (uid, new_org_id, 'owner', user_email)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        role = coalesce(public.profiles.role, 'owner'),
        email = coalesce(public.profiles.email, excluded.email)
    where public.profiles.organization_id is null;

  get diagnostics affected = row_count;
  if affected = 0 then
    -- Someone assigned an organization in the meantime: drop ours and return theirs.
    delete from public.organizations where id = new_org_id;
    select organization_id into org_id from public.profiles where id = uid;
    return org_id;
  end if;

  return new_org_id;
end;
$$;

revoke execute on function public.ensure_my_organization() from public, anon;
grant execute on function public.ensure_my_organization() to authenticated;
