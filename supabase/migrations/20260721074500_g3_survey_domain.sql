-- G3 FAN-016 versioned survey, private draft, and atomic submission domain.
-- A live_attendances row is the canonical completed-attendance fact.

create type public.live_survey_question_type as enum (
  'single_choice', 'multiple_choice', 'rating_1_5', 'free_text'
);
create type public.live_survey_common_question_key as enum (
  'overall_satisfaction', 'purchase_intent', 'future_interest', 'free_comment'
);
create type public.live_survey_response_status as enum ('draft', 'submitted');

create table public.live_surveys (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  version integer not null check (version > 0),
  publication_status public.content_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (live_event_id, version),
  unique (id, live_event_id),
  constraint live_surveys_publication_timestamp check (
    (publication_status = 'draft' and published_at is null)
    or (publication_status = 'published' and published_at is not null)
  )
);

create unique index live_surveys_one_published_per_live_idx
  on public.live_surveys (live_event_id)
  where publication_status = 'published';

create table public.live_survey_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  survey_id uuid not null references public.live_surveys(id) on delete restrict,
  question_type public.live_survey_question_type not null,
  common_key public.live_survey_common_question_key,
  is_required boolean not null default true,
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, position),
  unique (id, survey_id),
  unique (survey_id, common_key)
);

create table public.live_survey_question_localizations (
  question_id uuid not null references public.live_survey_questions(id) on delete restrict,
  locale public.content_locale not null,
  question_text text not null check (length(trim(question_text)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, locale)
);

create table public.live_survey_options (
  id uuid primary key default extensions.gen_random_uuid(),
  question_id uuid not null references public.live_survey_questions(id) on delete restrict,
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, position),
  unique (id, question_id)
);

