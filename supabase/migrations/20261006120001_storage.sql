-- Private 'invoices' bucket. Objects must live under a top-level folder named after the
-- uploader's organization id: <organization_id>/<file>.
-- Requires 20261006120000_multitenant_rls.sql (public.current_org_id()).
-- storage.objects already has RLS enabled by Supabase, so it is deliberately not altered here.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists invoices_objects_select on storage.objects;
drop policy if exists invoices_objects_insert on storage.objects;
drop policy if exists invoices_objects_update on storage.objects;
drop policy if exists invoices_objects_delete on storage.objects;

create policy invoices_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

create policy invoices_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

create policy invoices_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  )
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

create policy invoices_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );
