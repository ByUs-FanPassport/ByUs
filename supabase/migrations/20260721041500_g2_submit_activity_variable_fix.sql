-- Forward-only correction for PL/pgSQL activity_id column/variable ambiguity.
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
  pass_id uuid := extensions.gen_random_uuid();
  passport_id uuid := extensions.gen_random_uuid();
  passport_job_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  passport_record public.fan_passports%rowtype;
  stamp_record public.stamps%rowtype;
  expected_payload jsonb;
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
  set status = 'passed', score = correct_count, submitted_at = now()
  where id = attempt_record.id;

  insert into public.quiz_passes(
    id, app_user_id, celebrity_id, winning_attempt_id
  ) values (
    pass_id, p_app_user_id, attempt_record.celebrity_id, attempt_record.id
  )
  on conflict (app_user_id, celebrity_id) do nothing;
  if not exists (
    select 1 from public.quiz_passes pass
    where pass.id = pass_id
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
  insert into public.blockchain_jobs(
    id, entity_type, entity_id, operation_key, payload_version, payload
  ) values (
    passport_job_id, 'passport', passport_id,
    p_passport_operation_key, 1, expected_payload
  )
  on conflict (operation_key) do nothing;
  select * into job_record from public.blockchain_jobs job
  where job.operation_key = p_passport_operation_key
  for update;
  if not found
     or job_record.id <> passport_job_id
     or job_record.entity_type <> 'passport'
     or job_record.entity_id <> passport_id
     or job_record.payload_version <> 1
     or job_record.payload <> expected_payload
     or job_record.status <> 'PENDING' then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  insert into public.fan_passports(
    id, app_user_id, celebrity_id, quiz_pass_id, blockchain_job_id
  ) values (
    passport_id, p_app_user_id, attempt_record.celebrity_id, pass_id, passport_job_id
  )
  on conflict (app_user_id, celebrity_id) do nothing;
  select * into passport_record from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = attempt_record.celebrity_id
  for update;
  if not found
     or passport_record.id <> passport_id
     or passport_record.quiz_pass_id <> pass_id
     or passport_record.blockchain_job_id <> passport_job_id
     or passport_record.mint_status <> 'queued' then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, attempt_record.celebrity_id,
    'knowledge', 'quiz_pass', pass_id
  )
  on conflict (activity_type, source_type, source_id) do nothing;
  if not exists (
    select 1 from public.fan_activities activity
    where activity.id = v_activity_id
      and activity.app_user_id = p_app_user_id
      and activity.celebrity_id = attempt_record.celebrity_id
      and activity.activity_type = 'knowledge'
      and activity.source_type = 'quiz_pass'
      and activity.source_id = pass_id
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
  insert into public.blockchain_jobs(
    id, entity_type, entity_id, operation_key, payload_version, payload
  ) values (
    stamp_job_id, 'stamp', p_stamp_id,
    p_stamp_operation_key, 1, expected_payload
  )
  on conflict (operation_key) do nothing;
  select * into job_record from public.blockchain_jobs job
  where job.operation_key = p_stamp_operation_key
  for update;
  if not found
     or job_record.id <> stamp_job_id
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
    passport_id, v_activity_id, 'knowledge', stamp_job_id
  )
  on conflict (passport_id, activity_id, stamp_type) do nothing;
  select * into stamp_record from public.stamps stamp
  where stamp.passport_id = passport_id
    and stamp.activity_id = v_activity_id
    and stamp.stamp_type = 'knowledge'
  for update;
  if not found
     or stamp_record.id <> p_stamp_id
     or stamp_record.app_user_id <> p_app_user_id
     or stamp_record.celebrity_id <> attempt_record.celebrity_id
     or stamp_record.blockchain_job_id <> stamp_job_id
     or stamp_record.mint_status <> 'queued' then
    raise exception 'G2_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  return public.build_owned_quiz_submit_result(p_app_user_id, p_attempt_id);
end;
$$;

revoke all on function public.submit_owned_quiz_attempt(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.submit_owned_quiz_attempt(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

comment on function public.submit_owned_quiz_attempt(uuid, uuid, uuid, text, text, text, text) is
  'Scores privately and atomically persists a pass, Passport, Knowledge activity, score, Stamp, and two queue jobs.';