create table public.live_survey_option_localizations (
  option_id uuid not null references public.live_survey_options(id) on delete restrict,
  locale public.content_locale not null,
  label text not null check (length(trim(label)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (option_id, locale)
);

-- Include live_event_id in the canonical attendance ownership key so a survey
-- response cannot bind an attendance from another Live of the same celebrity.
alter table public.live_attendances
  add constraint live_attendances_response_owner_unique
  unique (id, app_user_id, live_event_id, celebrity_id);

create table public.live_survey_responses (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  survey_id uuid not null,
  attendance_id uuid not null,
  passport_id uuid not null,
  status public.live_survey_response_status not null default 'draft',
  revision integer not null default 0 check (revision >= 0),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_user_id, live_event_id),
  unique (id, app_user_id, celebrity_id),
  constraint live_survey_responses_submission_state check (
    (status = 'draft' and submitted_at is null)
    or (status = 'submitted' and submitted_at is not null)
  ),
  constraint live_survey_responses_survey_live_fk
    foreign key (survey_id, live_event_id)
    references public.live_surveys(id, live_event_id) on delete restrict,
  constraint live_survey_responses_attendance_fk
    foreign key (attendance_id, app_user_id, live_event_id, celebrity_id)
    references public.live_attendances(id, app_user_id, live_event_id, celebrity_id)
    on delete restrict,
  constraint live_survey_responses_passport_fk
    foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports(id, app_user_id, celebrity_id) on delete restrict
);

create table public.live_survey_answers (
  response_id uuid not null references public.live_survey_responses(id) on delete restrict,
  question_id uuid not null references public.live_survey_questions(id) on delete restrict,
  selected_option_ids uuid[],
  rating smallint,
  free_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (response_id, question_id),
  constraint live_survey_answers_one_value check (
    num_nonnulls(selected_option_ids, rating, free_text) = 1
  ),
  constraint live_survey_answers_rating_range check (rating is null or rating between 1 and 5),
  constraint live_survey_answers_free_text_length check (free_text is null or length(free_text) <= 4000),
  constraint live_survey_answers_selected_options_nonempty check (
    selected_option_ids is null or cardinality(selected_option_ids) > 0
  )
);

create table public.live_survey_idempotency (
  idempotency_key uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  operation text not null check (operation in ('save_draft', 'submit')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_id uuid not null references public.live_survey_responses(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index live_survey_responses_owner_idx
  on public.live_survey_responses(app_user_id, updated_at desc);
create index live_survey_answers_question_idx
  on public.live_survey_answers(question_id);
create index live_survey_idempotency_target_idx
  on public.live_survey_idempotency(app_user_id, live_event_id, created_at desc);

create trigger live_surveys_set_updated_at before update on public.live_surveys
  for each row execute function public.set_updated_at();
create trigger live_survey_questions_set_updated_at before update on public.live_survey_questions
  for each row execute function public.set_updated_at();
create trigger live_survey_question_localizations_set_updated_at before update on public.live_survey_question_localizations
  for each row execute function public.set_updated_at();
create trigger live_survey_options_set_updated_at before update on public.live_survey_options
  for each row execute function public.set_updated_at();
create trigger live_survey_option_localizations_set_updated_at before update on public.live_survey_option_localizations
  for each row execute function public.set_updated_at();
create trigger live_survey_responses_set_updated_at before update on public.live_survey_responses
  for each row execute function public.set_updated_at();
create trigger live_survey_answers_set_updated_at before update on public.live_survey_answers
  for each row execute function public.set_updated_at();

create function public.assert_live_survey_publishable(p_survey_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare survey_record public.live_surveys%rowtype;
begin
  select * into survey_record from public.live_surveys where id = p_survey_id;
  if not found or survey_record.publication_status <> 'published' then return; end if;
  if not exists (
    select 1 from public.live_events live
    where live.id = survey_record.live_event_id and live.publication_status = 'published'
  ) then raise exception 'published survey requires a published live'; end if;
  if (select count(*) from public.live_survey_questions where survey_id = p_survey_id) not between 4 and 6
     or (select min(position) from public.live_survey_questions where survey_id = p_survey_id) <> 1
     or (select max(position) from public.live_survey_questions where survey_id = p_survey_id) <>
        (select count(*) from public.live_survey_questions where survey_id = p_survey_id)
     or (select count(*) from public.live_survey_questions where survey_id = p_survey_id and common_key is not null) <> 4
     or exists (
       select 1 from unnest(enum_range(null::public.live_survey_common_question_key)) required(common_key)
       where not exists (
         select 1 from public.live_survey_questions question
         where question.survey_id = p_survey_id and question.common_key = required.common_key
       )
     ) then
    raise exception 'published survey requires four canonical common questions and zero to two additional questions in contiguous order';
  end if;
  if exists (
    select 1 from public.live_survey_questions question
    where question.survey_id = p_survey_id
      and (
        (select count(*) from public.live_survey_question_localizations localization
         where localization.question_id = question.id) <> 2
        or exists (
          select 1 from unnest(enum_range(null::public.content_locale)) required(locale)
          where not exists (
            select 1 from public.live_survey_question_localizations localization
            where localization.question_id = question.id and localization.locale = required.locale
          )
        )
        or (question.question_type in ('single_choice', 'multiple_choice') and (
          (select count(*) from public.live_survey_options option where option.question_id = question.id) < 2
          or exists (
            select 1 from public.live_survey_options option
            where option.question_id = question.id and (
              select count(*) from public.live_survey_option_localizations localization
              where localization.option_id = option.id
            ) <> 2
          )
        ))
        or (question.question_type in ('rating_1_5', 'free_text') and exists (
          select 1 from public.live_survey_options option where option.question_id = question.id
        ))
      )
  ) then raise exception 'published survey requires complete localized questions and valid options'; end if;
end;
$$;

create function public.prepare_live_survey_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.publication_status = 'published' and old.publication_status = 'draft' then
    new.published_at := now();
  elsif new.publication_status = 'draft' then new.published_at := null;
  end if;
  return new;
end;
$$;
create trigger live_surveys_prepare_publication before update of publication_status on public.live_surveys
  for each row execute function public.prepare_live_survey_publication();

create function public.validate_live_survey_publication()
returns trigger language plpgsql set search_path = '' as $$
begin perform public.assert_live_survey_publishable(coalesce(new.id, old.id)); return coalesce(new, old); end;
$$;
create constraint trigger live_surveys_validate_publication after insert or update on public.live_surveys
  deferrable initially deferred for each row execute function public.validate_live_survey_publication();

create function public.reject_live_survey_snapshot_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare target_survey_id uuid;
begin
  if tg_table_name = 'live_surveys' then target_survey_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'live_survey_questions' then target_survey_id := coalesce(new.survey_id, old.survey_id);
  elsif tg_table_name = 'live_survey_question_localizations' then
    select survey_id into strict target_survey_id from public.live_survey_questions where id = coalesce(new.question_id, old.question_id);
  elsif tg_table_name = 'live_survey_options' then
    select survey_id into strict target_survey_id from public.live_survey_questions where id = coalesce(new.question_id, old.question_id);
  else
    select question.survey_id into strict target_survey_id
    from public.live_survey_options option join public.live_survey_questions question on question.id = option.question_id
    where option.id = coalesce(new.option_id, old.option_id);
  end if;
  if exists (
    select 1 from public.live_surveys where id = target_survey_id and publication_status = 'published'
  ) then raise exception 'published survey snapshots are immutable'; end if;
  if exists (select 1 from public.live_survey_responses where survey_id = target_survey_id) then
    raise exception 'survey snapshots with responses are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger live_surveys_protect_snapshot before update or delete on public.live_surveys
  for each row execute function public.reject_live_survey_snapshot_mutation();
create trigger live_survey_questions_protect_snapshot before insert or update or delete on public.live_survey_questions
  for each row execute function public.reject_live_survey_snapshot_mutation();
create trigger live_survey_question_localizations_protect_snapshot before insert or update or delete on public.live_survey_question_localizations
  for each row execute function public.reject_live_survey_snapshot_mutation();
create trigger live_survey_options_protect_snapshot before insert or update or delete on public.live_survey_options
  for each row execute function public.reject_live_survey_snapshot_mutation();
create trigger live_survey_option_localizations_protect_snapshot before insert or update or delete on public.live_survey_option_localizations
  for each row execute function public.reject_live_survey_snapshot_mutation();

create function public.reject_live_survey_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'survey domain tables cannot be truncated'; end;
$$;
create trigger live_surveys_reject_truncate before truncate on public.live_surveys
  for each statement execute function public.reject_live_survey_truncate();
create trigger live_survey_questions_reject_truncate before truncate on public.live_survey_questions
  for each statement execute function public.reject_live_survey_truncate();
create trigger live_survey_question_localizations_reject_truncate before truncate on public.live_survey_question_localizations
  for each statement execute function public.reject_live_survey_truncate();
create trigger live_survey_options_reject_truncate before truncate on public.live_survey_options
  for each statement execute function public.reject_live_survey_truncate();
create trigger live_survey_option_localizations_reject_truncate before truncate on public.live_survey_option_localizations
  for each statement execute function public.reject_live_survey_truncate();

create function public.reject_submitted_live_survey_response_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status = 'submitted' then raise exception 'submitted survey response is immutable'; end if;
  if new.id is distinct from old.id or new.app_user_id is distinct from old.app_user_id
     or new.live_event_id is distinct from old.live_event_id or new.celebrity_id is distinct from old.celebrity_id
     or new.survey_id is distinct from old.survey_id or new.attendance_id is distinct from old.attendance_id
     or new.passport_id is distinct from old.passport_id or new.revision < old.revision
     or (old.status = 'draft' and new.status not in ('draft', 'submitted')) then
    raise exception 'survey response identity and state are immutable';
  end if;
  return new;
end;
$$;
create trigger live_survey_responses_protect_submission before update or delete on public.live_survey_responses
  for each row execute function public.reject_submitted_live_survey_response_mutation();

create function public.reject_submitted_live_survey_answer_mutation()
returns trigger language plpgsql set search_path = '' as $$
declare response_status public.live_survey_response_status;
begin
  select status into strict response_status from public.live_survey_responses
  where id = coalesce(new.response_id, old.response_id);
  if response_status <> 'draft' then raise exception 'submitted survey answers are immutable'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger live_survey_answers_protect_submission before insert or update or delete on public.live_survey_answers
  for each row execute function public.reject_submitted_live_survey_answer_mutation();

create function public.validate_and_replace_live_survey_answers(
  p_response_id uuid, p_survey_id uuid, p_answers jsonb, p_require_complete boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; question_record public.live_survey_questions%rowtype; question_id uuid;
  selected_ids uuid[]; rating_value smallint; free_text_value text;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 100 then
    raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) value where jsonb_typeof(value) <> 'object')
     or (select count(*) from jsonb_array_elements(p_answers)) <>
        (select count(distinct value ->> 'questionId') from jsonb_array_elements(p_answers) value) then
    raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023';
  end if;
  delete from public.live_survey_answers where response_id = p_response_id;
  for item in select value from jsonb_array_elements(p_answers) value loop
    begin question_id := (item ->> 'questionId')::uuid;
    exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
    select * into question_record from public.live_survey_questions
    where id = question_id and survey_id = p_survey_id;
    if not found then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
    if question_record.question_type in ('single_choice', 'multiple_choice') then
      if not (item ? 'selectedOptionIds') or jsonb_typeof(item -> 'selectedOptionIds') <> 'array'
         or item ? 'rating' or item ? 'freeText' then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      begin select array_agg(value::uuid order by value) into selected_ids from jsonb_array_elements_text(item -> 'selectedOptionIds') value;
      exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
      if selected_ids is null or cardinality(selected_ids) = 0
         or cardinality(selected_ids) <> (select count(distinct value) from unnest(selected_ids) value)
         or (question_record.question_type = 'single_choice' and cardinality(selected_ids) <> 1)
         or exists (select 1 from unnest(selected_ids) option_id where not exists (
           select 1 from public.live_survey_options option where option.id = option_id and option.question_id = question_id
         )) then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, selected_option_ids)
      values (p_response_id, question_id, selected_ids);
    elsif question_record.question_type = 'rating_1_5' then
      if not (item ? 'rating') or item ? 'selectedOptionIds' or item ? 'freeText' then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      begin rating_value := (item ->> 'rating')::smallint;
      exception when others then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end;
      if rating_value not between 1 and 5 then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, rating) values (p_response_id, question_id, rating_value);
    else
      if not (item ? 'freeText') or item ? 'selectedOptionIds' or item ? 'rating' or jsonb_typeof(item -> 'freeText') <> 'string' then
        raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      free_text_value := item ->> 'freeText';
      if length(free_text_value) > 4000 or (p_require_complete and length(trim(free_text_value)) = 0) then
        raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
      insert into public.live_survey_answers(response_id, question_id, free_text) values (p_response_id, question_id, free_text_value);
    end if;
  end loop;
  if p_require_complete and exists (
    select 1 from public.live_survey_questions question
    where question.survey_id = p_survey_id and question.is_required
      and not exists (select 1 from public.live_survey_answers answer where answer.response_id = p_response_id and answer.question_id = question.id)
  ) then raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023'; end if;
end;
$$;

create function public.build_owned_live_survey_submission_result(p_app_user_id uuid, p_response_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('response', jsonb_build_object(
    'status', 'submitted', 'submittedAt', response.submitted_at, 'activityId', activity.id,
    'scorePoints', score.points, 'stamp', jsonb_build_object(
      'id', stamp.id, 'businessStatus', stamp.business_status, 'mintStatus', stamp.mint_status
    )
  ))
  from public.live_survey_responses response
  join public.fan_activities activity on activity.app_user_id = response.app_user_id
    and activity.celebrity_id = response.celebrity_id and activity.activity_type = 'survey'
    and activity.source_type = 'live_survey_response' and activity.source_id = response.id
  join public.fan_score_ledger score on score.activity_id = activity.id and score.app_user_id = response.app_user_id
  join public.stamps stamp on stamp.activity_id = activity.id and stamp.passport_id = response.passport_id
    and stamp.app_user_id = response.app_user_id and stamp.celebrity_id = response.celebrity_id and stamp.stamp_type = 'survey'
  where response.id = p_response_id and response.app_user_id = p_app_user_id and response.status = 'submitted';
$$;

create function public.build_owned_live_survey_draft_result(p_app_user_id uuid, p_response_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('response', jsonb_build_object(
    'status', 'draft', 'revision', response.revision, 'answers', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'questionId', answer.question_id, 'selectedOptionIds', answer.selected_option_ids,
      'rating', answer.rating, 'freeText', answer.free_text
    )) order by question.position) from public.live_survey_answers answer
      join public.live_survey_questions question on question.id = answer.question_id where answer.response_id = response.id), '[]'::jsonb),
    'updatedAt', response.updated_at
  )) from public.live_survey_responses response
  where response.id = p_response_id and response.app_user_id = p_app_user_id and response.status = 'draft';
