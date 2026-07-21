-- Environment-specific bootstrap for the Supabase cron -> Edge Function ->
-- AWS Lambda invocation path. URLs and secrets are supplied after migration.

create or replace function public.configure_byus_worker_invocation(
  p_function_url text,
  p_cron_secret text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
  existing_job_id bigint;
  scheduled_job_id bigint;
begin
  if p_function_url is null
    or p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/invoke-mint-worker$' then
    raise exception 'a valid Supabase invoke-mint-worker function URL is required';
  end if;

  if p_cron_secret is null or length(p_cron_secret) < 32 then
    raise exception 'cron secret must contain at least 32 characters';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'byus_worker_cron_secret'
  order by created_at desc
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      p_cron_secret,
      'byus_worker_cron_secret',
      'ByUs mint-worker invocation authentication secret'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      p_cron_secret,
      'byus_worker_cron_secret',
      'ByUs mint-worker invocation authentication secret'
    );
  end if;

  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'byus-invoke-mint-worker-http'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  select cron.schedule(
    'byus-invoke-mint-worker-http',
    '* * * * *',
    format(
      $command$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-byus-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'byus_worker_cron_secret'
            order by created_at desc
            limit 1
          )
        ),
        body := '{}'::jsonb
      );
      $command$,
      p_function_url
    )
  ) into scheduled_job_id;

  return scheduled_job_id;
end;
$$;

revoke all on function public.configure_byus_worker_invocation(text, text)
from public, anon, authenticated;
grant execute on function public.configure_byus_worker_invocation(text, text)
to service_role;

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
    ),
    'worker_invocation_cron', exists (
      select 1 from cron.job where jobname = 'byus-invoke-mint-worker-http' and active
    ),
    'worker_cron_vault_secret', exists (
      select 1 from vault.secrets where name = 'byus_worker_cron_secret'
    )
  );
$$;

revoke all on function public.get_infrastructure_health() from public, anon, authenticated;
grant execute on function public.get_infrastructure_health() to service_role;
