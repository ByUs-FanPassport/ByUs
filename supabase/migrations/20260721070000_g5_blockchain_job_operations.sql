-- G5 / ADM-011 blockchain job operations.
-- Operator reads are redacted at the database boundary. Manual retries retain
-- the original business operation, idempotency key and prepared transaction so
-- the worker's chain lookup/rebroadcast path remains the reconciliation gate.

create type public.blockchain_job_attempt_event as enum (
  'claimed',
  'completed',
  'retry_scheduled',
  'failed',
  'lease_expired',
  'admin_retry_requested'
);

create table public.blockchain_job_attempt_history (
  id bigint generated always as identity primary key,
  blockchain_job_id uuid not null references public.blockchain_jobs(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 0),
  event public.blockchain_job_attempt_event not null,
  from_status public.blockchain_job_status,
  to_status public.blockchain_job_status not null,
  safe_error_code text check (
    safe_error_code is null
    or (length(safe_error_code) between 1 and 120 and safe_error_code ~ '^[A-Z0-9_]+$')
  ),
  actor_app_user_id uuid references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint blockchain_job_attempt_history_admin_actor check (
    (event = 'admin_retry_requested' and actor_app_user_id is not null
      and actor_admin_allowlist_id is not null and correlation_id is not null)
    or
    (event <> 'admin_retry_requested' and actor_app_user_id is null
      and actor_admin_allowlist_id is null)
  )
);

create index blockchain_job_attempt_history_job_idx
  on public.blockchain_job_attempt_history (blockchain_job_id, created_at, id);