$$;

create function public.get_owned_live_survey(p_app_user_id uuid, p_live_slug text, p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'survey', jsonb_build_object('id', survey.id, 'version', survey.version, 'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', question.id, 'type', question.question_type, 'question', localization.question_text,
        'required', question.is_required, 'order', question.position, 'options', coalesce((
          select jsonb_agg(jsonb_build_object('id', option.id, 'label', option_localization.label, 'order', option.position) order by option.position)
          from public.live_survey_options option join public.live_survey_option_localizations option_localization
            on option_localization.option_id = option.id and option_localization.locale = p_locale
          where option.question_id = question.id
        ), '[]'::jsonb)) order by question.position)
      from public.live_survey_questions question join public.live_survey_question_localizations localization
        on localization.question_id = question.id and localization.locale = p_locale
      where question.survey_id = survey.id
    ), '[]'::jsonb)),
    'eligibility', jsonb_build_object('completedAttendance', attendance.id is not null),
    'response', case when response.id is null then null else jsonb_build_object(
      'status', response.status, 'revision', response.revision, 'answers', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'questionId', answer.question_id, 'selectedOptionIds', answer.selected_option_ids,
        'rating', answer.rating, 'freeText', answer.free_text
      )) order by question.position) from public.live_survey_answers answer join public.live_survey_questions question
        on question.id = answer.question_id where answer.response_id = response.id), '[]'::jsonb),
      'submittedAt', response.submitted_at
    ) end
  )
  from public.live_events live join public.live_surveys survey on survey.live_event_id = live.id and survey.publication_status = 'published'
  left join public.live_attendances attendance on attendance.app_user_id = p_app_user_id and attendance.live_event_id = live.id
  left join public.live_survey_responses response on response.app_user_id = p_app_user_id and response.live_event_id = live.id
  where live.slug = p_live_slug and live.publication_status = 'published';
