-- Reproducible, secret-free source contract for the environment-specific
-- queue-maintenance schedule. The caller supplies the function URL and secret
-- after migrations; neither value is stored in this repository.

create or replace function public.configure_byus_queue_maintenance(
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
    or p_function_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/queue-maintenance$' then
    raise exception 'a valid Supabase queue-maintenance function URL is required';
  end if;

  if p_cron_secret is null or length(p_cron_secret) < 32 then
    raise exception 'cron secret must contain at least 32 characters';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'byus_cron_secret'
  order by created_at desc
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      p_cron_secret,
      'byus_cron_secret',
      'ByUs queue-maintenance HTTP authentication secret'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      p_cron_secret,
      'byus_cron_secret',
      'ByUs queue-maintenance HTTP authentication secret'
    );
  end if;

  for existing_job_id in
    select jobid
    from cron.job
    where jobname in (
      'byus-reclaim-stale-blockchain-jobs',
      'byus-queue-maintenance-http'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  select cron.schedule(
    'byus-queue-maintenance-http',
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
            where name = 'byus_cron_secret'
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

revoke all on function public.configure_byus_queue_maintenance(text, text)
from public, anon, authenticated;
grant execute on function public.configure_byus_queue_maintenance(text, text)
to service_role;

