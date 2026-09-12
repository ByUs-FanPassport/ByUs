-- Disposable clean-replay database only. Never run against a deployed database.
do $$ begin
 if current_database()<>'byus_clean' or inet_server_addr() is not null then
  raise exception 'Kakao tests require disposable local byus_clean'; end if;
end $$;
create schema kakao_test;
create function kakao_test.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'KAKAO_TEST: %',message; end if; end $$;
create table kakao_test.jobs(case_name text primary key,delivery_id uuid not null,app_user_id uuid not null,channel_id uuid not null);
create table kakao_test.email_before as select id,to_jsonb(o) as snapshot from public.external_notification_delivery_outbox o with no data;

begin;
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
 ('91000000-0000-4000-8000-000000000001','alimtalk-test-artist','published','/test.png',now(),array['creator']::public.celebrity_role[],'creator');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
 ('91000000-0000-4000-8000-000000000001','ko','테스트 크리에이터','통합 검증','크리에이터'),
 ('91000000-0000-4000-8000-000000000001','en','Test creator','Integration test','Creator');
insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values
 ('91000000-0000-4000-8000-000000000002','alimtalk-test-brand','published','/test.png','브랜드',now());
insert into public.brand_localizations(brand_id,locale,name,description) values
 ('91000000-0000-4000-8000-000000000002','ko','테스트 브랜드','통합 검증'),
 ('91000000-0000-4000-8000-000000000002','en','Test brand','Integration test');
insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,content_status,
 starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at)
values('91000000-0000-4000-8000-000000000003','alimtalk-test-live','91000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000002','published','scheduled',now()+interval '10 minutes',now()+interval '1 hour',
 now()-interval '1 day',now()+interval '5 minutes','https://youtube.com/watch?v=abc12345678','/test.png',extensions.crypt('TEST',extensions.gen_salt('bf',10)),now());
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values
 ('91000000-0000-4000-8000-000000000003','ko','카카오 통합 검증 LIVE','통합 검증','LIVE'),
 ('91000000-0000-4000-8000-000000000003','en','Integration LIVE','Integration test','LIVE');
commit;

create function kakao_test.enroll(owner_id uuid, seed text, phone text) returns uuid language plpgsql as $$
declare state_hash text:=encode(extensions.digest(seed,'sha256'),'hex'); subject_hash text:=encode(extensions.digest(owner_id::text,'sha256'),'hex'); pending jsonb; channel jsonb;
begin
 perform public.create_owned_kakao_alimtalk_state(owner_id,state_hash,repeat('a',64),'/settings');
 perform public.consume_owned_kakao_connection_state(owner_id,state_hash);
 perform public.complete_owned_kakao_connection(owner_id,subject_hash);
 pending:=public.stage_owned_kakao_phone_enrollment(owner_id,state_hash,subject_hash,phone);
 perform kakao_test.assert(pending->>'destinationLabel'='010-****-'||right(phone,4),'only masked phone returned');
 channel:=public.confirm_owned_kakao_phone_enrollment(owner_id,(pending->>'id')::uuid,'kakao-alimtalk-v1');
 perform kakao_test.assert(public.get_owned_kakao_phone_enrollment(owner_id) is null,'confirmation consumes pending');
 begin
  perform public.confirm_owned_kakao_phone_enrollment(owner_id,(pending->>'id')::uuid,'kakao-alimtalk-v1');
  raise exception 'KAKAO_TEST: confirmation replay accepted';
 exception when others then if sqlerrm='KAKAO_TEST: confirmation replay accepted' then raise; end if; end;
 return (channel->>'id')::uuid;
end $$;
create function kakao_test.job(case_name text, seq integer) returns uuid language plpgsql as $$
declare owner_id uuid:=extensions.gen_random_uuid(); channel uuid; notification uuid; delivery uuid;
begin
 insert into public.app_users(id,privy_user_id,verified_email) values(owner_id,'did:privy:alimtalk-'||owner_id,owner_id||'@example.invalid');
 channel:=kakao_test.enroll(owner_id,case_name,'0109000'||lpad(seq::text,4,'0'));
 insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
 values(owner_id,'live_10m','test:'||case_name,'91000000-0000-4000-8000-000000000003',now(),'/live/alimtalk-test-live',
 '{"title":"LIVE 시작 안내","detail":"곧 시작합니다."}') returning id into notification;
 select id into strict delivery from public.external_notification_delivery_outbox where notification_id=notification and public.external_notification_delivery_outbox.channel='kakao';
 insert into kakao_test.jobs values(case_name,delivery,owner_id,channel);
 return delivery;
