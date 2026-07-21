create or replace function public.get_infrastructure_health()
returns jsonb
language sql
stable
security definer
set search_path = public, storage, cron, vault, pg_catalog
as $$
  select jsonb_build_object(
    'blockchain_jobs_table', to_regclass('public.blockchain_jobs') is not null,
    'audit_logs_table', to_regclass('public.audit_logs') is not null,
    'pg_cron_extension', exists (
      select 1 from pg_extension where extname = 'pg_cron'
    ),
    'pg_net_extension', exists (
      select 1 from pg_extension where extname = 'pg_net'
    ),
    'vault_extension', exists (
      select 1 from pg_extension where extname = 'supabase_vault'
    ),
    'cms_assets_bucket', exists (
      select 1 from storage.buckets where id = 'cms-assets'
    ),
    'queue_maintenance_cron', exists (
      select 1 from cron.job where jobname = 'byus-queue-maintenance-http' and active
    ),
    'cron_vault_secret', exists (
      select 1 from vault.secrets where name = 'byus_cron_secret'
    )
  );
$$;

revoke all on function public.get_infrastructure_health() from public, anon, authenticated;
grant execute on function public.get_infrastructure_health() to service_role;
