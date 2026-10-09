-- Inventory tasks: a chef assigns blind counts to cooks, in one of two modes.
--   fast_zones       (daily): every zone of a branch gets its own cook.
--   control_parallel (weekly anti-theft): 2-5 cooks count the same zone independently.
-- Zones are storage_locations; each zone of a task is one stock_counts document, each cook's entries
-- are stock_count_items rows of that cook (is_blind). When the last cook submits, every zone is
-- merged (expected quantity fixed at that moment, average of the counts) and waits for the chef's
-- approve_stock_count(), which stays the only step that changes stock.
-- Cooks read their own tasks and entries only; expected quantities and other cooks' counts are
-- never returned to them. All writes go through the security definer functions below.
-- Idempotent; skips nothing silently: missing prerequisites stop the migration with a message.

do $$
begin
  if to_regclass('public.tenants') is null or to_regclass('public.branches') is null
     or to_regclass('public.storage_locations') is null or to_regclass('public.stock_counts') is null
     or to_regclass('public.stock_count_items') is null or to_regclass('public.memberships') is null
     or to_regprocedure('public.current_tenant_id()') is null
     or to_regprocedure('public.current_member_role()') is null
     or to_regprocedure('public.add_counter_to_count(uuid)') is null
     or to_regprocedure('public.product_last_purchase_price(uuid)') is null then
    raise exception 'Run 20261009_unify_tenant.sql, 20261011_parallel_count.sql and 20261014_count_polish.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_counts' and column_name = 'finished_by'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'storage_locations' and column_name = 'branch_id'
  ) then
    raise exception 'stock_counts.finished_by or storage_locations.branch_id missing: run 20261014_count_polish.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  mode text not null,
  status text not null default 'pending',
  title text not null,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint inventory_tasks_mode_check check (mode in ('fast_zones', 'control_parallel')),
  constraint inventory_tasks_status_check check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  constraint inventory_tasks_title_check check (char_length(btrim(title)) between 1 and 120)
);

create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null references public.inventory_tasks(id) on delete cascade,
  zone_id uuid not null references public.storage_locations(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  stock_count_id uuid references public.stock_counts(id) on delete set null,
  status text not null default 'pending',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint task_assignees_status_check check (status in ('pending', 'in_progress', 'submitted')),
  constraint task_assignees_unique unique (task_id, zone_id, assignee_id)
);

alter table public.stock_count_items add column if not exists is_blind boolean not null default false;
alter table public.stock_count_items add column if not exists photo_url text;
alter table public.stock_count_items drop constraint if exists stock_count_items_photo_url_check;
alter table public.stock_count_items add constraint stock_count_items_photo_url_check
  check (photo_url is null or char_length(photo_url) between 1 and 2048);
-- stock_count_items is readable column by column (system_quantity stays hidden).
grant select (is_blind, photo_url) on table public.stock_count_items to authenticated;

-- Zones are storage places; this view names them for inventory and reads through the caller's RLS.
do $$
begin
  if to_regclass('public.storage_zones') is null
     or (select c.relkind from pg_class c where c.oid = to_regclass('public.storage_zones')) = 'v' then
    execute $v$
      create or replace view public.storage_zones with (security_invoker = true) as
      select id, tenant_id, branch_id, name, type, code, is_active
      from public.storage_locations
    $v$;
    revoke all on public.storage_zones from anon;
    grant select on public.storage_zones to authenticated;
  else
    raise notice 'public.storage_zones exists and is not a view, left as is';
  end if;
end;
$$;

-- Each index only when its columns exist (the tables above may predate this file in another shape).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('idx_inventory_tasks_branch', 'inventory_tasks', array['tenant_id', 'branch_id', 'created_at'],
        'create index if not exists idx_inventory_tasks_branch on public.inventory_tasks (tenant_id, branch_id, created_at desc)'),
      ('idx_inventory_tasks_status', 'inventory_tasks', array['tenant_id', 'status'],
        'create index if not exists idx_inventory_tasks_status on public.inventory_tasks (tenant_id, status)'),
      ('idx_task_assignees_task', 'task_assignees', array['task_id'],
        'create index if not exists idx_task_assignees_task on public.task_assignees (task_id)'),
      ('idx_task_assignees_assignee', 'task_assignees', array['tenant_id', 'assignee_id', 'status'],
        'create index if not exists idx_task_assignees_assignee on public.task_assignees (tenant_id, assignee_id, status)'),
      ('idx_task_assignees_count', 'task_assignees', array['stock_count_id'],
        'create index if not exists idx_task_assignees_count on public.task_assignees (stock_count_id)')
    ) as s(name, tbl, cols, ddl)
  loop
    if (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = spec.tbl and column_name = any(spec.cols)
    ) = cardinality(spec.cols) then
      execute spec.ddl;
    else
      raise notice '%: column(s) % of public.% missing, skipped', spec.name, spec.cols, spec.tbl;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS: read only. Owners and chefs see every task of the tenant; others see the tasks they are
