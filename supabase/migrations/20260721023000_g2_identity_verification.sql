-- G2 private fan verification, issued credential, activity, and score foundation.
-- All tables in this migration are server-only. Browser-facing APIs must return
-- explicit answer-free DTOs rather than exposing these relations.

create type public.quiz_attempt_status as enum ('open', 'passed', 'failed');
create type public.credential_mint_status as enum ('queued', 'processing', 'minted', 'retryable', 'permanent_failure');
create type public.fan_activity_type as enum ('knowledge', 'reservation', 'attendance', 'survey');

create table public.celebrity_quizzes (
  id uuid primary key default extensions.gen_random_uuid(),
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  version integer not null check (version > 0),
  status public.content_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (celebrity_id, version),
  unique (id, celebrity_id),
  unique (id, version),
  constraint celebrity_quizzes_publication_timestamp check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  )
);

create unique index celebrity_quizzes_one_published_per_celebrity
  on public.celebrity_quizzes (celebrity_id) where status = 'published';

create table public.celebrity_quiz_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  quiz_id uuid not null references public.celebrity_quizzes(id) on delete cascade,
  position smallint not null check (position > 0),
  prompt_ko text not null check (length(trim(prompt_ko)) between 1 and 1000),
  prompt_en text not null check (length(trim(prompt_en)) between 1 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, position),
  unique (id, quiz_id)
);

create table public.celebrity_quiz_options (
  id uuid primary key default extensions.gen_random_uuid(),
  question_id uuid not null references public.celebrity_quiz_questions(id) on delete cascade,
  position smallint not null check (position > 0),
  label_ko text not null check (length(trim(label_ko)) between 1 and 500),
  label_en text not null check (length(trim(label_en)) between 1 and 500),
  is_correct boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, position),
  unique (id, question_id)
);

create unique index celebrity_quiz_options_one_active_correct
  on public.celebrity_quiz_options (question_id)
  where active and is_correct;

create table public.quiz_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  quiz_id uuid not null,
  quiz_version integer not null check (quiz_version > 0),
  idempotency_key uuid not null,
  status public.quiz_attempt_status not null default 'open',
  score smallint check (score between 0 and 3),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_user_id, celebrity_id, idempotency_key),
  unique (id, app_user_id, celebrity_id),
  unique (id, quiz_id),
  constraint quiz_attempts_quiz_celebrity_fk
    foreign key (quiz_id, celebrity_id)
    references public.celebrity_quizzes (id, celebrity_id) on delete restrict,
  constraint quiz_attempts_quiz_version_fk
    foreign key (quiz_id, quiz_version)
    references public.celebrity_quizzes (id, version) on delete restrict,
  constraint quiz_attempts_terminal_result_consistent check (
    (status = 'open' and score is null and submitted_at is null)
    or (status = 'passed' and score between 2 and 3 and submitted_at is not null)
    or (status = 'failed' and score between 0 and 1 and submitted_at is not null)
  )
);

create unique index quiz_attempts_one_open_per_user_celebrity
  on public.quiz_attempts (app_user_id, celebrity_id) where status = 'open';

create table public.quiz_attempt_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid not null,
  quiz_id uuid not null,
  source_question_id uuid not null,
  position smallint not null check (position between 1 and 3),
  prompt_ko text not null check (length(trim(prompt_ko)) > 0),
  prompt_en text not null check (length(trim(prompt_en)) > 0),
  created_at timestamptz not null default now(),
  unique (attempt_id, position),
  unique (attempt_id, source_question_id),
  unique (id, attempt_id),
  unique (id, source_question_id),
  constraint quiz_attempt_questions_attempt_quiz_fk
    foreign key (attempt_id, quiz_id)
    references public.quiz_attempts (id, quiz_id) on delete restrict,
  constraint quiz_attempt_questions_source_quiz_fk
    foreign key (source_question_id, quiz_id)
    references public.celebrity_quiz_questions (id, quiz_id) on delete restrict
);

