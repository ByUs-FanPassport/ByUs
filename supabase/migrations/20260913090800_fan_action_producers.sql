-- Atomically routes verified native service facts to the Fan Action lane.
-- Routes remain disabled until an explicit binding row is enabled.

alter table public.fan_passports add column fan_action_outbox_id uuid
  references public.fan_action_outbox(id) on delete restrict;
alter table public.stamps add column fan_action_outbox_id uuid
  references public.fan_action_outbox(id) on delete restrict;
alter table public.fan_reactions alter column blockchain_job_id drop not null;
alter table public.fan_reactions add column fan_action_outbox_id uuid
  references public.fan_action_outbox(id) on delete restrict;
alter table public.live_collectible_claims alter column blockchain_job_id drop not null;
alter table public.live_collectible_claims add column fan_action_outbox_id uuid
  references public.fan_action_outbox(id) on delete restrict;
alter table public.community_stamps alter column blockchain_job_id drop not null;
alter table public.community_stamps add column fan_action_outbox_id uuid
  references public.fan_action_outbox(id) on delete restrict;

alter table public.fan_passports add constraint fan_passports_exactly_one_chain_lane
  check ((blockchain_job_id is null) <> (fan_action_outbox_id is null)) not valid;
alter table public.stamps add constraint stamps_exactly_one_chain_lane
  check ((blockchain_job_id is null) <> (fan_action_outbox_id is null)) not valid;
alter table public.fan_reactions add constraint fan_reactions_exactly_one_chain_lane
  check ((blockchain_job_id is null) <> (fan_action_outbox_id is null)) not valid;
alter table public.live_collectible_claims add constraint live_collectible_claims_exactly_one_chain_lane
  check ((blockchain_job_id is null) <> (fan_action_outbox_id is null)) not valid;
alter table public.community_stamps add constraint community_stamps_exactly_one_chain_lane
  check ((blockchain_job_id is null) <> (fan_action_outbox_id is null)) not valid;

create unique index fan_passports_fan_action_outbox_once on public.fan_passports(fan_action_outbox_id)
  where fan_action_outbox_id is not null;
create unique index stamps_fan_action_entity_once on public.stamps(fan_action_outbox_id,id)
  where fan_action_outbox_id is not null;
create unique index fan_reactions_fan_action_outbox_once on public.fan_reactions(fan_action_outbox_id)
  where fan_action_outbox_id is not null;
create unique index live_collectible_claims_fan_action_outbox_once on public.live_collectible_claims(fan_action_outbox_id)
  where fan_action_outbox_id is not null;
create unique index community_stamps_fan_action_entity_once on public.community_stamps(fan_action_outbox_id,id)
  where fan_action_outbox_id is not null;

create function public.fan_action_native_enabled(p_action_code integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_enabled boolean;
begin
  if p_action_code not between 1 and 11 then raise exception 'FAN_ACTION_INVALID_CODE'; end if;
  select route.enabled into v_enabled from public.fan_action_producer_routes route
    where route.action_code=p_action_code for update;
  return coalesce(v_enabled,false);
end $$;
create function public.enqueue_fan_action_source(
  p_namespace text,p_source_key text,p_app_user_id uuid,p_creator_id uuid,p_campaign_id uuid,
  p_occurred_at timestamptz,p_action_code integer,p_credentials jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin raise exception 'FAN_ACTION_PRODUCER_NOT_INITIALIZED'; end $$;
create or replace function public.submit_owned_quiz_attempt(
  p_app_user_id uuid,
  p_attempt_id uuid,
  p_stamp_id uuid,
  p_passport_operation_key text,
  p_passport_credential_id text,
  p_stamp_operation_key text,
  p_stamp_issuance_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_record public.quiz_attempts%rowtype;
  celebrity_slug text;
  recipient text;
  question_count integer;
  answer_count integer;
  correct_count integer;
  expected_passport_operation_key text;
  expected_stamp_operation_key text;
  v_pass_id uuid := extensions.gen_random_uuid();
  v_passport_id uuid := extensions.gen_random_uuid();
  v_passport_job_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  v_stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  passport_record public.fan_passports%rowtype;
  stamp_record public.stamps%rowtype;
  expected_payload jsonb;
  recovered_passport_job boolean := false;
  v_native boolean := false;
  v_outbox_id uuid;
  v_occurred_at timestamptz := clock_timestamp();
begin
  perform 1 from public.app_users app_user
  where app_user.id = p_app_user_id and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G2_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.app_user_id = p_app_user_id
  for update;
  if not found then
    raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if attempt_record.status <> 'open' then
    return public.build_owned_quiz_submit_result(p_app_user_id, p_attempt_id);
  end if;

  select
    count(distinct question.id),
    count(answer.attempt_question_id),
    count(*) filter (where option.is_correct)
  into question_count, answer_count, correct_count
  from public.quiz_attempt_questions question
  left join public.quiz_attempt_answers answer
    on answer.attempt_id = attempt_record.id
   and answer.attempt_question_id = question.id
  left join public.quiz_attempt_options option
    on option.id = answer.selected_option_id
   and option.attempt_question_id = question.id
  where question.attempt_id = attempt_record.id;
  if question_count <> 3 or answer_count <> 3 then
    raise exception 'G2_ATTEMPT_INCOMPLETE' using errcode = '55000';
  end if;

  if correct_count < 2 then
    update public.quiz_attempts
    set status = 'failed', score = correct_count, submitted_at = now()
    where id = attempt_record.id;
    return public.build_owned_quiz_submit_result(p_app_user_id, p_attempt_id);
  end if;

  select celebrity.slug into strict celebrity_slug
  from public.celebrities celebrity
  where celebrity.id = attempt_record.celebrity_id
  for key share;

  select wallet.address into recipient
  from public.user_wallets wallet
  where wallet.app_user_id = p_app_user_id
    and wallet.chain_id = 91342
    and wallet.provider = 'privy'
    and wallet.wallet_type = 'embedded'
  for key share;
  if not found then
    raise exception 'G2_WALLET_NOT_READY' using errcode = '55000';
  end if;

  expected_passport_operation_key :=
    'byus:passport:v1:' || p_app_user_id::text || ':' || celebrity_slug;
  expected_stamp_operation_key := 'byus:stamp:v1:' || p_stamp_id::text;
  if p_stamp_id is null
     or p_passport_operation_key is distinct from expected_passport_operation_key
     or p_stamp_operation_key is distinct from expected_stamp_operation_key
     or p_passport_credential_id is null
     or p_stamp_issuance_id is null
     or p_passport_credential_id !~ '^0x[0-9a-f]{64}$'
     or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G2_ISSUANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.quiz_passes pass
    where pass.app_user_id = p_app_user_id
      and pass.celebrity_id = attempt_record.celebrity_id
  ) or exists (
    select 1 from public.fan_passports passport
    where passport.app_user_id = p_app_user_id
      and passport.celebrity_id = attempt_record.celebrity_id
  ) then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  update public.quiz_attempts
  set status = 'passed', score = correct_count, submitted_at = v_occurred_at
  where id = attempt_record.id;

  insert into public.quiz_passes(
    id, app_user_id, celebrity_id, winning_attempt_id, passed_at
  ) values (
    v_pass_id, p_app_user_id, attempt_record.celebrity_id, attempt_record.id, v_occurred_at
  )
  on conflict (app_user_id, celebrity_id) do nothing;
  if not exists (
    select 1 from public.quiz_passes pass
    where pass.id = v_pass_id
      and pass.app_user_id = p_app_user_id
      and pass.celebrity_id = attempt_record.celebrity_id
      and pass.winning_attempt_id = attempt_record.id
  ) then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'passportId', p_passport_credential_id
  );

  v_native:=public.fan_action_native_enabled(1);
  if v_native then
    v_outbox_id:=public.enqueue_fan_action_source('quiz_passes',v_pass_id::text,p_app_user_id,
      attempt_record.celebrity_id,null,v_occurred_at,1,jsonb_build_array(
        jsonb_build_object('entityType','passport','entityId',v_passport_id,'kind',0,
          'issuanceKey',p_passport_credential_id,'operationKey',p_passport_operation_key,'legacyPayload',expected_payload),
        jsonb_build_object('entityType','stamp','entityId',p_stamp_id,'kind',1,
          'issuanceKey',p_stamp_issuance_id,'operationKey',p_stamp_operation_key,
          'legacyPayload',jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,
            'issuanceId',p_stamp_issuance_id,'stampType','Knowledge'))));
    insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id,fan_action_outbox_id)
      values(v_passport_id,p_app_user_id,attempt_record.celebrity_id,v_pass_id,null,v_outbox_id);
  else
    -- Older flows could finish the on-chain Passport job without retaining the
    -- relational Passport. Reconcile only a completed, exact canonical job.
    select * into job_record
    from public.blockchain_jobs job
    where job.operation_key = p_passport_operation_key
    for update;

    if found then
      if job_record.entity_type <> 'passport'
         or job_record.payload_version <> 1
         or (job_record.payload - 'workerSubmission') - 'recipient' <> expected_payload - 'recipient'
         or lower(job_record.payload ->> 'recipient') is distinct from lower(expected_payload ->> 'recipient')
         or job_record.status <> 'COMPLETED'
         or job_record.tx_hash is null
         or job_record.tx_hash !~ '^0x[0-9a-fA-F]{64}$'
         or job_record.token_id is null
         or job_record.token_id <= 0
         or exists (
           select 1 from public.fan_passports existing
           where existing.id = job_record.entity_id
              or existing.blockchain_job_id = job_record.id
         ) then
        raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
      end if;
      recovered_passport_job := true;
      v_passport_id := job_record.entity_id;
      v_passport_job_id := job_record.id;
    else
      insert into public.blockchain_jobs(
        id, entity_type, entity_id, operation_key, payload_version, payload
      ) values (
        v_passport_job_id, 'passport', v_passport_id,
        p_passport_operation_key, 1, expected_payload
      );

      select * into job_record from public.blockchain_jobs job
      where job.id = v_passport_job_id
      for update;
      if not found
         or job_record.entity_type <> 'passport'
         or job_record.entity_id <> v_passport_id
         or job_record.payload_version <> 1
         or job_record.payload <> expected_payload
         or job_record.status <> 'PENDING' then
        raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
      end if;
    end if;

    insert into public.fan_passports(
      id, app_user_id, celebrity_id, quiz_pass_id, blockchain_job_id,
      mint_status, tx_hash, token_id
    ) values (
      v_passport_id, p_app_user_id, attempt_record.celebrity_id, v_pass_id, v_passport_job_id,
      case when recovered_passport_job then 'minted'::public.credential_mint_status
           else 'queued'::public.credential_mint_status end,
      case when recovered_passport_job then job_record.tx_hash end,
      case when recovered_passport_job then job_record.token_id end
    )
    on conflict (app_user_id, celebrity_id) do nothing;
    select * into passport_record from public.fan_passports passport
    where passport.app_user_id = p_app_user_id
      and passport.celebrity_id = attempt_record.celebrity_id
    for update;
    if not found
       or passport_record.id <> v_passport_id
       or passport_record.quiz_pass_id <> v_pass_id
       or passport_record.blockchain_job_id <> v_passport_job_id
       or passport_record.mint_status <> (
         case when recovered_passport_job then 'minted'::public.credential_mint_status
              else 'queued'::public.credential_mint_status end
       )
       or passport_record.tx_hash is distinct from (
         case when recovered_passport_job then job_record.tx_hash end
       )
       or passport_record.token_id is distinct from (
         case when recovered_passport_job then job_record.token_id end
       ) then
      raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
    end if;
  end if;

  select * into passport_record from public.fan_passports passport
  where passport.app_user_id=p_app_user_id and passport.celebrity_id=attempt_record.celebrity_id for update;
  if not found or passport_record.id<>v_passport_id or passport_record.quiz_pass_id<>v_pass_id
    or (v_native and (passport_record.fan_action_outbox_id<>v_outbox_id or passport_record.blockchain_job_id is not null))
    or (not v_native and passport_record.blockchain_job_id<>v_passport_job_id) then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode='23514';
  end if;

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, attempt_record.celebrity_id,
    'knowledge', 'quiz_pass', v_pass_id
  )
  on conflict (activity_type, source_type, source_id) do nothing;
  if not exists (
    select 1 from public.fan_activities activity
    where activity.id = v_activity_id
      and activity.app_user_id = p_app_user_id
      and activity.celebrity_id = attempt_record.celebrity_id
      and activity.activity_type = 'knowledge'
      and activity.source_type = 'quiz_pass'
      and activity.source_id = v_pass_id
  ) then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  insert into public.fan_score_ledger(
    activity_id, app_user_id, celebrity_id, points
  ) values (
    v_activity_id, p_app_user_id, attempt_record.celebrity_id, 1
  )
  on conflict (activity_id) do nothing;
  if not exists (
    select 1 from public.fan_score_ledger score
    where score.activity_id = v_activity_id
      and score.app_user_id = p_app_user_id
      and score.celebrity_id = attempt_record.celebrity_id
      and score.points = 1
  ) then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'issuanceId', p_stamp_issuance_id,
    'stampType', 'Knowledge'
  );
  if v_native then
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id,fan_action_outbox_id)
      values(p_stamp_id,p_app_user_id,attempt_record.celebrity_id,v_passport_id,v_activity_id,'knowledge',null,v_outbox_id)
      on conflict(passport_id,activity_id,stamp_type) do nothing;
  else
    insert into public.blockchain_jobs(
      id, entity_type, entity_id, operation_key, payload_version, payload
    ) values (
      v_stamp_job_id, 'stamp', p_stamp_id,
      p_stamp_operation_key, 1, expected_payload
    )
    on conflict (operation_key) do nothing;
    select * into job_record from public.blockchain_jobs job
    where job.operation_key = p_stamp_operation_key
    for update;
    if not found
       or job_record.id <> v_stamp_job_id
       or job_record.entity_type <> 'stamp'
       or job_record.entity_id <> p_stamp_id
       or job_record.payload_version <> 1
       or job_record.payload <> expected_payload
       or job_record.status <> 'PENDING' then
      raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
    end if;

    insert into public.stamps(
      id, app_user_id, celebrity_id, passport_id, activity_id,
      stamp_type, blockchain_job_id
    ) values (
      p_stamp_id, p_app_user_id, attempt_record.celebrity_id,
      v_passport_id, v_activity_id, 'knowledge', v_stamp_job_id
    )
    on conflict (passport_id, activity_id, stamp_type) do nothing;
    select * into stamp_record from public.stamps stamp
    where stamp.passport_id = v_passport_id
      and stamp.activity_id = v_activity_id
      and stamp.stamp_type = 'knowledge'
    for update;
    if not found
       or stamp_record.id <> p_stamp_id
       or stamp_record.app_user_id <> p_app_user_id
       or stamp_record.celebrity_id <> attempt_record.celebrity_id
       or stamp_record.blockchain_job_id <> v_stamp_job_id
       or stamp_record.mint_status <> 'queued' then
      raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
    end if;
  end if;
  select * into stamp_record from public.stamps stamp where stamp.passport_id=v_passport_id
    and stamp.activity_id=v_activity_id and stamp.stamp_type='knowledge' for update;
  if not found or stamp_record.id<>p_stamp_id or stamp_record.app_user_id<>p_app_user_id
    or stamp_record.celebrity_id<>attempt_record.celebrity_id
    or (v_native and (stamp_record.fan_action_outbox_id<>v_outbox_id or stamp_record.blockchain_job_id is not null))
    or (not v_native and stamp_record.blockchain_job_id<>v_stamp_job_id)
    or stamp_record.mint_status<>'queued' then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode='23514';
  end if;

  return public.build_owned_quiz_submit_result(p_app_user_id, p_attempt_id);
