begin;

do $$
begin
  if to_regprocedure('public.configure_telegram_certification_reviews(text,boolean)') is null then
    raise exception 'TELEGRAM_CERTIFICATION_CONFIG_RPC_MISSING';
  end if;
  if not exists(select 1 from cron.job where jobname='telegram-certification-review-maintenance' and active
    and command like '%maintain_telegram_certification_reviews%') then
    raise exception 'TELEGRAM_CERTIFICATION_MAINTENANCE_CRON_MISSING';
  end if;
end $$;

create temporary table telegram_certification_test_ids(name text primary key,id uuid not null) on commit drop;

insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('a9000000-0000-4000-8000-000000000001','did:privy:telegram-cert-owner','telegram-cert-owner@byus.test','active'),
  ('a9000000-0000-4000-8000-000000000002','did:privy:telegram-cert-admin','telegram-cert-admin@byus.test','active');
insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
  ('a9000000-0000-4000-8000-000000000001','인증팬','인증팬');
insert into public.admin_allowlist(id,email,role,active) values
  ('a9000000-0000-4000-8000-000000000010','telegram-cert-admin@byus.test','admin',true);
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('a9100000-0000-4000-8000-000000000001','telegram-certification-contract','draft','/telegram-certification.webp',null,'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('a9100000-0000-4000-8000-000000000001','ko','텔레그램 인증','텔레그램 인증','텔레그램 인증'),
  ('a9100000-0000-4000-8000-000000000001','en','Telegram Certification','Telegram Certification','Telegram Certification');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001',1,'draft',null);
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('a9200000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9200000-0000-4000-8000-000000000001',1,'a9200000-0000-4000-8000-000000000003','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('a9200000-0000-4000-8000-000000000004','a9000000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9200000-0000-4000-8000-000000000002');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('a9200000-0000-4000-8000-000000000005','a9000000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9200000-0000-4000-8000-000000000004');

do $$
declare saved jsonb; mission uuid; submitted jsonb;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000001',
    null,'a9100000-0000-4000-8000-000000000001','telegram-before-activation',null,'기타','활성화 전','Before activation','설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',2::smallint,1::bigint,null);
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000002',mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000001.webp',100,10,10,repeat('a',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,'a9500000-0000-4000-8000-000000000001','["a9400000-0000-4000-8000-000000000001"]',null,null);
  insert into telegram_certification_test_ids values('old_submission',(submitted->>'id')::uuid);
  begin
    perform public.configure_telegram_certification_reviews('-1001234567890',true);
    raise exception 'TELEGRAM_CERTIFICATION_ENABLED_WITHOUT_SHARED_CURSOR';
  exception when others then
    if sqlerrm not like '%TELEGRAM_CERTIFICATION_SHARED_TELEGRAM_NOT_READY%' then raise; end if;
  end;
  perform public.configure_telegram_alerts('-1001234567890',true);
  perform public.configure_telegram_commands(true);
  perform public.configure_telegram_certification_reviews('-1001234567890',true);
  if exists(select 1 from public.telegram_certification_deliveries where submission_id=(submitted->>'id')::uuid) then
    raise exception 'TELEGRAM_CERTIFICATION_ACTIVATION_BACKFILLED';
  end if;
end $$;

create function pg_temp.create_telegram_certification_fixture(p_key text,p_upload_id uuid,p_score smallint,p_tickets bigint)
returns uuid language plpgsql as $$
declare saved jsonb; mission uuid; submitted jsonb;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',extensions.gen_random_uuid(),
    null,'a9100000-0000-4000-8000-000000000001',p_key,null,'기타',p_key,p_key,'설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',p_score,p_tickets,null);
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',extensions.gen_random_uuid(),mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,p_upload_id,
    'a9000000-0000-4000-8000-000000000001/'||mission||'/'||p_upload_id||'.webp',100,10,10,repeat('9',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,extensions.gen_random_uuid(),jsonb_build_array(p_upload_id),null,null);
  return (submitted->>'id')::uuid;
end $$;

