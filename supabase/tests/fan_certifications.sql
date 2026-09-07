-- Run with psql -v ON_ERROR_STOP=1. All fixtures are rolled back.
begin;

insert into public.app_users(id,privy_user_id,verified_email,status) values
('c3000000-0000-4000-8000-000000000001','did:privy:cert-owner','cert-owner@byus.test','active'),
('c3000000-0000-4000-8000-000000000002','did:privy:cert-other','cert-other@byus.test','active'),
('c3000000-0000-4000-8000-000000000003','did:privy:cert-admin','cert-admin@byus.test','active');
insert into public.admin_allowlist(id,email,role,active) values
('c3000000-0000-4000-8000-000000000010','cert-admin@byus.test','admin',true);
insert into public.celebrities(id,slug,status,image_url,published_at) values
('c3100000-0000-4000-8000-000000000001','certification-contract','draft','/certification-contract.webp',null);
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
('c3100000-0000-4000-8000-000000000001','ko','인증 테스트','인증 테스트','인증 테스트'),
('c3100000-0000-4000-8000-000000000001','en','Certification Test','Certification Test','Certification Test');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
('c3200000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',1,'draft',null);
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
('c3200000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000001',1,'c3200000-0000-4000-8000-000000000003','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
('c3200000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
('c3200000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000004');

-- This otherwise complete draft deliberately has no reward revision.
insert into public.certification_missions(id,celebrity_id,immutable_key,category,title_ko,title_en,description_ko,description_en,instructions_ko,instructions_en,opens_at,closes_at)
values('c3300000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001','missing-reward','기타','보상 미설정','Missing reward','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day');

do $$
declare
  saved jsonb; activated jsonb; submitted jsonb; reviewed jsonb; replayed jsonb;
  detail jsonb; history jsonb; zero_id uuid; positive_id uuid; first_id uuid; second_id uuid;
begin
  begin
    perform public.save_admin_certification_mission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000014','c3300000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001','missing-reward',null::bigint,'기타','보상 미설정','Missing reward','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',0::smallint,0::bigint);
    raise exception 'draft update accepted a null expected revision';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_MISSION_REVISION_PAIR_REQUIRED%' then raise; end if;
  end;
  begin
    perform public.set_admin_certification_mission_status('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000011','c3300000-0000-4000-8000-000000000001',1,'active');
    raise exception 'mission activated without a reward revision';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_ACTIVATION_INCOMPLETE%' then raise; end if;
  end;

  saved:=public.save_admin_certification_mission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000012',null::uuid,'c3100000-0000-4000-8000-000000000001','zero-reward',null::bigint,'기타','0 보상 인증','Zero reward','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',0::smallint,0::bigint);
  zero_id:=(saved->>'id')::uuid;
  activated:=public.set_admin_certification_mission_status('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3000000-0000-4000-8000-000000000013',zero_id,1,'active');
  if activated->>'status'<>'active' then raise exception 'explicit zero reward did not activate'; end if;

  begin
    perform public.register_owned_certification_upload('c3000000-0000-4000-8000-000000000002',zero_id,'c3500000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002/'||zero_id||'/c3500000-0000-4000-8000-000000000001.webp',100,10,10,repeat('a',64));
    raise exception 'non-passport owner registered proof';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_PASSPORT_REQUIRED%' then raise; end if;
  end;

  perform public.register_owned_certification_upload('c3000000-0000-4000-8000-000000000001',zero_id,'c3500000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001/'||zero_id||'/c3500000-0000-4000-8000-000000000002.webp',100,10,10,repeat('b',64));
  perform public.register_owned_certification_upload('c3000000-0000-4000-8000-000000000001',zero_id,'c3500000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001/'||zero_id||'/c3500000-0000-4000-8000-000000000003.webp',100,10,10,repeat('c',64));
  insert into public.certification_uploads(id,app_user_id,celebrity_id,mission_id,object_path,content_type,byte_size,width,height,sha256,expires_at)
  values('c3500000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',zero_id,'c3000000-0000-4000-8000-000000000001/'||zero_id||'/c3500000-0000-4000-8000-000000000004.webp','image/webp',100,10,10,repeat('d',64),now()-interval '1 second');
  begin
    perform public.submit_owned_certification('c3000000-0000-4000-8000-000000000001',zero_id,'c3600000-0000-4000-8000-000000000001','["c3500000-0000-4000-8000-000000000004"]',null,null);
    raise exception 'expired upload was consumed';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_UPLOAD_INVALID%' then raise; end if;
  end;

  submitted:=public.submit_owned_certification('c3000000-0000-4000-8000-000000000001',zero_id,'c3600000-0000-4000-8000-000000000002','["c3500000-0000-4000-8000-000000000002"]','first',null);
  first_id:=(submitted->>'id')::uuid;
  if not exists(select 1 from public.certification_uploads where id='c3500000-0000-4000-8000-000000000002' and consumed_submission_id=first_id) then raise exception 'upload consumption mismatch'; end if;
  begin
    perform public.submit_owned_certification('c3000000-0000-4000-8000-000000000001',zero_id,'c3600000-0000-4000-8000-000000000003','["c3500000-0000-4000-8000-000000000003"]',null,null);
    raise exception 'second pending submission succeeded';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_ALREADY_OPEN%' then raise; end if;
  end;

  reviewed:=public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3600000-0000-4000-8000-000000000004',first_id,'c3600000-0000-4000-8000-000000000005',1,'reject','날짜가 보이도록 다시 제출해 주세요.');
  submitted:=public.submit_owned_certification('c3000000-0000-4000-8000-000000000001',zero_id,'c3600000-0000-4000-8000-000000000006','["c3500000-0000-4000-8000-000000000003"]','second',first_id);
  second_id:=(submitted->>'id')::uuid;
  if (select attempt_number from public.certification_submissions where id=second_id)<>2 then raise exception 'resubmission attempt mismatch'; end if;
  reviewed:=public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3600000-0000-4000-8000-000000000007',second_id,'c3600000-0000-4000-8000-000000000008',1,'approve',null);
  replayed:=public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3600000-0000-4000-8000-000000000009',second_id,'c3600000-0000-4000-8000-000000000008',1,'approve',null);
  if (replayed->>'replayed')::boolean is not true then raise exception 'review idempotency did not replay'; end if;
  if exists(select 1 from public.fan_score_ledger where manual_submission_id=second_id) or exists(select 1 from public.fan_ticket_ledger where source_type='manual_certification' and source_id=second_id) then raise exception 'zero reward created a ledger row'; end if;

  saved:=public.save_admin_certification_mission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3700000-0000-4000-8000-000000000001',null::uuid,'c3100000-0000-4000-8000-000000000001','positive-reward',null::bigint,'티켓 영수증','영수증 인증','Receipt proof','설명','Description','지침','Instructions',now()-interval '1 hour',now()+interval '1 day',2::smallint,1::bigint);
  positive_id:=(saved->>'id')::uuid;
  perform public.set_admin_certification_mission_status('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3700000-0000-4000-8000-000000000002',positive_id,1,'active');
  perform public.register_owned_certification_upload('c3000000-0000-4000-8000-000000000001',positive_id,'c3700000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001/'||positive_id||'/c3700000-0000-4000-8000-000000000003.webp',100,10,10,repeat('e',64));
  submitted:=public.submit_owned_certification('c3000000-0000-4000-8000-000000000001',positive_id,'c3700000-0000-4000-8000-000000000004','["c3700000-0000-4000-8000-000000000003"]',null,null);
  first_id:=(submitted->>'id')::uuid;
  reviewed:=public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3700000-0000-4000-8000-000000000005',first_id,'c3700000-0000-4000-8000-000000000006',1,'approve',null);
  replayed:=public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3700000-0000-4000-8000-000000000007',first_id,'c3700000-0000-4000-8000-000000000006',1,'approve',null);
  if (select count(*) from public.fan_score_ledger where manual_submission_id=first_id)<>1 or (select points from public.fan_score_ledger where manual_submission_id=first_id)<>2 then raise exception 'manual score was not posted exactly once'; end if;
  if (select count(*) from public.fan_ticket_ledger where source_type='manual_certification' and source_id=first_id)<>1 or (select amount from public.fan_ticket_ledger where source_type='manual_certification' and source_id=first_id)<>1 then raise exception 'manual ticket was not posted exactly once'; end if;
  begin
    perform public.review_admin_certification_submission('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000010','c3700000-0000-4000-8000-000000000008',first_id,'c3700000-0000-4000-8000-000000000009',1,'reject','늦은 반려 요청');
    raise exception 'stale review succeeded';
  exception when others then
    if sqlerrm not like '%CERTIFICATION_STALE_REVISION%' then raise; end if;
  end;

  detail:=public.get_owned_certification_submission('c3000000-0000-4000-8000-000000000002',first_id,'ko');
  if detail is not null then raise exception 'another owner read submission detail'; end if;
  history:=public.get_owned_celebrity_certification_history('c3000000-0000-4000-8000-000000000001','certification-contract','ko');
  if not exists(select 1 from jsonb_array_elements(history) h where h->>'kind'='quiz') or not exists(select 1 from jsonb_array_elements(history) h where h->>'kind'='manual') then raise exception 'unified owner history is incomplete'; end if;
  if has_function_privilege('anon','public.submit_owned_certification(uuid,uuid,uuid,jsonb,text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.submit_owned_certification(uuid,uuid,uuid,jsonb,text,uuid)','EXECUTE') then raise exception 'browser roles can submit directly'; end if;
  if has_table_privilege('anon','public.certification_submissions','SELECT') or has_table_privilege('authenticated','public.certification_submissions','SELECT') then raise exception 'browser roles can read submissions'; end if;
end $$;

select 'fan_certifications behavioral verification passed' as result;
rollback;