end;
$$;

create or replace function public.build_owned_quiz_submit_result(p_app_user_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt_record public.quiz_attempts%rowtype;result jsonb;aggregate_count integer;
begin
  select * into attempt_record from public.quiz_attempts attempt
    where attempt.id=p_attempt_id and attempt.app_user_id=p_app_user_id;
  if not found then raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode='P0002'; end if;
  if attempt_record.status='open' then raise exception 'G2_ATTEMPT_CLOSED' using errcode='55000'; end if;
  if attempt_record.status='failed' then
    return jsonb_build_object('attempt',jsonb_build_object('id',attempt_record.id,'status',attempt_record.status,
      'score',attempt_record.score,'submittedAt',attempt_record.submitted_at),'issuance',null);
  end if;
  select count(*) into aggregate_count from public.quiz_passes pass
  join public.fan_passports passport on passport.quiz_pass_id=pass.id and passport.app_user_id=pass.app_user_id
    and passport.celebrity_id=pass.celebrity_id and passport.business_status='issued'
  join public.fan_activities activity on activity.app_user_id=pass.app_user_id and activity.celebrity_id=pass.celebrity_id
    and activity.activity_type='knowledge' and activity.source_type='quiz_pass' and activity.source_id=pass.id
  join public.fan_score_ledger score on score.activity_id=activity.id and score.app_user_id=activity.app_user_id
    and score.celebrity_id=activity.celebrity_id and score.points=1
  join public.stamps stamp on stamp.passport_id=passport.id and stamp.activity_id=activity.id
    and stamp.app_user_id=passport.app_user_id and stamp.celebrity_id=passport.celebrity_id
    and stamp.stamp_type='knowledge' and stamp.business_status='issued'
  where pass.winning_attempt_id=attempt_record.id and pass.app_user_id=p_app_user_id
    and ((passport.blockchain_job_id is not null and passport.fan_action_outbox_id is null)
      or (passport.blockchain_job_id is null and passport.fan_action_outbox_id is not null))
    and ((stamp.blockchain_job_id is not null and stamp.fan_action_outbox_id is null)
      or (stamp.blockchain_job_id is null and stamp.fan_action_outbox_id=passport.fan_action_outbox_id));
  if aggregate_count<>1 then raise exception 'G2_ISSUANCE_INCOMPLETE' using errcode='23514'; end if;
  select jsonb_build_object('attempt',jsonb_build_object('id',attempt_record.id,'status',attempt_record.status,
    'score',attempt_record.score,'submittedAt',attempt_record.submitted_at),
    'issuance',jsonb_build_object('passportId',passport.id,'stampId',stamp.id,'scorePoints',score.points)) into result
  from public.quiz_passes pass join public.fan_passports passport on passport.quiz_pass_id=pass.id
  join public.fan_activities activity on activity.activity_type='knowledge' and activity.source_type='quiz_pass' and activity.source_id=pass.id
  join public.fan_score_ledger score on score.activity_id=activity.id
  join public.stamps stamp on stamp.passport_id=passport.id and stamp.activity_id=activity.id and stamp.stamp_type='knowledge'
  where pass.winning_attempt_id=attempt_record.id and pass.app_user_id=p_app_user_id;
  return result;
end $$;

revoke all on function public.submit_owned_quiz_attempt(uuid,uuid,uuid,text,text,text,text),
  public.build_owned_quiz_submit_result(uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_owned_quiz_attempt(uuid,uuid,uuid,text,text,text,text) to service_role;
create or replace function public.attend_owned_live_event(
  p_app_user_id uuid,
  p_live_slug text,
  p_idempotency_key uuid,
  p_normalized_code text,
  p_stamp_id uuid,
  p_stamp_operation_key text,
  p_stamp_issuance_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_record public.live_events%rowtype;
  existing_attendance public.live_attendances%rowtype;
  passport_record public.fan_passports%rowtype;
  celebrity_slug text;
  recipient text;
  expected_stamp_operation_key text;
  expected_payload jsonb;
  v_attendance_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  v_stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  stamp_record public.stamps%rowtype;
  result jsonb;
  v_outbox_id uuid;
  v_occurred_at timestamptz := clock_timestamp();
begin
  if p_app_user_id is null
     or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_idempotency_key is null
     or p_normalized_code is null
     or p_normalized_code !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'G3_ATTENDANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g3:attendance:key:' || p_idempotency_key::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g3:attendance:target:' || p_app_user_id::text || ':' || p_live_slug,
      0
    )
  );

  select attendance.* into existing_attendance
  from public.live_attendances attendance
  join public.live_events live on live.id = attendance.live_event_id
  where attendance.idempotency_key = p_idempotency_key
  for update of attendance;
  if found then
    if existing_attendance.app_user_id <> p_app_user_id
       or not exists (
         select 1 from public.live_events live
         where live.id = existing_attendance.live_event_id
           and live.slug = p_live_slug
       ) then
      raise exception 'G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    result := public.build_owned_live_attendance_result(p_app_user_id, existing_attendance.id);
    if result is null then
      raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  select attendance.* into existing_attendance
  from public.live_attendances attendance
  join public.live_events live on live.id = attendance.live_event_id
  where attendance.app_user_id = p_app_user_id
    and live.slug = p_live_slug
  for update of attendance;
  if found then
    result := public.build_owned_live_attendance_result(p_app_user_id, existing_attendance.id);
    if result is null then
      raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  perform 1
  from public.app_users app_user
  where app_user.id = p_app_user_id
    and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G3_ATTENDANCE_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select live.* into live_record
  from public.live_events live
  where live.slug = p_live_slug
    and live.publication_status = 'published'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_LIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select passport.* into passport_record
  from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = live_record.celebrity_id
    and passport.business_status = 'issued'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_PASSPORT_REQUIRED' using errcode = '42501';
  end if;

  -- Deliberately independent of reservation, current clock, and live lifecycle.
  -- crypt() performs a salted verifier comparison without persisting plaintext.
  if live_record.fan_code_hash !~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
     or extensions.crypt(p_normalized_code, live_record.fan_code_hash)
        is distinct from live_record.fan_code_hash then
    raise exception 'G3_ATTENDANCE_CODE_INVALID' using errcode = '22023';
  end if;

  select wallet.address into recipient
  from public.user_wallets wallet
  where wallet.app_user_id = p_app_user_id
    and wallet.chain_id = 91342
    and wallet.provider = 'privy'
    and wallet.wallet_type = 'embedded'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_WALLET_NOT_READY' using errcode = '55000';
  end if;

  select celebrity.slug into strict celebrity_slug
  from public.celebrities celebrity
  where celebrity.id = live_record.celebrity_id
  for key share;

  expected_stamp_operation_key := 'byus:stamp:v1:' || p_stamp_id::text;
  if p_stamp_id is null
     or p_stamp_operation_key is distinct from expected_stamp_operation_key
     or p_stamp_issuance_id is null
     or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G3_ATTENDANCE_ISSUANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.live_attendances(
    id, app_user_id, live_event_id, celebrity_id, passport_id, idempotency_key, attended_at
  ) values (
    v_attendance_id, p_app_user_id, live_record.id, live_record.celebrity_id,
    passport_record.id, p_idempotency_key, v_occurred_at
  );

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id,
    'attendance', 'live_attendance', v_attendance_id
  );

  insert into public.fan_score_ledger(activity_id, app_user_id, celebrity_id, points)
  values (v_activity_id, p_app_user_id, live_record.celebrity_id, 3);

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'issuanceId', p_stamp_issuance_id,
    'stampType', 'Attendance'
  );
  if public.fan_action_native_enabled(3) then
    v_outbox_id:=public.enqueue_fan_action_source('live_attendances',v_attendance_id::text,p_app_user_id,
      live_record.celebrity_id,live_record.id,v_occurred_at,3,jsonb_build_array(jsonb_build_object(
        'entityType','stamp','entityId',p_stamp_id,'kind',1,'issuanceKey',p_stamp_issuance_id,
        'operationKey',p_stamp_operation_key,'legacyPayload',expected_payload)));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id,fan_action_outbox_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,v_activity_id,'attendance',null,v_outbox_id);
  else
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
      values(v_stamp_job_id,'stamp',p_stamp_id,p_stamp_operation_key,1,expected_payload) on conflict(operation_key) do nothing;
    select job.* into job_record from public.blockchain_jobs job where job.operation_key=p_stamp_operation_key for update;
    if not found or job_record.id<>v_stamp_job_id or job_record.entity_type<>'stamp'
       or job_record.entity_id<>p_stamp_id or job_record.payload_version<>1
       or job_record.payload<>expected_payload or job_record.status<>'PENDING' then
      raise exception 'G3_ATTENDANCE_ISSUANCE_CONFLICT' using errcode='23514'; end if;
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,v_activity_id,'attendance',v_stamp_job_id);
  end if;

  select stamp.* into strict stamp_record from public.stamps stamp
  where stamp.id=p_stamp_id and stamp.app_user_id=p_app_user_id and stamp.celebrity_id=live_record.celebrity_id
    and stamp.passport_id=passport_record.id and stamp.activity_id=v_activity_id and stamp.stamp_type='attendance'
    and ((v_outbox_id is not null and stamp.fan_action_outbox_id=v_outbox_id and stamp.blockchain_job_id is null)
      or (v_outbox_id is null and stamp.blockchain_job_id=v_stamp_job_id and stamp.fan_action_outbox_id is null))
    and stamp.mint_status='queued';

  result := public.build_owned_live_attendance_result(p_app_user_id, v_attendance_id);
  if result is null then
    raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
  end if;
  return result;
