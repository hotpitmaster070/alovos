-- Default zones of a branch: one per kind, in the restaurant's language, no duplicates.
-- * Language: tenant_settings.language (az / ru / en); tenant_settings.locale only as a fallback
--   (it is the number format of the currency, so USD alone must not turn a Russian kitchen English);
--   without settings: en.
-- * Kinds are checked by storage type, not by name: a branch that already has a dry store
--   ("Quru anbar" from 20261008020000 or one named by hand) gets no second "Dry store".
--   dry = quru, cold = soyuducu, frozen = dondurucu; the receiving zone is a custom place,
--   recognised by its name in any of the three languages.
-- * The legacy branch trigger of 20261007140000 / 20261008020000 always created Azerbaijani places;
--   trg_branch_default_zones is now the only one seeding a new branch.
-- * Existing places are not renamed, moved or deleted.
-- Run after 20261023000000_inventory_tasks.sql. Idempotent.

do $$
begin
  if to_regprocedure('public.seed_default_zones(uuid)') is null then
    raise exception 'Run 20261023000000_inventory_tasks.sql first';
  end if;
end;
$$;

drop trigger if exists trg_branch_default_storage on public.branches;
drop function if exists public.create_default_storage_for_branch();

create or replace function public.tenant_zone_language(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
       when lower(left(btrim(s.language), 2)) in ('az', 'ru', 'en') then lower(left(btrim(s.language), 2))
       when lower(s.locale) like 'ru%' then 'ru'
       when lower(s.locale) like 'az%' then 'az'
     end
     from public.tenant_settings s
     where s.tenant_id = p_tenant_id),
    'en')
$$;
revoke execute on function public.tenant_zone_language(uuid) from public, anon, authenticated;

create or replace function public.seed_default_zones(p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_lang text;
  v_created integer := 0;
  v_zone record;
begin
  select b.tenant_id into v_tenant from public.branches b where b.id = p_branch_id;
  if v_tenant is null then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  -- Two seeds of one branch at once (trigger + ensure_default_zones) must not both insert.
  perform pg_advisory_xact_lock(hashtextextended('default_zones:' || p_branch_id::text, 0));
  v_lang := public.tenant_zone_language(v_tenant);

  for v_zone in
    select z.type, z.names, case v_lang when 'ru' then z.names[2] when 'az' then z.names[1] else z.names[3] end as name
    from (values
      (1, 'quru', array['Quru anbar', 'Сухой склад', 'Dry store']),
      (2, 'soyuducu', array['Soyuducu', 'Холодный склад', 'Cold store']),
      (3, 'dondurucu', array['Dondurucu', 'Морозильник', 'Freezer']),
      (4, 'custom', array['Qəbul zonası', 'Зона приёмки', 'Receiving'])
    ) as z(ord, type, names)
    order by z.ord
  loop
    if v_zone.type <> 'custom' then
      continue when exists (select 1 from public.storage_locations l where l.branch_id = p_branch_id and l.type = v_zone.type);
    else
      continue when exists (select 1 from public.storage_locations l where l.branch_id = p_branch_id and l.name = any(v_zone.names));
    end if;
    insert into public.storage_locations (tenant_id, branch_id, type, name)
    values (v_tenant, p_branch_id, v_zone.type, v_zone.name)
    on conflict (branch_id, name) do nothing;
    if found then
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke execute on function public.seed_default_zones(uuid) from public, anon, authenticated;
