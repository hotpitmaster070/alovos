-- Private bucket for inventory proof photos.
-- Object path: {tenant_id}/{branch_id}/{year}/{month}/{product_id}_{type}_{timestamp}.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-proofs', 'inventory-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists inventory_proofs_select on storage.objects;
drop policy if exists inventory_proofs_insert on storage.objects;

create policy inventory_proofs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inventory-proofs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
  );

create policy inventory_proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inventory-proofs'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.current_member_role()) in ('owner', 'chef', 'cook')
    and exists (
      select 1
      from public.branches b
      where b.id::text = (storage.foldername(name))[2]
        and b.tenant_id = (select public.current_tenant_id())
    )
  );