end;
$$;
create or replace function public.reserve_owned_live_event(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_idempotency_key uuid,
  p_stamp_id uuid,
  p_stamp_operation_key text,
  p_stamp_issuance_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_record public.live_events%rowtype;
  existing_reservation public.live_reservations%rowtype;
  passport_record public.fan_passports%rowtype;
  effective_status public.live_content_status;
  celebrity_slug text;
  recipient text;
  expected_stamp_operation_key text;
  expected_payload jsonb;
  v_reservation_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  v_stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  stamp_record public.stamps%rowtype;
  result jsonb;
  v_outbox_id uuid;
  v_occurred_at timestamptz := clock_timestamp();
begin
  if p_app_user_id is null
     or p_live_event_id is null
     or p_idempotency_key is null then
    raise exception 'G3_RESERVATION_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Serialize both global key reuse and the owner/event uniqueness race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g3:reservation:key:' || p_idempotency_key::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g3:reservation:target:' || p_app_user_id::text || ':' || p_live_event_id::text,
      0
    )
  );

  select reservation.* into existing_reservation
  from public.live_reservations reservation
  where reservation.idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_reservation.app_user_id <> p_app_user_id
       or existing_reservation.live_event_id <> p_live_event_id then
      raise exception 'G3_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    result := public.build_owned_live_reservation_result(
      p_app_user_id, existing_reservation.id
    );
    if result is null then
      raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  -- A retry with a fresh transport key still observes the already-issued
  -- business result and never evaluates expired availability again.
  select reservation.* into existing_reservation
  from public.live_reservations reservation
  where reservation.app_user_id = p_app_user_id
    and reservation.live_event_id = p_live_event_id
  for update;
  if found then
    result := public.build_owned_live_reservation_result(
      p_app_user_id, existing_reservation.id
    );
    if result is null then
      raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  perform 1
  from public.app_users app_user
  where app_user.id = p_app_user_id
    and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G3_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select live.* into live_record
  from public.live_events live
  where live.id = p_live_event_id
  for update;
  if not found then
    raise exception 'G3_LIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select override.effective_status into effective_status
  from public.live_status_overrides override
  where override.live_event_id = live_record.id
    and override.effective_from <= pg_catalog.now()
    and (override.effective_until is null or pg_catalog.now() < override.effective_until)
  order by override.effective_from desc, override.created_at desc, override.id desc
  limit 1;
  effective_status := coalesce(effective_status, live_record.content_status);

  if live_record.publication_status <> 'published'
     or effective_status <> 'scheduled' then
    raise exception 'G3_RESERVATION_UNAVAILABLE' using errcode = '55000';
  end if;
  if pg_catalog.now() < live_record.reservation_opens_at
     or pg_catalog.now() >= live_record.reservation_closes_at then
    raise exception 'G3_RESERVATION_WINDOW_CLOSED' using errcode = '55000';
  end if;

  select passport.* into passport_record
  from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = live_record.celebrity_id
    and passport.business_status = 'issued'
  for key share;
  if not found then
    raise exception 'G3_PASSPORT_REQUIRED' using errcode = '42501';
  end if;

  select wallet.address into recipient
  from public.user_wallets wallet
  where wallet.app_user_id = p_app_user_id
    and wallet.chain_id = 91342
    and wallet.provider = 'privy'
    and wallet.wallet_type = 'embedded'
  for key share;
  if not found then
    raise exception 'G3_WALLET_NOT_READY' using errcode = '55000';
  end if;

  select celebrity.slug into strict celebrity_slug
  from public.celebrities celebrity
  where celebrity.id = live_record.celebrity_id
  for key share;

  expected_stamp_operation_key := 'byus:stamp:v1:' || p_stamp_id::text;
  if p_stamp_id is null
     or p_stamp_operation_key is distinct from expected_stamp_operation_key
     or p_stamp_issuance_id is null
     or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G3_ISSUANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.live_reservations(
    id, app_user_id, live_event_id, celebrity_id, passport_id, idempotency_key, reserved_at
  ) values (
    v_reservation_id, p_app_user_id, live_record.id, live_record.celebrity_id,
    passport_record.id, p_idempotency_key, v_occurred_at
  );

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id,
    'reservation', 'live_reservation', v_reservation_id
  );

  insert into public.fan_score_ledger(
    activity_id, app_user_id, celebrity_id, points
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id, 1
  );

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'issuanceId', p_stamp_issuance_id,
    'stampType', 'Reservation'
  );
  if public.fan_action_native_enabled(2) then
    v_outbox_id:=public.enqueue_fan_action_source('live_reservations',v_reservation_id::text,p_app_user_id,
      live_record.celebrity_id,live_record.id,v_occurred_at,2,jsonb_build_array(jsonb_build_object(
        'entityType','stamp','entityId',p_stamp_id,'kind',1,'issuanceKey',p_stamp_issuance_id,
        'operationKey',p_stamp_operation_key,'legacyPayload',expected_payload)));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id,fan_action_outbox_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,v_activity_id,'reservation',null,v_outbox_id);
  else
    insert into public.blockchain_jobs(
      id, entity_type, entity_id, operation_key, payload_version, payload
    ) values (
      v_stamp_job_id, 'stamp', p_stamp_id,
      p_stamp_operation_key, 1, expected_payload
    ) on conflict (operation_key) do nothing;
    select job.* into job_record from public.blockchain_jobs job
      where job.operation_key = p_stamp_operation_key for update;
    if not found or job_record.id <> v_stamp_job_id or job_record.entity_type <> 'stamp'
       or job_record.entity_id <> p_stamp_id or job_record.payload_version <> 1
       or job_record.payload <> expected_payload or job_record.status <> 'PENDING' then
      raise exception 'G3_ISSUANCE_CONFLICT' using errcode = '23514';
    end if;
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,v_activity_id,'reservation',v_stamp_job_id);
  end if;

  select stamp.* into strict stamp_record from public.stamps stamp
  where stamp.id=p_stamp_id and stamp.app_user_id=p_app_user_id and stamp.celebrity_id=live_record.celebrity_id
    and stamp.passport_id=passport_record.id and stamp.activity_id=v_activity_id and stamp.stamp_type='reservation'
    and ((v_outbox_id is not null and stamp.fan_action_outbox_id=v_outbox_id and stamp.blockchain_job_id is null)
      or (v_outbox_id is null and stamp.blockchain_job_id=v_stamp_job_id and stamp.fan_action_outbox_id is null))
    and stamp.mint_status='queued';

  result := public.build_owned_live_reservation_result(
    p_app_user_id, v_reservation_id
  );
  if result is null then
    raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
  end if;
  return result;