$$;

create function public.get_or_create_owned_live_survey_response(p_app_user_id uuid, p_live_slug text)
returns public.live_survey_responses language plpgsql security definer set search_path = '' as $$
declare result public.live_survey_responses%rowtype; live_record public.live_events%rowtype;
  survey_record public.live_surveys%rowtype; attendance_record public.live_attendances%rowtype;
  passport_record public.fan_passports%rowtype;
begin
  select * into live_record from public.live_events where slug = p_live_slug and publication_status = 'published' for key share;
  if not found then raise exception 'G3_SURVEY_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into survey_record from public.live_surveys where live_event_id = live_record.id and publication_status = 'published' for key share;
  if not found then raise exception 'G3_SURVEY_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into attendance_record from public.live_attendances where app_user_id = p_app_user_id and live_event_id = live_record.id for key share;
  if not found then raise exception 'G3_ATTENDANCE_REQUIRED' using errcode = '42501'; end if;
  select * into passport_record from public.fan_passports where app_user_id = p_app_user_id and celebrity_id = live_record.celebrity_id and business_status = 'issued' for key share;
  if not found then raise exception 'G3_SURVEY_PASSPORT_REQUIRED' using errcode = '42501'; end if;
  select * into result from public.live_survey_responses where app_user_id = p_app_user_id and live_event_id = live_record.id for update;
  if not found then
    insert into public.live_survey_responses(app_user_id, live_event_id, celebrity_id, survey_id, attendance_id, passport_id)
    values (p_app_user_id, live_record.id, live_record.celebrity_id, survey_record.id, attendance_record.id, passport_record.id)
    returning * into result;
  end if;
  return result;
