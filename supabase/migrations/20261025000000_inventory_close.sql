-- Inventory cabinets, part 2 (on top of 20261023000000_inventory_tasks.sql, already deployed):
-- * closing a task: every zone is merged and approved through approve_stock_count() (stock set to the
--   counted balance, 'count' movements at lot cost), then the task becomes 'closed' with its money
--   totals (loss and surplus at product_last_purchase_price);
-- * a reason per discrepancy line (receiving error, theft, spoilage, mis-sort);
-- * reads for the three cabinets: the chef's task board and task lines, the cook's own tasks, stats
--   and blind lines, the discrepancy report (now with closed tasks and reasons).
-- Cooks never receive expected quantities before the reveal rule allows it (see my_assignment_lines).
-- Idempotent.

do $$
begin
  if to_regclass('public.inventory_tasks') is null or to_regclass('public.task_assignees') is null
     or to_regprocedure('public.merge_task_count(uuid)') is null
     or to_regprocedure('public.approve_stock_count(uuid)') is null
     or to_regprocedure('public.member_has_branch(uuid, uuid, uuid)') is null
     or to_regprocedure('public.product_last_purchase_price(uuid)') is null then
    raise exception 'Run 20261023000000_inventory_tasks.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.inventory_tasks add column if not exists closed_at timestamptz;
alter table public.inventory_tasks add column if not exists closed_by uuid references public.profiles(id) on delete set null;
alter table public.inventory_tasks add column if not exists total_loss numeric;
alter table public.inventory_tasks add column if not exists total_surplus numeric;
alter table public.inventory_tasks drop constraint if exists inventory_tasks_status_check;
alter table public.inventory_tasks add constraint inventory_tasks_status_check
  check (status in ('pending', 'in_progress', 'completed', 'closed', 'cancelled'));

alter table public.stock_count_items add column if not exists discrepancy_reason text;
alter table public.stock_count_items drop constraint if exists stock_count_items_discrepancy_reason_check;
alter table public.stock_count_items add constraint stock_count_items_discrepancy_reason_check
  check (discrepancy_reason is null or discrepancy_reason in ('receiving_error', 'theft', 'spoilage', 'mis_sort'));
grant select (discrepancy_reason) on table public.stock_count_items to authenticated;

do $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_tasks' and column_name in ('tenant_id', 'closed_at')
  ) = 2 then
    create index if not exists idx_inventory_tasks_closed on public.inventory_tasks (tenant_id, closed_at desc) where closed_at is not null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Balance of a product in one storage place now.
create or replace function public.zone_balance(p_tenant_id uuid, p_location_id uuid, p_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ps.quantity), 0)
  from public.product_stocks ps
  where ps.tenant_id = p_tenant_id and ps.location_id = p_location_id and ps.product_id = p_product_id
$$;
revoke execute on function public.zone_balance(uuid, uuid, uuid) from public, anon, authenticated;

-- A closed task is closed for cooks too.
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
  where a.id = p_assignment_id and a.assignee_id = auth.uid()
    and a.tenant_id = public.current_tenant_id()
  for update;
  if v_row.id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.inventory_tasks
    where id = v_row.task_id and status in ('completed', 'closed', 'cancelled')
  ) then
    raise exception 'task_closed' using errcode = '55000';
  end if;
  return v_row;