end;
$$;
create or replace function public.submit_owned_live_survey(
  p_app_user_id uuid, p_live_slug text, p_idempotency_key uuid, p_answers jsonb,
  p_stamp_id uuid, p_stamp_operation_key text, p_stamp_issuance_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  live_id uuid; request_hash text; recipient text; celebrity_slug text; result jsonb;
  reward_setting public.live_reward_setting_revisions%rowtype;
  activity_id uuid := extensions.gen_random_uuid(); job_id uuid := extensions.gen_random_uuid();
  expected_payload jsonb; job_record public.blockchain_jobs%rowtype; v_outbox_id uuid;
begin
  request_hash := encode(extensions.digest(p_answers::text, 'sha256'), 'hex');
  select id into live_id from public.live_events where slug = p_live_slug;
  if live_id is null then raise exception 'G3_SURVEY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:key:' || p_idempotency_key::text, 0));
  select * into existing from public.live_survey_idempotency where idempotency_key = p_idempotency_key for update;
  if found then
    if existing.app_user_id <> p_app_user_id or existing.live_event_id <> live_id
       or existing.operation <> 'submit' or existing.request_hash <> request_hash then
      raise exception 'G3_SURVEY_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514'; end if;
    return existing.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:target:' || p_app_user_id::text || ':' || live_id::text, 0));
  select * into response_record from public.live_survey_responses where app_user_id = p_app_user_id and live_event_id = live_id for update;
  if found and response_record.status = 'submitted' then
    result := public.build_owned_live_survey_submission_result(p_app_user_id, response_record.id);
    if result is null then raise exception 'G3_SURVEY_INTEGRITY_ERROR' using errcode = '23514'; end if;
    insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
    values (p_idempotency_key, p_app_user_id, live_id, 'submit', request_hash, response_record.id, result);
    return result;
  end if;
  perform 1 from public.app_users where id = p_app_user_id and status = 'active' for update;
  if not found then raise exception 'G3_SURVEY_USER_UNAVAILABLE' using errcode = '42501'; end if;
  response_record := public.get_or_create_owned_live_survey_response(p_app_user_id, p_live_slug);
  select revision.* into reward_setting
  from public.live_survey_reward_setting_bindings binding
  join public.live_reward_setting_revisions revision on revision.id = binding.reward_setting_revision_id
  where binding.survey_id = response_record.survey_id and revision.lifecycle_status = 'published';
  if not found then raise exception 'G3_SURVEY_REWARD_SETTINGS_REQUIRED' using errcode = '23514'; end if;
  perform public.validate_and_replace_live_survey_answers(response_record.id, response_record.survey_id, p_answers, true);
  select address into recipient from public.user_wallets where app_user_id = p_app_user_id and chain_id = 91342 and provider = 'privy' and wallet_type = 'embedded' for key share;
  if not found then raise exception 'G3_SURVEY_WALLET_NOT_READY' using errcode = '55000'; end if;
  select slug into strict celebrity_slug from public.celebrities where id = response_record.celebrity_id;
  if p_stamp_id is null or p_stamp_operation_key is distinct from 'byus:stamp:v1:' || p_stamp_id::text
     or p_stamp_issuance_id is null or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G3_SURVEY_ISSUANCE_CONFLICT' using errcode = '22023'; end if;
  update public.live_survey_responses set status = 'submitted', submitted_at = now(), revision = revision + 1
  where id = response_record.id returning * into response_record;
  insert into public.fan_activities(id, app_user_id, celebrity_id, activity_type, source_type, source_id)
  values (activity_id, p_app_user_id, response_record.celebrity_id, 'survey', 'live_survey_response', response_record.id);
  if reward_setting.mission_score > 0 then
    insert into public.fan_score_ledger(activity_id, app_user_id, celebrity_id, points)
    values (activity_id, p_app_user_id, response_record.celebrity_id, reward_setting.mission_score);
  end if;
  expected_payload := jsonb_build_object('recipient', recipient, 'celebritySlug', celebrity_slug, 'issuanceId', p_stamp_issuance_id, 'stampType', 'Survey');
  if public.fan_action_native_enabled(5) then
    v_outbox_id:=public.enqueue_fan_action_source('live_survey_responses',response_record.id::text,p_app_user_id,
      response_record.celebrity_id,response_record.live_event_id,response_record.submitted_at,5,jsonb_build_array(jsonb_build_object(
        'entityType','stamp','entityId',p_stamp_id,'kind',1,'issuanceKey',p_stamp_issuance_id,
        'operationKey',p_stamp_operation_key,'legacyPayload',expected_payload)));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id,fan_action_outbox_id)
      values(p_stamp_id,p_app_user_id,response_record.celebrity_id,response_record.passport_id,activity_id,'survey',null,v_outbox_id);
  else
    insert into public.blockchain_jobs(id, entity_type, entity_id, operation_key, payload_version, payload)
    values (job_id, 'stamp', p_stamp_id, p_stamp_operation_key, 1, expected_payload) on conflict (operation_key) do nothing;
    select * into job_record from public.blockchain_jobs where operation_key = p_stamp_operation_key for update;
    if not found or job_record.id <> job_id or job_record.entity_type <> 'stamp' or job_record.entity_id <> p_stamp_id
       or job_record.payload_version <> 1 or job_record.payload <> expected_payload or job_record.status <> 'PENDING' then
      raise exception 'G3_SURVEY_ISSUANCE_CONFLICT' using errcode = '23514'; end if;
    insert into public.stamps(id, app_user_id, celebrity_id, passport_id, activity_id, stamp_type, blockchain_job_id)
    values (p_stamp_id, p_app_user_id, response_record.celebrity_id, response_record.passport_id, activity_id, 'survey', job_id);
  end if;
  perform public.freeze_live_reward_settings_on_issuance(reward_setting.id, now(), 'live_survey_response', response_record.id);
  result := public.build_owned_live_survey_submission_result(p_app_user_id, response_record.id);
  if result is null then raise exception 'G3_SURVEY_INTEGRITY_ERROR' using errcode = '23514'; end if;
  insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
  values (p_idempotency_key, p_app_user_id, response_record.live_event_id, 'submit', request_hash, response_record.id, result);
  return result;
end;
$$;
create or replace function public.submit_owned_live_mission(
  p_app_user_id uuid,p_mission_id uuid,p_idempotency_key uuid,p_answers jsonb,
  p_stamp_id uuid,p_stamp_operation_key text,p_stamp_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare mission public.live_surveys%rowtype; live_record public.live_events%rowtype;
  passport_record public.fan_passports%rowtype; attendance_record public.live_attendances%rowtype;
  response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  reward_setting public.live_reward_setting_revisions%rowtype; item jsonb; question_record public.live_survey_questions%rowtype;
  selected_id uuid; all_correct boolean:=true; request_hash text; activity_id uuid:=extensions.gen_random_uuid();
  job_id uuid:=extensions.gen_random_uuid(); expected_payload jsonb; job_record public.blockchain_jobs%rowtype;
  recipient text; celebrity_slug text; result jsonb; v_policy_version integer; v_outbox_id uuid;
begin
  select * into mission from public.live_surveys where id=p_mission_id and publication_status='published' and not legacy_contract;
  if not found then raise exception 'PHASE2_MISSION_NOT_FOUND' using errcode='P0002'; end if;
  if statement_timestamp() < mission.visible_from or statement_timestamp() >= mission.visible_until then
    raise exception 'PHASE2_MISSION_NOT_VISIBLE' using errcode='55000';
  end if;
  perform public.validate_phase2_mission_contract(mission.id);
  select * into strict live_record from public.live_events where id=mission.live_event_id;
  request_hash:=encode(extensions.digest((jsonb_build_object('missionId',p_mission_id,'answers',p_answers))::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:key:'||p_idempotency_key::text,0));
  select * into existing from public.live_survey_idempotency where idempotency_key=p_idempotency_key for update;
  if found then
    if existing.app_user_id<>p_app_user_id or existing.live_event_id<>mission.live_event_id or existing.request_hash<>request_hash then raise exception 'PHASE2_MISSION_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return existing.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase2:mission:target:'||p_app_user_id::text||':'||p_mission_id::text,0));
  select * into response_record from public.live_survey_responses where app_user_id=p_app_user_id and survey_id=p_mission_id for update;
  if found then raise exception 'PHASE2_MISSION_ALREADY_COMPLETED' using errcode='23505'; end if;
  select * into passport_record from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=live_record.celebrity_id and business_status='issued' for key share;
  if not found then raise exception 'PHASE2_MISSION_PASSPORT_REQUIRED' using errcode='42501'; end if;
  select address into recipient from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
  if recipient is null then raise exception 'PHASE2_MISSION_WALLET_NOT_READY' using errcode='55000'; end if;
  if mission.attendance_requirement='required' then
    select * into attendance_record from public.live_attendances where app_user_id=p_app_user_id and live_event_id=mission.live_event_id;
    if not found then raise exception 'PHASE2_MISSION_ATTENDANCE_REQUIRED' using errcode='42501'; end if;
  end if;
  if jsonb_typeof(p_answers)<>'array' or jsonb_array_length(p_answers)<>(select count(*) from public.live_survey_questions where survey_id=p_mission_id) then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
  insert into public.live_survey_responses(app_user_id,live_event_id,celebrity_id,survey_id,attendance_id,passport_id,status,submitted_at,legacy_contract)
  values(p_app_user_id,mission.live_event_id,live_record.celebrity_id,mission.id,attendance_record.id,passport_record.id,'draft',null,false) returning * into response_record;
  for item in select value from jsonb_array_elements(p_answers) loop
    select * into question_record from public.live_survey_questions where id=(item->>'questionId')::uuid and survey_id=mission.id;
    if not found or jsonb_array_length(item->'selectedOptionIds')<>1 then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    selected_id:=(item->'selectedOptionIds'->>0)::uuid;
    if not exists(select 1 from public.live_survey_options where id=selected_id and question_id=question_record.id) then raise exception 'PHASE2_MISSION_INVALID_ANSWERS' using errcode='22023'; end if;
    insert into public.live_survey_answers(response_id,question_id,selected_option_ids) values(response_record.id,question_record.id,array[selected_id]);
    if mission.mission_type='quiz' and selected_id<>question_record.correct_option_id then all_correct:=false; end if;
  end loop;
  update public.live_survey_responses set status='submitted',submitted_at=now(),correctness=case when mission.mission_type='quiz' then all_correct else null end where id=response_record.id returning * into response_record;
  select r.* into reward_setting from public.live_survey_reward_setting_bindings b join public.live_reward_setting_revisions r on r.id=b.reward_setting_revision_id where b.survey_id=mission.id and r.lifecycle_status='published';
  if not found then raise exception 'PHASE2_MISSION_REWARD_SETTINGS_REQUIRED' using errcode='23514'; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id) values(activity_id,p_app_user_id,live_record.celebrity_id,'survey','live_survey_response',response_record.id);
  if reward_setting.mission_score>0 then insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(activity_id,p_app_user_id,live_record.celebrity_id,reward_setting.mission_score); end if;
  select activation.policy_version into strict v_policy_version from public.reward_policy_activation activation where activation.singleton=true;
  if reward_setting.mission_ticket>0 then perform public.post_fan_ticket_entry(p_app_user_id,live_record.celebrity_id,'credit',reward_setting.mission_ticket,'mission_completion',response_record.id,response_record.id,v_policy_version,reward_setting.revision,reward_setting.id); end if;
  select slug into strict celebrity_slug from public.celebrities where id=live_record.celebrity_id;
  if p_stamp_operation_key is distinct from 'byus:stamp:v1:'||p_stamp_id::text or p_stamp_issuance_id!~'^0x[0-9a-f]{64}$' then raise exception 'PHASE2_MISSION_ISSUANCE_CONFLICT' using errcode='22023'; end if;
  expected_payload:=jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'issuanceId',p_stamp_issuance_id,'stampType','Survey');
  if public.fan_action_native_enabled(4) then
    v_outbox_id:=public.enqueue_fan_action_source('live_survey_responses',response_record.id::text,p_app_user_id,
      live_record.celebrity_id,mission.live_event_id,response_record.submitted_at,4,jsonb_build_array(jsonb_build_object(
        'entityType','stamp','entityId',p_stamp_id,'kind',1,'issuanceKey',p_stamp_issuance_id,
        'operationKey',p_stamp_operation_key,'legacyPayload',expected_payload)));
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id,fan_action_outbox_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,activity_id,'survey',null,v_outbox_id);
  else
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(job_id,'stamp',p_stamp_id,p_stamp_operation_key,1,expected_payload) on conflict(operation_key) do nothing;
    select * into job_record from public.blockchain_jobs where operation_key=p_stamp_operation_key for update;
    if not found or job_record.id<>job_id or job_record.entity_id<>p_stamp_id or job_record.payload<>expected_payload then raise exception 'PHASE2_MISSION_ISSUANCE_CONFLICT' using errcode='23514'; end if;
    insert into public.stamps(id,app_user_id,celebrity_id,passport_id,activity_id,stamp_type,blockchain_job_id)
      values(p_stamp_id,p_app_user_id,live_record.celebrity_id,passport_record.id,activity_id,'survey',job_id);
  end if;
  perform public.freeze_live_reward_settings_on_issuance(reward_setting.id,now(),'live_survey_response',response_record.id);
  result:=jsonb_build_object('mission',jsonb_build_object('id',mission.id,'type',mission.mission_type,'completed',true,'correctness',case when mission.mission_type='quiz' then all_correct else null end,'scorePoints',reward_setting.mission_score,'ticketAmount',reward_setting.mission_ticket,'stamp',jsonb_build_object('id',p_stamp_id,'businessStatus','completed','mintStatus','queued')));
  insert into public.live_survey_idempotency(idempotency_key,app_user_id,live_event_id,operation,request_hash,response_id,result) values(p_idempotency_key,p_app_user_id,mission.live_event_id,'submit',request_hash,response_record.id,result);
  return result;