create function public.redact_blockchain_job_error_code(raw_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_code in (
      'GIWA_BROADCAST_FAILED', 'GIWA_PREPARE_FAILED', 'GIWA_RECEIPT_FAILED',
      'GIWA_RPC_READ_FAILED', 'GIWA_TRANSACTION_REVERTED',
      'INVALID_JOB_PAYLOAD', 'LEASE_EXPIRED', 'MINT_EVENT_NOT_FOUND',
      'MISSING_SIGNED_TRANSACTION', 'PINATA_INVALID_RESPONSE',
      'PINATA_UPLOAD_FAILED', 'QUEUE_DATABASE_ERROR', 'STALE_JOB_LEASE',
      'TRANSACTION_HASH_MISMATCH', 'UNEXPECTED_WORKER_ERROR',
      'UNSUPPORTED_PAYLOAD_VERSION'
    ) then raw_code
    when raw_code is null then null
    else 'UNKNOWN_JOB_ERROR'
  end;
$$;

create function public.reject_blockchain_job_attempt_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'blockchain job attempt history is append-only';
end;
$$;

create trigger blockchain_job_attempt_history_reject_update_delete
before update or delete on public.blockchain_job_attempt_history
for each row execute function public.reject_blockchain_job_attempt_history_mutation();

create trigger blockchain_job_attempt_history_reject_truncate
before truncate on public.blockchain_job_attempt_history
for each statement execute function public.reject_blockchain_job_attempt_history_mutation();

create function public.record_blockchain_job_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_kind public.blockchain_job_attempt_event;
  error_code text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  event_kind := case
    when new.status = 'PROCESSING' then 'claimed'::public.blockchain_job_attempt_event
    when new.status = 'COMPLETED' then 'completed'::public.blockchain_job_attempt_event
    when new.status = 'FAILED' then 'failed'::public.blockchain_job_attempt_event
    when new.status = 'RETRYING' and new.last_error_code = 'LEASE_EXPIRED'
      then 'lease_expired'::public.blockchain_job_attempt_event
    when new.status = 'RETRYING' then 'retry_scheduled'::public.blockchain_job_attempt_event
  end;

  -- Error messages are deliberately excluded. Only a bounded machine code can
  -- enter operational history or its later admin projection.
  if new.status in ('RETRYING', 'FAILED') then
    error_code := public.redact_blockchain_job_error_code(new.last_error_code);
  end if;

  insert into public.blockchain_job_attempt_history (
    blockchain_job_id, attempt_number, event, from_status, to_status, safe_error_code
  ) values (
    new.id, new.attempts, event_kind, old.status, new.status, error_code
  );
  return new;
end;
$$;

create trigger blockchain_jobs_record_attempt_transition
after update of status on public.blockchain_jobs
for each row
when (old.status is distinct from new.status)
execute function public.record_blockchain_job_attempt_transition();

-- A failed credential can only re-enter retryable through the reviewed admin
-- RPC below. The queue reconciliation trigger performs this projection after
-- the locked job transition; all other credential invariants remain unchanged.
create or replace function public.enforce_credential_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.app_user_id is distinct from old.app_user_id
     or new.celebrity_id is distinct from old.celebrity_id
     or new.business_status is distinct from old.business_status
     or new.issued_at is distinct from old.issued_at then
    raise exception 'credential identity and business fields are immutable';
  end if;

  if tg_table_name = 'fan_passports'
     and new.quiz_pass_id is distinct from old.quiz_pass_id then
    raise exception 'credential identity and business fields are immutable';
  end if;
  if tg_table_name = 'stamps'
     and (
       new.passport_id is distinct from old.passport_id
       or new.activity_id is distinct from old.activity_id
       or new.stamp_type is distinct from old.stamp_type
     ) then
    raise exception 'credential identity and business fields are immutable';
  end if;

  if old.blockchain_job_id is not null
     and new.blockchain_job_id is distinct from old.blockchain_job_id then
    raise exception 'credential blockchain job link is immutable once assigned';
  end if;
  if old.mint_status = 'minted' then
    raise exception 'minted credential is immutable';
  end if;

  if new.mint_status is distinct from old.mint_status
     and not (
       (old.mint_status = 'queued' and new.mint_status in ('processing', 'retryable', 'permanent_failure'))
       or (old.mint_status = 'processing' and new.mint_status in ('minted', 'retryable', 'permanent_failure'))
       or (old.mint_status = 'retryable' and new.mint_status in ('processing', 'permanent_failure'))
       or (old.mint_status = 'permanent_failure' and new.mint_status = 'retryable')
     ) then
    raise exception 'invalid credential mint status transition';
  end if;
  return new;
end;
$$;

create function public.assert_blockchain_job_admin_actor(
  target_actor_app_user_id uuid,
  target_actor_admin_allowlist_id uuid,
  mutation_required boolean
)
returns public.admin_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.admin_role;
begin
  select allowlist.role into actor_role
  from public.admin_allowlist allowlist
  join public.app_users actor
    on actor.id = target_actor_app_user_id
   and actor.status = 'active'
   and actor.verified_email = allowlist.email
  where allowlist.id = target_actor_admin_allowlist_id
    and allowlist.active
  for share of allowlist, actor;

  if actor_role is null then
    raise exception 'active matching administrator is required';
  end if;
  if mutation_required and actor_role = 'viewer' then
    raise exception 'viewer role is read-only';
  end if;
  return actor_role;
end;
$$;

create function public.get_admin_blockchain_jobs(
  target_actor_app_user_id uuid,
  target_actor_admin_allowlist_id uuid,
  target_job_id uuid default null,
  target_status public.blockchain_job_status default null,
  target_limit integer default 50,
  target_before_created_at timestamptz default null
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  status public.blockchain_job_status,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  transaction_reference text,
  chain_state text,
  safe_error_code text,
  safe_error_summary text,
  manually_retryable boolean,
  attempt_history jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_blockchain_job_admin_actor(
    target_actor_app_user_id, target_actor_admin_allowlist_id, false
  );
  if target_limit < 1 or target_limit > 100 then
    raise exception 'limit must be between 1 and 100';
  end if;

  return query
  select
    job.id,
    job.entity_type,
    job.entity_id,
    job.status,
    job.attempts,
    job.max_attempts,
    job.next_attempt_at,
    job.created_at,
    job.updated_at,
    job.completed_at,
    case when job.tx_hash is null then null
      else left(job.tx_hash, 10) || '…' || right(job.tx_hash, 8)
    end,
    case
      when job.status = 'COMPLETED' then 'confirmed'
      when job.tx_hash is not null then 'prepared_reconciliation_required'
      else 'not_submitted'
    end,
    public.redact_blockchain_job_error_code(job.last_error_code),
    case
      when job.last_error_code is null then null
      when job.last_error_code = 'LEASE_EXPIRED' then 'Worker lease expired before completion.'
      when job.last_error_code like 'GIWA_%' then 'Chain provider operation requires review.'
      when job.last_error_code like 'PINATA_%' then 'Metadata storage operation requires review.'
      when job.last_error_code in ('MISSING_SIGNED_TRANSACTION', 'MINT_EVENT_NOT_FOUND') then 'Chain reconciliation requires review.'
      else 'Job processing failed. Review the machine error code.'
    end,
    job.status in ('RETRYING', 'FAILED') and job.attempts < 32,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'attemptNumber', history.attempt_number,
        'event', history.event,
        'fromStatus', history.from_status,
        'toStatus', history.to_status,
        'errorCode', history.safe_error_code,
        'createdAt', history.created_at,
        'correlationId', history.correlation_id
      ) order by history.created_at, history.id)
      from public.blockchain_job_attempt_history history
      where history.blockchain_job_id = job.id
    ), '[]'::jsonb)
  from public.blockchain_jobs job
  where (target_job_id is null or job.id = target_job_id)
    and (target_status is null or job.status = target_status)
    and (target_before_created_at is null or job.created_at < target_before_created_at)
  order by job.created_at desc, job.id desc
  limit target_limit;