create table public.quiz_attempt_options (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_question_id uuid not null,
  source_question_id uuid not null,
  source_option_id uuid not null,
  position smallint not null check (position > 0),
  label_ko text not null check (length(trim(label_ko)) > 0),
  label_en text not null check (length(trim(label_en)) > 0),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique (attempt_question_id, position),
  unique (attempt_question_id, source_option_id),
  unique (id, attempt_question_id),
  constraint quiz_attempt_options_snapshot_question_fk
    foreign key (attempt_question_id, source_question_id)
    references public.quiz_attempt_questions (id, source_question_id) on delete restrict,
  constraint quiz_attempt_options_source_question_fk
    foreign key (source_option_id, source_question_id)
    references public.celebrity_quiz_options (id, question_id) on delete restrict
);

create table public.quiz_attempt_answers (
  attempt_id uuid not null,
  attempt_question_id uuid not null,
  selected_option_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, attempt_question_id),
  constraint quiz_attempt_answers_question_fk
    foreign key (attempt_question_id, attempt_id)
    references public.quiz_attempt_questions (id, attempt_id) on delete restrict,
  constraint quiz_attempt_answers_selected_option_fk
    foreign key (selected_option_id, attempt_question_id)
    references public.quiz_attempt_options (id, attempt_question_id) on delete restrict
);

create table public.quiz_passes (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  winning_attempt_id uuid not null unique,
  passed_at timestamptz not null default now(),
  unique (app_user_id, celebrity_id),
  unique (id, app_user_id, celebrity_id),
  constraint quiz_passes_winning_attempt_owner_fk
    foreign key (winning_attempt_id, app_user_id, celebrity_id)
    references public.quiz_attempts (id, app_user_id, celebrity_id) on delete restrict
);

create table public.fan_passports (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  quiz_pass_id uuid not null unique,
  business_status text not null default 'issued' check (business_status = 'issued'),
  mint_status public.credential_mint_status not null default 'queued',
  blockchain_job_id uuid unique references public.blockchain_jobs(id) on delete restrict,
  tx_hash text,
  token_id numeric(78, 0),
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_user_id, celebrity_id),
  unique (id, app_user_id, celebrity_id),
  constraint fan_passports_quiz_pass_owner_fk
    foreign key (quiz_pass_id, app_user_id, celebrity_id)
    references public.quiz_passes (id, app_user_id, celebrity_id) on delete restrict,
  constraint fan_passports_mint_result_consistent check (
    (
      mint_status = 'minted'
      and tx_hash is not null
      and tx_hash ~ '^0x[0-9a-fA-F]{64}$'
      and token_id is not null
      and token_id > 0
    )
    or (mint_status <> 'minted' and tx_hash is null and token_id is null)
  )
);

create table public.fan_activities (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  activity_type public.fan_activity_type not null,
  source_type text not null check (length(trim(source_type)) between 1 and 80),
  source_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (activity_type, source_type, source_id),
  unique (id, app_user_id, celebrity_id)
);

create table public.stamps (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  passport_id uuid not null,
  activity_id uuid not null,
  stamp_type text not null default 'knowledge' check (stamp_type = 'knowledge'),
  business_status text not null default 'issued' check (business_status = 'issued'),
  mint_status public.credential_mint_status not null default 'queued',
  blockchain_job_id uuid unique references public.blockchain_jobs(id) on delete restrict,
  tx_hash text,
  token_id numeric(78, 0),
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (passport_id, activity_id, stamp_type),
  constraint stamps_passport_owner_fk
    foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports (id, app_user_id, celebrity_id) on delete restrict,
  constraint stamps_activity_owner_fk
    foreign key (activity_id, app_user_id, celebrity_id)
    references public.fan_activities (id, app_user_id, celebrity_id) on delete restrict,
  constraint stamps_mint_result_consistent check (
    (
      mint_status = 'minted'
      and tx_hash is not null
      and tx_hash ~ '^0x[0-9a-fA-F]{64}$'
      and token_id is not null
      and token_id > 0
    )
    or (mint_status <> 'minted' and tx_hash is null and token_id is null)
  )
);

create table public.fan_score_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  activity_id uuid not null unique,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  points smallint not null,
  created_at timestamptz not null default now(),
  constraint fan_score_ledger_activity_owner_fk
    foreign key (activity_id, app_user_id, celebrity_id)
    references public.fan_activities (id, app_user_id, celebrity_id) on delete restrict
);