-- assigned to and their own assignments. No client writes.
-- ---------------------------------------------------------------------------
alter table public.inventory_tasks enable row level security;
alter table public.task_assignees enable row level security;

revoke all on public.inventory_tasks, public.task_assignees from anon;
revoke insert, update, delete, truncate, references, trigger on public.inventory_tasks, public.task_assignees from authenticated;
grant select on public.inventory_tasks, public.task_assignees to authenticated;

drop policy if exists inventory_tasks_select on public.inventory_tasks;
create policy inventory_tasks_select on public.inventory_tasks
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_member_role()) in ('owner', 'chef')
      or exists (
        select 1 from public.task_assignees a
        where a.task_id = inventory_tasks.id and a.assignee_id = (select auth.uid())
      )
    )
  );

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.current_member_role()) in ('owner', 'chef') or assignee_id = (select auth.uid()))
  );

-- Blind counts: a cook reads only their own entries. Owners and chefs read every entry; merged rows
-- (with the expected quantity) go to others only through stock_count_lines(), which decides when to reveal.
drop policy if exists stock_count_items_select on public.stock_count_items;
create policy stock_count_items_select on public.stock_count_items
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.current_member_role()) in ('owner', 'chef') or user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- The member may work in the branch: memberships.branch_ids empty means every branch.
create or replace function public.member_has_branch(p_user_id uuid, p_tenant_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user_id and m.tenant_id = p_tenant_id
      and (cardinality(m.branch_ids) = 0 or p_branch_id = any (m.branch_ids))
  )
$$;
revoke execute on function public.member_has_branch(uuid, uuid, uuid) from public, anon, authenticated;

-- Four zones for a branch (meat, vegetables, dry, bar) in the restaurant's language, each only when
-- the branch has no place of that name. Returns the number created. Internal: no caller checks.
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

  select lower(left(coalesce(s.locale, ''), 2)) into v_lang from public.tenant_settings s where s.tenant_id = v_tenant;
  for v_zone in
    select z.type,
      case coalesce(v_lang, '') when 'ru' then z.ru when 'en' then z.en else z.az end as name
    from (values
      (1, 'soyuducu', 'Ət soyuducusu', 'Мясной холодильник', 'Meat fridge'),
      (2, 'soyuducu', 'Tərəvəz', 'Овощи', 'Vegetables'),
      (3, 'quru', 'Quru anbar', 'Сухой склад', 'Dry store'),
      (4, 'custom', 'Bar', 'Бар', 'Bar')
    ) as z(ord, type, az, ru, en)
    order by z.ord
  loop
    if not exists (select 1 from public.storage_locations l where l.branch_id = p_branch_id and l.name = v_zone.name) then
      insert into public.storage_locations (tenant_id, branch_id, type, name)
      values (v_tenant, p_branch_id, v_zone.type, v_zone.name);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke execute on function public.seed_default_zones(uuid) from public, anon, authenticated;

-- The same for owners and chefs of the branch's tenant (e.g. after deleting zones).
create or replace function public.ensure_default_zones(p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and tenant_id = public.current_tenant_id())
     or coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.seed_default_zones(p_branch_id);
end;
$$;
revoke execute on function public.ensure_default_zones(uuid) from public, anon;
grant execute on function public.ensure_default_zones(uuid) to authenticated;

-- Every new branch starts with the default zones; a failure here never blocks creating the branch.
create or replace function public.branch_default_zones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.seed_default_zones(new.id);
  exception when others then
    raise notice 'default zones skipped for branch %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.branch_default_zones() from public, anon, authenticated;
drop trigger if exists trg_branch_default_zones on public.branches;
create trigger trg_branch_default_zones
  after insert on public.branches
  for each row execute function public.branch_default_zones();

