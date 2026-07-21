-- G2 queue-to-credential reconciliation.
-- Existing worker RPCs remain the sole queue mutation boundary. These guards
-- validate credential links and make their mint projection transactional with
-- each blockchain_jobs status transition.

create function public.assert_credential_blockchain_job_link(
  credential_kind text,
  credential_id uuid,
  credential_owner_id uuid,
  credential_celebrity_id uuid,
  credential_mint_status public.credential_mint_status,
  credential_job_id uuid,
  credential_tx_hash text,
  credential_token_id numeric
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  job_record public.blockchain_jobs%rowtype;
  celebrity_slug text;
  job_payload jsonb;
  expected_operation_key text;
  expected_mint_status public.credential_mint_status;
  expected_payload_keys integer;
begin
  if credential_job_id is null then
    if credential_mint_status <> 'queued'
       or credential_tx_hash is not null
       or credential_token_id is not null then
      raise exception 'unlinked credential must remain in canonical queued state';
    end if;
    return;
  end if;

  select * into job_record
  from public.blockchain_jobs
  where id = credential_job_id;

  if not found then
    raise exception 'credential blockchain job does not exist';
  end if;

  if job_record.entity_type <> credential_kind
     or job_record.entity_id <> credential_id then
    raise exception 'job entity does not match credential';
  end if;

  if job_record.payload_version <> 1 then
    raise exception 'job payload version must be 1';
  end if;

  select slug into strict celebrity_slug
  from public.celebrities
  where id = credential_celebrity_id;

  expected_operation_key := case credential_kind
    when 'passport' then
      'byus:passport:v1:' || credential_owner_id::text || ':' || celebrity_slug
    when 'stamp' then
      'byus:stamp:v1:' || credential_id::text
    else null
  end;

  if expected_operation_key is null
     or job_record.operation_key <> expected_operation_key then
    raise exception 'job operation key does not match credential';
  end if;

  job_payload := job_record.payload;
  if jsonb_typeof(job_payload) <> 'object' then
    raise exception 'job payload must be an object';
  end if;

  expected_payload_keys := case credential_kind when 'passport' then 3 else 4 end;
  if job_payload ? 'workerSubmission' then
    expected_payload_keys := expected_payload_keys + 1;
    if jsonb_typeof(job_payload -> 'workerSubmission') <> 'object'
       or case
            when jsonb_typeof(job_payload -> 'workerSubmission') = 'object'
              then (select count(*) from jsonb_object_keys(job_payload -> 'workerSubmission'))
            else 0
          end <> 2
       or not ((job_payload -> 'workerSubmission') ?& array['txHash', 'signedTransaction'])
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'txHash') <> 'string'
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'signedTransaction') <> 'string'
       or coalesce(job_payload -> 'workerSubmission' ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
       or coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '') !~ '^0x[0-9a-fA-F]+$'
       or length(coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '')) > 262144 then
      raise exception 'job worker submission payload is invalid';
    end if;
  end if;

  if (select count(*) from jsonb_object_keys(job_payload)) <> expected_payload_keys then
    raise exception 'job payload contains unexpected fields';
  end if;

  if jsonb_typeof(job_payload -> 'celebritySlug') <> 'string'
     or job_payload ->> 'celebritySlug' is distinct from celebrity_slug then
    raise exception 'job celebrity slug does not match credential';
  end if;

  if jsonb_typeof(job_payload -> 'recipient') <> 'string'
     or coalesce(job_payload ->> 'recipient', '') !~ '^0x[0-9a-fA-F]{40}$'
     or not exists (
       select 1
       from public.user_wallets
       where app_user_id = credential_owner_id
         and chain_id = 91342
         and provider = 'privy'
         and wallet_type = 'embedded'
         and address = lower(job_payload ->> 'recipient')
     ) then
    raise exception 'job recipient is not owned by credential owner';
  end if;

  if credential_kind = 'passport' then
    if not (job_payload ?& array['recipient', 'celebritySlug', 'passportId'])
       or jsonb_typeof(job_payload -> 'passportId') <> 'string'
       or coalesce(job_payload ->> 'passportId', '') !~ '^0x[0-9a-fA-F]{64}$' then
      raise exception 'job passport payload is invalid';
    end if;
  elsif credential_kind = 'stamp' then
    if not (job_payload ?& array['recipient', 'celebritySlug', 'issuanceId', 'stampType'])
       or jsonb_typeof(job_payload -> 'issuanceId') <> 'string'
       or jsonb_typeof(job_payload -> 'stampType') <> 'string'
       or coalesce(job_payload ->> 'issuanceId', '') !~ '^0x[0-9a-fA-F]{64}$' then
      raise exception 'job stamp payload is invalid';
    end if;
    if job_payload ->> 'stampType' is distinct from 'Knowledge' then
      raise exception 'job knowledge stamp type is invalid';
    end if;
  else
    raise exception 'unsupported credential kind';
  end if;

  expected_mint_status := case job_record.status
    when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status
  end;

  if credential_mint_status <> expected_mint_status then
    raise exception 'credential mint status does not match queue status';
  end if;

  if job_record.status = 'COMPLETED'
     and (
       credential_tx_hash is distinct from job_record.tx_hash
       or credential_token_id is distinct from job_record.token_id
     ) then
    raise exception 'job completion result does not match credential';
  elsif job_record.status <> 'COMPLETED'
        and (credential_tx_hash is not null or credential_token_id is not null) then
    raise exception 'non-completed credential cannot expose a mint result';
  end if;