create index quiz_attempts_owner_created_idx
  on public.quiz_attempts (app_user_id, celebrity_id, created_at desc);
create index fan_passports_owner_idx
  on public.fan_passports (app_user_id, celebrity_id);
create index fan_activities_owner_occurred_idx
  on public.fan_activities (app_user_id, celebrity_id, occurred_at desc);
create index stamps_owner_issued_idx
  on public.stamps (app_user_id, celebrity_id, issued_at desc);
create index fan_score_ledger_owner_created_idx
  on public.fan_score_ledger (app_user_id, celebrity_id, created_at desc);

create trigger celebrity_quizzes_set_updated_at
before update on public.celebrity_quizzes
for each row execute function public.set_updated_at();
create trigger celebrity_quiz_questions_set_updated_at
before update on public.celebrity_quiz_questions
for each row execute function public.set_updated_at();
create trigger celebrity_quiz_options_set_updated_at
before update on public.celebrity_quiz_options
for each row execute function public.set_updated_at();
create trigger quiz_attempts_set_updated_at
before update on public.quiz_attempts
for each row execute function public.set_updated_at();
create trigger quiz_attempt_answers_set_updated_at
before update on public.quiz_attempt_answers
for each row execute function public.set_updated_at();
create trigger fan_passports_set_updated_at
before update on public.fan_passports
for each row execute function public.set_updated_at();
create trigger stamps_set_updated_at
before update on public.stamps
for each row execute function public.set_updated_at();

create function public.enforce_published_quiz_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_parent_status public.content_status;
  new_parent_status public.content_status;
begin
  if tg_table_name = 'celebrity_quizzes' then
    if old.status = 'published' then
      raise exception 'published quiz versions are immutable; create a new version';
    end if;
  elsif tg_table_name = 'celebrity_quiz_questions' then
    if tg_op <> 'INSERT' then
      select status into old_parent_status
      from public.celebrity_quizzes where id = old.quiz_id;
    end if;
    if tg_op <> 'DELETE' then
      select status into new_parent_status
      from public.celebrity_quizzes where id = new.quiz_id;
    end if;
    if old_parent_status = 'published' or new_parent_status = 'published' then
      raise exception 'published quiz versions are immutable; create a new version';
    end if;
  else
    if tg_op <> 'INSERT' then
      select quiz.status into old_parent_status
      from public.celebrity_quiz_questions question
      join public.celebrity_quizzes quiz on quiz.id = question.quiz_id
      where question.id = old.question_id;
    end if;
    if tg_op <> 'DELETE' then
      select quiz.status into new_parent_status
      from public.celebrity_quiz_questions question
      join public.celebrity_quizzes quiz on quiz.id = question.quiz_id
      where question.id = new.question_id;
    end if;
    if old_parent_status = 'published' or new_parent_status = 'published' then
      raise exception 'published quiz versions are immutable; create a new version';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger celebrity_quizzes_enforce_immutability
before update or delete on public.celebrity_quizzes
for each row execute function public.enforce_published_quiz_immutability();
create trigger celebrity_quiz_questions_enforce_immutability
before insert or update or delete on public.celebrity_quiz_questions
for each row execute function public.enforce_published_quiz_immutability();
create trigger celebrity_quiz_options_enforce_immutability
before insert or update or delete on public.celebrity_quiz_options
for each row execute function public.enforce_published_quiz_immutability();

create function public.prepare_quiz_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status = 'draft' then
    new.published_at := now();
  elsif new.status = 'draft' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger celebrity_quizzes_prepare_publication
before update of status on public.celebrity_quizzes
for each row execute function public.prepare_quiz_publication();