end;
$$;

create function public.save_owned_live_survey_draft(
  p_app_user_id uuid, p_live_slug text, p_idempotency_key uuid,
  p_expected_revision integer, p_answers jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare response_record public.live_survey_responses%rowtype; idempotency_record public.live_survey_idempotency%rowtype;
  live_id uuid; request_hash text; result jsonb;
begin
  if p_app_user_id is null or p_idempotency_key is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'G3_SURVEY_INVALID_ANSWERS' using errcode = '22023';
  end if;
  request_hash := encode(extensions.digest(
    jsonb_build_object('expectedRevision', p_expected_revision, 'answers', p_answers)::text,
    'sha256'
  ), 'hex');
  select id into live_id from public.live_events where slug = p_live_slug;
  if live_id is null then raise exception 'G3_SURVEY_NOT_FOUND' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:key:' || p_idempotency_key::text, 0));
  select * into idempotency_record from public.live_survey_idempotency where idempotency_key = p_idempotency_key for update;
  if found then
    if idempotency_record.app_user_id <> p_app_user_id or idempotency_record.live_event_id <> live_id
       or idempotency_record.operation <> 'save_draft'
       or idempotency_record.request_hash <> request_hash then raise exception 'G3_SURVEY_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514'; end if;
    return idempotency_record.result;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('g3:survey:target:' || p_app_user_id::text || ':' || live_id::text, 0));
  perform 1 from public.app_users where id = p_app_user_id and status = 'active' for update;
  if not found then raise exception 'G3_SURVEY_USER_UNAVAILABLE' using errcode = '42501'; end if;
  response_record := public.get_or_create_owned_live_survey_response(p_app_user_id, p_live_slug);
  if response_record.status = 'submitted' then raise exception 'G3_SURVEY_ALREADY_SUBMITTED' using errcode = '55000'; end if;
  if response_record.revision <> p_expected_revision then
    raise exception 'G3_SURVEY_REVISION_CONFLICT' using errcode = '40001';
  end if;
  perform public.validate_and_replace_live_survey_answers(response_record.id, response_record.survey_id, p_answers, false);
  update public.live_survey_responses set revision = revision + 1
  where id = response_record.id and revision = p_expected_revision returning * into response_record;
  if not found then raise exception 'G3_SURVEY_REVISION_CONFLICT' using errcode = '40001'; end if;
  result := public.build_owned_live_survey_draft_result(p_app_user_id, response_record.id);
  insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
  values (p_idempotency_key, p_app_user_id, response_record.live_event_id, 'save_draft', request_hash, response_record.id, result);
  return result;