end $$;

create or replace function public.enqueue_fan_action_source(
  p_namespace text,p_source_key text,p_app_user_id uuid,p_creator_id uuid,p_campaign_id uuid,
  p_occurred_at timestamptz,p_action_code integer,p_credentials jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_binding public.fan_action_bindings%rowtype;
  v_route public.fan_action_producer_routes%rowtype;
  v_occurrence public.fan_action_occurrences%rowtype;
  v_outbox public.fan_action_outbox%rowtype;
  v_recipient text;
  v_snapshot_credentials jsonb;
  v_snapshot jsonb;
  v_descriptor jsonb;
  v_entity_type text;
  v_entity_id uuid;
  v_kind integer;
  v_issuance_key text;
  v_operation_key text;
  v_legacy_payload jsonb;
  v_nft_contract text;
  v_zero text:= '0x'||repeat('0',64);
begin
  if p_namespace is null or p_namespace !~ '^[a-z][a-z0-9_]{1,62}$'
    or p_source_key is null or length(p_source_key) not between 1 and 240
    or p_app_user_id is null or p_occurred_at is null or p_action_code not between 1 and 11
    or jsonb_typeof(p_credentials) is distinct from 'array' then
    raise exception 'FAN_ACTION_INVALID_SOURCE';
  end if;

  if p_creator_id is not null and not exists(
    select 1 from public.celebrities creator
    where creator.id=p_creator_id and creator.status='published' and creator.archived_at is null
  ) then
    raise exception 'FAN_ACTION_CREATOR_NOT_PUBLIC';
  end if;
  if p_campaign_id is not null and (
    p_creator_id is null or not exists(
      select 1 from public.live_events campaign
      where campaign.id=p_campaign_id and campaign.celebrity_id=p_creator_id
        and campaign.publication_status='published' and campaign.archived_at is null
    )
  ) then
    raise exception 'FAN_ACTION_CAMPAIGN_NOT_PUBLIC';
  end if;

  select route.* into v_route from public.fan_action_producer_routes route
    where route.action_code=p_action_code and route.enabled for key share;
  if not found then raise exception 'FAN_ACTION_ROUTE_DISABLED'; end if;
  select binding.* into strict v_binding from public.fan_action_bindings binding
    where binding.id=v_route.binding_id for key share;

  select lower(wallet.address) into strict v_recipient from public.user_wallets wallet
    where wallet.app_user_id=p_app_user_id and wallet.chain_id=91342
      and wallet.provider='privy' and wallet.wallet_type='embedded';
  if v_recipient !~ '^0x[0-9a-f]{40}$' then raise exception 'FAN_ACTION_WALLET_INVALID'; end if;

  if jsonb_array_length(p_credentials)>2 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;
  v_snapshot_credentials:='[]'::jsonb;
  for v_descriptor in select value from jsonb_array_elements(p_credentials) loop
    if jsonb_typeof(v_descriptor)<>'object'
      or (select count(*) from jsonb_object_keys(v_descriptor))<>6
      or not (v_descriptor ?& array['entityType','entityId','kind','issuanceKey','operationKey','legacyPayload']) then
      raise exception 'FAN_ACTION_INVALID_CREDENTIAL';
    end if;
    begin v_entity_id:=(v_descriptor->>'entityId')::uuid; exception when others then raise exception 'FAN_ACTION_INVALID_CREDENTIAL'; end;
    v_entity_type:=v_descriptor->>'entityType';
    begin v_kind:=(v_descriptor->>'kind')::integer; exception when others then raise exception 'FAN_ACTION_INVALID_CREDENTIAL'; end;
    v_issuance_key:=lower(v_descriptor->>'issuanceKey');
    v_operation_key:=v_descriptor->>'operationKey';
    v_legacy_payload:=v_descriptor->'legacyPayload';
    if v_entity_type not in ('passport','stamp','reaction','collectible','community_stamp')
      or v_kind not between 0 and 2
      or (v_issuance_key is null) is distinct from (v_entity_type='collectible' and v_kind=2)
      or (v_issuance_key is not null and v_issuance_key !~ '^0x[0-9a-f]{64}$')
      or nullif(btrim(v_operation_key),'') is null or length(v_operation_key)>300
      or jsonb_typeof(v_legacy_payload) is distinct from 'object'
      or (v_entity_type='passport') is distinct from (v_kind=0)
      or (v_entity_type='collectible') is distinct from (v_kind=2) then
      raise exception 'FAN_ACTION_INVALID_CREDENTIAL';
    end if;
    v_nft_contract:=lower(v_binding.assets->>v_kind::text);
    if v_nft_contract is null or v_nft_contract !~ '^0x[0-9a-f]{40}$' then
      raise exception 'FAN_ACTION_BINDING_ASSET_INVALID';
    end if;
    v_snapshot_credentials:=v_snapshot_credentials||jsonb_build_array(jsonb_build_object(
      'kind',v_kind,'nftContract',v_nft_contract,'issuanceKey',v_issuance_key,'mode','MINT',
      'metadata',jsonb_build_object('operationKey',v_operation_key,'legacyEntityType',v_entity_type,'legacyPayload',v_legacy_payload)
    ));
  end loop;
  if p_action_code=1 and jsonb_array_length(p_credentials)<>2 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;
  if p_action_code<>1 and jsonb_array_length(p_credentials)<>1 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;

  insert into public.fan_action_occurrences(source_namespace,canonical_source_key,app_user_id,creator_id,campaign_id,source_occurred_at)
    values(p_namespace,p_source_key,p_app_user_id,p_creator_id,p_campaign_id,p_occurred_at)
    on conflict(source_namespace,canonical_source_key) do nothing;
  select * into strict v_occurrence from public.fan_action_occurrences occurrence
    where occurrence.source_namespace=p_namespace and occurrence.canonical_source_key=p_source_key for update;
  if v_occurrence.app_user_id<>p_app_user_id or v_occurrence.creator_id is distinct from p_creator_id
    or v_occurrence.campaign_id is distinct from p_campaign_id or v_occurrence.source_occurred_at<>p_occurred_at then
    raise exception 'FAN_ACTION_SOURCE_CONFLICT';
  end if;

  v_snapshot:=jsonb_build_object(
    'version',1,'chainId',v_binding.chain_id,'environmentId',v_binding.environment_id,
    'hubProxy',v_binding.hub_proxy,'schemaUid',v_binding.schema_uid,'schemaVersion',v_binding.schema_version,
    'bindingVersion',v_binding.binding_version,'operationKind','RECORD_AND_ISSUE',
    'sourceNamespace',p_namespace,'canonicalSourceKey',p_source_key,'revision',1,
    'actionCode',p_action_code,'policyVersion',v_route.policy_version,'recipient',v_recipient,
    'creatorId',case when p_creator_id is null then v_zero else '0x'||lpad(replace(p_creator_id::text,'-',''),64,'0') end,
    'campaignId',case when p_campaign_id is null then v_zero else '0x'||lpad(replace(p_campaign_id::text,'-',''),64,'0') end,
    'sourceOccurredAt',to_jsonb(p_occurred_at)#>>'{}','origin','NATIVE',
    'evidenceCommitment','0x'||encode(extensions.digest(encode(v_occurrence.evidence_salt,'hex')||jsonb_build_object('namespace',p_namespace,'sourceKey',p_source_key,
      'appUserId',p_app_user_id,'creatorId',p_creator_id,'campaignId',p_campaign_id,'occurredAt',p_occurred_at)::text,'sha256'),'hex'),
    'migrationBatchId',v_zero,'assetBaseUri',v_binding.asset_base_uri,
    'credentials',v_snapshot_credentials,'migrationProof','[]'::jsonb
  );
  insert into public.fan_action_outbox(occurrence_row_id,binding_id,revision,operation_kind,source_snapshot)
    values(v_occurrence.id,v_binding.id,1,'record_and_issue',v_snapshot)
    on conflict(occurrence_row_id,revision) do nothing;
  select * into strict v_outbox from public.fan_action_outbox outbox
    where outbox.occurrence_row_id=v_occurrence.id and outbox.revision=1 for update;
  if v_outbox.binding_id<>v_binding.id or v_outbox.operation_kind<>'record_and_issue'
    or v_outbox.source_snapshot is distinct from v_snapshot then raise exception 'FAN_ACTION_SOURCE_CONFLICT'; end if;

  for v_descriptor in select value from jsonb_array_elements(p_credentials) loop
    insert into public.fan_action_credentials(outbox_id,entity_type,entity_id,credential_kind,issuance_key)
      values(v_outbox.id,v_descriptor->>'entityType',(v_descriptor->>'entityId')::uuid,
        (v_descriptor->>'kind')::integer,lower(v_descriptor->>'issuanceKey'))
      on conflict(outbox_id,entity_type,entity_id) do nothing;
  end loop;
  if (select count(*) from public.fan_action_credentials credential where credential.outbox_id=v_outbox.id)
      <>jsonb_array_length(p_credentials) then raise exception 'FAN_ACTION_CREDENTIAL_CONFLICT'; end if;
  return v_outbox.id;
end $$;

create function public.assert_fan_action_credential_link(
  p_outbox_id uuid,p_entity_type text,p_entity_id uuid,p_app_user_id uuid,
  p_mint_status public.credential_mint_status,p_tx_hash text,p_token_id numeric
) returns void language plpgsql security definer set search_path='' as $$
declare v_outbox public.fan_action_outbox%rowtype;v_credential public.fan_action_credentials%rowtype;
  v_expected public.credential_mint_status;
begin
  select outbox.* into strict v_outbox from public.fan_action_outbox outbox
    join public.fan_action_occurrences occurrence on occurrence.id=outbox.occurrence_row_id
    where outbox.id=p_outbox_id and occurrence.app_user_id=p_app_user_id;
  select * into strict v_credential from public.fan_action_credentials credential
    where credential.outbox_id=p_outbox_id and credential.entity_type=p_entity_type and credential.entity_id=p_entity_id;
  v_expected:=case v_outbox.status when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if p_mint_status<>v_expected then raise exception 'fan action credential mint status mismatch'; end if;
  if v_outbox.status='COMPLETED' then
    if p_tx_hash is distinct from v_outbox.tx_hash or p_token_id is distinct from v_credential.token_id
      or v_credential.nft_contract is null or v_credential.link_origin<>'MINTED_NOW' then
      raise exception 'fan action credential result mismatch'; end if;
  elsif p_tx_hash is not null or p_token_id is not null then
    raise exception 'pending fan action credential exposes a mint result';
  end if;
end $$;

create function public.reject_fan_action_credential_lane_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.fan_action_outbox_id is distinct from new.fan_action_outbox_id then
    raise exception 'credential fan action link is immutable once assigned';
  end if;
  return new;
end $$;

do $$ declare v_table text;begin
  foreach v_table in array array['fan_passports','stamps','fan_reactions','live_collectible_claims','community_stamps'] loop
    execute format('create trigger %I before update of fan_action_outbox_id on public.%I for each row execute function public.reject_fan_action_credential_lane_mutation()',v_table||'_fan_action_link_immutable',v_table);
  end loop;
end $$;

revoke all on function public.fan_action_native_enabled(integer),
  public.enqueue_fan_action_source(text,text,uuid,uuid,uuid,timestamptz,integer,jsonb),
  public.assert_fan_action_credential_link(uuid,text,uuid,uuid,public.credential_mint_status,text,numeric),
  public.reject_fan_action_credential_lane_mutation()
  from public,anon,authenticated,service_role;

-- Existing validators retain their exact legacy path and delegate only v2 rows.
create or replace function public.validate_credential_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.fan_action_outbox_id is not null then
    perform public.assert_fan_action_credential_link(new.fan_action_outbox_id,
      case when tg_table_name='fan_passports' then 'passport' else 'stamp' end,
      new.id,new.app_user_id,new.mint_status,new.tx_hash,new.token_id);
  elsif tg_table_name='fan_passports' then
    perform public.assert_credential_blockchain_job_link('passport',new.id,new.app_user_id,new.celebrity_id,
      new.mint_status,new.blockchain_job_id,new.tx_hash,new.token_id);
  else
    perform public.assert_stamp_blockchain_job_link_v2(new.id,new.app_user_id,new.celebrity_id,new.stamp_type,
      new.mint_status,new.blockchain_job_id,new.tx_hash,new.token_id);
  end if;
  return new;
end $$;

create or replace function public.validate_reaction_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.fan_action_outbox_id is not null then
    perform public.assert_fan_action_credential_link(new.fan_action_outbox_id,'reaction',new.id,new.app_user_id,
      new.mint_status,new.tx_hash,new.token_id);
  else
    perform public.assert_reaction_blockchain_job_link(new.id,new.app_user_id,new.celebrity_id,
      new.mint_status,new.blockchain_job_id,new.tx_hash,new.token_id);
  end if;
  return new;
end $$;

create or replace function public.assert_collectible_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare job public.blockchain_jobs%rowtype; expected public.credential_mint_status; live_slug text; celebrity_slug text; key_count integer;
begin
  if new.fan_action_outbox_id is not null then
    perform public.assert_fan_action_credential_link(new.fan_action_outbox_id,'collectible',new.id,new.app_user_id,
      new.mint_status,new.tx_hash,new.token_id);
    return new;
  end if;
  select * into strict job from public.blockchain_jobs where id=new.blockchain_job_id;
  select live.slug,celebrity.slug into strict live_slug,celebrity_slug from public.live_events live join public.celebrities celebrity on celebrity.id=live.celebrity_id where live.id=new.live_event_id;
  if job.entity_type<>'collectible' or job.entity_id<>new.id or job.operation_key<>'byus:collectible:v1:'||new.id::text or job.payload_version<>1 then raise exception 'Collectible blockchain job identity mismatch'; end if;
  select count(*) into key_count from jsonb_object_keys(job.payload);
  if key_count not in (5,6) or not(job.payload ?& array['recipient','celebritySlug','liveSlug','claimId','metadataVersion'])
    or job.payload->>'celebritySlug'<>celebrity_slug or job.payload->>'liveSlug'<>live_slug or job.payload->>'claimId'<>new.id::text
    or job.payload->>'metadataVersion'<>'1' or coalesce(job.payload->>'recipient','') !~ '^0x[0-9a-fA-F]{40}$'
    or not exists(select 1 from public.user_wallets w where w.app_user_id=new.app_user_id and w.chain_id=91342 and w.provider='privy' and w.wallet_type='embedded' and w.address=lower(job.payload->>'recipient'))
  then raise exception 'Collectible blockchain job payload mismatch'; end if;
  expected:=case job.status when 'PENDING' then 'queued'::public.credential_mint_status when 'PROCESSING' then 'processing'::public.credential_mint_status when 'RETRYING' then 'retryable'::public.credential_mint_status when 'FAILED' then 'permanent_failure'::public.credential_mint_status when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.mint_status<>expected then raise exception 'Collectible mint status mismatch'; end if;
  if job.status='COMPLETED' and (new.tx_hash is distinct from job.tx_hash or new.token_id is distinct from job.token_id) then raise exception 'Collectible mint result mismatch'; end if;
  return new;
end $$;

create or replace function public.assert_community_stamp_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_job public.blockchain_jobs%rowtype;v_expected_status public.credential_mint_status;v_expected_payload jsonb;
begin
  if tg_op='INSERT' then
    if not exists(select 1 from public.app_users app_user where app_user.id=new.app_user_id and app_user.status='active') then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
    if new.celebrity_id is not null and not exists(select 1 from public.celebrities celebrity
      where celebrity.id=new.celebrity_id and celebrity.status='published' and celebrity.archived_at is null) then
      raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
    perform public.assert_community_stamp_source(new.app_user_id,new.celebrity_id,new.kind,new.source_key);
  end if;
  if new.fan_action_outbox_id is not null then
    perform public.assert_fan_action_credential_link(new.fan_action_outbox_id,'community_stamp',new.id,new.app_user_id,
      new.mint_status,new.tx_hash,new.token_id);
    return new;
  end if;
  select * into v_job from public.blockchain_jobs job where job.id=new.blockchain_job_id for key share;
  if not found or v_job.entity_type<>'community_stamp' or v_job.entity_id<>new.id
    or v_job.operation_key<>'byus:community-stamp:v1:'||new.id::text or v_job.payload_version<>1 then
    raise exception 'community stamp blockchain job link is invalid'; end if;
  v_expected_payload:=jsonb_build_object('recipient',(select wallet.address from public.user_wallets wallet
    where wallet.app_user_id=new.app_user_id and wallet.chain_id=91342 and wallet.provider='privy' and wallet.wallet_type='embedded'),
    'issuanceId','0x'||encode(extensions.digest(v_job.operation_key,'sha256'),'hex'),'stampKind',new.kind::text,
    'celebritySlug',(select celebrity.slug from public.celebrities celebrity where celebrity.id=new.celebrity_id));
  if (v_job.payload-'workerSubmission') is distinct from v_expected_payload or v_expected_payload->>'recipient' is null
    or coalesce(v_expected_payload->>'recipient','') !~ '^0x[0-9a-f]{40}$' then
    raise exception 'community stamp blockchain job payload is invalid'; end if;
  v_expected_status:=case v_job.status when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.mint_status<>v_expected_status or (v_job.status='COMPLETED' and
      (new.tx_hash is distinct from v_job.tx_hash or new.token_id is distinct from v_job.token_id))
    or (v_job.status<>'COMPLETED' and (new.tx_hash is not null or new.token_id is not null)) then
    raise exception 'community stamp mint state does not match blockchain job'; end if;
  return new;
end $$;

revoke all on function public.validate_credential_blockchain_job_link(),
  public.validate_reaction_blockchain_job_link(),public.assert_collectible_blockchain_job_link(),
  public.assert_community_stamp_blockchain_job_link() from public,anon,authenticated,service_role;

create or replace function public.react_to_creator(
  p_app_user_id uuid,p_celebrity_id uuid,p_reaction_id uuid,p_job_id uuid,p_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.fan_reactions%rowtype;slug text;recipient text;payload jsonb;
  v_outbox_id uuid;v_operation_key text;v_occurred_at timestamptz:=clock_timestamp();
begin
  if p_reaction_id is null or p_job_id is null or coalesce(p_issuance_id,'') !~ '^0x[0-9a-f]{64}$'
  then raise exception 'P2_REACTION_INPUT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reaction:'||p_app_user_id::text||':'||p_celebrity_id::text,0));
  perform 1 from public.app_users u where u.id=p_app_user_id and u.status='active' for update;
  if not found then raise exception 'P2_USER_UNAVAILABLE' using errcode='42501'; end if;
  select * into existing from public.fan_reactions r where r.app_user_id=p_app_user_id and r.celebrity_id=p_celebrity_id;
  if found then return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'fanActionOutboxId',existing.fan_action_outbox_id,'created',false,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id)); end if;
  select c.slug into slug from public.celebrities c where c.id=p_celebrity_id and c.status='published' and c.archived_at is null for key share;
  if not found then raise exception 'P2_CREATOR_NOT_FOUND' using errcode='P0002'; end if;
  select w.address into recipient from public.user_wallets w where w.app_user_id=p_app_user_id and w.chain_id=91342
    and w.provider='privy' and w.wallet_type='embedded' for key share;
  if not found then raise exception 'P2_WALLET_NOT_READY' using errcode='55000'; end if;
  payload:=jsonb_build_object('recipient',recipient,'celebritySlug',slug,'issuanceId',p_issuance_id,'reactionType','FirstReaction');
  v_operation_key:='byus:reaction:v1:'||p_reaction_id::text;
  if public.fan_action_native_enabled(6) then
    v_outbox_id:=public.enqueue_fan_action_source('fan_reactions',p_reaction_id::text,p_app_user_id,p_celebrity_id,null,
      v_occurred_at,6,jsonb_build_array(jsonb_build_object('entityType','reaction','entityId',p_reaction_id,'kind',1,
        'issuanceKey',p_issuance_id,'operationKey',v_operation_key,'legacyPayload',payload)));
    insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,fan_action_outbox_id,completed_at)
      values(p_reaction_id,p_app_user_id,p_celebrity_id,null,v_outbox_id,v_occurred_at) returning * into existing;
  else
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
      values(p_job_id,'reaction',p_reaction_id,v_operation_key,1,payload);
    insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,completed_at)
      values(p_reaction_id,p_app_user_id,p_celebrity_id,p_job_id,v_occurred_at) returning * into existing;
  end if;
  return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'fanActionOutboxId',existing.fan_action_outbox_id,'created',true,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id));
