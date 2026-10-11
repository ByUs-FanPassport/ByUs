\set ON_ERROR_STOP on

\ir ../../migrations/20261011110000_brand_passports.sql

do $$
begin
  if exists(select 1 from pg_trigger where tgname in (
      'celebrity_quizzes_reject_brand','fan_passports_reject_brand'
    ) and not tgisinternal)
    or to_regprocedure('public.reject_brand_quiz_or_passport()') is not null then
    raise exception 'brand quiz/passport rejection objects remain';
  end if;
  if (select count(*) from public.fan_activities
      where celebrity_id='95600000-0000-4000-8000-000000000003'
        and activity_type='first_reaction' and source_type='fan_reaction')<>2
    or (select count(*) from public.first_reaction_stamps
      where celebrity_id='95600000-0000-4000-8000-000000000003')<>2 then
    raise exception 'brand reaction backfill was missing or duplicated';
  end if;
  if not exists(select 1 from public.first_reaction_stamps stamp
      join public.fan_reactions reaction on reaction.id=stamp.reaction_id
      where stamp.reaction_id='95600000-0000-4000-8000-000000000004'
        and stamp.passport_id is null and stamp.mint_status='minted'
        and stamp.tx_hash='0x'||repeat('d',64) and stamp.token_id=77
        and stamp.blockchain_source_id=reaction.id and stamp.issued_at=reaction.completed_at)
    or not exists(select 1 from public.first_reaction_stamps stamp
      join public.fan_reactions reaction on reaction.id=stamp.reaction_id
      where stamp.reaction_id='95600000-0000-4000-8000-000000000007'
        and stamp.passport_id is null and stamp.mint_status='queued'
        and stamp.tx_hash is null and stamp.token_id is null
        and reaction.blockchain_job_id is null and reaction.fan_action_outbox_id is not null) then
    raise exception 'brand reaction backfill did not preserve legacy/native mint evidence';
  end if;
end $$;