end $$;

-- Keep a real pre-existing Email job outside its claim window. Dedicated
-- Kakao work must leave every persisted field identical.
insert into public.app_users(id,privy_user_id,verified_email) values
 ('91000000-0000-4000-8000-000000000010','did:privy:alimtalk-email-owner','email-unchanged@example.invalid');
select public.sync_owned_google_notification_channel('91000000-0000-4000-8000-000000000010',
 'did:privy:alimtalk-email-owner','email-unchanged@example.invalid',true,now());
insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
 values('91000000-0000-4000-8000-000000000010','live_10m','test:email-unchanged',
 '91000000-0000-4000-8000-000000000003',now(),'/live/alimtalk-test-live','{"title":"Email retained","detail":"Not sent"}');
update public.external_notification_delivery_outbox set available_at=now()+interval '1 year' where channel='email';
insert into kakao_test.email_before select id,to_jsonb(o) from public.external_notification_delivery_outbox o where channel='email';
select kakao_test.assert(exists(select 1 from kakao_test.email_before b join public.fan_notifications n on n.id=(b.snapshot->>'notification_id')::uuid where n.app_user_id='91000000-0000-4000-8000-000000000010'),'dedicated Email preservation fixture retained alongside existing pending');

-- Enrollment owner binding, cancellation and privilege boundaries.
do $$
declare o uuid:=extensions.gen_random_uuid(); stranger uuid:=extensions.gen_random_uuid(); state text:=repeat('b',64); pending jsonb; channel uuid; f record;
begin
 insert into public.app_users(id,privy_user_id,verified_email) values(o,'did:privy:enrollment-owner','owner@example.invalid'),(stranger,'did:privy:enrollment-stranger','stranger@example.invalid');
 perform public.create_owned_kakao_alimtalk_state(o,state,repeat('c',64),'/settings');
 begin
  perform public.consume_owned_kakao_connection_state(stranger,state);
  raise exception 'KAKAO_TEST: cross-owner state accepted';
 exception when others then if sqlerrm='KAKAO_TEST: cross-owner state accepted' then raise; end if; end;
 perform public.consume_owned_kakao_connection_state(o,state);
 perform public.complete_owned_kakao_connection(o,repeat('d',64));
 pending:=public.stage_owned_kakao_phone_enrollment(o,state,repeat('d',64),'01099990001');
 begin
  perform public.confirm_owned_kakao_phone_enrollment(stranger,(pending->>'id')::uuid,'kakao-alimtalk-v1');
  raise exception 'KAKAO_TEST: cross-owner confirmation accepted';
 exception when others then if sqlerrm='KAKAO_TEST: cross-owner confirmation accepted' then raise; end if; end;
 perform public.cancel_owned_kakao_phone_enrollment(o);
 perform kakao_test.assert(public.get_owned_kakao_phone_enrollment(o) is null,'cancel purges pending phone');
 begin
  perform public.stage_owned_kakao_phone_enrollment(o,state,repeat('d',64),'01099990001');
  raise exception 'KAKAO_TEST: canceled state restaged';
 exception when others then if sqlerrm='KAKAO_TEST: canceled state restaged' then raise; end if; end;
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and (proname like '%kakao%' or proname like '%before_alimtalk') loop
  perform kakao_test.assert(not has_function_privilege('anon',f.oid,'EXECUTE'),'anon RPC exposure: '||f.proname);
  perform kakao_test.assert(not has_function_privilege('authenticated',f.oid,'EXECUTE'),'authenticated RPC exposure: '||f.proname);
  if f.proname like '%before_alimtalk' then perform kakao_test.assert(not has_function_privilege('service_role',f.oid,'EXECUTE'),'legacy service bypass'); end if;
 end loop;
 perform kakao_test.assert(not has_table_privilege('service_role','public.kakao_phone_enrollments','SELECT'),'private phone table ACL');
 perform kakao_test.assert(not has_table_privilege('authenticated','public.kakao_notification_attempts','SELECT'),'attempt table ACL');
