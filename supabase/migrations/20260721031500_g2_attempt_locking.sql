-- Serialize every G2 attempt snapshot/answer mutation with submission.
-- The owner row is locked before the attempt row so future owner-scoped answer
-- RPCs and the atomic submit RPC can use one deadlock-safe lock order.

create or replace function public.enforce_open_attempt_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_attempt_id uuid;
  new_attempt_id uuid;
  target_attempt_ids uuid[];
  expected_attempt_count integer;
  expected_owner_count integer;
  locked_row_count integer;
begin
  if tg_table_name = 'quiz_attempt_questions' then
    if tg_op <> 'INSERT' then old_attempt_id := old.attempt_id; end if;
    if tg_op <> 'DELETE' then new_attempt_id := new.attempt_id; end if;
  elsif tg_table_name = 'quiz_attempt_options' then
    if tg_op <> 'INSERT' then
      select question.attempt_id into old_attempt_id
      from public.quiz_attempt_questions question
      where question.id = old.attempt_question_id;
      if not found then
        raise exception 'quiz snapshot parent question does not exist';
      end if;
    end if;
    if tg_op <> 'DELETE' then
      select question.attempt_id into new_attempt_id
      from public.quiz_attempt_questions question
      where question.id = new.attempt_question_id;
      if not found then
        raise exception 'quiz snapshot parent question does not exist';
      end if;
    end if;
  elsif tg_table_name = 'quiz_attempt_answers' then
    if tg_op <> 'INSERT' then old_attempt_id := old.attempt_id; end if;
    if tg_op <> 'DELETE' then new_attempt_id := new.attempt_id; end if;
  else
    raise exception 'unsupported quiz attempt snapshot relation';
  end if;

  select array_agg(candidate.attempt_id order by candidate.attempt_id)
  into target_attempt_ids
  from (
    select distinct attempt_id
    from unnest(array[old_attempt_id, new_attempt_id]) as ids(attempt_id)
    where attempt_id is not null
  ) candidate;

  expected_attempt_count := coalesce(cardinality(target_attempt_ids), 0);
  if expected_attempt_count = 0 then
    raise exception 'quiz snapshot parent attempt does not exist';
  end if;

  select count(*), count(distinct attempt.app_user_id)
  into locked_row_count, expected_owner_count
  from public.quiz_attempts attempt
  where attempt.id = any(target_attempt_ids);
  if locked_row_count <> expected_attempt_count then
    raise exception 'quiz snapshot parent attempt does not exist';
  end if;

  -- Lock every canonical owner first. Attempt identity is immutable, so the
  -- owner set read above cannot change while these locks are acquired.
  perform 1
  from public.app_users app_user
  where app_user.id in (
    select distinct attempt.app_user_id
    from public.quiz_attempts attempt
    where attempt.id = any(target_attempt_ids)
  )
  order by app_user.id
  for key share;
  get diagnostics locked_row_count = row_count;
  if locked_row_count <> expected_owner_count then
    raise exception 'quiz snapshot parent owner does not exist';
  end if;

  -- UPDATE is intentional: submission takes this same attempt-row lock. An
  -- answer writer admitted before submission must finish first; one arriving
  -- after terminalization waits and then fails the open-state check below.
  perform 1
  from public.quiz_attempts attempt
  where attempt.id = any(target_attempt_ids)
  order by attempt.id
  for update;
  get diagnostics locked_row_count = row_count;
  if locked_row_count <> expected_attempt_count then
    raise exception 'quiz snapshot parent attempt does not exist';
  end if;

  if exists (
    select 1
    from public.quiz_attempts attempt
    where attempt.id = any(target_attempt_ids)
      and attempt.status <> 'open'
  ) then
    raise exception 'quiz snapshot is immutable after attempt submission';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.enforce_open_attempt_snapshot_mutation()
  from public, anon, authenticated;

comment on function public.enforce_open_attempt_snapshot_mutation() is
  'Locks canonical owners then parent attempts and permits snapshot or answer mutation only while every parent attempt is open.';
