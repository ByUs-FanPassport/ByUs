\set ON_ERROR_STOP on
begin;

create temporary table expected_fan_stages (
  stage_key text primary key,
  tier_name text not null,
  subdivision smallint not null,
  stage_rank smallint not null,
  minimum_score integer not null
) on commit drop;

insert into expected_fan_stages values
  ('bronze-1',   'Bronze',   1,  1,   0),
  ('silver-1',   'Silver',   1,  2,  15),
  ('silver-2',   'Silver',   2,  3,  30),
  ('gold-1',     'Gold',     1,  4,  50),
  ('gold-2',     'Gold',     2,  5,  70),
  ('gold-3',     'Gold',     3,  6,  95),
  ('platinum-1', 'Platinum', 1,  7, 120),
  ('platinum-2', 'Platinum', 2,  8, 150),
  ('platinum-3', 'Platinum', 3,  9, 180),
  ('platinum-4', 'Platinum', 4, 10, 215),
  ('diamond-1',  'Diamond',  1, 11, 250);

do $$
declare
  stage record;
  progress jsonb;
  expected_previous_key text;
  function_signature text;
  function_oid regprocedure;
  definition text;
begin
  if (select policy_version from public.reward_policy_activation where singleton) is distinct from 2 then
    raise exception 'Fan stage assertions require active reward policy 2';
  end if;

  if exists (
      select policy_version, stage_key, tier_name, subdivision, stage_rank, minimum_score
      from public.reward_policy_tier_stages where policy_version = 2
      except
      select 2, stage_key, tier_name, subdivision, stage_rank, minimum_score
      from expected_fan_stages
    ) or exists (
      select 2, stage_key, tier_name, subdivision, stage_rank, minimum_score
      from expected_fan_stages
      except
      select policy_version, stage_key, tier_name, subdivision, stage_rank, minimum_score
      from public.reward_policy_tier_stages where policy_version = 2
    ) then
    raise exception 'Fan stage seed differs from the approved 11 rows';
  end if;

  for stage in select * from expected_fan_stages order by stage_rank loop
    progress := public.get_fan_stage_progress(stage.minimum_score, stage.tier_name);
    if progress -> 'current' ->> 'key' is distinct from stage.stage_key
      or (progress -> 'current' ->> 'minimumScore')::integer is distinct from stage.minimum_score
      or (progress -> 'current' ->> 'rank')::integer is distinct from stage.stage_rank then
      raise exception 'Fan stage exact boundary failed for %: %', stage.stage_key, progress;
    end if;

    select coalesce(previous.stage_key, 'bronze-1') into expected_previous_key
    from expected_fan_stages previous
    where previous.stage_rank = greatest(stage.stage_rank - 1, 1);

    progress := public.get_fan_stage_progress(
      stage.minimum_score - 1,
      public.fan_level_for_score(stage.minimum_score - 1, 2)
    );
    if progress -> 'current' ->> 'key' is distinct from expected_previous_key then
      raise exception 'Fan stage below-boundary failed for %: %', stage.stage_key, progress;
    end if;
  end loop;

  progress := public.get_fan_stage_progress(22, 'Silver');
  if progress -> 'current' ->> 'key' is distinct from 'silver-1'
    or progress -> 'next' ->> 'key' is distinct from 'silver-2'
    or (progress ->> 'remaining')::integer is distinct from 8
    or (progress ->> 'progressPercent')::integer is distinct from 46 then
    raise exception 'Representative Silver progress failed: %', progress;
  end if;

  progress := public.get_fan_stage_progress(10, 'Gold');
  if progress -> 'current' ->> 'key' is distinct from 'gold-1'
    or progress -> 'next' ->> 'key' is distinct from 'gold-2'
    or (progress ->> 'remaining')::integer is distinct from 60
    or (progress ->> 'progressPercent')::integer is distinct from 0 then
    raise exception 'Legacy Gold floor failed: %', progress;
  end if;

  -- Corrections reduce the subdivision within an earned major tier.
  progress := public.get_fan_stage_progress(100, 'Gold');
  if progress -> 'current' ->> 'key' is distinct from 'gold-3' then
    raise exception 'Gold subdivision before correction failed: %', progress;
  end if;
  progress := public.get_fan_stage_progress(80, 'Gold');
  if progress -> 'current' ->> 'key' is distinct from 'gold-2'
    or progress -> 'current' ->> 'tier' is distinct from 'Gold'
    or progress -> 'next' ->> 'key' is distinct from 'gold-3'
    or (progress ->> 'remaining')::integer is distinct from 15
    or (progress ->> 'progressPercent')::integer is distinct from 40 then
    raise exception 'Gold subdivision correction failed: %', progress;
  end if;

  progress := public.get_fan_stage_progress(-10, 'Platinum');
  if progress -> 'current' ->> 'key' is distinct from 'platinum-1'
    or progress -> 'next' ->> 'key' is distinct from 'platinum-2'
    or (progress ->> 'remaining')::integer is distinct from 160
    or (progress ->> 'progressPercent')::integer is distinct from 0 then
    raise exception 'Negative score correction floor failed: %', progress;
  end if;

  progress := public.get_fan_stage_progress(999, 'Diamond');
  if progress -> 'current' ->> 'key' is distinct from 'diamond-1'
    or progress -> 'next' is distinct from 'null'::jsonb
    or (progress ->> 'remaining')::integer is distinct from 0
    or (progress ->> 'progressPercent')::integer is distinct from 100 then
    raise exception 'Max-stage overshoot failed: %', progress;
  end if;

  update public.reward_policy_activation set policy_version = 1 where singleton;
  if public.get_fan_stage_progress(35, 'Diamond') is not null then
    raise exception 'Policy without stage configuration did not return null';
  end if;
  update public.reward_policy_activation set policy_version = 2 where singleton;

  begin
    insert into public.reward_policy_tier_stages values
      (2, 'bronze-2', 'Bronze', 2, 2, 1);
    raise exception 'Fan stage insert unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Tier stages are immutable%' then raise; end if;
  end;
  begin
    update public.reward_policy_tier_stages set minimum_score = 1
    where policy_version = 2 and stage_key = 'bronze-1';
    raise exception 'Fan stage update unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Tier stages are immutable%' then raise; end if;
  end;
  begin
    delete from public.reward_policy_tier_stages
    where policy_version = 2 and stage_key = 'bronze-1';
    raise exception 'Fan stage delete unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Tier stages are immutable%' then raise; end if;
  end;
  begin
    truncate public.reward_policy_tier_stages;
    raise exception 'Fan stage truncate unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Tier stages are immutable%' then raise; end if;
  end;

  foreach function_signature in array array[
    'public.get_fan_stage_progress(integer,text)',
    'public.get_owned_my_fan_activity_with_stages(uuid,public.content_locale,timestamptz)',
    'public.get_owned_passport_collection_with_stages(uuid,public.content_locale)',
    'public.get_owned_passport_detail_with_stages(uuid,uuid,public.content_locale)'
  ] loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'Missing Fan stage function %', function_signature;
    end if;
    if has_function_privilege('anon', function_oid, 'execute')
      or has_function_privilege('authenticated', function_oid, 'execute')
      or not has_function_privilege('service_role', function_oid, 'execute')
      or exists (
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral aclexplode(coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )) acl
        where procedure.oid = function_oid
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      ) then
      raise exception 'Fan stage function grants are invalid for %', function_signature;
    end if;
    if exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = function_oid
        and (procedure.provolatile is distinct from 's'
          or not procedure.prosecdef
          or not coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""'])
    ) then
      raise exception 'Fan stage function security attributes are invalid for %', function_signature;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.reward_policy_tier_stages', 'select,insert,update,delete,truncate')
    or has_table_privilege('authenticated', 'public.reward_policy_tier_stages', 'select,insert,update,delete,truncate')
    or has_table_privilege('service_role', 'public.reward_policy_tier_stages', 'select,insert,update,delete,truncate') then
    raise exception 'Fan stage table is directly accessible';
  end if;

  definition := pg_get_functiondef(
    'public.get_owned_my_fan_activity_with_stages(uuid,public.content_locale,timestamptz)'::regprocedure
  );
  if (length(definition) - length(replace(definition, 'public.get_owned_my_fan_activity(', '')))
      / length('public.get_owned_my_fan_activity(') is distinct from 1 then
    raise exception 'MY stage wrapper must call its old RPC exactly once';
  end if;
  definition := pg_get_functiondef(
    'public.get_owned_passport_collection_with_stages(uuid,public.content_locale)'::regprocedure
  );
  if (length(definition) - length(replace(definition, 'public.get_owned_passport_collection(', '')))
      / length('public.get_owned_passport_collection(') is distinct from 1 then
    raise exception 'Passport collection stage wrapper must call its old RPC exactly once';
  end if;
  definition := pg_get_functiondef(
    'public.get_owned_passport_detail_with_stages(uuid,uuid,public.content_locale)'::regprocedure
  );
  if (length(definition) - length(replace(definition, 'public.get_owned_passport_detail(', '')))
      / length('public.get_owned_passport_detail(') is distinct from 1
    or definition like '%get_owned_passport_detail_before_first_reaction%' then
    raise exception 'Passport detail stage wrapper does not call the current RPC exactly once';
  end if;
