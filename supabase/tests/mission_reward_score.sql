-- Generalized Mission reward-score regression.
-- Run with psql -v ON_ERROR_STOP=1 against a disposable clean-replay database.
-- All fixtures are rolled back.
begin;

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('a1000000-0000-4000-8000-000000000001','did:privy:mission-score-one','mission-score-one@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000002','did:privy:mission-score-zero','mission-score-zero@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000003','did:privy:mission-score-three','mission-score-three@byus.test','active'),
  ('a1000000-0000-4000-8000-000000000004','did:privy:mission-score-admin','mission-score-admin@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('a1000000-0000-4000-8000-000000000010','mission-score-admin@byus.test','admin',true);
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('a1000000-0000-4000-8000-000000000001',91342,'0xa100000000000000000000000000000000000001','privy','embedded'),
  ('a1000000-0000-4000-8000-000000000002',91342,'0xa100000000000000000000000000000000000002','privy','embedded'),
  ('a1000000-0000-4000-8000-000000000003',91342,'0xa100000000000000000000000000000000000003','privy','embedded');

insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('a1100000-0000-4000-8000-000000000001','mission-score-contract','published','/mission-score.webp',now(),'{artist}','idol'),
  ('a1100000-0000-4000-8000-000000000002','mission-score-other','draft','/mission-score-other.webp',null,'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('a1100000-0000-4000-8000-000000000001','ko','미션 점수 테스트','미션 점수 테스트','미션 점수 테스트'),
  ('a1100000-0000-4000-8000-000000000001','en','Mission Score Test','Mission score test','Mission score test');
insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values
  ('a1200000-0000-4000-8000-000000000001','mission-score-brand','published','/mission-score-brand.svg','Mission score brand',now());
insert into public.brand_localizations(brand_id,locale,name,description) values
  ('a1200000-0000-4000-8000-000000000001','ko','미션 점수 브랜드','미션 점수 브랜드'),
  ('a1200000-0000-4000-8000-000000000001','en','Mission Score Brand','Mission score brand');

insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('a1300000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001',1,'published',now());
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('a1310000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',1,'a1310000-0000-4000-8000-000000000011','passed',3,now()),
  ('a1310000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',1,'a1310000-0000-4000-8000-000000000012','passed',3,now()),
  ('a1310000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',1,'a1310000-0000-4000-8000-000000000013','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('a1320000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','a1310000-0000-4000-8000-000000000001'),
  ('a1320000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','a1310000-0000-4000-8000-000000000002'),
  ('a1320000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000001','a1310000-0000-4000-8000-000000000003');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('a1330000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','a1320000-0000-4000-8000-000000000001'),
  ('a1330000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','a1320000-0000-4000-8000-000000000002'),
  ('a1330000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000001','a1320000-0000-4000-8000-000000000003');

insert into public.live_events(
  id,slug,celebrity_id,brand_id,starts_at,ends_at,reservation_opens_at,
  reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,
  attendance_valid_from,attendance_valid_until
) values
  ('a1400000-0000-4000-8000-000000000001','mission-score-one','a1100000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','2030-01-10T12:00:00Z','2030-01-10T13:00:00Z','2029-12-01T00:00:00Z','2030-01-10T11:00:00Z','https://www.youtube.com/watch?v=abcdefghijk','/mission-score-one.webp',extensions.crypt('MISSION-ONE',extensions.gen_salt('bf',12)),'2030-01-10T11:55:00Z','2030-01-10T13:10:00Z'),
  ('a1400000-0000-4000-8000-000000000002','mission-score-zero','a1100000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','2030-01-11T12:00:00Z','2030-01-11T13:00:00Z','2029-12-01T00:00:00Z','2030-01-11T11:00:00Z','https://www.youtube.com/watch?v=abcdefghijk','/mission-score-zero.webp',extensions.crypt('MISSION-ZERO',extensions.gen_salt('bf',12)),'2030-01-11T11:55:00Z','2030-01-11T13:10:00Z'),
  ('a1400000-0000-4000-8000-000000000003','mission-score-three','a1100000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','2030-01-12T12:00:00Z','2030-01-12T13:00:00Z','2029-12-01T00:00:00Z','2030-01-12T11:00:00Z','https://www.youtube.com/watch?v=abcdefghijk','/mission-score-three.webp',extensions.crypt('MISSION-THREE',extensions.gen_salt('bf',12)),'2030-01-12T11:55:00Z','2030-01-12T13:10:00Z');
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
select live_id,locale,title,title,title from (values
  ('a1400000-0000-4000-8000-000000000001'::uuid,'ko'::public.content_locale,'1점 라이브'),
  ('a1400000-0000-4000-8000-000000000001'::uuid,'en'::public.content_locale,'One point live'),
  ('a1400000-0000-4000-8000-000000000002'::uuid,'ko'::public.content_locale,'0점 라이브'),
  ('a1400000-0000-4000-8000-000000000002'::uuid,'en'::public.content_locale,'Zero point live'),
  ('a1400000-0000-4000-8000-000000000003'::uuid,'ko'::public.content_locale,'3점 라이브'),
  ('a1400000-0000-4000-8000-000000000003'::uuid,'en'::public.content_locale,'Three point live')
) fixture(live_id,locale,title);
update public.live_events set publication_status='published',published_at=now()
where id in ('a1400000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000003');

-- Revision 3 is deliberately newer than the score-1 Mission's frozen revision 2.
insert into public.live_reward_setting_revisions(
  id,live_event_id,revision,policy_version,lifecycle_status,mission_score,mission_ticket,
  journey_bonus_ticket,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at
)
select fixture.id,fixture.live_id,fixture.revision,activation.policy_version,'published',fixture.score,fixture.ticket,0,
  'a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000010',fixture.correlation_id,now()
from (values
  ('a1410000-0000-4000-8000-000000000001'::uuid,'a1400000-0000-4000-8000-000000000001'::uuid,2,1,1,'a1410000-0000-4000-8000-000000000011'::uuid),
  ('a1410000-0000-4000-8000-000000000002'::uuid,'a1400000-0000-4000-8000-000000000002'::uuid,2,0,1,'a1410000-0000-4000-8000-000000000012'::uuid),
  ('a1410000-0000-4000-8000-000000000003'::uuid,'a1400000-0000-4000-8000-000000000003'::uuid,2,3,0,'a1410000-0000-4000-8000-000000000013'::uuid)
) fixture(id,live_id,revision,score,ticket,correlation_id)
cross join public.reward_policy_activation activation
where activation.singleton;

insert into public.live_surveys(
  id,live_event_id,version,mission_type,legacy_contract,attendance_requirement,
  visible_from,visible_until
) values
  ('a1500000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001',1,'vote',false,'not_required','2020-01-01T00:00:00Z','2100-01-01T00:00:00Z'),
  ('a1500000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000002',1,'quiz',false,'not_required','2020-01-01T00:00:00Z','2100-01-01T00:00:00Z'),
  ('a1500000-0000-4000-8000-000000000003','a1400000-0000-4000-8000-000000000003',1,'vote',false,'not_required','2020-01-01T00:00:00Z','2100-01-01T00:00:00Z'),
  ('a1500000-0000-4000-8000-000000000004','a1400000-0000-4000-8000-000000000001',2,'vote',false,'not_required','2020-01-01T00:00:00Z','2100-01-01T00:00:00Z');
insert into public.live_survey_localizations(survey_id,locale,title,description)
select mission_id,locale,title,title from (values
  ('a1500000-0000-4000-8000-000000000001'::uuid,'ko'::public.content_locale,'1점 투표'),
  ('a1500000-0000-4000-8000-000000000001'::uuid,'en'::public.content_locale,'One point vote'),
  ('a1500000-0000-4000-8000-000000000002'::uuid,'ko'::public.content_locale,'0점 퀴즈'),
  ('a1500000-0000-4000-8000-000000000002'::uuid,'en'::public.content_locale,'Zero point quiz'),
  ('a1500000-0000-4000-8000-000000000003'::uuid,'ko'::public.content_locale,'3점 투표'),
  ('a1500000-0000-4000-8000-000000000003'::uuid,'en'::public.content_locale,'Three point vote')
) fixture(mission_id,locale,title);
insert into public.live_survey_questions(id,survey_id,question_type,position) values
  ('a1510000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','single_choice',1),
  ('a1510000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000002','single_choice',1),
  ('a1510000-0000-4000-8000-000000000003','a1500000-0000-4000-8000-000000000003','single_choice',1);
insert into public.live_survey_options(id,question_id,position) values
  ('a1520000-0000-4000-8000-000000000001','a1510000-0000-4000-8000-000000000001',1),
  ('a1520000-0000-4000-8000-000000000002','a1510000-0000-4000-8000-000000000001',2),
  ('a1520000-0000-4000-8000-000000000003','a1510000-0000-4000-8000-000000000002',1),
  ('a1520000-0000-4000-8000-000000000004','a1510000-0000-4000-8000-000000000002',2),
  ('a1520000-0000-4000-8000-000000000005','a1510000-0000-4000-8000-000000000003',1),
  ('a1520000-0000-4000-8000-000000000006','a1510000-0000-4000-8000-000000000003',2);
update public.live_survey_questions set correct_option_id='a1520000-0000-4000-8000-000000000003'
where id='a1510000-0000-4000-8000-000000000002';
update public.live_surveys set
  lifecycle_status='published',publication_status='published',published_at=now(),ever_published_at=now()
where id in ('a1500000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000003');
-- The Mission is already frozen to revision 2; revision 3 is now the LIVE's latest.
insert into public.live_reward_setting_revisions(
  id,live_event_id,revision,policy_version,lifecycle_status,mission_score,mission_ticket,
  journey_bonus_ticket,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at
)
select 'a1410000-0000-4000-8000-000000000004','a1400000-0000-4000-8000-000000000001',3,
  activation.policy_version,'published',3,2,0,'a1000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000010','a1410000-0000-4000-8000-000000000014',now()
from public.reward_policy_activation activation where activation.singleton;
-- Deliberately invalid cross-LIVE fixture: the score trigger must still reject it.
insert into public.live_survey_reward_setting_bindings(survey_id,reward_setting_revision_id) values
  ('a1500000-0000-4000-8000-000000000004','a1410000-0000-4000-8000-000000000003');

-- A draft Journey exists for the first Mission, but is intentionally unpublished.
insert into public.live_journey_requirement_revisions(
  id,live_event_id,revision,lifecycle_status,require_passport,require_reservation,
  require_attendance,bonus_ticket_amount,reward_setting_revision_id,
  reward_setting_revision,policy_version,actor_app_user_id,actor_admin_allowlist_id,correlation_id
)
select 'a1600000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001',1,'draft',true,false,false,0,
  'a1410000-0000-4000-8000-000000000001',2,activation.policy_version,
  'a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000010','a1600000-0000-4000-8000-000000000002'
from public.reward_policy_activation activation where activation.singleton;
insert into public.live_journey_mission_requirements(
  requirement_revision_id,live_event_id,mission_id,mission_version,position
) values(
  'a1600000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000001',1,1
);

do $$
declare first_result jsonb; replay_result jsonb; adjustment_result jsonb;
  score_one_activity uuid; score_zero_activity uuid; score_three_activity uuid;
begin
  first_result:=public.submit_owned_live_mission(
    'a1000000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001',
    'a1700000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('questionId','a1510000-0000-4000-8000-000000000001','selectedOptionIds',jsonb_build_array('a1520000-0000-4000-8000-000000000001'))),
    'a1800000-0000-4000-8000-000000000001','byus:stamp:v1:a1800000-0000-4000-8000-000000000001','0x'||repeat('1',64)
  );
  replay_result:=public.submit_owned_live_mission(
    'a1000000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001',
    'a1700000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('questionId','a1510000-0000-4000-8000-000000000001','selectedOptionIds',jsonb_build_array('a1520000-0000-4000-8000-000000000001'))),
    'a1800000-0000-4000-8000-000000000001','byus:stamp:v1:a1800000-0000-4000-8000-000000000001','0x'||repeat('1',64)
  );
  if first_result is distinct from replay_result
    or first_result#>>'{mission,scorePoints}'<>'1'
    or first_result#>>'{mission,ticketAmount}'<>'1' then
    raise exception 'score-1 Mission did not replay its frozen reward result';
  end if;
  if (select count(*) from public.live_survey_responses where app_user_id='a1000000-0000-4000-8000-000000000001' and survey_id='a1500000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.fan_activities where app_user_id='a1000000-0000-4000-8000-000000000001' and source_type='live_survey_response')<>1
    or (select count(*) from public.fan_score_ledger where app_user_id='a1000000-0000-4000-8000-000000000001' and points=1)<>1
    or (select count(*) from public.fan_ticket_ledger where app_user_id='a1000000-0000-4000-8000-000000000001' and source_type='mission_completion' and amount=1)<>1
    or (select count(*) from public.stamps where id='a1800000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.blockchain_jobs where operation_key='byus:stamp:v1:a1800000-0000-4000-8000-000000000001')<>1 then
    raise exception 'score-1 Mission replay duplicated or omitted an effect';
  end if;
  if exists(select 1 from public.live_attendances where app_user_id='a1000000-0000-4000-8000-000000000001')
    or exists(select 1 from public.live_journey_publications where live_event_id='a1400000-0000-4000-8000-000000000001') then
    raise exception 'score-1 Mission unexpectedly depended on attendance or a published Journey';
  end if;
  begin
    perform public.submit_owned_live_mission(
      'a1000000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001',
      'a1700000-0000-4000-8000-000000000002',
      jsonb_build_array(jsonb_build_object('questionId','a1510000-0000-4000-8000-000000000001','selectedOptionIds',jsonb_build_array('a1520000-0000-4000-8000-000000000001'))),
      'a1800000-0000-4000-8000-000000000002','byus:stamp:v1:a1800000-0000-4000-8000-000000000002','0x'||repeat('2',64));
    raise exception 'fresh key repeated an already completed Mission';
  exception when unique_violation then
    if sqlerrm not like '%PHASE2_MISSION_ALREADY_COMPLETED%' then raise; end if;
  end;
  select id into strict score_one_activity from public.fan_activities
  where app_user_id='a1000000-0000-4000-8000-000000000001' and source_type='live_survey_response';
  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(
      score_one_activity,'a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001',2);
    raise exception 'wrong direct score was accepted';
  exception when others then
    if sqlerrm not like '%fan score points do not match source%' then raise; end if;
  end;

  perform public.submit_owned_live_mission(
    'a1000000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000002',
    'a1700000-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object('questionId','a1510000-0000-4000-8000-000000000002','selectedOptionIds',jsonb_build_array('a1520000-0000-4000-8000-000000000003'))),
    'a1800000-0000-4000-8000-000000000003','byus:stamp:v1:a1800000-0000-4000-8000-000000000003','0x'||repeat('3',64));
  if exists(select 1 from public.fan_score_ledger where app_user_id='a1000000-0000-4000-8000-000000000002') then
    raise exception 'zero-score Mission created a score row';
  end if;
  if (select count(*) from public.fan_ticket_ledger
      where app_user_id='a1000000-0000-4000-8000-000000000002'
        and source_type='mission_completion' and amount=1)<>1 then
    raise exception 'zero-score Mission did not preserve its ticket reward';
  end if;
  if not exists(select 1 from public.stamps where id='a1800000-0000-4000-8000-000000000003') then
    raise exception 'zero-score Mission omitted its stamp';
  end if;
  select id into strict score_zero_activity from public.fan_activities
  where app_user_id='a1000000-0000-4000-8000-000000000002' and source_type='live_survey_response';
  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(
      score_zero_activity,'a1000000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001',0);
    raise exception 'zero direct score row was accepted';
  exception when others then
    if sqlerrm not like '%zero-point mission cannot create a score row%' then raise; end if;
  end;

  perform public.submit_owned_live_mission(
    'a1000000-0000-4000-8000-000000000003','a1500000-0000-4000-8000-000000000003',
    'a1700000-0000-4000-8000-000000000004',
    jsonb_build_array(jsonb_build_object('questionId','a1510000-0000-4000-8000-000000000003','selectedOptionIds',jsonb_build_array('a1520000-0000-4000-8000-000000000005'))),
    'a1800000-0000-4000-8000-000000000004','byus:stamp:v1:a1800000-0000-4000-8000-000000000004','0x'||repeat('4',64));
  if (select count(*) from public.fan_score_ledger where app_user_id='a1000000-0000-4000-8000-000000000003' and points=3)<>1 then
    raise exception 'bound score-3 Mission was not accepted';
  end if;
  select id into strict score_three_activity from public.fan_activities
  where app_user_id='a1000000-0000-4000-8000-000000000003' and source_type='live_survey_response';
  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(
      score_three_activity,'a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001',3);
    raise exception 'another owner reused a Mission score source';
  exception when no_data_found then null;
  end;
  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(
      score_three_activity,'a1000000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000002',3);
    raise exception 'another Creator reused a Mission score source';
  exception when no_data_found then null;
  end;
  adjustment_result:=public.admin_adjust_fan_score(
    'a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000010',
    'a1810000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',
    'a1100000-0000-4000-8000-000000000001',2::smallint,'Mission regression adjustment',
    'a1810000-0000-4000-8000-000000000002'
  );
  if adjustment_result->>'points'<>'2' or adjustment_result->>'resultingScore'<>'5'
    or (select count(*) from public.fan_score_ledger ledger
        join public.fan_score_adjustments adjustment on adjustment.id=ledger.adjustment_id
        where adjustment.id=(adjustment_result->>'adjustmentId')::uuid
          and ledger.activity_id is null and ledger.points=2)<>1 then
    raise exception 'admin score adjustment source regressed';
  end if;

  insert into public.live_survey_responses(
    id,app_user_id,live_event_id,celebrity_id,survey_id,attendance_id,passport_id,
    status,submitted_at,legacy_contract
  ) values(
    'a1900000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000004',null,'a1330000-0000-4000-8000-000000000001',
    'submitted',now(),false
  );
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id) values(
    'a1900000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001','survey','live_survey_response','a1900000-0000-4000-8000-000000000001'
  );
  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points) values(
      'a1900000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
      'a1100000-0000-4000-8000-000000000001',3);
    raise exception 'cross-LIVE reward binding produced a score row';
  exception when no_data_found then null;
  end;
end $$;

rollback;