end;
$$;

create function public.validate_credential_blockchain_job_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_credential_blockchain_job_link(
    case tg_table_name when 'fan_passports' then 'passport' else 'stamp' end,
    new.id,
    new.app_user_id,
    new.celebrity_id,
    new.mint_status,
    new.blockchain_job_id,
    new.tx_hash,
    new.token_id
  );
  return new;
end;
$$;

create function public.enforce_linked_blockchain_job_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_linked boolean;
begin
  select exists (
    select 1 from public.fan_passports where blockchain_job_id = old.id
    union all
    select 1 from public.stamps where blockchain_job_id = old.id
  ) into is_linked;

  if not is_linked then
    return new;
  end if;

  if new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.operation_key is distinct from old.operation_key
     or new.payload_version is distinct from old.payload_version
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'linked blockchain job business identity is immutable';
  end if;

  if new.payload ? 'workerSubmission'
     and new.tx_hash is distinct from new.payload -> 'workerSubmission' ->> 'txHash' then
    raise exception 'linked blockchain job transaction hash conflicts with prepared submission';
  end if;

  if new.payload = old.payload then
    return new;
  end if;

  if old.payload ? 'workerSubmission'
     or not (new.payload ? 'workerSubmission')
     or new.payload - 'workerSubmission' <> old.payload
     or jsonb_typeof(new.payload -> 'workerSubmission') <> 'object'
     or case
          when jsonb_typeof(new.payload -> 'workerSubmission') = 'object'
            then (select count(*) from jsonb_object_keys(new.payload -> 'workerSubmission'))
          else 0
        end <> 2
     or not ((new.payload -> 'workerSubmission') ?& array['txHash', 'signedTransaction'])
     or jsonb_typeof(new.payload -> 'workerSubmission' -> 'txHash') <> 'string'
     or jsonb_typeof(new.payload -> 'workerSubmission' -> 'signedTransaction') <> 'string'
     or coalesce(new.payload -> 'workerSubmission' ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(new.payload -> 'workerSubmission' ->> 'signedTransaction', '') !~ '^0x[0-9a-fA-F]+$'
     or length(coalesce(new.payload -> 'workerSubmission' ->> 'signedTransaction', '')) > 262144
     or new.payload -> 'workerSubmission' ->> 'txHash' is distinct from new.tx_hash then
    raise exception 'linked blockchain job payload is immutable';
  end if;

  return new;
end;
$$;

create function public.reconcile_credential_from_blockchain_job()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_mint_status public.credential_mint_status;
  linked_count integer;
  affected_count integer;
begin
  select
    (select count(*) from public.fan_passports where blockchain_job_id = new.id)
    + (select count(*) from public.stamps where blockchain_job_id = new.id)
  into linked_count;

  if linked_count = 0 then
    -- unlinked legacy jobs are intentionally ignored
    return new;
  end if;
  if linked_count <> 1 then
    raise exception 'linked blockchain job credential mismatch';
  end if;

  expected_mint_status := case new.status
    when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status
  end;

  if new.entity_type = 'passport' then
    update public.fan_passports
    set mint_status = expected_mint_status,
        tx_hash = case when new.status = 'COMPLETED' then new.tx_hash else null end,
        token_id = case when new.status = 'COMPLETED' then new.token_id else null end
    where id = new.entity_id
      and blockchain_job_id = new.id;
  elsif new.entity_type = 'stamp' then
    update public.stamps
    set mint_status = expected_mint_status,
        tx_hash = case when new.status = 'COMPLETED' then new.tx_hash else null end,
        token_id = case when new.status = 'COMPLETED' then new.token_id else null end
    where id = new.entity_id
      and blockchain_job_id = new.id;
  end if;

  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception 'linked blockchain job credential mismatch';
  end if;
  return new;
end;
$$;

create function public.enforce_blockchain_job_enqueue_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payload ? 'workerSubmission' then
    raise exception 'worker submission can only be appended by the prepared transaction RPC';
  end if;
  return new;
end;
$$;

-- Refuse trigger installation when any already-linked row violates the new
-- contract. No data is repaired or inferred by this migration.
do $preflight$
declare
  credential record;
begin
  for credential in select * from public.fan_passports where blockchain_job_id is not null loop
    begin
      perform public.assert_credential_blockchain_job_link(
        'passport', credential.id, credential.app_user_id, credential.celebrity_id,
        credential.mint_status, credential.blockchain_job_id, credential.tx_hash,
        credential.token_id
      );
    exception when others then
      raise exception 'existing fan passport blockchain job link is invalid: %', sqlerrm;
    end;
  end loop;

  for credential in select * from public.stamps where blockchain_job_id is not null loop
    begin
      perform public.assert_credential_blockchain_job_link(
        'stamp', credential.id, credential.app_user_id, credential.celebrity_id,
        credential.mint_status, credential.blockchain_job_id, credential.tx_hash,
        credential.token_id
      );
    exception when others then
      raise exception 'existing stamp blockchain job link is invalid: %', sqlerrm;
    end;
  end loop;
end;
$preflight$;

create trigger fan_passports_validate_blockchain_job_link
before insert or update of blockchain_job_id, mint_status, tx_hash, token_id
on public.fan_passports
for each row execute function public.validate_credential_blockchain_job_link();

create trigger blockchain_jobs_enforce_enqueue_payload
before insert on public.blockchain_jobs
for each row execute function public.enforce_blockchain_job_enqueue_payload();

create trigger stamps_validate_blockchain_job_link
before insert or update of blockchain_job_id, mint_status, tx_hash, token_id
on public.stamps
for each row execute function public.validate_credential_blockchain_job_link();

create trigger blockchain_jobs_enforce_linked_immutability
before update on public.blockchain_jobs
for each row execute function public.enforce_linked_blockchain_job_immutability();

create trigger blockchain_jobs_reconcile_credential_status
after update of status on public.blockchain_jobs
for each row
when (old.status is distinct from new.status)
execute function public.reconcile_credential_from_blockchain_job();

revoke all on function public.assert_credential_blockchain_job_link(
  text, uuid, uuid, uuid, public.credential_mint_status, uuid, text, numeric
) from public, anon, authenticated;
revoke all on function public.validate_credential_blockchain_job_link() from public, anon, authenticated;
revoke all on function public.enforce_linked_blockchain_job_immutability() from public, anon, authenticated;
revoke all on function public.reconcile_credential_from_blockchain_job() from public, anon, authenticated;
revoke all on function public.enforce_blockchain_job_enqueue_payload() from public, anon, authenticated;

-- Worker queue mutations remain behind the existing SECURITY DEFINER RPCs.
-- Direct enqueue inputs remain available until the enqueue RPC lands. Queue
-- state, lease, result, error, identity, and timestamp columns must take their
-- database defaults and cannot be supplied or mutated through table writes.
revoke all on public.blockchain_jobs from service_role;
grant select on public.blockchain_jobs to service_role;
grant insert (
  entity_type,
  entity_id,
  operation_key,
  payload_version,
  payload,
  max_attempts,
  idempotency_key,
  next_attempt_at
) on public.blockchain_jobs to service_role;
