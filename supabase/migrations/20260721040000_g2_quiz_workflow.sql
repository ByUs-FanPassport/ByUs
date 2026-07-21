-- G2 owner-scoped quiz workflow and atomic pass issuance boundary.

create function public.build_owned_quiz_attempt_projection(
  p_app_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', attempt.id,
      'status', attempt.status,
      'score', attempt.score,
      'submittedAt', attempt.submitted_at
    ),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'position', question.position,
          'promptKo', question.prompt_ko,
          'promptEn', question.prompt_en,
          'selectedOptionId', answer.selected_option_id,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'position', option.position,
                'labelKo', option.label_ko,
                'labelEn', option.label_en
              ) order by option.position, option.id
            )
            from public.quiz_attempt_options option
            where option.attempt_question_id = question.id
          ), '[]'::jsonb)
        ) order by question.position, question.id
      )
      from public.quiz_attempt_questions question
      left join public.quiz_attempt_answers answer
        on answer.attempt_id = attempt.id
       and answer.attempt_question_id = question.id
      where question.attempt_id = attempt.id
    ), '[]'::jsonb)
  )
  from public.quiz_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.app_user_id = p_app_user_id;
$$;

create function public.build_owned_quiz_submit_result(
  p_app_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_record public.quiz_attempts%rowtype;
  result jsonb;
  aggregate_count integer;
begin
  select * into attempt_record
  from public.quiz_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.app_user_id = p_app_user_id;
  if not found then
    raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if attempt_record.status = 'open' then
    raise exception 'G2_ATTEMPT_CLOSED' using errcode = '55000';
  end if;

  if attempt_record.status = 'failed' then
    return jsonb_build_object(
      'attempt', jsonb_build_object(
        'id', attempt_record.id,
        'status', attempt_record.status,
        'score', attempt_record.score,
        'submittedAt', attempt_record.submitted_at
      ),
      'issuance', null
    );
  end if;

  select count(*) into aggregate_count
  from public.quiz_passes pass
  join public.fan_passports passport
    on passport.quiz_pass_id = pass.id
   and passport.app_user_id = pass.app_user_id
   and passport.celebrity_id = pass.celebrity_id
   and passport.business_status = 'issued'
  join public.blockchain_jobs passport_job
    on passport_job.id = passport.blockchain_job_id
   and passport_job.entity_type = 'passport'
   and passport_job.entity_id = passport.id
   and passport_job.payload_version = 1
  join public.fan_activities activity
    on activity.app_user_id = pass.app_user_id
   and activity.celebrity_id = pass.celebrity_id
   and activity.activity_type = 'knowledge'
   and activity.source_type = 'quiz_pass'
   and activity.source_id = pass.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = activity.app_user_id
   and score.celebrity_id = activity.celebrity_id
   and score.points = 1
  join public.stamps stamp
    on stamp.passport_id = passport.id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = passport.app_user_id
   and stamp.celebrity_id = passport.celebrity_id
   and stamp.stamp_type = 'knowledge'
   and stamp.business_status = 'issued'
  join public.blockchain_jobs stamp_job
    on stamp_job.id = stamp.blockchain_job_id
   and stamp_job.entity_type = 'stamp'
   and stamp_job.entity_id = stamp.id
   and stamp_job.payload_version = 1
  where pass.winning_attempt_id = attempt_record.id
    and pass.app_user_id = p_app_user_id
    and passport.mint_status = case passport_job.status
      when 'PENDING' then 'queued'::public.credential_mint_status
      when 'PROCESSING' then 'processing'::public.credential_mint_status
      when 'RETRYING' then 'retryable'::public.credential_mint_status
      when 'FAILED' then 'permanent_failure'::public.credential_mint_status
      when 'COMPLETED' then 'minted'::public.credential_mint_status
    end
    and stamp.mint_status = case stamp_job.status
      when 'PENDING' then 'queued'::public.credential_mint_status
      when 'PROCESSING' then 'processing'::public.credential_mint_status
      when 'RETRYING' then 'retryable'::public.credential_mint_status
      when 'FAILED' then 'permanent_failure'::public.credential_mint_status
      when 'COMPLETED' then 'minted'::public.credential_mint_status
    end
    and (
      (passport_job.status = 'COMPLETED'
       and passport.tx_hash = passport_job.tx_hash
       and passport.token_id = passport_job.token_id)
      or (passport_job.status <> 'COMPLETED'
          and passport.tx_hash is null
          and passport.token_id is null)
    )
    and (
      (stamp_job.status = 'COMPLETED'
       and stamp.tx_hash = stamp_job.tx_hash
       and stamp.token_id = stamp_job.token_id)
      or (stamp_job.status <> 'COMPLETED'
          and stamp.tx_hash is null
          and stamp.token_id is null)
    );
  if aggregate_count <> 1 then
    raise exception 'G2_ISSUANCE_INCOMPLETE' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', attempt_record.id,
      'status', attempt_record.status,
      'score', attempt_record.score,
      'submittedAt', attempt_record.submitted_at
    ),
    'issuance', jsonb_build_object(
      'passportId', passport.id,
      'stampId', stamp.id,
      'scorePoints', score.points
    )
  ) into result
  from public.quiz_passes pass
  join public.fan_passports passport
    on passport.quiz_pass_id = pass.id
   and passport.app_user_id = pass.app_user_id
   and passport.celebrity_id = pass.celebrity_id
   and passport.business_status = 'issued'
  join public.blockchain_jobs passport_job
    on passport_job.id = passport.blockchain_job_id
   and passport_job.entity_type = 'passport'
   and passport_job.entity_id = passport.id
   and passport_job.payload_version = 1
  join public.fan_activities activity
    on activity.app_user_id = pass.app_user_id
   and activity.celebrity_id = pass.celebrity_id
   and activity.activity_type = 'knowledge'
   and activity.source_type = 'quiz_pass'
   and activity.source_id = pass.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = activity.app_user_id
   and score.celebrity_id = activity.celebrity_id
   and score.points = 1
  join public.stamps stamp
    on stamp.passport_id = passport.id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = passport.app_user_id
   and stamp.celebrity_id = passport.celebrity_id
   and stamp.stamp_type = 'knowledge'
   and stamp.business_status = 'issued'
  join public.blockchain_jobs stamp_job
    on stamp_job.id = stamp.blockchain_job_id
   and stamp_job.entity_type = 'stamp'
   and stamp_job.entity_id = stamp.id
   and stamp_job.payload_version = 1
  where pass.winning_attempt_id = attempt_record.id
    and pass.app_user_id = p_app_user_id
    and passport.mint_status = case passport_job.status
      when 'PENDING' then 'queued'::public.credential_mint_status
      when 'PROCESSING' then 'processing'::public.credential_mint_status
      when 'RETRYING' then 'retryable'::public.credential_mint_status
      when 'FAILED' then 'permanent_failure'::public.credential_mint_status
      when 'COMPLETED' then 'minted'::public.credential_mint_status
    end
    and stamp.mint_status = case stamp_job.status
      when 'PENDING' then 'queued'::public.credential_mint_status
      when 'PROCESSING' then 'processing'::public.credential_mint_status
      when 'RETRYING' then 'retryable'::public.credential_mint_status
      when 'FAILED' then 'permanent_failure'::public.credential_mint_status
      when 'COMPLETED' then 'minted'::public.credential_mint_status
    end
    and (
      (passport_job.status = 'COMPLETED'
       and passport.tx_hash = passport_job.tx_hash
       and passport.token_id = passport_job.token_id)
      or (passport_job.status <> 'COMPLETED'
          and passport.tx_hash is null
          and passport.token_id is null)
    )
    and (
      (stamp_job.status = 'COMPLETED'
       and stamp.tx_hash = stamp_job.tx_hash
       and stamp.token_id = stamp_job.token_id)
      or (stamp_job.status <> 'COMPLETED'
          and stamp.tx_hash is null
          and stamp.token_id is null)
    );
  return result;