-- People a chef can assign in a branch: members with access to it.
create or replace function public.inventory_staff(p_branch_id uuid)
returns table (user_id uuid, email text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.email, m.role
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.tenant_id = v_tenant
      and m.role in ('owner', 'chef', 'cook')
      and (cardinality(m.branch_ids) = 0 or p_branch_id = any (m.branch_ids))
    order by case m.role when 'cook' then 0 when 'chef' then 1 else 2 end, p.email, m.user_id;
end;
$$;
revoke execute on function public.inventory_staff(uuid) from public, anon;
grant execute on function public.inventory_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Create a task (owner/chef)
-- p_assignments: [{zone_id, assignee_id}]. fast_zones: one cook per zone, at least one zone.
-- control_parallel: one zone, 2-5 different cooks.
-- ---------------------------------------------------------------------------
create or replace function public.create_inventory_task(
  p_branch_id uuid,
  p_mode text,
  p_title text,
  p_assignments jsonb,
  p_scheduled_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_title text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), '');
  v_task uuid;
  v_item jsonb;
  v_zone uuid;
  v_user uuid;
  v_zones uuid[] := '{}';
  v_users uuid[] := '{}';
  v_pairs integer := 0;
  v_count uuid;
  v_zone_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('fast_zones', 'control_parallel')
     or v_title is null or char_length(v_title) > 120
     or p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
     or jsonb_array_length(p_assignments) = 0 or jsonb_array_length(p_assignments) > 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id and tenant_id = v_tenant)
     or not public.member_has_branch(auth.uid(), v_tenant, p_branch_id) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  -- Validate every pair first.
  for v_item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'zone_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_item ->> 'assignee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_zone := (v_item ->> 'zone_id')::uuid;
    v_user := (v_item ->> 'assignee_id')::uuid;
    if not exists (
      select 1 from public.storage_locations
      where id = v_zone and tenant_id = v_tenant and branch_id = p_branch_id and is_active
    ) then
      raise exception 'location_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.memberships m
      where m.user_id = v_user and m.tenant_id = v_tenant and m.role in ('owner', 'chef', 'cook')
    ) or not public.member_has_branch(v_user, v_tenant, p_branch_id) then
      raise exception 'assignee_not_found' using errcode = 'P0002';
    end if;
    if p_mode = 'fast_zones' and v_zone = any (v_zones) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if p_mode = 'control_parallel' and v_user = any (v_users) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if not (v_zone = any (v_zones)) then
      v_zones := array_append(v_zones, v_zone);
    end if;
    v_users := array_append(v_users, v_user);
    v_pairs := v_pairs + 1;
  end loop;
  if p_mode = 'control_parallel' and (cardinality(v_zones) <> 1 or v_pairs < 2 or v_pairs > 5) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.inventory_tasks (tenant_id, branch_id, created_by, mode, status, title, scheduled_at)
  values (v_tenant, p_branch_id, auth.uid(), p_mode, 'pending', v_title, p_scheduled_at)
  returning id into v_task;

  -- One open count per zone; a zone already being counted stops the whole task.
  foreach v_zone_id in array v_zones loop
    begin
      insert into public.stock_counts (tenant_id, branch_id, location_id, group_key, user_id, status)
      values (v_tenant, p_branch_id, v_zone_id, 'inventory_task ' || v_task, auth.uid(), 'draft')
      returning id into v_count;
    exception when unique_violation then
      raise exception 'open_count' using errcode = '55000';
    end;
    update public.stock_counts
    set status = 'counting',
        counted_by = array(
          select (a ->> 'assignee_id')::uuid from jsonb_array_elements(p_assignments) a
          where (a ->> 'zone_id')::uuid = v_zone_id
        ),
        finished_by = '{}'
    where id = v_count;

    insert into public.task_assignees (tenant_id, task_id, zone_id, assignee_id, stock_count_id)
    select v_tenant, v_task, v_zone_id, (a ->> 'assignee_id')::uuid, v_count
    from jsonb_array_elements(p_assignments) a
    where (a ->> 'zone_id')::uuid = v_zone_id;
  end loop;

  return v_task;