do $$
declare saved jsonb; mission uuid; submitted jsonb;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000011',
    null,'a9100000-0000-4000-8000-000000000001','telegram-after-activation',null,'기타','영수증 인증','Receipt proof','설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',2::smallint,1::bigint,null);
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000012',mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000011','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000011.webp',100,10,10,repeat('b',64));
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000012','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000012.webp',100,20,10,repeat('c',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,'a9500000-0000-4000-8000-000000000011','["a9400000-0000-4000-8000-000000000011","a9400000-0000-4000-8000-000000000012"]','개인정보 없는 검토 메모',null);
  insert into telegram_certification_test_ids values('telegram_submission',(submitted->>'id')::uuid);
  if (select count(*) from public.telegram_certification_deliveries where submission_id=(submitted->>'id')::uuid)<>1 then
    raise exception 'TELEGRAM_CERTIFICATION_CAPTURE_MISSING_OR_DUPLICATED';
  end if;
end $$;

do $$
declare claim jsonb; delivery uuid; token text; lease text; first_upload uuid; second_upload uuid; approval jsonb;
begin
  if has_table_privilege('service_role','public.telegram_certification_deliveries','select')
    or has_table_privilege('anon','public.telegram_certification_deliveries','select')
    or has_function_privilege('anon','public.claim_telegram_certification_delivery(text)','execute')
    or has_function_privilege('authenticated','public.approve_telegram_certification(text,text,bigint,bigint,text,text)','execute')
    or not has_function_privilege('service_role','public.claim_telegram_certification_delivery(text)','execute')
    or has_function_privilege('anon','public.record_telegram_certification_delivery(uuid,text,text,text,uuid,integer,bigint,integer,text)','execute')
    or not has_function_privilege('service_role','public.record_telegram_certification_delivery(uuid,text,text,text,uuid,integer,bigint,integer,text)','execute')
    or has_function_privilege('service_role','public.finalize_certification_review_internal(uuid,bigint,public.certification_submission_status,text,public.certification_review_source,uuid,uuid,bigint,text,text,uuid)','execute') then
    raise exception 'TELEGRAM_CERTIFICATION_RLS_OR_RPC_ACL';
  end if;
  if public.claim_telegram_certification_delivery('-999') is not null then raise exception 'TELEGRAM_CERTIFICATION_WRONG_CHAT_CLAIMED'; end if;
  claim:=public.claim_telegram_certification_delivery('-1001234567890');
  delivery:=(claim->>'delivery_id')::uuid;token:=claim->>'callback_token';lease:=claim->>'lease_token';
  first_upload:=(claim->'uploads'->0->>'upload_id')::uuid;second_upload:=(claim->'uploads'->1->>'upload_id')::uuid;
  if claim->>'submission_id'<>(select id::text from telegram_certification_test_ids where name='telegram_submission')
    or claim->>'creator_name'<>'텔레그램 인증' or claim->>'mission_title'<>'영수증 인증'
    or claim->>'applicant_nickname'<>'인증팬' or claim->>'attempt_number'<>'1'
    or claim->'reward'<>jsonb_build_object('score_points',2,'ticket_amount',1,'stamp_count',0)
    or jsonb_array_length(claim->'uploads')<>2 or length(token)<>32 or length(lease)<>32
    or claim->'action_message_id'<>'null'::jsonb
    or claim->'uploads'->0->>'delivery_status'<>'pending'
    or claim->'uploads'->0->'provider_message_id'<>'null'::jsonb
    or claim::text like '%telegram-cert-owner@byus.test%'
    or claim ?| array['app_user_id','verified_email','email'] then
    raise exception 'TELEGRAM_CERTIFICATION_CLAIM_PAYLOAD_UNSAFE_OR_INCOMPLETE';
  end if;
  if public.claim_telegram_certification_delivery('-1001234567890') is not null then raise exception 'TELEGRAM_CERTIFICATION_DOUBLE_CLAIM'; end if;
  if (public.record_telegram_certification_delivery(delivery,'-1001234567890',repeat('0',32),'sending',first_upload,1)->>'accepted')::boolean then
    raise exception 'TELEGRAM_CERTIFICATION_STALE_LEASE_STARTED_SEND';
  end if;
  begin
    perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',second_upload,2);
    raise exception 'TELEGRAM_CERTIFICATION_ATTACHMENT_PRECEDED_ACTION';
  exception when others then
    if sqlerrm not like '%TELEGRAM_CERTIFICATION_ACTION_MESSAGE_REQUIRED%' then raise; end if;
  end;
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',first_upload,1);
  if (public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',first_upload,1)->>'accepted')::boolean then
    raise exception 'TELEGRAM_CERTIFICATION_SEND_REENTERED';
  end if;
  if public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sent',first_upload,1,9001)->>'status'<>'partial' then
    raise exception 'TELEGRAM_CERTIFICATION_FIRST_UPLOAD_NOT_PARTIAL';
  end if;
  update public.telegram_certification_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id=delivery;
  update public.telegram_certification_review_settings set lease_expires_at=clock_timestamp()-interval '1 second';
  perform public.maintain_telegram_certification_reviews();
  claim:=public.claim_telegram_certification_delivery('-1001234567890');
  if claim->>'delivery_id'<>delivery::text or claim->>'action_message_id'<>'9001'
    or claim->'uploads'->0->>'delivery_status'<>'sent' or claim->'uploads'->0->>'provider_message_id'<>'9001'
    or claim->'uploads'->1->>'delivery_status'<>'pending'
    or (public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',second_upload,2)->>'accepted')::boolean then
    raise exception 'TELEGRAM_CERTIFICATION_PARTIAL_RECLAIM_UNSAFE';
  end if;
  lease:=claim->>'lease_token';
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',second_upload,2);
  if public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sent',second_upload,2,9002)->>'status'<>'sent' then
    raise exception 'TELEGRAM_CERTIFICATION_UPLOADS_NOT_COMPLETE';
  end if;
  approval:=public.approve_telegram_certification('-1001234567890',repeat('0',32),9001,7001,'검토자','reviewer_1');
  if approval->>'error_code'<>'TELEGRAM_CERTIFICATION_CALLBACK_MISMATCH' then raise exception 'TELEGRAM_CERTIFICATION_CALLBACK_MISMATCH_ACCEPTED'; end if;
  approval:=public.approve_telegram_certification('-1001234567890',token,9001,7001,'검토자','reviewer_1');
  if (approval->>'outcome') is distinct from 'approved' or (approval->>'status') is distinct from 'approved'
    or (approval->>'reviewer_display_name') is distinct from '검토자' then raise exception 'TELEGRAM_CERTIFICATION_APPROVAL_FAILED'; end if;
  approval:=public.approve_telegram_certification('-1001234567890',token,9001,7002,'다른검토자','reviewer_2');
  if (approval->>'outcome') is distinct from 'already_processed' or (approval->>'status') is distinct from 'approved'
    or (approval->>'reviewer_display_name') is distinct from '검토자' then raise exception 'TELEGRAM_CERTIFICATION_FIRST_CLICK_NOT_FINAL'; end if;
end $$;

do $$
declare submission uuid:=(select id from telegram_certification_test_ids where name='telegram_submission');
begin
  if not exists(select 1 from public.certification_submissions where id=submission and status='approved' and review_source='telegram'
      and reviewed_by_app_user_id is null and reviewed_by_admin_allowlist_id is null and reviewed_by_telegram_user_id=7001 and reviewed_by_telegram_name='검토자')
    or (select count(*) from public.fan_score_ledger where manual_submission_id=submission and points=2)<>1
    or (select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id=submission and amount=1)<>1
    or (select count(*) from public.telegram_certification_review_receipts where submission_id=submission)<>1
    or not exists(select 1 from public.audit_logs where entity_id=submission::text and before_after_summary->>'reviewSource'='telegram') then
    raise exception 'TELEGRAM_CERTIFICATION_GENERIC_REWARD_OR_ATTRIBUTION_NOT_EXACTLY_ONCE';
  end if;
end $$;

-- Web review remains attributed to admin_web, and a delivered callback observes
-- the web winner as already processed rather than minting rewards again.
do $$
declare old_submission uuid:=(select id from telegram_certification_test_ids where name='old_submission'); reviewed jsonb;
begin
  reviewed:=public.review_admin_certification_submission('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',
    'a9600000-0000-4000-8000-000000000001',old_submission,'a9600000-0000-4000-8000-000000000002',1,'approve',null);
  if reviewed->>'status'<>'approved' or not exists(select 1 from public.certification_submissions where id=old_submission and review_source='admin_web'
      and reviewed_by_app_user_id='a9000000-0000-4000-8000-000000000002' and reviewed_by_telegram_user_id is null) then
    raise exception 'TELEGRAM_CERTIFICATION_WEB_REVIEW_REGRESSION';
  end if;
end $$;

-- A membership approval performs its wallet precondition before mutation, then
-- creates one activity, score row, stamp, and blockchain job after the wallet exists.
do $$
declare saved jsonb; mission uuid; submitted jsonb; claim jsonb; delivery uuid; upload uuid; token text; lease text; approval jsonb; submission uuid;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000021',
    null,'a9100000-0000-4000-8000-000000000001','telegram-membership',null,'멤버십','유튜브 멤버십','YouTube membership','설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',1::smallint,0::bigint,'youtube');
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000022',mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000021','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000021.webp',100,10,10,repeat('d',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,'a9500000-0000-4000-8000-000000000021','["a9400000-0000-4000-8000-000000000021"]',null,null);
  submission:=(submitted->>'id')::uuid;
  claim:=public.claim_telegram_certification_delivery('-1001234567890');delivery:=(claim->>'delivery_id')::uuid;token:=claim->>'callback_token';lease:=claim->>'lease_token';upload:=(claim->'uploads'->0->>'upload_id')::uuid;
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',upload,1);
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sent',upload,1,9011);
  approval:=public.approve_telegram_certification('-1001234567890',token,9011,7011,'멤버십검토자','member_reviewer');
  if approval->>'error_code'<>'CERTIFICATION_MEMBERSHIP_WALLET_NOT_READY'
    or not exists(select 1 from public.certification_submissions where id=submission and status='pending' and review_revision=1)
    or exists(select 1 from public.fan_activities where source_id=submission) then
    raise exception 'TELEGRAM_CERTIFICATION_WALLET_FAILURE_MUTATED_PENDING';
  end if;
  insert into public.user_wallets(id,app_user_id,chain_id,address) values
    ('a9700000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001',91342,'0xa900000000000000000000000000000000000001');
  approval:=public.approve_telegram_certification('-1001234567890',token,9011,7011,'멤버십검토자','member_reviewer');
  if approval->>'outcome'<>'approved'
    or (select count(*) from public.fan_activities where source_id=submission and activity_type='membership')<>1
    or (select count(*) from public.fan_score_ledger where manual_submission_id=submission and points=1)<>1
    or (select count(*) from public.stamps s join public.fan_activities a on a.id=s.activity_id where a.source_id=submission and s.stamp_type='membership')<>1
    or (select count(*) from public.blockchain_jobs j join public.stamps s on s.blockchain_job_id=j.id join public.fan_activities a on a.id=s.activity_id where a.source_id=submission)<>1
    or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=submission) then
    raise exception 'TELEGRAM_CERTIFICATION_MEMBERSHIP_REWARD_NOT_EXACTLY_ONCE';
  end if;
  approval:=public.approve_telegram_certification('-1001234567890',token,9011,7012,'다른멤버십검토자','other_member_reviewer');
  if approval->>'outcome'<>'already_processed'
    or (select count(*) from public.fan_activities where source_id=submission and activity_type='membership')<>1
    or (select count(*) from public.fan_score_ledger where manual_submission_id=submission)<>1
    or (select count(*) from public.stamps s join public.fan_activities a on a.id=s.activity_id where a.source_id=submission)<>1 then
    raise exception 'TELEGRAM_CERTIFICATION_MEMBERSHIP_REPEAT_NOT_FINAL';
  end if;
