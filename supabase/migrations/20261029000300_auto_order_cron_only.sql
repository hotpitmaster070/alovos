-- alovos-auto-order (every 15 min, run_due_auto_orders(): the restaurant's own time, only when it switched
-- auto-order on) replaces the hourly alovos-auto-purchase-requests job of 20261016_parlevel_forecast.sql.
-- check_and_create_auto_requests*() stay for the manual "check now" button. The other jobs
-- (cleanup-empty-tenants, notify-expiring) are not touched. Without pg_cron nothing happens.
-- Run after 20261029000200_smart_settings_suppliers.sql. Idempotent.

do $$
begin
  if to_regprocedure('public.run_due_auto_orders()') is null then
    raise exception 'Run 20261029000200_smart_settings_suppliers.sql first';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.unschedule(jobid) from cron.job where jobname = 'alovos-auto-purchase-requests'$cron$;
    execute $cron$select cron.schedule('alovos-auto-order', '*/15 * * * *', 'select public.run_due_auto_orders()')$cron$;
  end if;
end;
$$;