end $$;

-- Accepted is not sent; ID conflicts, duplicate/out-of-order results, purged
-- phone reconciliation, unknown and no automatic send retries.
do $$
declare d uuid; j record; o uuid; c uuid; before_hash text;
begin
 d:=kakao_test.job('accepted',1);
 select * into strict j from public.claim_kakao_notification_deliveries('test-worker',1,60);
 perform kakao_test.assert(j.id=d and j.template_id is not null,'claim expected eligible delivery');
 perform kakao_test.assert(public.begin_kakao_notification_send(d,j.attempt_token,j.template_id,repeat('a',64)),'initial begin');
 perform kakao_test.assert(not public.begin_kakao_notification_send(d,j.attempt_token,j.template_id,repeat('a',64)),'lost begin response cannot authorize twice');
 begin
  perform public.complete_external_notification_delivery(d,'test-worker','legacy-id');
  raise exception 'legacy completion allowed';
 exception when others then if sqlerrm<>'KAKAO_DEDICATED_RESULT_REQUIRED' then raise; end if; end;
 begin
  perform public.fail_external_notification_delivery(d,'test-worker','FAILURE',true);
  raise exception 'legacy failure allowed';
 exception when others then if sqlerrm<>'KAKAO_DEDICATED_RESULT_REQUIRED' then raise; end if; end;
 perform kakao_test.assert(public.record_kakao_notification_submission(d,j.attempt_token,'accepted','MSG-accepted','GRP-accepted',null),'record acceptance');
 perform kakao_test.assert((select status='processing' and sent_at is null and attempt_count=1 from public.external_notification_delivery_outbox where id=d),'acceptance is not delivery');
 perform kakao_test.assert(not public.record_kakao_notification_receipt(d,'MSG-wrong','GRP-accepted'),'receipt ID mismatch rejected');
 perform kakao_test.assert(public.record_kakao_notification_receipt(d,'MSG-accepted','GRP-accepted'),'duplicate valid receipt accepted');
 select app_user_id,channel_id into o,c from kakao_test.jobs where delivery_id=d;
 select destination_fingerprint into before_hash from public.kakao_notification_attempts where delivery_id=d;
 perform public.set_owned_notification_channel_consent(o,c,false,'kakao-alimtalk-v1');
 perform kakao_test.assert(not exists(select 1 from public.fan_notification_channel_private where channel_id=c),'withdrawal deletes raw phone');
 perform kakao_test.assert((select destination_fingerprint=before_hash from public.kakao_notification_attempts where delivery_id=d),'immutable fingerprint retained');
 perform kakao_test.assert((select count(*)=1 from public.claim_kakao_notification_reconciliations(2) where id=d),'receipt can reconcile after phone deletion');
 perform kakao_test.assert(public.record_kakao_notification_result(d,'MSG-accepted','delivered','4000'),'canonical delivered recorded');
 perform kakao_test.assert((select status='sent' and sent_at is not null from public.external_notification_delivery_outbox where id=d),'only delivered becomes sent');
 perform public.record_kakao_notification_result(d,'MSG-accepted','pending','2000');
 perform public.record_kakao_notification_result(d,'MSG-accepted','failed','3010');
 perform kakao_test.assert((select status='delivered' from public.kakao_notification_attempts where delivery_id=d),'terminal result does not regress');
 d:=kakao_test.job('unknown',2);
 select * into strict j from public.claim_kakao_notification_deliveries('test-worker',1,60);
 perform kakao_test.assert(public.begin_kakao_notification_send(d,j.attempt_token,j.template_id,repeat('b',64)),'unknown begin');
 update public.kakao_notification_attempts set lease_expires_at=now()-interval '1 second' where delivery_id=d;
 perform public.maintain_kakao_notification_deliveries();
 perform kakao_test.assert((select status='unknown' from public.kakao_notification_attempts where delivery_id=d),'expired sending becomes unknown');
 perform kakao_test.assert((select count(*)=0 from public.claim_kakao_notification_deliveries('test-worker',2,60)),'unknown cannot be resent');
 perform kakao_test.assert(public.record_kakao_notification_receipt(d,'MSG-unknown','GRP-unknown'),'lost ACK recovered by valid receipt');
 perform kakao_test.assert(public.record_kakao_notification_submission(d,j.attempt_token,'accepted','MSG-unknown','GRP-unknown',null),'late matching ACK accepted');
 perform kakao_test.assert(not public.record_kakao_notification_result(d,'MSG-unknown','failed','9999'),'undocumented result cannot become terminal');
 perform kakao_test.assert(public.record_kakao_notification_result(d,'MSG-unknown','failed','3010'),'canonical failure recorded');
 perform kakao_test.assert((select status='failed' and available_at='infinity'::timestamptz from public.external_notification_delivery_outbox where id=d),'final failure not automatically retried');