end $$;

-- Stale callback revisions are reported without changing the pending business row.
do $$
declare saved jsonb; mission uuid; submitted jsonb; claim jsonb; delivery uuid; upload uuid; token text; first_lease text; second_lease text; approval jsonb; submission uuid;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000031',
    null,'a9100000-0000-4000-8000-000000000001','telegram-stale',null,'기타','오래된 심사','Stale review','설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',0::smallint,0::bigint,null);
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000032',mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000031','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000031.webp',100,10,10,repeat('e',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,'a9500000-0000-4000-8000-000000000031','["a9400000-0000-4000-8000-000000000031"]',null,null);
  submission:=(submitted->>'id')::uuid;
  claim:=public.claim_telegram_certification_delivery('-1001234567890');delivery:=(claim->>'delivery_id')::uuid;token:=claim->>'callback_token';first_lease:=claim->>'lease_token';upload:=(claim->'uploads'->0->>'upload_id')::uuid;
  update public.telegram_certification_deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id=delivery;
  update public.telegram_certification_review_settings set lease_expires_at=clock_timestamp()-interval '1 second';
  perform public.maintain_telegram_certification_reviews();
  claim:=public.claim_telegram_certification_delivery('-1001234567890');second_lease:=claim->>'lease_token';
  if first_lease=second_lease or (public.record_telegram_certification_delivery(delivery,'-1001234567890',first_lease,'sending',upload,1)->>'accepted')::boolean then
    raise exception 'TELEGRAM_CERTIFICATION_EXPIRED_CLAIM_NOT_FENCED';
  end if;
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',second_lease,'sending',upload,1);
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',second_lease,'sent',upload,1,9021);
  update public.telegram_certification_deliveries set expected_review_revision=2 where id=delivery;
  approval:=public.approve_telegram_certification('-1001234567890',token,9021,7021,'검토자','stale_reviewer');
  if approval->>'error_code'<>'CERTIFICATION_STALE_REVISION'
    or not exists(select 1 from public.certification_submissions where id=submission and status='pending' and review_revision=1) then
    raise exception 'TELEGRAM_CERTIFICATION_STALE_REVISION_MUTATED_PENDING';
  end if;
