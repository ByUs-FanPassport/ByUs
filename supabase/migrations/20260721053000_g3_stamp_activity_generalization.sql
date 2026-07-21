-- G3 generalizes the G2 Knowledge-only stamp constraint without weakening the
-- existing ownership, activity-source, or blockchain queue invariants.

alter table public.stamps
  drop constraint stamps_stamp_type_check;

alter table public.stamps
  add constraint stamps_stamp_type_check
  check (stamp_type in ('knowledge', 'reservation', 'attendance', 'survey'));

create or replace function public.validate_fan_activity_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.activity_type = 'knowledge'
     and (
       new.source_type <> 'quiz_pass'
       or not exists (
         select 1 from public.quiz_passes
         where id = new.source_id
           and app_user_id = new.app_user_id
           and celebrity_id = new.celebrity_id
       )
     ) then
    raise exception 'knowledge activity must reference an owned quiz pass';
  elsif new.activity_type = 'reservation'
        and (
          new.source_type <> 'live_reservation'
          or not exists (
            select 1
            from public.live_reservations reservation
            join public.live_events live
              on live.id = reservation.live_event_id
             and live.celebrity_id = reservation.celebrity_id
            where reservation.id = new.source_id
              and reservation.app_user_id = new.app_user_id
              and reservation.celebrity_id = new.celebrity_id
              and live.celebrity_id = new.celebrity_id
          )
        ) then
    raise exception 'reservation activity must reference an owned live reservation for the same celebrity';
  end if;
  return new;
end;
$$;

create or replace function public.validate_stamp_activity_type()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_activity_type public.fan_activity_type;
begin
  select activity_type into strict linked_activity_type
  from public.fan_activities
  where id = new.activity_id
    and app_user_id = new.app_user_id
    and celebrity_id = new.celebrity_id;

  if new.stamp_type <> linked_activity_type::text then
    raise exception 'stamp type must exactly match activity type';
  end if;
  return new;
exception
  when no_data_found then
    raise exception 'stamp requires an owned activity for the same celebrity';
end;
$$;

drop trigger stamps_validate_knowledge_activity on public.stamps;
drop trigger stamps_validate_knowledge_activity_update on public.stamps;
drop function public.validate_knowledge_stamp_activity();

create trigger stamps_validate_activity_type
before insert on public.stamps
for each row execute function public.validate_stamp_activity_type();

create trigger stamps_validate_activity_type_update
before update on public.stamps
for each row execute function public.validate_stamp_activity_type();

-- The G2 validator accepted only the Knowledge worker payload. This v2 helper
-- receives the row's stamp type explicitly so INSERT validation remains exact.
create function public.assert_stamp_blockchain_job_link_v2(
  credential_id uuid,
  credential_owner_id uuid,
  credential_celebrity_id uuid,
  credential_stamp_type text,
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
  expected_stamp_type text;
  expected_mint_status public.credential_mint_status;
  expected_payload_keys integer := 4;
  actual_payload_keys integer;
  worker_submission_key_count integer;
begin
  if credential_stamp_type not in ('knowledge', 'reservation', 'attendance', 'survey') then
    raise exception 'unsupported stamp type';
  end if;

  if credential_job_id is null then
    if credential_mint_status <> 'queued'
       or credential_tx_hash is not null
       or credential_token_id is not null then
      raise exception 'unlinked credential must remain in canonical queued state';
    end if;
    return;
  end if;

  select * into job_record from public.blockchain_jobs where id = credential_job_id;
  if not found then raise exception 'credential blockchain job does not exist'; end if;
  if job_record.entity_type <> 'stamp' or job_record.entity_id <> credential_id then
    raise exception 'job entity does not match credential';
  end if;
  if job_record.payload_version <> 1 then
    raise exception 'job payload version must be 1';
  end if;

  select slug into strict celebrity_slug
  from public.celebrities where id = credential_celebrity_id;

  if job_record.operation_key <> 'byus:stamp:v1:' || credential_id::text then
    raise exception 'job operation key does not match credential';
  end if;

  job_payload := job_record.payload;
  if jsonb_typeof(job_payload) <> 'object' then
    raise exception 'job payload must be an object';
  end if;

  if job_payload ? 'workerSubmission' then
    expected_payload_keys := 5;
    if jsonb_typeof(job_payload -> 'workerSubmission') <> 'object' then
      raise exception 'job worker submission payload is invalid';
    end if;
    select count(*) into worker_submission_key_count
    from jsonb_object_keys(job_payload -> 'workerSubmission');
    if worker_submission_key_count <> 2
       or not ((job_payload -> 'workerSubmission') ?& array['txHash', 'signedTransaction'])
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'txHash') <> 'string'
       or jsonb_typeof(job_payload -> 'workerSubmission' -> 'signedTransaction') <> 'string'
       or coalesce(job_payload -> 'workerSubmission' ->> 'txHash', '') !~ '^0x[0-9a-fA-F]{64}$'
       or coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '') !~ '^0x[0-9a-fA-F]+$'
       or length(coalesce(job_payload -> 'workerSubmission' ->> 'signedTransaction', '')) > 262144 then
      raise exception 'job worker submission payload is invalid';
    end if;
  end if;

  select count(*) into actual_payload_keys from jsonb_object_keys(job_payload);
  if actual_payload_keys <> expected_payload_keys
     or not (job_payload ?& array['recipient', 'celebritySlug', 'issuanceId', 'stampType'])
     or jsonb_typeof(job_payload -> 'recipient') <> 'string'
     or jsonb_typeof(job_payload -> 'celebritySlug') <> 'string'
     or jsonb_typeof(job_payload -> 'issuanceId') <> 'string'
     or jsonb_typeof(job_payload -> 'stampType') <> 'string'
     or coalesce(job_payload ->> 'issuanceId', '') !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'job stamp payload is invalid';
  end if;

  expected_stamp_type := upper(left(credential_stamp_type, 1)) || substr(credential_stamp_type, 2);
  if job_payload ->> 'stampType' is distinct from expected_stamp_type then
    raise exception 'job stamp type does not match credential';
  end if;
  if job_payload ->> 'celebritySlug' is distinct from celebrity_slug then
    raise exception 'job celebrity slug does not match credential';
  end if;
  if coalesce(job_payload ->> 'recipient', '') !~ '^0x[0-9a-fA-F]{40}$'
     or not exists (
       select 1 from public.user_wallets
       where app_user_id = credential_owner_id
         and chain_id = 91342
         and provider = 'privy'
         and wallet_type = 'embedded'
         and address = lower(job_payload ->> 'recipient')
     ) then
    raise exception 'job recipient is not owned by credential owner';
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
     and (credential_tx_hash is distinct from job_record.tx_hash
          or credential_token_id is distinct from job_record.token_id) then
    raise exception 'job completion result does not match credential';
  elsif job_record.status <> 'COMPLETED'
        and (credential_tx_hash is not null or credential_token_id is not null) then
    raise exception 'non-completed credential cannot expose a mint result';
  end if;
