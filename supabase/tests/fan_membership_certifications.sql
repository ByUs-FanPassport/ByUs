-- Paid-membership certification behavioral regression.
-- Run with psql -v ON_ERROR_STOP=1 against a disposable clean-replay database.
-- All fixtures are rolled back.
begin;

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('d1000000-0000-4000-8000-000000000001','did:privy:membership-owner','membership-owner@byus.test','active'),
  ('d1000000-0000-4000-8000-000000000002','did:privy:membership-other','membership-other@byus.test','active'),
  ('d1000000-0000-4000-8000-000000000003','did:privy:membership-no-wallet','membership-no-wallet@byus.test','active'),
  ('d1000000-0000-4000-8000-000000000004','did:privy:membership-admin','membership-admin@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('d1000000-0000-4000-8000-000000000010','membership-admin@byus.test','admin',true);
insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
  ('d1000000-0000-4000-8000-000000000001','멤버십팬','멤버십팬');
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('d1000000-0000-4000-8000-000000000001',91342,'0xd100000000000000000000000000000000000001','privy','embedded'),
  ('d1000000-0000-4000-8000-000000000002',91342,'0xd100000000000000000000000000000000000002','privy','embedded');

insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('d1100000-0000-4000-8000-000000000001','membership-contract','published','/membership-contract.webp',now(),'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('d1100000-0000-4000-8000-000000000001','ko','멤버십 테스트','멤버십 테스트','멤버십 테스트'),
  ('d1100000-0000-4000-8000-000000000001','en','Membership Test','Membership Test','Membership Test');
insert into public.celebrity_social_links(celebrity_id,platform,url,position,active) values
  ('d1100000-0000-4000-8000-000000000001','youtube','https://www.youtube.com/@membership-contract',0,true),
  ('d1100000-0000-4000-8000-000000000001','chzzk','https://chzzk.naver.com/membership-contract',1,true);

insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('d1200000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001',1,'published',now());
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('d1200000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001',1,'d1200000-0000-4000-8000-000000000021','passed',3,now()),
  ('d1200000-0000-4000-8000-000000000012','d1000000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001',1,'d1200000-0000-4000-8000-000000000022','passed',3,now()),
  ('d1200000-0000-4000-8000-000000000013','d1000000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000001',1,'d1200000-0000-4000-8000-000000000023','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('d1200000-0000-4000-8000-000000000031','d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000011'),
  ('d1200000-0000-4000-8000-000000000032','d1000000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000012'),
  ('d1200000-0000-4000-8000-000000000033','d1000000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000013');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('d1200000-0000-4000-8000-000000000041','d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000031'),
  ('d1200000-0000-4000-8000-000000000042','d1000000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000032'),
  ('d1200000-0000-4000-8000-000000000043','d1000000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000001','d1200000-0000-4000-8000-000000000033');

do $$
declare
  saved jsonb; activated jsonb; submitted jsonb; reviewed jsonb; replayed jsonb;
  mission_id uuid; first_submission uuid; second_submission uuid; no_wallet_submission uuid;
  v_activity_id uuid; v_stamp_id uuid; detail jsonb; public_detail jsonb; owner_detail jsonb;
  collection_row jsonb; passport_detail jsonb; stamp_detail jsonb; history jsonb;
  admin_queue jsonb; admin_pending jsonb; admin_rejected jsonb;
  admin_fan jsonb; analytics jsonb;
begin
  -- Only the three supported membership platforms may be configured.
  begin
    perform public.save_admin_certification_mission_v2(
      'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000001',
      null,'d1100000-0000-4000-8000-000000000001','membership-chzzk',null,'멤버십','치지직 멤버십','CHZZK membership','설명','Description','지침','Instructions',
      now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'chzzk');
    raise exception 'unsupported CHZZK membership mission was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_PLATFORM_INVALID%' then raise; end if;
  end;
  begin
    perform public.save_admin_certification_mission_v2(
      'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000002',
      null,'d1100000-0000-4000-8000-000000000001','membership-zero',null,'멤버십','0점 멤버십','Zero membership','설명','Description','지침','Instructions',
      now()-interval '1 hour',now()+interval '1 day',0::smallint,0::bigint,'youtube');
    raise exception 'zero-score membership reward was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_REWARD_INVALID%' then raise; end if;
  end;
  begin
    perform public.save_admin_certification_mission_v2(
      'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000003',
      null,'d1100000-0000-4000-8000-000000000001','membership-ticket',null,'멤버십','티켓 멤버십','Ticket membership','설명','Description','지침','Instructions',
      now()-interval '1 hour',now()+interval '1 day',1::smallint,1::bigint,'youtube');
    raise exception 'ticket-bearing membership reward was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_REWARD_INVALID%' then raise; end if;
  end;

  saved:=public.save_admin_certification_mission_v2(
    'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000004',
    null,'d1100000-0000-4000-8000-000000000001','membership-youtube',null,'멤버십','유튜브 유료 멤버십','YouTube paid membership','현재 유효한 유료 멤버십을 인증해 주세요.','Verify a currently active paid membership.','크리에이터 계정, 내 계정, 유효기간을 보여 주세요.','Show the creator, your account, and validity.',
    now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'youtube');
  mission_id:=(saved->>'id')::uuid;
  if saved->'reward'->>'scorePoints'<>'1' or saved->'reward'->>'ticketAmount'<>'0'
    or (select membership_platform from public.certification_missions where id=mission_id)<>'youtube' then
    raise exception 'membership configuration snapshot mismatch';
  end if;

  begin
    perform public.save_admin_certification_mission_v2(
      'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000005',
      null,'d1100000-0000-4000-8000-000000000001','membership-youtube-duplicate',null,'멤버십','중복','Duplicate','설명','Description','지침','Instructions',
      now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'youtube');
    raise exception 'second mission for creator/platform was accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.certification_missions set membership_platform='instagram' where id=mission_id;
    raise exception 'membership platform changed after creation';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_PLATFORM_IMMUTABLE%' then raise; end if;
  end;
  begin
    perform public.save_admin_certification_mission(
      'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000006',
      mission_id,'d1100000-0000-4000-8000-000000000001','membership-youtube',1,'멤버십','유튜브 유료 멤버십','YouTube paid membership','설명','Description','지침','Instructions',
      now()-interval '1 hour',now()+interval '1 day',0::smallint,1::bigint);
    raise exception 'legacy mission editor weakened membership reward';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_REWARD_INVALID%' then raise; end if;
  end;

  activated:=public.set_admin_certification_mission_status(
    'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1300000-0000-4000-8000-000000000007',mission_id,1,'active');
  if activated->>'status'<>'active' then raise exception 'membership mission did not activate'; end if;

  begin
    perform public.submit_owned_certification(
      'd1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000020','[]',null,null);
    raise exception 'zero-image membership proof was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_UPLOAD_COUNT_INVALID%' then raise; end if;
  end;
  begin
    perform public.submit_owned_certification(
      'd1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000021','["d1400000-0000-4000-8000-000000000099"]',null,null);
    raise exception 'missing membership upload was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_UPLOAD_INVALID%' then raise; end if;
  end;

  -- Registration and consumption remain Passport- and owner-scoped.
  begin
    perform public.register_owned_certification_upload(
      'd1000000-0000-4000-8000-000000000004',mission_id,'d1400000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000004/'||mission_id||'/d1400000-0000-4000-8000-000000000001.webp',100,10,10,repeat('1',64));
    raise exception 'owner without Passport registered membership proof';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_PASSPORT_REQUIRED%' then raise; end if;
  end;
  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000002',mission_id,'d1400000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002/'||mission_id||'/d1400000-0000-4000-8000-000000000002.webp',100,10,10,repeat('2',64));
  begin
    perform public.submit_owned_certification('d1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000001','["d1400000-0000-4000-8000-000000000002"]',null,null);
    raise exception 'foreign membership upload was consumed';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_UPLOAD_INVALID%' then raise; end if;
  end;

  -- A Passport without the required embedded chain-91342 wallet cannot be approved,
  -- and the whole reward transaction must roll back.
  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000003',mission_id,'d1400000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000003/'||mission_id||'/d1400000-0000-4000-8000-000000000003.webp',100,10,10,repeat('3',64));
  submitted:=public.submit_owned_certification('d1000000-0000-4000-8000-000000000003',mission_id,'d1500000-0000-4000-8000-000000000002','["d1400000-0000-4000-8000-000000000003"]',null,null);
  no_wallet_submission:=(submitted->>'id')::uuid;
  if (select membership_platform from public.certification_submissions where id=no_wallet_submission)<>'youtube' then raise exception 'server did not snapshot mission platform'; end if;
  begin
    perform public.review_admin_certification_submission('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1500000-0000-4000-8000-000000000003',no_wallet_submission,'d1500000-0000-4000-8000-000000000004',1,'approve',null);
    raise exception 'membership approval succeeded without required wallet';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_WALLET_NOT_READY%' then raise; end if;
  end;
  if (select status from public.certification_submissions where id=no_wallet_submission)<>'pending'
    or exists(select 1 from public.fan_activities where source_id=no_wallet_submission)
    or exists(select 1 from public.fan_score_ledger where manual_submission_id=no_wallet_submission)
    or exists(select 1 from public.stamps where app_user_id='d1000000-0000-4000-8000-000000000003') then
    raise exception 'failed wallet precondition left partial membership rewards';
  end if;
  admin_pending:=public.get_admin_certification_queue(
    'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','pending');
  if not exists(
    select 1 from jsonb_array_elements(admin_pending) row_value
    where row_value->>'id'=no_wallet_submission::text
      and row_value->'applicantName'='null'::jsonb
  ) then
    raise exception 'missing profile was not represented neutrally in admin queue';
  end if;

  -- Reject with a reason, grant nothing, then accept a three-image resubmission.
  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000001',mission_id,'d1400000-0000-4000-8000-000000000011','d1000000-0000-4000-8000-000000000001/'||mission_id||'/d1400000-0000-4000-8000-000000000011.webp',100,10,10,repeat('a',64));
  submitted:=public.submit_owned_certification('d1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000011','["d1400000-0000-4000-8000-000000000011"]','first proof',null);
  first_submission:=(submitted->>'id')::uuid;
  if (select membership_platform from public.certification_submissions where id=first_submission)<>'youtube'
    or (select reward_score_points from public.certification_submissions where id=first_submission)<>1
    or (select reward_ticket_amount from public.certification_submissions where id=first_submission)<>0 then
    raise exception 'submission did not preserve server-owned platform/reward snapshot';
  end if;
  begin
    update public.certification_submissions set membership_platform='instagram' where id=first_submission;
    raise exception 'submission membership snapshot was mutable';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MEMBERSHIP_SNAPSHOT_IMMUTABLE%' then raise; end if;
  end;
  begin
    insert into public.fan_activities(app_user_id,celebrity_id,activity_type,source_type,source_id)
    values('d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','membership','certification_submission',first_submission);
    raise exception 'pending membership submission became an activity';
  exception when others then
    if sqlerrm not like '%membership activity must reference an owned approved membership submission%' then raise; end if;
  end;
  reviewed:=public.review_admin_certification_submission('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1500000-0000-4000-8000-000000000012',first_submission,'d1500000-0000-4000-8000-000000000013',1,'reject','다음 결제일이 보이도록 다시 제출해 주세요.');
  if reviewed->>'status'<>'rejected' or (select rejection_reason from public.certification_submissions where id=first_submission) is null
    or exists(select 1 from public.fan_activities where source_id=first_submission)
    or exists(select 1 from public.fan_score_ledger where manual_submission_id=first_submission)
    or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=first_submission) then
    raise exception 'membership rejection state or zero-grant contract failed';
  end if;
  admin_rejected:=public.get_admin_certification_queue(
    'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','rejected');
  if not exists(
    select 1 from jsonb_array_elements(admin_rejected) row_value
    where row_value->>'id'=first_submission::text
      and row_value->>'applicantName'='멤버십팬'
      and row_value->>'creatorNameKo'='멤버십 테스트'
      and row_value->>'creatorNameEn'='Membership Test'
      and row_value->>'missionTitleEn'='YouTube paid membership'
      and row_value->>'instructionsKo'='크리에이터 계정, 내 계정, 유효기간을 보여 주세요.'
      and row_value->>'instructionsEn'='Show the creator, your account, and validity.'
      and row_value->>'rejectionReason'='다음 결제일이 보이도록 다시 제출해 주세요.'
      and row_value->>'reviewedAt' is not null
      and row_value->'previousSubmissionId'='null'::jsonb
  ) then
    raise exception 'rejected admin review context mismatch';
  end if;
  begin
    insert into public.fan_activities(app_user_id,celebrity_id,activity_type,source_type,source_id)
    values('d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','membership','certification_submission',first_submission);
    raise exception 'rejected membership submission became an activity';
  exception when others then
    if sqlerrm not like '%membership activity must reference an owned approved membership submission%' then raise; end if;
  end;

  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000001',mission_id,'d1400000-0000-4000-8000-000000000012','d1000000-0000-4000-8000-000000000001/'||mission_id||'/d1400000-0000-4000-8000-000000000012.webp',100,10,10,repeat('b',64));
  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000001',mission_id,'d1400000-0000-4000-8000-000000000013','d1000000-0000-4000-8000-000000000001/'||mission_id||'/d1400000-0000-4000-8000-000000000013.webp',100,10,10,repeat('c',64));
  perform public.register_owned_certification_upload('d1000000-0000-4000-8000-000000000001',mission_id,'d1400000-0000-4000-8000-000000000014','d1000000-0000-4000-8000-000000000001/'||mission_id||'/d1400000-0000-4000-8000-000000000014.webp',100,10,10,repeat('d',64));
  begin
    perform public.submit_owned_certification('d1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000014','["d1400000-0000-4000-8000-000000000012","d1400000-0000-4000-8000-000000000013","d1400000-0000-4000-8000-000000000014","d1400000-0000-4000-8000-000000000011"]',null,first_submission);
    raise exception 'four-image membership proof was accepted';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_UPLOAD_COUNT_INVALID%' then raise; end if;
  end;
  submitted:=public.submit_owned_certification('d1000000-0000-4000-8000-000000000001',mission_id,'d1500000-0000-4000-8000-000000000015','["d1400000-0000-4000-8000-000000000012","d1400000-0000-4000-8000-000000000013","d1400000-0000-4000-8000-000000000014"]','updated proof',first_submission);
  second_submission:=(submitted->>'id')::uuid;
  if (select attempt_number from public.certification_submissions where id=second_submission)<>2
    or (select count(*) from public.certification_uploads where consumed_submission_id=second_submission)<>3 then
    raise exception 'three-image membership resubmission mismatch';
  end if;

  reviewed:=public.review_admin_certification_submission('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1500000-0000-4000-8000-000000000016',second_submission,'d1500000-0000-4000-8000-000000000017',1,'approve',null);
  replayed:=public.review_admin_certification_submission('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1500000-0000-4000-8000-000000000018',second_submission,'d1500000-0000-4000-8000-000000000017',1,'approve',null);
  select activity.id into strict v_activity_id from public.fan_activities activity where activity.source_type='certification_submission' and activity.source_id=second_submission;
  select stamp.id into strict v_stamp_id from public.stamps stamp where stamp.activity_id=v_activity_id and stamp.stamp_type='membership';
  if reviewed->>'status'<>'approved' or (replayed->>'replayed')::boolean is not true
    or (select count(*) from public.fan_activities where source_id=second_submission and activity_type='membership')<>1
    or (select count(*) from public.fan_score_ledger where manual_submission_id=second_submission and points=1)<>1
    or (select count(*) from public.stamps where activity_id=v_activity_id and stamp_type='membership')<>1
    or (select count(*) from public.blockchain_jobs where entity_type='stamp' and entity_id=v_stamp_id and payload->>'stampType'='Membership' and payload->>'recipient'='0xd100000000000000000000000000000000000001')<>1
    or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=second_submission) then
    raise exception 'membership approval was not exactly-once or granted a ticket';
  end if;

  begin
    insert into public.fan_score_ledger(activity_id,app_user_id,celebrity_id,points)
    values(v_activity_id,'d1000000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001',1);
    raise exception 'membership activity created an extra activity-sourced score';
  exception when others then
    if sqlerrm not like '%membership score requires manual submission source%' then raise; end if;
  end;
  begin
    insert into public.fan_activities(app_user_id,celebrity_id,activity_type,source_type,source_id)
    values('d1000000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','membership','certification_submission',second_submission);
    raise exception 'foreign membership submission became another owner activity';
  exception when others then
    if sqlerrm not like '%membership activity must reference an owned approved membership submission%' then raise; end if;
  end;

  -- Public/admin/owner wrappers add membership data while preserving current
  -- Passport stage and First Reaction wrappers.
  public_detail:=public.get_public_certification(mission_id,'ko');
  owner_detail:=public.get_owned_certification_submission('d1000000-0000-4000-8000-000000000001',second_submission,'ko');
  detail:=public.get_owned_certification_submission('d1000000-0000-4000-8000-000000000002',second_submission,'ko');
  history:=public.get_owned_celebrity_certification_history('d1000000-0000-4000-8000-000000000001','membership-contract','ko');
  admin_queue:=public.get_admin_certification_queue('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','approved');
  select value into strict collection_row from public.get_owned_passport_collection_with_stages('d1000000-0000-4000-8000-000000000001','ko') value where value->>'id'='d1200000-0000-4000-8000-000000000041';
  select value into strict passport_detail from public.get_owned_passport_detail_with_stages('d1200000-0000-4000-8000-000000000041','d1000000-0000-4000-8000-000000000001','ko') value;
  select value into strict stamp_detail from public.get_owned_stamp_detail(v_stamp_id,'d1000000-0000-4000-8000-000000000001','ko') value;
  select value into strict admin_fan from public.get_admin_fans(
    'd1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000010','d1500000-0000-4000-8000-000000000019',
    'ko',null,'d1100000-0000-4000-8000-000000000001',null,null,null,50) value
    where value->>'fanId'='d1000000-0000-4000-8000-000000000001';
  analytics:=public.read_admin_creator_analytics(
    'd1000000-0000-4000-8000-000000000010','d1100000-0000-4000-8000-000000000001',null,
    now()-interval '1 day',now()+interval '1 day',now()+interval '1 minute');
  if public_detail->>'membershipPlatform'<>'youtube' or public_detail->>'creatorAccountUrl'<>'https://www.youtube.com/@membership-contract'
    or public_detail->'reward'->>'stampCount'<>'1' or public_detail->'reward'->>'ticketAmount'<>'0'
    or owner_detail->>'membershipPlatform'<>'youtube' or owner_detail->'reward'->>'stampCount'<>'1' or detail is not null
    or not exists(select 1 from jsonb_array_elements(history) row_value where row_value->>'id'=second_submission::text and row_value->>'membershipPlatform'='youtube')
    or not exists(
      select 1 from jsonb_array_elements(admin_queue) row_value
      where row_value->>'id'=second_submission::text
        and row_value->>'membershipPlatform'='youtube'
        and row_value->>'applicantName'='멤버십팬'
        and row_value->>'creatorNameKo'='멤버십 테스트'
        and row_value->>'creatorNameEn'='Membership Test'
        and row_value->>'missionTitleEn'='YouTube paid membership'
        and row_value->>'instructionsKo'='크리에이터 계정, 내 계정, 유효기간을 보여 주세요.'
        and row_value->>'instructionsEn'='Show the creator, your account, and validity.'
        and row_value->>'reviewedAt' is not null
        and row_value->'rejectionReason'='null'::jsonb
        and row_value->>'previousSubmissionId'=first_submission::text
        and jsonb_array_length(row_value->'uploads')=3
    )
    or collection_row->'stampSummary'->>'membership'<>'1' or collection_row->'score'->>'points'<>'1' or not (collection_row->'score' ? 'stageProgress')
    or passport_detail->'stampSummary'->>'membership'<>'1' or passport_detail->'score'->>'points'<>'1' or not (passport_detail ? 'firstReaction') or not (passport_detail->'score' ? 'stageProgress')
    or not exists(select 1 from jsonb_array_elements(passport_detail->'activities') row_value where row_value->>'type'='membership' and row_value->>'points'='1')
    or stamp_detail->>'type'<>'membership' or stamp_detail->'activity'->>'points'<>'1'
    or admin_fan->'celebritySummaries'->0->'activityCounts'->>'membership'<>'1'
    or analytics->'metrics'->'stampTypeCounts'->'value'->>'membership'<>'1' then
    raise exception 'membership read model or existing wrapper regression';
  end if;

  if has_function_privilege('anon','public.save_admin_certification_mission_v2(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint,public.social_platform)','EXECUTE')
    or has_function_privilege('authenticated','public.save_admin_certification_mission_v2(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text,text,text,text,text,timestamptz,timestamptz,smallint,bigint,public.social_platform)','EXECUTE')
    or has_function_privilege('anon','public.review_admin_certification_submission(uuid,uuid,uuid,uuid,uuid,bigint,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.get_owned_passport_detail(uuid,uuid,public.content_locale)','EXECUTE')
    or has_function_privilege('anon','public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status)','EXECUTE')
    or has_function_privilege('authenticated','public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status)','EXECUTE')
    or not has_function_privilege('service_role','public.get_admin_certification_queue(uuid,uuid,public.certification_submission_status)','EXECUTE')
    or not has_function_privilege('service_role','public.get_owned_passport_detail(uuid,uuid,public.content_locale)','EXECUTE') then
    raise exception 'membership RPC privilege boundary mismatch';
  end if;
end $$;

select 'fan membership certifications behavioral verification passed' as result;
rollback;