end;
$$;
revoke execute on function public.create_inventory_task(uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.create_inventory_task(uuid, text, text, jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A cook's work
-- ---------------------------------------------------------------------------
-- The assignment of the caller, locked; its task must still be open.
create or replace function public.my_task_assignment(p_assignment_id uuid)
returns public.task_assignees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_assignees;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select a.* into v_row
  from public.task_assignees a
  join public.inventory_tasks t on t.id = a.task_id
  where a.id = p_assignment_id and a.assignee_id = auth.uid()
    and a.tenant_id = public.current_tenant_id()
  for update of a;
  if v_row.id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.inventory_tasks where id = v_row.task_id and status in ('completed', 'cancelled')) then
    raise exception 'task_closed' using errcode = '55000';
  end if;
  return v_row;
end;
$$;
revoke execute on function public.my_task_assignment(uuid) from public, anon, authenticated;

-- "Start counting": the zone's products are then listed by count_products_page() (name and unit only).
create or replace function public.start_task_assignment(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_assignees := public.my_task_assignment(p_assignment_id);
begin
  if v_row.status = 'submitted' then
    raise exception 'already_submitted' using errcode = '55000';
  end if;
  update public.task_assignees set status = 'in_progress' where id = v_row.id and status = 'pending';
  update public.inventory_tasks set status = 'in_progress' where id = v_row.task_id and status = 'pending';
  return v_row.stock_count_id;
end;
$$;
revoke execute on function public.start_task_assignment(uuid) from public, anon;
grant execute on function public.start_task_assignment(uuid) to authenticated;

-- Merges one zone of a finished task: the expected balance now, the average of the assignees' counts
-- (anyone else who joined the zone's count from the regular count screen is ignored).
create or replace function public.merge_task_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts;
begin
  select * into v_count from public.stock_counts where id = p_count_id for update;
  if v_count.id is null or v_count.status <> 'counting' then
    return;
  end if;
  insert into public.stock_count_items (tenant_id, stock_count_id, product_id, counted_quantity, user_id, system_quantity, is_blind)
  select v_count.tenant_id, v_count.id, i.product_id, round(avg(i.counted_quantity), 3), null,
    (select coalesce(sum(ps.quantity), 0) from public.product_stocks ps
      where ps.tenant_id = v_count.tenant_id and ps.product_id = i.product_id
        and ps.location_id = v_count.location_id and ps.branch_id is not distinct from v_count.branch_id),
    true
  from public.stock_count_items i
  where i.stock_count_id = v_count.id
    and i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = v_count.id)
  group by i.product_id
  on conflict (stock_count_id, product_id) where user_id is null do nothing;
  update public.stock_counts set status = 'merging', merged_at = now() where id = v_count.id;
end;
$$;
revoke execute on function public.merge_task_count(uuid) from public, anon, authenticated;

-- "Send": [{product_id, quantity}] replaces the caller's entries for the zone. When every assignee of
-- the task has sent, each zone is merged and the task is completed. Returns the task status.
create or replace function public.submit_task_assignment(p_assignment_id uuid, p_items jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_assignees := public.my_task_assignment(p_assignment_id);
  v_count public.stock_counts;
  v_item jsonb;
  v_product uuid;
  v_quantity numeric;
  v_task public.inventory_tasks;
  v_zone_count uuid;
begin
  if v_row.status = 'submitted' then
    raise exception 'already_submitted' using errcode = '55000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 2000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_count from public.stock_counts where id = v_row.stock_count_id for update;
  if v_count.id is null or v_count.status <> 'counting' then
    raise exception 'task_closed' using errcode = '55000';
  end if;

  delete from public.stock_count_items where stock_count_id = v_count.id and user_id = auth.uid();
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'quantity'), '') <> 'number'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_product := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity < 0 or v_quantity > 1000000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products where id = v_product and tenant_id = v_count.tenant_id) then
      raise exception 'product_not_found' using errcode = 'P0002';
    end if;
    if v_item ? 'photo_url' and jsonb_typeof(v_item -> 'photo_url') not in ('string', 'null') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    insert into public.stock_count_items (tenant_id, stock_count_id, product_id, counted_quantity, user_id, is_blind, photo_url)
    values (v_count.tenant_id, v_count.id, v_product, v_quantity, auth.uid(), true,
      nullif(left(btrim(coalesce(v_item ->> 'photo_url', '')), 2048), ''))
    on conflict (stock_count_id, product_id, user_id) where user_id is not null
    do update set counted_quantity = excluded.counted_quantity, is_blind = true, photo_url = excluded.photo_url;
  end loop;

  perform public.add_counter_to_count(v_count.id);
  update public.stock_counts
  set finished_by = array(select distinct unnest(array_append(coalesce(finished_by, '{}'), auth.uid())))
  where id = v_count.id;
  update public.task_assignees set status = 'submitted', submitted_at = now() where id = v_row.id;

  select * into v_task from public.inventory_tasks where id = v_row.task_id for update;
  if not exists (select 1 from public.task_assignees where task_id = v_task.id and status <> 'submitted') then
    for v_zone_count in
      select distinct stock_count_id from public.task_assignees where task_id = v_task.id and stock_count_id is not null
    loop
      perform public.merge_task_count(v_zone_count);
    end loop;
    update public.inventory_tasks set status = 'completed', completed_at = now() where id = v_task.id;
    return 'completed';
  end if;
  update public.inventory_tasks set status = 'in_progress' where id = v_task.id and status = 'pending';
  return 'in_progress';