end;
$$;
revoke execute on function public.my_task_assignment(uuid) from public, anon, authenticated;

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
  if v_task.id is null or not public.member_has_branch(auth.uid(), v_task.tenant_id, v_task.branch_id) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('completed', 'closed', 'cancelled') then
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
-- 3. Chef: board, counters, lines
-- ---------------------------------------------------------------------------
create or replace function public.inventory_task_board(
  p_branch_id uuid default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_task_id uuid default null
)
returns table (
  id uuid,
  title text,
  mode text,
  status text,
  branch_id uuid,
  branch_name text,
  created_at timestamptz,
  scheduled_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  total_loss numeric,
  total_surplus numeric,
  zones jsonb,
  assignees jsonb,
  submitted integer,
  assigned integer,
  total_count bigint
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
    select t.id, t.title, t.mode, t.status, t.branch_id, b.name, t.created_at, t.scheduled_at, t.completed_at,
      t.closed_at, t.total_loss, t.total_surplus,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'type', z.type) order by z.name, z.id)
        from (select distinct l.id, l.name, l.type from public.task_assignees a
              join public.storage_locations l on l.id = a.zone_id where a.task_id = t.id) z
      ), '[]'::jsonb),
      coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.assignee_id, 'email', p.email, 'status', a.status, 'zone_id', a.zone_id)
          order by p.email, a.id)
        from public.task_assignees a left join public.profiles p on p.id = a.assignee_id
        where a.task_id = t.id
      ), '[]'::jsonb),
      (select count(*)::integer from public.task_assignees a where a.task_id = t.id and a.status = 'submitted'),
      (select count(*)::integer from public.task_assignees a where a.task_id = t.id),
      count(*) over ()
    from public.inventory_tasks t
    join public.branches b on b.id = t.branch_id
    where t.tenant_id = v_tenant
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and (p_task_id is null or t.id = p_task_id)
      and public.member_has_branch(auth.uid(), v_tenant, t.branch_id)
    order by (t.status in ('pending', 'in_progress', 'completed')) desc, t.created_at desc, t.id
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 30), 1), 200);
end;
$$;
revoke execute on function public.inventory_task_board(uuid, integer, integer, uuid) from public, anon;
grant execute on function public.inventory_task_board(uuid, integer, integer, uuid) to authenticated;

-- Header counters of the chef cabinet: open tasks, finished since p_from, waiting to be closed.
create or replace function public.inventory_task_counts(p_branch_id uuid default null, p_from timestamptz default null)
returns table (active integer, finished integer, awaiting integer)
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
    select
      count(*) filter (where t.status in ('pending', 'in_progress'))::integer,
      count(*) filter (where t.status in ('completed', 'closed') and (p_from is null or t.completed_at >= p_from))::integer,
      count(*) filter (where t.status = 'completed')::integer
    from public.inventory_tasks t
    where t.tenant_id = v_tenant
      and (p_branch_id is null or t.branch_id = p_branch_id)
      and public.member_has_branch(auth.uid(), v_tenant, t.branch_id);
end;
$$;
revoke execute on function public.inventory_task_counts(uuid, timestamptz) from public, anon;
grant execute on function public.inventory_task_counts(uuid, timestamptz) to authenticated;

-- Every counted product of a task: expected (the merge snapshot, else the balance now), the merged
-- result, each assignee's count, the unit cost and the reason. Owner/chef only.
create or replace function public.inventory_task_lines(p_task_id uuid)
returns table (
  stock_count_id uuid,
  count_status text,
  zone_id uuid,
  zone_name text,
  zone_type text,
  product_id uuid,
  product_name text,
  unit text,
  expected_quantity numeric,
  counted_quantity numeric,
  counts jsonb,
  unit_cost numeric,
  discrepancy_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_task public.inventory_tasks;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_task from public.inventory_tasks where id = p_task_id and tenant_id = public.current_tenant_id();
  if v_task.id is null or not public.member_has_branch(auth.uid(), v_task.tenant_id, v_task.branch_id) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  return query
    with task_counts as (
      select distinct a.stock_count_id as id, a.zone_id from public.task_assignees a
      where a.task_id = v_task.id and a.stock_count_id is not null
    ),
    items as (
      select distinct tc.id as count_id, tc.zone_id, i.product_id
      from task_counts tc
      join public.stock_count_items i on i.stock_count_id = tc.id
      where i.user_id is null
        or i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = tc.id)
    )
    select it.count_id, c.status, l.id, l.name, l.type, p.id, p.name, p.unit,
      coalesce(m.system_quantity, public.zone_balance(v_task.tenant_id, it.zone_id, it.product_id)),
      m.counted_quantity,
      coalesce((
        select jsonb_agg(jsonb_build_object('user_id', i.user_id, 'email', pr.email, 'quantity', i.counted_quantity)
          order by pr.email, i.user_id)
        from public.stock_count_items i
        left join public.profiles pr on pr.id = i.user_id
        where i.stock_count_id = it.count_id and i.product_id = it.product_id
          and i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = it.count_id)
      ), '[]'::jsonb),
      coalesce(p.cost, public.product_last_purchase_price(p.id)),
      m.discrepancy_reason
    from items it
    join public.stock_counts c on c.id = it.count_id
    join public.storage_locations l on l.id = it.zone_id
    join public.products p on p.id = it.product_id
    left join public.stock_count_items m on m.stock_count_id = it.count_id and m.product_id = it.product_id and m.user_id is null
    order by l.name, p.name, p.id
    limit 5000;