create function public.assert_quiz_publishable(target_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_status public.content_status;
begin
  select status into current_status
  from public.celebrity_quizzes
  where id = target_id;

  if current_status is null or current_status <> 'published' then
    return;
  end if;

  if (
    select count(*)
    from public.celebrity_quiz_questions
    where quiz_id = target_id and active
  ) < 3 then
    raise exception 'published quiz requires at least three active questions';
  end if;

  if exists (
    select 1
    from public.celebrity_quiz_questions question
    where question.quiz_id = target_id
      and question.active
      and (
        (
          select count(*)
          from public.celebrity_quiz_options option
          where option.question_id = question.id and option.active
        ) < 2
        or (
          select count(*)
          from public.celebrity_quiz_options option
          where option.question_id = question.id
            and option.active
            and option.is_correct
        ) <> 1
      )
  ) then
    raise exception 'published quiz questions require at least two active options and exactly one correct option';
  end if;
end;
$$;

create function public.validate_quiz_publication_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.assert_quiz_publishable(old.id);
    return old;
  end if;
  perform public.assert_quiz_publishable(new.id);
  return new;
end;
$$;

create function public.validate_quiz_question_publication_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.assert_quiz_publishable(old.quiz_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.quiz_id is distinct from old.quiz_id) then
    perform public.assert_quiz_publishable(new.quiz_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.validate_quiz_option_publication_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_target_quiz_id uuid;
  new_target_quiz_id uuid;
begin
  if tg_op <> 'INSERT' then
    select quiz_id into old_target_quiz_id
    from public.celebrity_quiz_questions where id = old.question_id;
    if old_target_quiz_id is not null then
      perform public.assert_quiz_publishable(old_target_quiz_id);
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select quiz_id into new_target_quiz_id
    from public.celebrity_quiz_questions where id = new.question_id;
    if new_target_quiz_id is not null
       and (tg_op = 'INSERT' or new_target_quiz_id is distinct from old_target_quiz_id) then
      perform public.assert_quiz_publishable(new_target_quiz_id);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger celebrity_quizzes_validate_publication
after insert or update on public.celebrity_quizzes
deferrable initially deferred for each row
execute function public.validate_quiz_publication_trigger();
create constraint trigger celebrity_quiz_questions_validate_publication
after insert or update or delete on public.celebrity_quiz_questions
deferrable initially deferred for each row
execute function public.validate_quiz_question_publication_trigger();
create constraint trigger celebrity_quiz_options_validate_publication
after insert or update or delete on public.celebrity_quiz_options
deferrable initially deferred for each row
execute function public.validate_quiz_option_publication_trigger();

create function public.enforce_quiz_attempt_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.app_user_id is distinct from old.app_user_id
     or new.celebrity_id is distinct from old.celebrity_id
     or new.quiz_id is distinct from old.quiz_id
     or new.quiz_version is distinct from old.quiz_version
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'quiz attempt identity is immutable';
  end if;

  if old.status <> 'open' then
    raise exception 'terminal quiz attempt is immutable';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('passed', 'failed') then
    raise exception 'quiz attempt transition must be open to passed or failed';
  end if;
  return new;
end;
$$;

create trigger quiz_attempts_enforce_transition
before update on public.quiz_attempts
for each row execute function public.enforce_quiz_attempt_transition();

create function public.validate_quiz_pass_winning_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.quiz_attempts
    where id = new.winning_attempt_id
      and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id
      and status = 'passed'
  ) then
    raise exception 'winning attempt must be passed and owned by the quiz pass';
  end if;
  return new;
end;
$$;

create trigger quiz_passes_validate_winning_attempt
before insert on public.quiz_passes
for each row execute function public.validate_quiz_pass_winning_attempt();

create function public.enforce_open_attempt_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_attempt_id uuid;
  new_attempt_id uuid;
begin
  if tg_table_name = 'quiz_attempt_questions' then
    if tg_op <> 'INSERT' then old_attempt_id := old.attempt_id; end if;
    if tg_op <> 'DELETE' then new_attempt_id := new.attempt_id; end if;
  elsif tg_table_name = 'quiz_attempt_options' then
    if tg_op <> 'INSERT' then
      select attempt_id into old_attempt_id
      from public.quiz_attempt_questions where id = old.attempt_question_id;
    end if;
    if tg_op <> 'DELETE' then
      select attempt_id into new_attempt_id
      from public.quiz_attempt_questions where id = new.attempt_question_id;
    end if;
  else
    if tg_op <> 'INSERT' then old_attempt_id := old.attempt_id; end if;
    if tg_op <> 'DELETE' then new_attempt_id := new.attempt_id; end if;
  end if;

  if (old_attempt_id is not null and not exists (
        select 1 from public.quiz_attempts where id = old_attempt_id and status = 'open'
      ))
     or (new_attempt_id is not null and not exists (
        select 1 from public.quiz_attempts where id = new_attempt_id and status = 'open'
      )) then
    raise exception 'quiz snapshot is immutable after attempt submission';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger quiz_attempt_questions_require_open_attempt
before insert or update or delete on public.quiz_attempt_questions
for each row execute function public.enforce_open_attempt_snapshot_mutation();
create trigger quiz_attempt_options_require_open_attempt
before insert or update or delete on public.quiz_attempt_options
for each row execute function public.enforce_open_attempt_snapshot_mutation();
create trigger quiz_attempt_answers_require_open_attempt
before insert or update or delete on public.quiz_attempt_answers
for each row execute function public.enforce_open_attempt_snapshot_mutation();

comment on table public.quiz_attempt_questions is
  'Attempt snapshot; a future atomic submit RPC must validate exactly three snapshot questions before terminal transition.';

create function public.validate_fan_activity_source()
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
  end if;
  return new;
end;
$$;

create trigger fan_activities_validate_source
before insert on public.fan_activities
for each row execute function public.validate_fan_activity_source();

create trigger fan_activities_00_validate_source_update
before update on public.fan_activities
for each row execute function public.validate_fan_activity_source();

create function public.reject_fan_activity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fan activity is append-only';
end;
$$;

create trigger fan_activities_append_only
before update or delete on public.fan_activities
for each row execute function public.reject_fan_activity_mutation();

create function public.validate_knowledge_stamp_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.fan_activities
    where id = new.activity_id
      and app_user_id = new.app_user_id
      and celebrity_id = new.celebrity_id
      and activity_type = 'knowledge'
  ) then
    raise exception 'knowledge stamp requires a knowledge activity';
  end if;
  return new;