end $$;

-- A web review that wins before a callback is final; the callback receives an
-- already_processed receipt and cannot duplicate the generic reward.
do $$
declare saved jsonb; mission uuid; submitted jsonb; claim jsonb; delivery uuid; upload uuid; token text; lease text; callback jsonb; submission uuid;
begin
  saved:=public.save_admin_certification_mission_v2(
    'a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000041',
    null,'a9100000-0000-4000-8000-000000000001','telegram-web-race',null,'기타','웹 경합','Web race','설명','Description','지침','Instructions',
    now()-interval '1 hour',now()+interval '1 day',2::smallint,1::bigint,null);
  mission:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010','a9300000-0000-4000-8000-000000000042',mission,1,'active');
  perform public.register_owned_certification_upload('a9000000-0000-4000-8000-000000000001',mission,'a9400000-0000-4000-8000-000000000041','a9000000-0000-4000-8000-000000000001/'||mission||'/a9400000-0000-4000-8000-000000000041.webp',100,10,10,repeat('f',64));
  submitted:=public.submit_owned_certification('a9000000-0000-4000-8000-000000000001',mission,'a9500000-0000-4000-8000-000000000041','["a9400000-0000-4000-8000-000000000041"]',null,null);
  submission:=(submitted->>'id')::uuid;
  claim:=public.claim_telegram_certification_delivery('-1001234567890');delivery:=(claim->>'delivery_id')::uuid;token:=claim->>'callback_token';lease:=claim->>'lease_token';upload:=(claim->'uploads'->0->>'upload_id')::uuid;
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',upload,1);
  perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sent',upload,1,9031);
  perform public.review_admin_certification_submission('a9000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000010',
    'a9600000-0000-4000-8000-000000000011',submission,'a9600000-0000-4000-8000-000000000012',1,'approve',null);
  callback:=public.approve_telegram_certification('-1001234567890',token,9031,7031,'늦은검토자','late_reviewer');
  if (callback->>'outcome') is distinct from 'already_processed' or (callback->>'status') is distinct from 'approved'
    or callback->'reviewer_display_name' is distinct from 'null'::jsonb
    or (select count(*) from public.fan_score_ledger where manual_submission_id=submission)<>1
    or (select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id=submission)<>1
    or not exists(select 1 from public.certification_submissions where id=submission and review_source='admin_web')
    or not exists(select 1 from public.audit_logs where entity_id=submission::text and action='certification.submission.telegram_already_processed'
      and before_after_summary->'telegram'->>'userId'='7031') then
    raise exception 'TELEGRAM_CERTIFICATION_WEB_CALLBACK_FINALITY_FAILED';
  end if;