end;
$$;
revoke execute on function public.inventory_task_lines(uuid) from public, anon;
grant execute on function public.inventory_task_lines(uuid) to authenticated;

-- The report now covers closed tasks too and returns the merged result and the reason.
drop function if exists public.inventory_discrepancy_lines(uuid, date, date, uuid);
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
  task_status text,
  branch_id uuid,
  completed_at timestamptz,
  stock_count_id uuid,
  count_status text,
  zone_id uuid,
  zone_name text,
  zone_type text,
  product_id uuid,
  product_name text,
  unit text,
  expected_quantity numeric,
  counted_quantity numeric,
  counts jsonb,
  unit_cost numeric,
  discrepancy_reason text
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
    select t.id, t.title, t.mode, t.status, t.branch_id, t.completed_at, c.id, c.status, l.id, l.name, l.type,
      p.id, p.name, p.unit, m.system_quantity, m.counted_quantity,
      coalesce((
        select jsonb_agg(jsonb_build_object('user_id', i.user_id, 'email', pr.email, 'quantity', i.counted_quantity)
          order by pr.email, i.user_id)
        from public.stock_count_items i
        left join public.profiles pr on pr.id = i.user_id
        where i.stock_count_id = c.id and i.product_id = m.product_id
          and i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = c.id)
      ), '[]'::jsonb),
      coalesce(p.cost, public.product_last_purchase_price(p.id)),
      m.discrepancy_reason
    from public.inventory_tasks t
    join (select distinct a.task_id, a.stock_count_id from public.task_assignees a) ta on ta.task_id = t.id
    join public.stock_counts c on c.id = ta.stock_count_id
    join public.storage_locations l on l.id = c.location_id
    join public.stock_count_items m on m.stock_count_id = c.id and m.user_id is null
    join public.products p on p.id = m.product_id
    where t.tenant_id = v_tenant
      and t.status in ('completed', 'closed')
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