end;
$$;

-- Minimal owner data proves parity, ordering, and cross-owner isolation through
-- the existing RPCs rather than reimplementing any owner predicate here.
insert into public.app_users(id, privy_user_id, verified_email) values
  ('71000000-0000-4000-8000-000000000001', 'did:privy:fan-stage-owner', 'fan-stage-owner@example.test'),
  ('71000000-0000-4000-8000-000000000002', 'did:privy:fan-stage-other', 'fan-stage-other@example.test');

insert into public.admin_allowlist(id, email, role, created_by_app_user_id) values
  ('71000000-0000-4000-8000-000000000003', 'fan-stage-owner@example.test', 'admin',
   '71000000-0000-4000-8000-000000000001');

insert into public.celebrities(id, slug, image_url, image_position) values
  ('71000000-0000-4000-8000-000000000011', 'fan-stage-alpha', 'https://example.test/alpha.jpg', 'center'),
  ('71000000-0000-4000-8000-000000000012', 'fan-stage-beta', 'https://example.test/beta.jpg', 'center');
insert into public.celebrity_localizations(celebrity_id, locale, name, summary, image_alt) values
  ('71000000-0000-4000-8000-000000000011', 'ko', 'Alpha', 'Alpha summary', 'Alpha'),
  ('71000000-0000-4000-8000-000000000012', 'ko', 'Beta', 'Beta summary', 'Beta');

