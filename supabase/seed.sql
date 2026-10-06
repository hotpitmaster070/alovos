-- Local development only. Supabase applies this file on `supabase db reset`.
-- Hosted projects do not run it. Branch names are not seeded.

insert into public.tenants (id, name)
values ('00000000-0000-4000-8000-000000000001', 'dev')
on conflict (id) do nothing;