end;
$$;

create function public.start_owned_quiz_attempt(
  p_app_user_id uuid,
  p_celebrity_slug text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  celebrity_record public.celebrities%rowtype;
  quiz_record public.celebrity_quizzes%rowtype;
  attempt_record public.quiz_attempts%rowtype;
  passport_id uuid;
  inserted_count integer;
begin
  if p_idempotency_key is null then
    raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '22023';
  end if;

  perform 1 from public.app_users app_user
  where app_user.id = p_app_user_id and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G2_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select celebrity.* into celebrity_record
  from public.celebrities celebrity
  where celebrity.slug = p_celebrity_slug
    and celebrity.status = 'published'
  for key share;
  if not found then
    raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '22023';
  end if;

  select passport.id into passport_id
  from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = celebrity_record.id;
  if found then
    return jsonb_build_object('kind', 'holder', 'passportId', passport_id);
  end if;

  select quiz.* into quiz_record
  from public.celebrity_quizzes quiz
  where quiz.celebrity_id = celebrity_record.id
    and quiz.status = 'published'
  for key share;
  if not found then
    raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '22023';
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.app_user_id = p_app_user_id
    and attempt.celebrity_id = celebrity_record.id
    and attempt.status = 'open'
  for update;
  if found then
    return public.build_owned_quiz_attempt_projection(p_app_user_id, attempt_record.id)
      || jsonb_build_object('kind', 'attempt');
  end if;

  select attempt.* into attempt_record
  from public.quiz_attempts attempt
  where attempt.app_user_id = p_app_user_id
    and attempt.celebrity_id = celebrity_record.id
    and attempt.idempotency_key = p_idempotency_key
  for update;
  if found then
    return public.build_owned_quiz_attempt_projection(p_app_user_id, attempt_record.id)
      || jsonb_build_object('kind', 'attempt');
  end if;

  insert into public.quiz_attempts(
    app_user_id, celebrity_id, quiz_id, quiz_version, idempotency_key
  ) values (
    p_app_user_id, celebrity_record.id, quiz_record.id, quiz_record.version, p_idempotency_key
  )
  on conflict (app_user_id, celebrity_id, idempotency_key) do nothing
  returning * into attempt_record;
  if not found then
    select attempt.* into strict attempt_record
    from public.quiz_attempts attempt
    where attempt.app_user_id = p_app_user_id
      and attempt.celebrity_id = celebrity_record.id
      and attempt.idempotency_key = p_idempotency_key
    for update;
    if attempt_record.quiz_id <> quiz_record.id
       or attempt_record.quiz_version <> quiz_record.version then
      raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '23514';
    end if;
    return public.build_owned_quiz_attempt_projection(p_app_user_id, attempt_record.id)
      || jsonb_build_object('kind', 'attempt');
  end if;

  with randomized as materialized (
    select source_question.*, random() as random_order
    from public.celebrity_quiz_questions source_question
    where source_question.quiz_id = quiz_record.id
      and source_question.active
    order by random_order, source_question.id
    limit 3
  )
  insert into public.quiz_attempt_questions(
    attempt_id, quiz_id, source_question_id, position, prompt_ko, prompt_en
  )
  select
    attempt_record.id,
    quiz_record.id,
    randomized.id,
    row_number() over (order by randomized.random_order, randomized.id)::smallint,
    randomized.prompt_ko,
    randomized.prompt_en
  from randomized;
  get diagnostics inserted_count = row_count;
  if inserted_count <> 3 then
    raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '23514';
  end if;

  insert into public.quiz_attempt_options(
    attempt_question_id,
    source_question_id,
    source_option_id,
    position,
    label_ko,
    label_en,
    is_correct
  )
  select
    snapshot_question.id,
    snapshot_question.source_question_id,
    source_option.id,
    source_option.position,
    source_option.label_ko,
    source_option.label_en,
    source_option.is_correct
  from public.quiz_attempt_questions snapshot_question
  join public.celebrity_quiz_options source_option
    on source_option.question_id = snapshot_question.source_question_id
   and source_option.active
  where snapshot_question.attempt_id = attempt_record.id
  order by snapshot_question.position, source_option.position, source_option.id;

  if exists (
    select 1
    from public.quiz_attempt_questions snapshot_question
    where snapshot_question.attempt_id = attempt_record.id
      and (
        select count(*)
        from public.quiz_attempt_options snapshot_option
        where snapshot_option.attempt_question_id = snapshot_question.id
      ) < 2
  ) then
    raise exception 'G2_QUIZ_UNAVAILABLE' using errcode = '23514';
  end if;

  return public.build_owned_quiz_attempt_projection(p_app_user_id, attempt_record.id)
    || jsonb_build_object('kind', 'attempt');
end;
$$;

create function public.get_owned_quiz_attempt(
  p_app_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := public.build_owned_quiz_attempt_projection(p_app_user_id, p_attempt_id);
  if result is null then
    raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create function public.save_owned_quiz_answer(
  p_app_user_id uuid,
  p_attempt_id uuid,
  p_attempt_question_id uuid,
  p_selected_option_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_status public.quiz_attempt_status;
begin
  perform 1 from public.app_users app_user
  where app_user.id = p_app_user_id and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G2_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select attempt.status into attempt_status
  from public.quiz_attempts attempt
  where attempt.id = p_attempt_id
    and attempt.app_user_id = p_app_user_id
  for update;
  if not found then
    raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if attempt_status <> 'open' then
    raise exception 'G2_ATTEMPT_CLOSED' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.quiz_attempt_questions question
    join public.quiz_attempt_options option
      on option.attempt_question_id = question.id
    where question.id = p_attempt_question_id
      and question.attempt_id = p_attempt_id
      and option.id = p_selected_option_id
  ) then
    raise exception 'G2_ANSWER_SELECTION_INVALID' using errcode = '22023';
  end if;

  insert into public.quiz_attempt_answers(
    attempt_id, attempt_question_id, selected_option_id
  ) values (
    p_attempt_id, p_attempt_question_id, p_selected_option_id
  )
  on conflict (attempt_id, attempt_question_id) do update
    set selected_option_id = excluded.selected_option_id;

  return public.build_owned_quiz_attempt_projection(p_app_user_id, p_attempt_id);
end;
$$;

create function public.get_owned_quiz_submit_context(
  p_app_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'attemptId', attempt.id,
    'status', attempt.status,
    'appUserId', attempt.app_user_id,
    'celebritySlug', celebrity.slug,
    'passportId', passport.id
  ) into result
  from public.quiz_attempts attempt
  join public.celebrities celebrity on celebrity.id = attempt.celebrity_id
  left join public.quiz_passes pass
    on pass.winning_attempt_id = attempt.id
   and pass.app_user_id = attempt.app_user_id
   and pass.celebrity_id = attempt.celebrity_id
  left join public.fan_passports passport
    on passport.quiz_pass_id = pass.id
   and passport.app_user_id = pass.app_user_id
   and passport.celebrity_id = pass.celebrity_id
  where attempt.id = p_attempt_id
    and attempt.app_user_id = p_app_user_id;
  if result is null then
    raise exception 'G2_ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create function public.submit_owned_quiz_attempt(
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
  activity_id uuid := extensions.gen_random_uuid();
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
    activity_id, p_app_user_id, attempt_record.celebrity_id,
    'knowledge', 'quiz_pass', pass_id
  )
  on conflict (activity_type, source_type, source_id) do nothing;
  if not exists (
    select 1 from public.fan_activities activity
    where activity.id = activity_id
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
    activity_id, p_app_user_id, attempt_record.celebrity_id, 1
  )
  on conflict (activity_id) do nothing;
  if not exists (
    select 1 from public.fan_score_ledger score
    where score.activity_id = activity_id
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
    passport_id, activity_id, 'knowledge', stamp_job_id
  )
  on conflict (passport_id, activity_id, stamp_type) do nothing;
  select * into stamp_record from public.stamps stamp
  where stamp.passport_id = passport_id
    and stamp.activity_id = activity_id
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

revoke all on function public.build_owned_quiz_attempt_projection(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.build_owned_quiz_submit_result(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.start_owned_quiz_attempt(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_owned_quiz_attempt(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.save_owned_quiz_answer(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_owned_quiz_submit_context(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_owned_quiz_attempt(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.start_owned_quiz_attempt(uuid, text, uuid)
  to service_role;
grant execute on function public.get_owned_quiz_attempt(uuid, uuid)
  to service_role;
grant execute on function public.save_owned_quiz_answer(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.get_owned_quiz_submit_context(uuid, uuid)
  to service_role;
grant execute on function public.submit_owned_quiz_attempt(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

-- The RPCs above are now the sole G2 end-user mutation boundary. Admin quiz
-- bank DML and worker queue RPC execution grants remain unchanged.
revoke insert on public.quiz_attempts from service_role;
revoke update (status, score, submitted_at, updated_at) on public.quiz_attempts
  from service_role;
revoke insert on public.quiz_attempt_questions from service_role;
revoke insert on public.quiz_attempt_options from service_role;
revoke insert, update, delete on public.quiz_attempt_answers from service_role;
revoke update (selected_option_id, updated_at) on public.quiz_attempt_answers
  from service_role;
revoke insert on public.quiz_passes from service_role;
revoke insert on public.fan_passports from service_role;
revoke update (mint_status, blockchain_job_id, tx_hash, token_id, updated_at)
  on public.fan_passports from service_role;
revoke insert on public.fan_activities from service_role;
revoke insert on public.stamps from service_role;
revoke update (mint_status, blockchain_job_id, tx_hash, token_id, updated_at)
  on public.stamps from service_role;
revoke insert on public.fan_score_ledger from service_role;
revoke insert on public.blockchain_jobs from service_role;
revoke insert (
  entity_type,
  entity_id,
  operation_key,
  payload_version,
  payload,
  max_attempts,
  idempotency_key,
  next_attempt_at
) on public.blockchain_jobs from service_role;

comment on function public.start_owned_quiz_attempt(uuid, text, uuid) is
  'Returns an existing holder/open attempt or snapshots three random questions once while preserving administrator option positions.';
comment on function public.submit_owned_quiz_attempt(uuid, uuid, uuid, text, text, text, text) is
  'Scores privately and atomically persists a pass, Passport, Knowledge activity, score, Stamp, and two queue jobs.';