insert into public.celebrity_quizzes(id, celebrity_id, version) values
  ('71000000-0000-4000-8000-000000000021', '71000000-0000-4000-8000-000000000011', 1),
  ('71000000-0000-4000-8000-000000000022', '71000000-0000-4000-8000-000000000012', 1);
insert into public.quiz_attempts(
  id, app_user_id, celebrity_id, quiz_id, quiz_version, idempotency_key,
  status, score, submitted_at
) values
  ('71000000-0000-4000-8000-000000000031', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000021', 1,
   '71000000-0000-4000-8000-000000000131', 'passed', 3, '2026-09-10T00:00:00Z'),
  ('71000000-0000-4000-8000-000000000032', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000022', 1,
   '71000000-0000-4000-8000-000000000132', 'passed', 3, '2026-09-10T00:00:00Z');
insert into public.quiz_passes(id, app_user_id, celebrity_id, winning_attempt_id) values
  ('71000000-0000-4000-8000-000000000041', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000031'),
  ('71000000-0000-4000-8000-000000000042', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000032');
insert into public.fan_passports(
  id, app_user_id, celebrity_id, quiz_pass_id, issued_at
) values
  ('71000000-0000-4000-8000-000000000051', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000041',
   '2026-09-10T02:00:00Z'),
  ('71000000-0000-4000-8000-000000000052', '71000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000042',
   '2026-09-10T01:00:00Z');

insert into public.fan_score_adjustments(
  id, app_user_id, celebrity_id, points, reason, idempotency_key,
  actor_app_user_id, actor_admin_allowlist_id, correlation_id, resulting_score
) values (
  '71000000-0000-4000-8000-000000000061',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000011',
  10, 'Fan stage legacy floor fixture',
  '71000000-0000-4000-8000-000000000161',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000162', 10
);
insert into public.fan_score_ledger(
  id, activity_id, adjustment_id, app_user_id, celebrity_id, points
) values (
  '71000000-0000-4000-8000-000000000071', null,
  '71000000-0000-4000-8000-000000000061',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000011', 10
);
insert into public.fan_tier_cutover_snapshots(
  app_user_id, celebrity_id, attained_tier, attained_tier_rank,
  score_at_cutover, cutover_at, source_policy_version
) values (
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000011',
  'Gold', 3, 10, '2026-09-10T00:00:00Z', 1
);

create temporary table fan_stage_rpc_parity (
  fixture text primary key,
  old_payload jsonb not null,
  new_payload jsonb not null
) on commit drop;

insert into fan_stage_rpc_parity
select 'my',
  public.get_owned_my_fan_activity(
    '71000000-0000-4000-8000-000000000001', 'ko', '2026-09-10T03:00:00Z'
  ),
  public.get_owned_my_fan_activity_with_stages(
    '71000000-0000-4000-8000-000000000001', 'ko', '2026-09-10T03:00:00Z'
  );
insert into fan_stage_rpc_parity
select 'collection',
  coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb),
  (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
   from public.get_owned_passport_collection_with_stages(
     '71000000-0000-4000-8000-000000000001', 'ko'
   ) with ordinality as staged(value, ordinality))
from public.get_owned_passport_collection(
  '71000000-0000-4000-8000-000000000001', 'ko'
) with ordinality as original(value, ordinality);
insert into fan_stage_rpc_parity
select 'detail',
  coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb),
  (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
   from public.get_owned_passport_detail_with_stages(
     '71000000-0000-4000-8000-000000000051',
     '71000000-0000-4000-8000-000000000001', 'ko'
   ) with ordinality as staged(value, ordinality))