end;
$$;

create trigger stamps_validate_knowledge_activity
before insert on public.stamps
for each row execute function public.validate_knowledge_stamp_activity();

create trigger stamps_validate_knowledge_activity_update
before update on public.stamps
for each row execute function public.validate_knowledge_stamp_activity();

create function public.validate_fan_score_weight()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_activity_type public.fan_activity_type;
  expected_points smallint;
begin
  select activity_type into strict source_activity_type
  from public.fan_activities
  where id = new.activity_id
    and app_user_id = new.app_user_id
    and celebrity_id = new.celebrity_id;

  expected_points := case source_activity_type
    when 'knowledge' then 1
    when 'reservation' then 1
    when 'attendance' then 3
    when 'survey' then 2
  end;

  if new.points <> expected_points then
    raise exception 'fan score points do not match activity type';
  end if;
  return new;
end;
$$;

create trigger fan_score_ledger_validate_weight
before insert on public.fan_score_ledger
for each row execute function public.validate_fan_score_weight();

create trigger fan_score_ledger_00_validate_weight_update
before update on public.fan_score_ledger
for each row execute function public.validate_fan_score_weight();

create function public.reject_fan_score_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fan score ledger is append-only';
end;
$$;

create trigger fan_score_ledger_append_only
before update or delete on public.fan_score_ledger
for each row execute function public.reject_fan_score_ledger_mutation();

create function public.enforce_credential_update()
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
     ) then
    raise exception 'invalid credential mint status transition';
  end if;
  return new;
end;
$$;

create trigger fan_passports_enforce_update
before update on public.fan_passports
for each row execute function public.enforce_credential_update();
create trigger stamps_enforce_update
before update on public.stamps
for each row execute function public.enforce_credential_update();

create function public.prevent_referenced_celebrity_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug = old.slug then
    return new;
  end if;

  if exists (select 1 from public.quiz_attempts where celebrity_id = old.id)
     or exists (select 1 from public.fan_passports where celebrity_id = old.id)
     or exists (select 1 from public.fan_activities where celebrity_id = old.id)
     or exists (
       select 1 from public.blockchain_jobs
       where payload ->> 'celebritySlug' = old.slug
     ) then
    raise exception 'celebrity slug is immutable after it is referenced';
  end if;
  return new;
end;
$$;

