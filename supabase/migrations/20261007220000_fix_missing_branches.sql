-- Every tenant with a profile gets a Main Branch if it has no branch yet. Idempotent.
-- session_replication_role = replica skips user triggers (enforce_tenant_id) for this transaction
-- only; Supabase forbids ALTER TABLE ... DISABLE TRIGGER ALL. It also skips FK checks, which is
-- safe here because tenant_id comes from profiles.tenant_id, itself an FK to tenants.

begin;

set local session_replication_role = replica;

insert into public.branches (tenant_id, name)
select p.tenant_id, 'Main Branch'
from public.profiles p
left join public.branches b on b.tenant_id = p.tenant_id
where p.tenant_id is not null and b.id is null
on conflict do nothing;

commit;