from public.get_owned_passport_detail(
  '71000000-0000-4000-8000-000000000051',
  '71000000-0000-4000-8000-000000000001', 'ko'
) with ordinality as original(value, ordinality);

do $$
declare
  old_payload jsonb;
  new_payload jsonb;
  normalized jsonb;
begin
  select parity.old_payload, parity.new_payload into old_payload, new_payload
  from fan_stage_rpc_parity parity where fixture = 'my';
  select jsonb_set(
    new_payload, '{creators}',
    coalesce(jsonb_agg(creator.value #- '{passport,stageProgress}' order by creator.ordinality), '[]'::jsonb)
  ) into normalized
  from jsonb_array_elements(new_payload -> 'creators')
    with ordinality as creator(value, ordinality);
  if normalized is distinct from old_payload
    or new_payload -> 'creators' -> 0 -> 'passport' -> 'stageProgress' -> 'current' ->> 'key' is distinct from 'gold-1'
    or new_payload -> 'creators' -> 1 -> 'passport' -> 'stageProgress' -> 'current' ->> 'key' is distinct from 'bronze-1'
    or new_payload -> 'creators' -> 0 -> 'celebrity' ->> 'name' is distinct from 'Alpha'
    or new_payload -> 'creators' -> 1 -> 'celebrity' ->> 'name' is distinct from 'Beta' then
    raise exception 'MY wrapper parity, stage placement, or ordering failed';
  end if;

  select parity.old_payload, parity.new_payload into old_payload, new_payload
  from fan_stage_rpc_parity parity where fixture = 'collection';
  select coalesce(jsonb_agg(passport.value #- '{score,stageProgress}' order by passport.ordinality), '[]'::jsonb)
  into normalized
  from jsonb_array_elements(new_payload) with ordinality as passport(value, ordinality);
  if normalized is distinct from old_payload
    or new_payload -> 0 ->> 'id' is distinct from '71000000-0000-4000-8000-000000000051'
    or new_payload -> 1 ->> 'id' is distinct from '71000000-0000-4000-8000-000000000052'
    or new_payload -> 0 -> 'score' -> 'stageProgress' -> 'current' ->> 'key' is distinct from 'gold-1' then
    raise exception 'Passport collection wrapper parity, stage placement, or ordering failed';
  end if;

  select parity.old_payload, parity.new_payload into old_payload, new_payload
  from fan_stage_rpc_parity parity where fixture = 'detail';
  select coalesce(jsonb_agg(passport.value #- '{score,stageProgress}' order by passport.ordinality), '[]'::jsonb)
  into normalized
  from jsonb_array_elements(new_payload) with ordinality as passport(value, ordinality);
  if normalized is distinct from old_payload
    or new_payload -> 0 -> 'score' -> 'stageProgress' -> 'current' ->> 'key' is distinct from 'gold-1'
    or (new_payload -> 0 ? 'firstReaction') is not true then
    raise exception 'Passport detail wrapper parity or current First Reaction projection failed';
  end if;

  if public.get_owned_my_fan_activity_with_stages(
      '71000000-0000-4000-8000-000000000002', 'ko', '2026-09-10T03:00:00Z'
    ) -> 'creators' is distinct from '[]'::jsonb
    or exists (
      select 1 from public.get_owned_passport_collection_with_stages(
        '71000000-0000-4000-8000-000000000002', 'ko'
      )
    )
    or exists (
      select 1 from public.get_owned_passport_detail_with_stages(
        '71000000-0000-4000-8000-000000000051',
        '71000000-0000-4000-8000-000000000002', 'ko'
      )
    ) then
    raise exception 'Fan stage wrapper cross-owner isolation failed';
  end if;
end;
$$;

select jsonb_build_object(
  'status', 'PASS',
  'representativeStageCases', jsonb_build_object(
    'score22Silver', public.get_fan_stage_progress(22, 'Silver'),
    'score10GoldLegacy', public.get_fan_stage_progress(10, 'Gold'),
    'score250Diamond', public.get_fan_stage_progress(250, 'Diamond')
  ),
  'all11StageBoundaries', (
    select jsonb_agg(jsonb_build_object(
      'score', expected.minimum_score,
      'effectiveTier', expected.tier_name,
      'progress', public.get_fan_stage_progress(expected.minimum_score, expected.tier_name)
    ) order by expected.stage_rank)
    from expected_fan_stages expected
  ),
  'wrapperParity', jsonb_build_object(
    'my', true,
    'passportCollection', true,
    'passportDetail', true,
    'crossOwnerDenied', true
  )
) as fan_tier_stage_result;

rollback;