end $$;

-- Generic sender isolation, enrollment-generation invalidation and prepared
-- lease recovery. The concurrent begin/revoke schedules follow in the shell.
do $$
declare d uuid; j record; old_token uuid; o uuid; c uuid;
begin
 d:=kakao_test.job('reenrolled',3);
 perform kakao_test.assert((select count(*)=0 from public.claim_external_notification_deliveries('generic',25,60) where channel='kakao'),'all Kakao excluded from generic queue');
 select * into strict j from public.claim_kakao_notification_deliveries('test-worker',1,60);
 old_token:=j.attempt_token;
 update public.kakao_notification_attempts set lease_expires_at=now()-interval '1 second' where delivery_id=d;
 update public.external_notification_delivery_outbox set lease_expires_at=now()-interval '1 second' where id=d;
 select * into strict j from public.claim_kakao_notification_deliveries('test-worker-new',1,60);
 perform kakao_test.assert(j.attempt_token<>old_token,'prepared lease reissued');
 perform kakao_test.assert(not public.begin_kakao_notification_send(d,old_token,j.template_id,repeat('c',64)),'expired token denied');
 select app_user_id,channel_id into o,c from kakao_test.jobs where delivery_id=d;
 perform public.set_owned_notification_channel_consent(o,c,false,'kakao-alimtalk-v1');
 perform kakao_test.enroll(o,'second-enrollment','01090000003');
 perform kakao_test.assert(not public.begin_kakao_notification_send(d,j.attempt_token,j.template_id,repeat('c',64)),'old delivery cannot use a new enrollment');
 perform kakao_test.assert((select status='suppressed' from public.kakao_notification_attempts where delivery_id=d),'changed consent suppresses prepared delivery');
 perform kakao_test.assert(not exists(select 1 from kakao_test.email_before b full join public.external_notification_delivery_outbox retained on retained.id=b.id and retained.channel='email' where (retained.channel='email' or b.id is not null) and b.snapshot is distinct from to_jsonb(retained)),'existing Email unchanged');
end $$;
-- Admin DTO remains ISO-compatible and cannot manually retry Kakao.
insert into public.app_users(id,privy_user_id,verified_email) values
 ('91000000-0000-4000-8000-000000000020','did:privy:alimtalk-admin','alimtalk-admin@example.invalid');
insert into public.admin_allowlist(id,email,role,active) values
 ('91000000-0000-4000-8000-000000000021','alimtalk-admin@example.invalid','admin',true);
do $$
declare data jsonb; item jsonb; target uuid;
begin
 data:=public.get_admin_notification_deliveries('91000000-0000-4000-8000-000000000020','91000000-0000-4000-8000-000000000021');
 for item in select value from jsonb_array_elements(data->'items') loop
  perform kakao_test.assert(item->>'nextAttemptAt' is not null and item->>'nextAttemptAt'<>'infinity','admin ISO date present');
  if item->>'channel'='kakao' then perform kakao_test.assert((item->>'manuallyRetryable')::boolean=false,'admin Kakao retry disabled'); end if;
 end loop;
 select delivery_id into target from kakao_test.jobs where case_name='unknown';
 begin
  perform public.admin_retry_notification_delivery(target,'91000000-0000-4000-8000-000000000020',
   '91000000-0000-4000-8000-000000000021',extensions.gen_random_uuid(),extensions.gen_random_uuid());
  raise exception 'KAKAO_TEST: admin retry allowed';
 exception when others then if sqlerrm not like '%not final failed%' then raise; end if; end;
end $$;
select kakao_test.job('race-begin',11),kakao_test.job('revoke-first',12),kakao_test.job('begin-first',13);
select 'Kakao SQL enrollment, lifecycle, immutable identity, isolation and ACL PASS' as result;