end;
$$;

create function public.admin_retry_blockchain_job(
  target_job_id uuid,
  target_actor_app_user_id uuid,
  target_actor_admin_allowlist_id uuid,
  target_correlation_id uuid
)
returns table (
  id uuid,
  status public.blockchain_job_status,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  chain_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_record public.blockchain_jobs%rowtype;
  original_status public.blockchain_job_status;
  original_operation_key text;
  original_idempotency_key uuid;
begin
  if target_job_id is null or target_correlation_id is null then
    raise exception 'job and correlation identifiers are required';
  end if;
  perform public.assert_blockchain_job_admin_actor(
    target_actor_app_user_id, target_actor_admin_allowlist_id, true
  );

  select * into job_record
  from public.blockchain_jobs
  where blockchain_jobs.id = target_job_id
  for update;
  if not found then raise exception 'blockchain job not found'; end if;
  if job_record.status not in ('RETRYING', 'FAILED') then
    raise exception 'only retryable or failed blockchain jobs can be retried';
  end if;
  if job_record.attempts >= 32 then
    raise exception 'blockchain job reached the absolute attempt limit';
  end if;

  original_operation_key := job_record.operation_key;
  original_idempotency_key := job_record.idempotency_key;
  original_status := job_record.status;

  update public.blockchain_jobs job
  set status = 'RETRYING',
      max_attempts = greatest(job.max_attempts, job.attempts + 1),
      next_attempt_at = now(),
      lease_owner = null,
      lease_expires_at = null
  where job.id = target_job_id
  returning * into job_record;

  if job_record.operation_key is distinct from original_operation_key
     or job_record.idempotency_key is distinct from original_idempotency_key then
    raise exception 'blockchain job business identity changed during retry';
  end if;

  insert into public.blockchain_job_attempt_history (
    blockchain_job_id, attempt_number, event, from_status, to_status,
    safe_error_code, actor_app_user_id, actor_admin_allowlist_id, correlation_id
  ) values (
    job_record.id, job_record.attempts, 'admin_retry_requested',
    original_status,
    'RETRYING',
    public.redact_blockchain_job_error_code(job_record.last_error_code),
    target_actor_app_user_id, target_actor_admin_allowlist_id, target_correlation_id
  );

  insert into public.audit_logs (
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    target_actor_app_user_id, target_actor_admin_allowlist_id,
    'blockchain_job.retry_requested', 'blockchain_job', job_record.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', original_status, 'attempts', job_record.attempts),
      'after', jsonb_build_object(
        'status', 'RETRYING',
        'chain_state', case when job_record.tx_hash is null then 'not_submitted' else 'prepared_reconciliation_required' end
      )
    ),
    target_correlation_id
  );

  return query select job_record.id, job_record.status, job_record.attempts,
    job_record.max_attempts, job_record.next_attempt_at,
    case when job_record.tx_hash is null then 'not_submitted' else 'prepared_reconciliation_required' end;
end;
$$;

alter table public.blockchain_job_attempt_history enable row level security;
revoke all on public.blockchain_job_attempt_history from public, anon, authenticated, service_role;
revoke all on function public.reject_blockchain_job_attempt_history_mutation() from public, anon, authenticated, service_role;
revoke all on function public.redact_blockchain_job_error_code(text) from public, anon, authenticated, service_role;
revoke all on function public.record_blockchain_job_attempt_transition() from public, anon, authenticated, service_role;
revoke all on function public.assert_blockchain_job_admin_actor(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_blockchain_jobs(uuid, uuid, uuid, public.blockchain_job_status, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_retry_blockchain_job(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_admin_blockchain_jobs(uuid, uuid, uuid, public.blockchain_job_status, integer, timestamptz) to service_role;
grant execute on function public.admin_retry_blockchain_job(uuid, uuid, uuid, uuid) to service_role;

comment on table public.blockchain_job_attempt_history is
  'Append-only redacted operational history. Raw errors, payloads, wallets, private keys, operation keys and signed transactions are forbidden.';
comment on function public.admin_retry_blockchain_job(uuid, uuid, uuid, uuid) is
  'Queues one reviewed retry while preserving the original operation/idempotency keys and prepared transaction for worker-side chain reconciliation.';