end $$;

create or replace function public.claim_owned_live_collectible(p_app_user_id uuid,p_live_slug text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare live_record public.live_events%rowtype;completion public.live_journey_completions%rowtype;requirement public.live_journey_requirement_revisions%rowtype;
  frozen public.live_collectible_claim_windows%rowtype;existing_key public.live_collectible_claim_idempotency%rowtype;
  existing_claim public.live_collectible_claims%rowtype;recipient text;celebrity_slug text;claim_id uuid:=extensions.gen_random_uuid();job_id uuid:=extensions.gen_random_uuid();
  observed_at timestamptz:=pg_catalog.statement_timestamp();until_at timestamptz;payload jsonb;v_outbox_id uuid;v_operation_key text;
begin
  if p_app_user_id is null or p_idempotency_key is null or p_live_slug is null or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collectible:idempotency:'||p_idempotency_key::text,0));
  select * into existing_key from public.live_collectible_claim_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if existing_key.app_user_id<>p_app_user_id or not exists(select 1 from public.live_events where id=existing_key.live_event_id and slug=p_live_slug) then raise exception 'P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('claim',public.project_live_collectible_claim(existing_key.claim_id),'replayed',true);
  end if;
  perform 1 from public.app_users where id=p_app_user_id and status='active' for share;if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select live.* into live_record from public.live_events live where live.slug=p_live_slug and live.publication_status='published' and live.archived_at is null;
  if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select slug into strict celebrity_slug from public.celebrities where id=live_record.celebrity_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collectible:target:'||p_app_user_id::text||':'||live_record.id::text,0));
  select * into existing_claim from public.live_collectible_claims where app_user_id=p_app_user_id and live_event_id=live_record.id;
  if found then raise exception 'P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
  select * into completion from public.live_journey_completions where app_user_id=p_app_user_id and live_event_id=live_record.id;
  if not found then raise exception 'P3_COLLECTIBLE_JOURNEY_INCOMPLETE' using errcode='55000'; end if;
  select * into strict requirement from public.live_journey_requirement_revisions where id=completion.requirement_revision_id;
  select * into frozen from public.live_collectible_claim_windows where live_event_id=live_record.id;
  if not found then frozen:=public.freeze_live_collectible_window(live_record.id,observed_at); end if;
  until_at:=frozen.opens_at+pg_catalog.make_interval(hours=>requirement.claim_window_duration_hours);
  if observed_at>=until_at then raise exception 'P3_COLLECTIBLE_WINDOW_EXPIRED' using errcode='55000'; end if;
  select address into recipient from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
  if not found then raise exception 'P3_COLLECTIBLE_WALLET_NOT_READY' using errcode='55000'; end if;
  payload:=jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'liveSlug',live_record.slug,'claimId',claim_id::text,'metadataVersion',1);
  v_operation_key:='byus:collectible:v1:'||claim_id::text;
  if public.fan_action_native_enabled(11) then
    v_outbox_id:=public.enqueue_fan_action_source('live_collectible_claims',claim_id::text,p_app_user_id,live_record.celebrity_id,
      live_record.id,observed_at,11,jsonb_build_array(jsonb_build_object('entityType','collectible','entityId',claim_id,'kind',2,
        'issuanceKey',null,'operationKey',v_operation_key,'legacyPayload',payload)));
    insert into public.live_collectible_claims(id,app_user_id,live_event_id,journey_completion_id,requirement_revision_id,frozen_ends_at,claim_window_until,blockchain_job_id,fan_action_outbox_id,claimed_at)
      values(claim_id,p_app_user_id,live_record.id,completion.id,completion.requirement_revision_id,frozen.opens_at,until_at,null,v_outbox_id,observed_at) returning * into existing_claim;
  else
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(job_id,'collectible',claim_id,v_operation_key,1,payload);
    insert into public.live_collectible_claims(id,app_user_id,live_event_id,journey_completion_id,requirement_revision_id,frozen_ends_at,claim_window_until,blockchain_job_id,claimed_at)
      values(claim_id,p_app_user_id,live_record.id,completion.id,completion.requirement_revision_id,frozen.opens_at,until_at,job_id,observed_at) returning * into existing_claim;
  end if;
  insert into public.live_collectible_claim_idempotency values(p_idempotency_key,p_app_user_id,live_record.id,claim_id,observed_at);
  return jsonb_build_object('claim',public.project_live_collectible_claim(claim_id),'replayed',false);