end $$;

-- Explicit 429 responses are the only retryable send failure and stop after
-- three claims. An ambiguous send is terminal and retention runs while disabled.
do $$
declare submission uuid; claim jsonb; delivery uuid; upload uuid; lease text; i integer; result jsonb; unknown_delivery uuid;
begin
  submission:=pg_temp.create_telegram_certification_fixture('telegram-throttle','a9400000-0000-4000-8000-000000000051'::uuid,0::smallint,0::bigint);
  for i in 1..3 loop
    claim:=public.claim_telegram_certification_delivery('-1001234567890');
    delivery:=(claim->>'delivery_id')::uuid;upload:=(claim->'uploads'->0->>'upload_id')::uuid;lease:=claim->>'lease_token';
    perform public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'sending',upload,1);
    result:=public.record_telegram_certification_delivery(delivery,'-1001234567890',lease,'throttled',upload,1,null,1);
    if (result->>'status') is distinct from (case when i<3 then 'pending' else 'failed' end) then
      raise exception 'TELEGRAM_CERTIFICATION_THROTTLE_CAP_FAILED';
    end if;
    update public.telegram_certification_review_settings set next_send_at='-infinity';
    update public.telegram_certification_deliveries set available_at=clock_timestamp() where id=delivery and status='pending';
  end loop;
  if public.claim_telegram_certification_delivery('-1001234567890') is not null then raise exception 'TELEGRAM_CERTIFICATION_THROTTLED_RESENT'; end if;

  submission:=pg_temp.create_telegram_certification_fixture('telegram-ambiguous','a9400000-0000-4000-8000-000000000052'::uuid,0::smallint,0::bigint);
  claim:=public.claim_telegram_certification_delivery('-1001234567890');
  unknown_delivery:=(claim->>'delivery_id')::uuid;upload:=(claim->'uploads'->0->>'upload_id')::uuid;lease:=claim->>'lease_token';
  perform public.record_telegram_certification_delivery(unknown_delivery,'-1001234567890',lease,'sending',upload,1);
  result:=public.record_telegram_certification_delivery(unknown_delivery,'-1001234567890',lease,'delivery_unknown',upload,1);
  update public.telegram_certification_review_settings set next_send_at='-infinity';
  if result->>'status'<>'delivery_unknown' or public.claim_telegram_certification_delivery('-1001234567890') is not null then
    raise exception 'TELEGRAM_CERTIFICATION_AMBIGUOUS_SEND_RETRIED';
  end if;
  perform public.configure_telegram_certification_reviews('-1001234567890',false);
  update public.telegram_certification_deliveries set finished_at=clock_timestamp()-interval '31 days' where id in (delivery,unknown_delivery);
  perform public.maintain_telegram_certification_reviews();
  if exists(select 1 from public.telegram_certification_deliveries where id in (delivery,unknown_delivery)) then
    raise exception 'TELEGRAM_CERTIFICATION_DISABLED_RETENTION_FAILED';
  end if;
end $$;

rollback;
