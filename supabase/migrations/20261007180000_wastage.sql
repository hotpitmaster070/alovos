-- Waste log columns used by /app/tullanti, plus the photo bucket.
-- reason stays the english check constraint. Screen copy is translated in the app.

alter table public.wastage_logs add column if not exists branch_id uuid references public.branches(id);
alter table public.wastage_logs add column if not exists location_id uuid references public.storage_locations(id);
alter table public.wastage_logs add column if not exists quantity numeric;
alter table public.wastage_logs add column if not exists photo_url text;
alter table public.wastage_logs add column if not exists cost numeric;

alter table public.wastage_logs drop constraint if exists wastage_logs_reason_check;
alter table public.wastage_logs add constraint wastage_logs_reason_check
  check (reason in ('spoiled', 'overcooked', 'dropped', 'expired', 'theft', 'other'));

alter table public.wastage_logs drop constraint if exists wastage_logs_quantity_positive;
alter table public.wastage_logs add constraint wastage_logs_quantity_positive
  check (quantity is null or quantity > 0);

create index if not exists idx_wastage_logs_tenant_created
  on public.wastage_logs (tenant_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('wastage-photos', 'wastage-photos', false)
on conflict (id) do nothing;

drop policy if exists wastage_photos_select on storage.objects;
drop policy if exists wastage_photos_insert on storage.objects;
drop policy if exists wastage_photos_delete on storage.objects;

create policy wastage_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'wastage-photos'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );

create policy wastage_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'wastage-photos'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );

create policy wastage_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'wastage-photos'
    and (storage.foldername(name))[1] = (select public.my_tenant_id())::text
  );