end;
$$;

create or replace function public.validate_credential_blockchain_job_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'fan_passports' then
    perform public.assert_credential_blockchain_job_link(
      'passport', new.id, new.app_user_id, new.celebrity_id, new.mint_status,
      new.blockchain_job_id, new.tx_hash, new.token_id
    );
  else
    perform public.assert_stamp_blockchain_job_link_v2(
      new.id, new.app_user_id, new.celebrity_id, new.stamp_type, new.mint_status,
      new.blockchain_job_id, new.tx_hash, new.token_id
    );
  end if;
  return new;
end;
$$;

do $preflight$
declare
  credential record;
  activity record;
begin
  for activity in
    select * from public.fan_activities
    where activity_type in ('knowledge', 'reservation')
  loop
    if activity.activity_type = 'knowledge'
       and (
         activity.source_type <> 'quiz_pass'
         or not exists (
           select 1 from public.quiz_passes
           where id = activity.source_id
             and app_user_id = activity.app_user_id
             and celebrity_id = activity.celebrity_id
         )
       ) then
      raise exception 'existing knowledge activity source is invalid';
    elsif activity.activity_type = 'reservation'
          and (
            activity.source_type <> 'live_reservation'
            or not exists (
              select 1
              from public.live_reservations reservation
              join public.live_events live
                on live.id = reservation.live_event_id
               and live.celebrity_id = reservation.celebrity_id
              where reservation.id = activity.source_id
                and reservation.app_user_id = activity.app_user_id
                and reservation.celebrity_id = activity.celebrity_id
                and live.celebrity_id = activity.celebrity_id
            )
          ) then
      raise exception 'existing reservation activity source is invalid';
    end if;
  end loop;

  for credential in select * from public.stamps loop
    if not exists (
      select 1 from public.fan_activities activity
      where activity.id = credential.activity_id
        and activity.app_user_id = credential.app_user_id
        and activity.celebrity_id = credential.celebrity_id
        and activity.activity_type::text = credential.stamp_type
    ) then
      raise exception 'existing stamp activity type is invalid';
    end if;

    perform public.assert_stamp_blockchain_job_link_v2(
      credential.id, credential.app_user_id, credential.celebrity_id,
      credential.stamp_type, credential.mint_status,
      credential.blockchain_job_id, credential.tx_hash, credential.token_id
    );
  end loop;
end;
$preflight$;

revoke all on function public.validate_stamp_activity_type() from public, anon, authenticated;
revoke all on function public.assert_stamp_blockchain_job_link_v2(
  uuid, uuid, uuid, text, public.credential_mint_status, uuid, text, numeric
) from public, anon, authenticated;