create trigger celebrities_preserve_referenced_slug
before update of slug on public.celebrities
for each row execute function public.prevent_referenced_celebrity_slug_change();

alter table public.celebrity_quizzes enable row level security;
alter table public.celebrity_quiz_questions enable row level security;
alter table public.celebrity_quiz_options enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_questions enable row level security;
alter table public.quiz_attempt_options enable row level security;
alter table public.quiz_attempt_answers enable row level security;
alter table public.quiz_passes enable row level security;
alter table public.fan_passports enable row level security;
alter table public.fan_activities enable row level security;
alter table public.stamps enable row level security;
alter table public.fan_score_ledger enable row level security;

revoke all on public.celebrity_quizzes from public, anon, authenticated;
revoke all on public.celebrity_quiz_questions from public, anon, authenticated;
revoke all on public.celebrity_quiz_options from public, anon, authenticated;
revoke all on public.quiz_attempts from public, anon, authenticated;
revoke all on public.quiz_attempt_questions from public, anon, authenticated;
revoke all on public.quiz_attempt_options from public, anon, authenticated;
revoke all on public.quiz_attempt_answers from public, anon, authenticated;
revoke all on public.quiz_passes from public, anon, authenticated;
revoke all on public.fan_passports from public, anon, authenticated;
revoke all on public.fan_activities from public, anon, authenticated;
revoke all on public.stamps from public, anon, authenticated;
revoke all on public.fan_score_ledger from public, anon, authenticated;

grant select, insert, update, delete on public.celebrity_quizzes to service_role;
grant select, insert, update, delete on public.celebrity_quiz_questions to service_role;
grant select, insert, update, delete on public.celebrity_quiz_options to service_role;
grant select, insert on public.quiz_attempts to service_role;
grant select, insert on public.quiz_attempt_questions to service_role;
grant select, insert on public.quiz_attempt_options to service_role;
grant select, insert, delete on public.quiz_attempt_answers to service_role;
grant update (selected_option_id, updated_at) on public.quiz_attempt_answers to service_role;
grant select, insert on public.quiz_passes to service_role;
grant select, insert on public.fan_passports to service_role;
grant update (mint_status, blockchain_job_id, tx_hash, token_id, updated_at) on public.fan_passports to service_role;
grant select, insert on public.fan_activities to service_role;
grant select, insert on public.stamps to service_role;
grant update (mint_status, blockchain_job_id, tx_hash, token_id, updated_at) on public.stamps to service_role;
grant select, insert on public.fan_score_ledger to service_role;

revoke all on function public.prepare_quiz_publication() from public, anon, authenticated;
revoke all on function public.enforce_published_quiz_immutability() from public, anon, authenticated;
revoke all on function public.assert_quiz_publishable(uuid) from public, anon, authenticated;
revoke all on function public.validate_quiz_publication_trigger() from public, anon, authenticated;
revoke all on function public.validate_quiz_question_publication_trigger() from public, anon, authenticated;
revoke all on function public.validate_quiz_option_publication_trigger() from public, anon, authenticated;
revoke all on function public.enforce_quiz_attempt_transition() from public, anon, authenticated;
revoke all on function public.validate_quiz_pass_winning_attempt() from public, anon, authenticated;
revoke all on function public.enforce_open_attempt_snapshot_mutation() from public, anon, authenticated;
revoke all on function public.validate_fan_activity_source() from public, anon, authenticated;
revoke all on function public.reject_fan_activity_mutation() from public, anon, authenticated;
revoke all on function public.validate_knowledge_stamp_activity() from public, anon, authenticated;
revoke all on function public.validate_fan_score_weight() from public, anon, authenticated;
revoke all on function public.reject_fan_score_ledger_mutation() from public, anon, authenticated;
revoke all on function public.enforce_credential_update() from public, anon, authenticated;
revoke all on function public.prevent_referenced_celebrity_slug_change() from public, anon, authenticated;

comment on table public.celebrity_quiz_options is
  'Private quiz answer bank. is_correct must never appear in a browser DTO.';
comment on table public.quiz_attempt_options is
  'Immutable private answer snapshot used only for server-side scoring.';
comment on table public.fan_score_ledger is
  'Append-only score events with points derived from the linked activity type.';