-- Owner/chef: why a line differs. null clears it.
create or replace function public.set_discrepancy_reason(p_count_id uuid, p_product_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is not null and p_reason not in ('receiving_error', 'theft', 'spoilage', 'mis_sort') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.stock_count_items i
  set discrepancy_reason = p_reason
  from public.stock_counts c
  where c.id = i.stock_count_id and c.id = p_count_id and c.tenant_id = v_tenant
    and i.product_id = p_product_id and i.user_id is null
    and public.member_has_branch(auth.uid(), v_tenant, c.branch_id);
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_discrepancy_reason(uuid, uuid, text) from public, anon;
grant execute on function public.set_discrepancy_reason(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Close a task (owner/chef). Zones still counting are merged with what was sent, zones nobody
-- sent are cancelled; every merged zone is approved (stock = counted, 'count' movements at lot cost).
-- ---------------------------------------------------------------------------
create or replace function public.close_inventory_task(p_task_id uuid)
returns table (total_loss numeric, total_surplus numeric, movements integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_task public.inventory_tasks;
  v_count_id uuid;
  v_status text;
  v_moves integer := 0;
  v_counts uuid[] := '{}';
  v_loss numeric;
  v_surplus numeric;
begin
  if coalesce(public.current_member_role(), '') not in ('owner', 'chef') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_task from public.inventory_tasks
  where id = p_task_id and tenant_id = public.current_tenant_id()
  for update;
  if v_task.id is null or not public.member_has_branch(auth.uid(), v_task.tenant_id, v_task.branch_id) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.status in ('closed', 'cancelled') then
    raise exception 'task_closed' using errcode = '55000';
  end if;

  for v_count_id in
    select distinct a.stock_count_id from public.task_assignees a
    where a.task_id = v_task.id and a.stock_count_id is not null
  loop
    select status into v_status from public.stock_counts where id = v_count_id for update;
    if v_status in ('draft', 'counting') then
      if exists (
        select 1 from public.stock_count_items i
        where i.stock_count_id = v_count_id
          and i.user_id in (select a.assignee_id from public.task_assignees a where a.stock_count_id = v_count_id)
      ) then
        perform public.merge_task_count(v_count_id);
      else
        update public.stock_counts set status = 'cancelled' where id = v_count_id;
        continue;
      end if;
      select status into v_status from public.stock_counts where id = v_count_id;
    end if;
    if v_status = 'merging' then
      v_moves := v_moves + public.approve_stock_count(v_count_id);
      v_counts := array_append(v_counts, v_count_id);
    elsif v_status = 'approved' then
      v_counts := array_append(v_counts, v_count_id);
    end if;
  end loop;

  if cardinality(v_counts) = 0 then
    raise exception 'nothing_counted' using errcode = '55000';
  end if;

  select
    round(coalesce(sum(greatest(m.system_quantity - m.counted_quantity, 0) * coalesce(p.cost, public.product_last_purchase_price(m.product_id), 0)), 0), 2),
    round(coalesce(sum(greatest(m.counted_quantity - m.system_quantity, 0) * coalesce(p.cost, public.product_last_purchase_price(m.product_id), 0)), 0), 2)
  into v_loss, v_surplus
  from public.stock_count_items m
  join public.products p on p.id = m.product_id
  where m.stock_count_id = any (v_counts) and m.user_id is null and m.system_quantity is not null;

  update public.inventory_tasks
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), completed_at = coalesce(completed_at, now()),
      total_loss = v_loss, total_surplus = v_surplus
  where id = v_task.id;

  return query select v_loss, v_surplus, v_moves;
end;
$$;
revoke execute on function public.close_inventory_task(uuid) from public, anon;
grant execute on function public.close_inventory_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cook: own tasks, stats and blind lines
-- ---------------------------------------------------------------------------
create or replace function public.my_inventory_tasks()
returns table (
  assignment_id uuid,
  task_id uuid,
  title text,
  mode text,
  task_status text,
  status text,
  zone_id uuid,
  zone_name text,
  zone_type text,
  branch_id uuid,
  branch_name text,
  scheduled_at timestamptz,
  created_at timestamptz,
  submitted_at timestamptz,
  product_count integer,
  peers_total integer,
  peers_submitted integer
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, t.id, t.title, t.mode, t.status, a.status, l.id, l.name, l.type, t.branch_id, b.name,
    t.scheduled_at, t.created_at, a.submitted_at,
    (select count(*)::integer from public.products p
      where p.tenant_id = t.tenant_id
        and (p.storage_location_id = l.id
          or exists (select 1 from public.product_stocks ps where ps.product_id = p.id and ps.location_id = l.id))),
    (select count(*)::integer from public.task_assignees o where o.task_id = t.id and o.zone_id = a.zone_id and o.id <> a.id),
    (select count(*)::integer from public.task_assignees o
      where o.task_id = t.id and o.zone_id = a.zone_id and o.id <> a.id and o.status = 'submitted')
  from public.task_assignees a
  join public.inventory_tasks t on t.id = a.task_id
  join public.storage_locations l on l.id = a.zone_id
  join public.branches b on b.id = t.branch_id
  where a.assignee_id = auth.uid()
    and a.tenant_id = public.current_tenant_id()
    and t.status <> 'cancelled'
  order by (a.status = 'submitted'), coalesce(t.scheduled_at, t.created_at) desc, a.id
  limit 200
$$;
revoke execute on function public.my_inventory_tasks() from public, anon;
grant execute on function public.my_inventory_tasks() to authenticated;

-- open: assignments still to send; sent: assignments sent; accuracy: how close the caller's counts
-- were to the expected balance in closed tasks (null before the first closed task).
create or replace function public.my_inventory_stats()
returns table (open_count integer, sent_count integer, accuracy numeric)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select a.* from public.task_assignees a
    join public.inventory_tasks t on t.id = a.task_id
    where a.assignee_id = auth.uid() and a.tenant_id = public.current_tenant_id() and t.status <> 'cancelled'
  ),
  checked as (
    select i.counted_quantity as q, m.system_quantity as e
    from mine a
    join public.inventory_tasks t on t.id = a.task_id and t.status = 'closed'
    join public.stock_count_items i on i.stock_count_id = a.stock_count_id and i.user_id = a.assignee_id
    join public.stock_count_items m on m.stock_count_id = a.stock_count_id and m.product_id = i.product_id and m.user_id is null
    where m.system_quantity is not null
  )
  select
    (select count(*)::integer from mine where status <> 'submitted'),
    (select count(*)::integer from mine where status = 'submitted'),
    (select case when sum(greatest(abs(q), abs(e))) > 0
      then round(100 * greatest(1 - sum(abs(q - e)) / sum(greatest(abs(q), abs(e))), 0), 1) end
     from checked)
$$;
revoke execute on function public.my_inventory_stats() from public, anon;
grant execute on function public.my_inventory_stats() to authenticated;

-- The products of the caller's zone with the caller's own counts. The expected quantity is revealed
-- only when the task is closed, or in fast_zones (one cook per zone) once the caller has sent.
create or replace function public.my_assignment_lines(p_assignment_id uuid)
returns table (product_id uuid, name text, unit text, my_quantity numeric, expected_quantity numeric, revealed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_a public.task_assignees;
  v_task public.inventory_tasks;
  v_reveal boolean;
begin
  select * into v_a from public.task_assignees
  where id = p_assignment_id and assignee_id = auth.uid() and tenant_id = public.current_tenant_id();
  if v_a.id is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  select * into v_task from public.inventory_tasks where id = v_a.task_id;
  v_reveal := v_task.status = 'closed' or (v_task.mode = 'fast_zones' and v_a.status = 'submitted');

  return query
    with zone_products as (
      select p.id from public.products p
      where p.tenant_id = v_a.tenant_id
        and (p.storage_location_id = v_a.zone_id
          or exists (select 1 from public.product_stocks ps where ps.product_id = p.id and ps.location_id = v_a.zone_id))
      union
      select i.product_id from public.stock_count_items i
      where i.stock_count_id = v_a.stock_count_id and i.user_id = auth.uid()
    )
    select p.id, p.name, p.unit, mine.counted_quantity,
      case when v_reveal then coalesce(m.system_quantity, public.zone_balance(v_a.tenant_id, v_a.zone_id, p.id)) end,
      v_reveal
    from zone_products z
    join public.products p on p.id = z.id
    left join public.stock_count_items mine
      on mine.stock_count_id = v_a.stock_count_id and mine.product_id = p.id and mine.user_id = auth.uid()
    left join public.stock_count_items m
      on m.stock_count_id = v_a.stock_count_id and m.product_id = p.id and m.user_id is null
    order by p.name, p.id
    limit 2000;
end;
$$;
revoke execute on function public.my_assignment_lines(uuid) from public, anon;
grant execute on function public.my_assignment_lines(uuid) to authenticated;
