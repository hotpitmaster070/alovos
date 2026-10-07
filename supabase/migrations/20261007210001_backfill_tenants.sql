-- Provision a tenant for every existing user that has no profile or no profiles.tenant_id.
-- Run after 20261007210000_auto_tenant_on_signup.sql. Idempotent: provisioned users are skipped.

do $$
declare
  u record;
begin
  for u in
    select au.id, au.email
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null or p.tenant_id is null
  loop
    perform public.provision_tenant(u.id, u.email);
  end loop;
end;
$$;

-- Users who already had a tenant are skipped above and may still have no branch.
insert into public.branches (tenant_id, name)
select p.tenant_id, 'Main Branch'
from public.profiles p
left join public.branches b on b.tenant_id = p.tenant_id
where p.tenant_id is not null and b.id is null
on conflict do nothing;