end $$;

create or replace function public.issue_community_stamp(
  p_app_user_id uuid,p_celebrity_id uuid,p_kind public.community_stamp_kind,p_source_key text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_recipient text;v_celebrity_slug text;v_stamp_id uuid:=extensions.gen_random_uuid();
  v_job_id uuid:=extensions.gen_random_uuid();v_operation_key text;v_payload jsonb;v_outbox_id uuid;
  v_action_code integer;v_occurred_at timestamptz:=pg_catalog.statement_timestamp();v_source_id uuid;
begin
  if p_app_user_id is null or p_kind is null or p_source_key is null then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023'; end if;
  if p_kind in ('subscription','support') then
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001'; end if;
  perform 1 from public.app_users app_user where app_user.id=p_app_user_id and app_user.status='active' for key share;
  if not found then raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
  select wallet.address into v_recipient from public.user_wallets wallet where wallet.app_user_id=p_app_user_id
    and wallet.chain_id=91342 and wallet.provider='privy' and wallet.wallet_type='embedded' for key share;
  if v_recipient is null then raise exception 'COMMUNITY_STAMP_WALLET_NOT_READY' using errcode='P0001'; end if;
  if p_celebrity_id is not null then
    select celebrity.slug into v_celebrity_slug from public.celebrities celebrity where celebrity.id=p_celebrity_id
      and celebrity.status='published' and celebrity.archived_at is null for key share;
    if v_celebrity_slug is null then raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  perform public.assert_community_stamp_source(p_app_user_id,p_celebrity_id,p_kind,p_source_key);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('community-stamp:'||p_app_user_id::text||':'||p_kind::text||':'||coalesce(p_celebrity_id::text,'global')||':'||p_source_key,0));
  if exists(select 1 from public.community_stamps stamp where stamp.app_user_id=p_app_user_id and stamp.kind=p_kind and
      (stamp.source_key=p_source_key or (p_kind in ('welcome','invite') and stamp.celebrity_id is null)
        or (p_kind in ('first_comment','subscription','support','share') and stamp.celebrity_id=p_celebrity_id))) then return false; end if;
  v_action_code:=case p_kind when 'welcome' then 7 when 'first_comment' then 8 when 'invite' then 9 when 'daily_checkin' then 10 end;
  if p_kind='first_comment' then
    v_source_id:=pg_catalog.split_part(p_source_key,':',3)::uuid;
    if pg_catalog.split_part(p_source_key,':',2)='lounge' then
      select created_at into strict v_occurred_at from public.fan_lounge_messages where id=v_source_id;
    else select created_at into strict v_occurred_at from public.celebrity_notice_comments where id=v_source_id; end if;
  elsif p_kind='invite' then
    v_source_id:=pg_catalog.split_part(p_source_key,':',2)::uuid;
    select redeemed_at into strict v_occurred_at from public.community_stamp_invite_redemptions where id=v_source_id;
  end if;
  v_operation_key:='byus:community-stamp:v1:'||v_stamp_id::text;
  v_payload:=jsonb_build_object('recipient',v_recipient,'issuanceId','0x'||encode(extensions.digest(v_operation_key,'sha256'),'hex'),
    'stampKind',p_kind::text,'celebritySlug',v_celebrity_slug);
  if v_action_code is not null and public.fan_action_native_enabled(v_action_code) then
    v_outbox_id:=public.enqueue_fan_action_source('community_stamps',p_source_key||':'||p_app_user_id::text,
      p_app_user_id,p_celebrity_id,null,v_occurred_at,v_action_code,jsonb_build_array(jsonb_build_object(
        'entityType','community_stamp','entityId',v_stamp_id,'kind',1,
        'issuanceKey','0x'||encode(extensions.digest(v_operation_key,'sha256'),'hex'),
        'operationKey',v_operation_key,'legacyPayload',v_payload)));
    insert into public.community_stamps(id,app_user_id,celebrity_id,kind,source_key,issued_at,blockchain_job_id,fan_action_outbox_id)
      values(v_stamp_id,p_app_user_id,p_celebrity_id,p_kind,p_source_key,v_occurred_at,null,v_outbox_id);
  else
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
      values(v_job_id,'community_stamp',v_stamp_id,v_operation_key,1,v_payload);
    insert into public.community_stamps(id,app_user_id,celebrity_id,kind,source_key,issued_at,blockchain_job_id)
      values(v_stamp_id,p_app_user_id,p_celebrity_id,p_kind,p_source_key,v_occurred_at,v_job_id);
  end if;
  return true;
