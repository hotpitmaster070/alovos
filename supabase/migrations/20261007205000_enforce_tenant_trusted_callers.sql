-- enforce_tenant_id() derives the tenant from auth.uid(). Signup (provision_tenant), backfills in
-- the SQL Editor and service_role have no end-user JWT, so current_tenant_id() is null and every
-- insert into branches/products/stock failed with no_tenant.
-- Callers without an anon/authenticated JWT are trusted and keep their explicit tenant_id.
-- anon/authenticated requests are still checked: tenant_id, branch_id and product_id must match
-- the caller's tenant. Idempotent. Run before 20261007210000_auto_tenant_on_signup.sql.

create or replace function public.enforce_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if new.tenant_id is not null and coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if new.tenant_id is not null and new.tenant_id is distinct from v_tenant then
    raise exception 'tenant_mismatch' using errcode = '42501';
  end if;
  new.tenant_id := v_tenant;

  if tg_table_name = 'products' and new.branch_id is not null then
    if not exists (
      select 1 from public.branches where id = new.branch_id and tenant_id = v_tenant
    ) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  end if;

  if tg_table_name = 'stock' then
    if not exists (
      select 1 from public.products where id = new.product_id and tenant_id = v_tenant
    ) then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.branches where id = new.branch_id and tenant_id = v_tenant
    ) then
      raise exception 'branch_not_found' using errcode = 'P0002';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_tenant_id() from public, anon, authenticated;