end;
$$;

create function public.submit_owned_live_survey(
  p_app_user_id uuid, p_live_slug text, p_idempotency_key uuid, p_answers jsonb,
  p_stamp_id uuid, p_stamp_operation_key text, p_stamp_issuance_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare response_record public.live_survey_responses%rowtype; existing public.live_survey_idempotency%rowtype;
  live_id uuid; request_hash text; recipient text; celebrity_slug text; result jsonb;
  activity_id uuid := extensions.gen_random_uuid(); job_id uuid := extensions.gen_random_uuid(); expected_payload jsonb; job_record public.blockchain_jobs%rowtype;
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
  insert into public.fan_score_ledger(activity_id, app_user_id, celebrity_id, points)
  values (activity_id, p_app_user_id, response_record.celebrity_id, 2);
  expected_payload := jsonb_build_object('recipient', recipient, 'celebritySlug', celebrity_slug, 'issuanceId', p_stamp_issuance_id, 'stampType', 'Survey');
  insert into public.blockchain_jobs(id, entity_type, entity_id, operation_key, payload_version, payload)
  values (job_id, 'stamp', p_stamp_id, p_stamp_operation_key, 1, expected_payload) on conflict (operation_key) do nothing;
  select * into job_record from public.blockchain_jobs where operation_key = p_stamp_operation_key for update;
  if not found or job_record.id <> job_id or job_record.entity_type <> 'stamp' or job_record.entity_id <> p_stamp_id
     or job_record.payload_version <> 1 or job_record.payload <> expected_payload or job_record.status <> 'PENDING' then
    raise exception 'G3_SURVEY_ISSUANCE_CONFLICT' using errcode = '23514'; end if;
  insert into public.stamps(id, app_user_id, celebrity_id, passport_id, activity_id, stamp_type, blockchain_job_id)
  values (p_stamp_id, p_app_user_id, response_record.celebrity_id, response_record.passport_id, activity_id, 'survey', job_id);
  result := public.build_owned_live_survey_submission_result(p_app_user_id, response_record.id);
  if result is null then raise exception 'G3_SURVEY_INTEGRITY_ERROR' using errcode = '23514'; end if;
  insert into public.live_survey_idempotency(idempotency_key, app_user_id, live_event_id, operation, request_hash, response_id, result)
  values (p_idempotency_key, p_app_user_id, response_record.live_event_id, 'submit', request_hash, response_record.id, result);
  return result;
end;
$$;

create or replace function public.validate_fan_activity_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.activity_type = 'knowledge' and (new.source_type <> 'quiz_pass' or not exists (
    select 1 from public.quiz_passes where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'knowledge activity must reference an owned quiz pass';
  elsif new.activity_type = 'reservation' and (new.source_type <> 'live_reservation' or not exists (
    select 1 from public.live_reservations where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'reservation activity must reference an owned live reservation for the same celebrity';
  elsif new.activity_type = 'attendance' and (new.source_type <> 'live_attendance' or not exists (
    select 1 from public.live_attendances where id = new.source_id and app_user_id = new.app_user_id and celebrity_id = new.celebrity_id
  )) then raise exception 'attendance activity must reference an owned live attendance for the same celebrity';
  elsif new.activity_type = 'survey' and (new.source_type <> 'live_survey_response' or not exists (
    select 1 from public.live_survey_responses where id = new.source_id and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id and status = 'submitted'
  )) then raise exception 'survey activity must reference an owned submitted response for the same celebrity';
  end if;
  return new;
end;
$$;

alter table public.live_surveys enable row level security;
alter table public.live_survey_questions enable row level security;
alter table public.live_survey_question_localizations enable row level security;
alter table public.live_survey_options enable row level security;
alter table public.live_survey_option_localizations enable row level security;
alter table public.live_survey_responses enable row level security;
alter table public.live_survey_answers enable row level security;
alter table public.live_survey_idempotency enable row level security;
alter table public.live_surveys force row level security;
alter table public.live_survey_questions force row level security;
alter table public.live_survey_question_localizations force row level security;
alter table public.live_survey_options force row level security;
alter table public.live_survey_option_localizations force row level security;
alter table public.live_survey_responses force row level security;
alter table public.live_survey_answers force row level security;
alter table public.live_survey_idempotency force row level security;

revoke all on public.live_surveys, public.live_survey_questions, public.live_survey_question_localizations,
  public.live_survey_options, public.live_survey_option_localizations, public.live_survey_responses,
  public.live_survey_answers, public.live_survey_idempotency from public, anon, authenticated;
revoke all on function public.get_owned_live_survey(uuid, text, public.content_locale) from public, anon, authenticated;
revoke all on function public.save_owned_live_survey_draft(uuid, text, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.submit_owned_live_survey(uuid, text, uuid, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function public.build_owned_live_survey_submission_result(uuid, uuid) from public, anon, authenticated;
revoke all on function public.build_owned_live_survey_draft_result(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_or_create_owned_live_survey_response(uuid, text) from public, anon, authenticated;
revoke all on function public.validate_and_replace_live_survey_answers(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.get_owned_live_survey(uuid, text, public.content_locale) to service_role;
grant execute on function public.save_owned_live_survey_draft(uuid, text, uuid, integer, jsonb) to service_role;
grant execute on function public.submit_owned_live_survey(uuid, text, uuid, jsonb, uuid, text, text) to service_role;
revoke insert, update, delete, truncate on public.live_survey_responses, public.live_survey_answers,
  public.live_survey_idempotency from service_role;

comment on column public.live_survey_answers.free_text is
  'Private raw owner response. Never project into blockchain jobs, general audit logs, or public/admin list projections.';
comment on function public.submit_owned_live_survey(uuid, text, uuid, jsonb, uuid, text, text) is
  'Atomically finalizes one attendance-eligible survey response and issues +2, Survey activity, Stamp, and one queue job.';