exception when unique_violation then return false;
end $$;

revoke all on function public.react_to_creator(uuid,uuid,uuid,uuid,text),
  public.claim_owned_live_collectible(uuid,text,uuid),
  public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)
  from public,anon,authenticated,service_role;
grant execute on function public.react_to_creator(uuid,uuid,uuid,uuid,text),
  public.claim_owned_live_collectible(uuid,text,uuid) to service_role;

-- Historical H2 imports mint a missing legacy credential without rewriting its
-- append-only legacy job or business row. Owner projections may overlay only a
-- completed MINTED_NOW result for the same owner and entity. Existing minted
-- credentials (H1) always retain their original mint evidence.
create function public.effective_fan_action_mint(
  p_app_user_id uuid,p_entity_type text,p_entity_id uuid,
  p_base_status text,p_base_tx_hash text,p_base_token_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_base_status='minted' then
    return jsonb_build_object('status',p_base_status,'txHash',p_base_tx_hash,'tokenId',p_base_token_id);
  end if;
  select jsonb_build_object('status','minted','txHash',outbox.tx_hash,'tokenId',credential.token_id::text)
    into v_result
  from public.fan_action_credentials credential
  join public.fan_action_outbox outbox on outbox.id=credential.outbox_id
  join public.fan_action_occurrences occurrence on occurrence.id=outbox.occurrence_row_id
  where occurrence.app_user_id=p_app_user_id
    and credential.entity_type=p_entity_type and credential.entity_id=p_entity_id
    and credential.legacy_job_id is not null
    and outbox.operation_kind='import_historical' and outbox.status='COMPLETED'
    and credential.link_origin='MINTED_NOW' and credential.token_id is not null
    and outbox.tx_hash is not null
  order by outbox.created_at desc,outbox.id desc limit 1;
  return coalesce(v_result,jsonb_build_object('status',p_base_status,'txHash',p_base_tx_hash,'tokenId',p_base_token_id));
end $$;
revoke all on function public.effective_fan_action_mint(uuid,text,uuid,text,text,text)
  from public,anon,authenticated,service_role;

alter function public.get_owned_passport_collection(uuid,public.content_locale)
  rename to get_owned_passport_collection_legacy_projection;
create function public.get_owned_passport_collection(p_app_user_id uuid,p_locale public.content_locale)
returns setof jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{mint}',public.effective_fan_action_mint(p_app_user_id,'passport',(item->>'id')::uuid,
    item->'mint'->>'status',item->'mint'->>'txHash',item->'mint'->>'tokenId'))
  from public.get_owned_passport_collection_legacy_projection(p_app_user_id,p_locale) item
$$;

alter function public.get_owned_passport_detail(uuid,uuid,public.content_locale)
  rename to get_owned_passport_detail_legacy_projection;
create function public.get_owned_passport_detail(p_passport_id uuid,p_app_user_id uuid,p_locale public.content_locale)
returns setof jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(jsonb_set(item,'{mint}',public.effective_fan_action_mint(p_app_user_id,'passport',(item->>'id')::uuid,
      item->'mint'->>'status',item->'mint'->>'txHash',item->'mint'->>'tokenId')),
    '{stamps}',coalesce((select jsonb_agg(jsonb_set(entry.stamp,'{mint}',public.effective_fan_action_mint(
      p_app_user_id,'stamp',(entry.stamp->>'id')::uuid,entry.stamp->'mint'->>'status',entry.stamp->'mint'->>'txHash',entry.stamp->'mint'->>'tokenId')) order by entry.ordinal)
      from jsonb_array_elements(item->'stamps') with ordinality as entry(stamp,ordinal)),'[]'::jsonb))
  from public.get_owned_passport_detail_legacy_projection(p_passport_id,p_app_user_id,p_locale) item
$$;

alter function public.get_owned_stamp_detail(uuid,uuid,public.content_locale)
  rename to get_owned_stamp_detail_legacy_projection;
create function public.get_owned_stamp_detail(p_stamp_id uuid,p_app_user_id uuid,p_locale public.content_locale)
returns setof jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{mint}',public.effective_fan_action_mint(p_app_user_id,'stamp',(item->>'id')::uuid,
    item->'mint'->>'status',item->'mint'->>'txHash',item->'mint'->>'tokenId'))
  from public.get_owned_stamp_detail_legacy_projection(p_stamp_id,p_app_user_id,p_locale) item
$$;

alter function public.build_fan_activity_completion(uuid,uuid)
  rename to build_fan_activity_completion_legacy_projection;
create function public.build_fan_activity_completion(p_app_user_id uuid,p_activity_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{earnedStamp,mintStatus}',to_jsonb(public.effective_fan_action_mint(
    p_app_user_id,'stamp',(item->'earnedStamp'->>'id')::uuid,item->'earnedStamp'->>'mintStatus',null,null)->>'status'))
  from (select public.build_fan_activity_completion_legacy_projection(p_app_user_id,p_activity_id) item) base
$$;

alter function public.build_owned_live_reservation_result(uuid,uuid)
  rename to build_owned_live_reservation_result_legacy_projection;
create function public.build_owned_live_reservation_result(p_app_user_id uuid,p_reservation_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{stampMintStatus}',to_jsonb(public.effective_fan_action_mint(
    p_app_user_id,'stamp',(item->>'stampId')::uuid,item->>'stampMintStatus',null,null)->>'status'))
  from (select public.build_owned_live_reservation_result_legacy_projection(p_app_user_id,p_reservation_id) item) base
$$;

alter function public.build_owned_live_attendance_result(uuid,uuid)
  rename to build_owned_live_attendance_result_legacy_projection;
create function public.build_owned_live_attendance_result(p_app_user_id uuid,p_attendance_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{stampMintStatus}',to_jsonb(public.effective_fan_action_mint(
    p_app_user_id,'stamp',(item->>'stampId')::uuid,item->>'stampMintStatus',null,null)->>'status'))
  from (select public.build_owned_live_attendance_result_legacy_projection(p_app_user_id,p_attendance_id) item) base
$$;

alter function public.build_owned_live_survey_submission_result(uuid,uuid)
  rename to build_owned_live_survey_submission_result_legacy_projection;
create function public.build_owned_live_survey_submission_result(p_app_user_id uuid,p_response_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{response,stamp,mintStatus}',to_jsonb(public.effective_fan_action_mint(
    p_app_user_id,'stamp',(item->'response'->'stamp'->>'id')::uuid,item->'response'->'stamp'->>'mintStatus',null,null)->>'status'))
  from (select public.build_owned_live_survey_submission_result_legacy_projection(p_app_user_id,p_response_id) item) base
$$;

alter function public.get_owned_reaction(uuid,text) rename to get_owned_reaction_legacy_projection;
create function public.get_owned_reaction(p_app_user_id uuid,p_celebrity_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{mintStatus}',to_jsonb(public.effective_fan_action_mint(
    p_app_user_id,'reaction',(item->>'reactionId')::uuid,item->>'mintStatus',null,null)->>'status'))
  from (select public.get_owned_reaction_legacy_projection(p_app_user_id,p_celebrity_slug) item) base
$$;

alter function public.project_live_collectible_claim(uuid) rename to project_live_collectible_claim_legacy_projection;
create function public.project_live_collectible_claim(p_claim_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{mint}',public.effective_fan_action_mint(claim.app_user_id,'collectible',claim.id,
    item->'mint'->>'status',item->'mint'->>'txHash',item->'mint'->>'tokenId'))
  from public.live_collectible_claims claim
  cross join lateral (select public.project_live_collectible_claim_legacy_projection(p_claim_id) item) base
  where claim.id=p_claim_id
$$;

alter function public.get_owned_community_stamps(uuid,text) rename to get_owned_community_stamps_legacy_projection;
create function public.get_owned_community_stamps(p_app_user_id uuid,p_celebrity_slug text default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(item,'{stamps}',coalesce((select jsonb_agg(jsonb_set(entry.stamp,'{mint}',public.effective_fan_action_mint(
    p_app_user_id,'community_stamp',(entry.stamp->>'id')::uuid,entry.stamp->'mint'->>'status',entry.stamp->'mint'->>'txHash',entry.stamp->'mint'->>'tokenId')) order by entry.ordinal)
    from jsonb_array_elements(item->'stamps') with ordinality as entry(stamp,ordinal)),'[]'::jsonb))
  from (select public.get_owned_community_stamps_legacy_projection(p_app_user_id,p_celebrity_slug) item) base
$$;

revoke all on function
  public.get_owned_passport_collection_legacy_projection(uuid,public.content_locale),
  public.get_owned_passport_detail_legacy_projection(uuid,uuid,public.content_locale),
  public.get_owned_stamp_detail_legacy_projection(uuid,uuid,public.content_locale),
  public.build_fan_activity_completion_legacy_projection(uuid,uuid),
  public.build_owned_live_reservation_result_legacy_projection(uuid,uuid),
  public.build_owned_live_attendance_result_legacy_projection(uuid,uuid),
  public.build_owned_live_survey_submission_result_legacy_projection(uuid,uuid),
  public.get_owned_reaction_legacy_projection(uuid,text),
  public.project_live_collectible_claim_legacy_projection(uuid),
  public.get_owned_community_stamps_legacy_projection(uuid,text)
from public,anon,authenticated,service_role;
revoke all on function
  public.get_owned_passport_collection(uuid,public.content_locale),
  public.get_owned_passport_detail(uuid,uuid,public.content_locale),
  public.get_owned_stamp_detail(uuid,uuid,public.content_locale),
  public.build_fan_activity_completion(uuid,uuid),
  public.build_owned_live_reservation_result(uuid,uuid),
  public.build_owned_live_attendance_result(uuid,uuid),
  public.build_owned_live_survey_submission_result(uuid,uuid),
  public.get_owned_reaction(uuid,text),public.project_live_collectible_claim(uuid),
  public.get_owned_community_stamps(uuid,text)
from public,anon,authenticated,service_role;
grant execute on function
  public.get_owned_passport_collection(uuid,public.content_locale),
  public.get_owned_passport_detail(uuid,uuid,public.content_locale),
  public.get_owned_stamp_detail(uuid,uuid,public.content_locale),
  public.get_owned_reaction(uuid,text),public.get_owned_community_stamps(uuid,text)
to service_role;