end;
$$;
revoke execute on function public.submit_task_assignment(uuid, jsonb) from public, anon;
grant execute on function public.submit_task_assignment(uuid, jsonb) to authenticated;

-- Owner/chef: drop an open task and its counts; stock does not change.
create or replace function public.cancel_inventory_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.inventory_tasks;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_task from public.inventory_tasks
  where id = p_task_id and tenant_id = public.current_tenant_id()
  for update;
  if v_task.id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'task_closed' using errcode = '55000';
  end if;
  update public.stock_counts set status = 'cancelled'
  where id in (select stock_count_id from public.task_assignees where task_id = v_task.id)
    and status in ('draft', 'counting');
  update public.inventory_tasks set status = 'cancelled', completed_at = now() where id = v_task.id;
end;
$$;
revoke execute on function public.cancel_inventory_task(uuid) from public, anon;
grant execute on function public.cancel_inventory_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Discrepancies (owner/chef): one row per product and zone of completed tasks, with every
-- cook's count, the expected balance fixed at merge time and the unit cost from the database.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_discrepancy_lines(
  p_branch_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_task_id uuid default null
)
returns table (
  task_id uuid,
  task_title text,
  mode text,
  branch_id uuid,
  completed_at timestamptz,
  stock_count_id uuid,
  count_status text,
  zone_id uuid,
  zone_name text,
  product_id uuid,
  product_name text,
  unit text,
  expected_quantity numeric,
  counts jsonb,
  unit_cost numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'no_tenant' using errcode = '42501';
  end if;
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select t.id, t.title, t.mode, t.branch_id, t.completed_at, c.id, c.status, l.id, l.name,
      p.id, p.name, p.unit, m.system_quantity,
      coalesce((
        select jsonb_agg(jsonb_build_object('user_id', i.user_id, 'email', pr.email, 'quantity', i.counted_quantity)
          order by pr.email, i.user_id)
        from public.stock_count_items i
        left join public.profiles pr on pr.id = i.user_id
        where i.stock_count_id = c.id and i.product_id = m.product_id
          and i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = c.id)
      ), '[]'::jsonb),
      public.product_last_purchase_price(p.id)
    from public.inventory_tasks t
    join (select distinct a.task_id, a.stock_count_id from public.task_assignees a) ta on ta.task_id = t.id
    join public.stock_counts c on c.id = ta.stock_count_id
    join public.storage_locations l on l.id = c.location_id
    join public.stock_count_items m on m.stock_count_id = c.id and m.user_id is null
    join public.products p on p.id = m.product_id
    where t.tenant_id = v_tenant
      and t.status = 'completed'
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_task_id is null or t.id = p_task_id)
      and (p_from is null or t.completed_at >= p_from::timestamptz)
      and (p_to is null or t.completed_at < (p_to + 1)::timestamptz)
      and public.member_has_branch(auth.uid(), v_tenant, t.branch_id)
    order by t.completed_at desc, t.id, l.name, p.name, p.id
    limit 5000;
end;
$$;
revoke execute on function public.inventory_discrepancy_lines(uuid, date, date, uuid) from public, anon;
grant execute on function public.inventory_discrepancy_lines(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Default zones for every existing branch
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  v_total integer := 0;
begin
  for b in select id from public.branches loop
    begin
      v_total := v_total + public.seed_default_zones(b.id);
    exception when others then
      raise notice 'default zones skipped for branch %: %', b.id, sqlerrm;
    end;
  end loop;
  raise notice 'default zones created: %', v_total;
end;
$$;
