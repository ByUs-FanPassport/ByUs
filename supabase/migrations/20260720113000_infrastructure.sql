create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create type public.blockchain_job_status as enum (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'RETRYING',
  'FAILED'
);

create table public.blockchain_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  entity_type text not null check (entity_type in ('passport', 'stamp')),
  entity_id uuid not null,
  operation_key text not null unique,
  payload_version integer not null default 1 check (payload_version > 0),
  payload jsonb not null default '{}'::jsonb,
  status public.blockchain_job_status not null default 'PENDING',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 32),
  idempotency_key uuid not null unique default extensions.gen_random_uuid(),
  tx_hash text,
  token_id numeric(78, 0),
  last_error_code text,
  last_error_message text,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint blockchain_jobs_completed_fields check (
    status <> 'COMPLETED'
    or (tx_hash is not null and token_id is not null and completed_at is not null)
  ),
  constraint blockchain_jobs_lease_fields check (
    status <> 'PROCESSING'
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create index blockchain_jobs_dispatch_idx
  on public.blockchain_jobs (status, next_attempt_at, created_at)
  where status in ('PENDING', 'RETRYING');
create index blockchain_jobs_stale_lease_idx
  on public.blockchain_jobs (lease_expires_at)
  where status = 'PROCESSING';
create index blockchain_jobs_entity_idx
  on public.blockchain_jobs (entity_type, entity_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_admin_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_after_summary jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger blockchain_jobs_set_updated_at
before update on public.blockchain_jobs
for each row execute function public.set_updated_at();

create or replace function public.claim_blockchain_jobs(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.blockchain_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'worker id is required';
  end if;
  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'batch size must be between 1 and 100';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 30 and 900';
  end if;

  return query
  with candidates as (
    select id
    from public.blockchain_jobs
    where status in ('PENDING', 'RETRYING')
      and next_attempt_at <= now()
      and attempts < max_attempts
    order by next_attempt_at, created_at
    for update skip locked
    limit p_batch_size
  )
  update public.blockchain_jobs jobs
  set status = 'PROCESSING',
      attempts = jobs.attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_error_code = null,
      last_error_message = null
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function public.complete_blockchain_job(
  p_job_id uuid,
  p_worker_id text,
  p_tx_hash text,
  p_token_id numeric
)
returns public.blockchain_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.blockchain_jobs;
begin
  update public.blockchain_jobs
  set status = 'COMPLETED',
      tx_hash = p_tx_hash,
      token_id = p_token_id,
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null
  where id = p_job_id
    and status = 'PROCESSING'
    and lease_owner = p_worker_id
    and lease_expires_at > now()
  returning * into result;

  if result.id is null then
    raise exception 'job lease is not active for this worker';
  end if;
  return result;
end;
$$;

create or replace function public.retry_blockchain_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns public.blockchain_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.blockchain_jobs;
begin
  update public.blockchain_jobs
  set status = case
        when p_retryable and attempts < max_attempts then 'RETRYING'::public.blockchain_job_status
        else 'FAILED'::public.blockchain_job_status
      end,
      next_attempt_at = case
        when p_retryable and attempts < max_attempts
          then now() + make_interval(secs => least(3600, (power(2, attempts)::integer * 15)))
        else next_attempt_at
      end,
      last_error_code = left(p_error_code, 120),
      last_error_message = left(p_error_message, 1000),
      lease_owner = null,
      lease_expires_at = null
  where id = p_job_id
    and status = 'PROCESSING'
    and lease_owner = p_worker_id
  returning * into result;

  if result.id is null then
    raise exception 'job lease is not owned by this worker';
  end if;
  return result;
end;
$$;

create or replace function public.reclaim_stale_blockchain_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reclaimed integer;
begin
  update public.blockchain_jobs
  set status = case
        when attempts < max_attempts then 'RETRYING'::public.blockchain_job_status
        else 'FAILED'::public.blockchain_job_status
      end,
      next_attempt_at = now(),
      last_error_code = 'LEASE_EXPIRED',
      last_error_message = 'Worker lease expired before completion',
      lease_owner = null,
      lease_expires_at = null
  where status = 'PROCESSING'
    and lease_expires_at <= now();
  get diagnostics reclaimed = row_count;
  return reclaimed;
end;
$$;

revoke all on public.blockchain_jobs from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on function public.claim_blockchain_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_blockchain_job(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.retry_blockchain_job(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.reclaim_stale_blockchain_jobs() from public, anon, authenticated;
grant all on public.blockchain_jobs to service_role;
grant select, insert on public.audit_logs to service_role;
grant execute on function public.claim_blockchain_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_blockchain_job(uuid, text, text, numeric) to service_role;
grant execute on function public.retry_blockchain_job(uuid, text, text, text, boolean) to service_role;
grant execute on function public.reclaim_stale_blockchain_jobs() to service_role;

alter table public.blockchain_jobs enable row level security;
alter table public.audit_logs enable row level security;

select cron.schedule(
  'byus-reclaim-stale-blockchain-jobs',
  '* * * * *',
  $$select public.reclaim_stale_blockchain_jobs();$$
)
where not exists (
  select 1 from cron.job where jobname = 'byus-reclaim-stale-blockchain-jobs'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cms-assets',
  'cms-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'video/mp4']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can read CMS assets"
on storage.objects for select
to public
using (bucket_id = 'cms-assets');

create policy "Service role manages CMS assets"
on storage.objects for all
to service_role
using (bucket_id = 'cms-assets')
with check (bucket_id = 'cms-assets');
