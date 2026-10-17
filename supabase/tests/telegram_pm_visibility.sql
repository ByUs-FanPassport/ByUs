-- Disposable local replay only. Domain fixtures and injected failures all roll back.
do $$ begin
  if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local replay only'; end if;
end $$;
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end $$;

insert into public.app_users(id,privy_user_id,verified_email) values
 ('af170000-0000-4000-8000-000000000001','did:privy:pm-fixture','pm-fixture@example.invalid');
insert into public.admin_allowlist(id,email,role) values
 ('af170000-0000-4000-8000-000000000002','pm-fixture@example.invalid','operator');
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
 ('af170000-0000-4000-8000-000000000003','telegram-pm-fixture','published','/images/creator.webp',now(),'{creator}','creator');
insert into public.benefits(id,slug,celebrity_id,publication_status,delivery_type) values
 ('af170000-0000-4000-8000-000000000004','telegram-pm-benefit','af170000-0000-4000-8000-000000000003','draft','text');
insert into public.benefit_localizations(benefit_id,locale,title,summary,eligibility_label,delivery_label) values
 ('af170000-0000-4000-8000-000000000004','ko','검증 경품','로컬 검증 경품','검증 대상','검증 전달');

-- Real published/unpublished draws exercise the aggregate joins, not a mock view.
create function pg_temp.fulfillment(p_status public.benefit_fulfillment_status default 'information_required',
 p_method public.benefit_fulfillment_method default 'physical_shipping',p_disposition text default 'active',
 p_deadline timestamptz default null,p_published boolean default true) returns uuid language plpgsql as $$
declare campaign uuid:=gen_random_uuid(); draw uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid();
 winner uuid:=gen_random_uuid(); fulfillment uuid:=gen_random_uuid();
 actor constant uuid:='af170000-0000-4000-8000-000000000001';
 admin constant uuid:='af170000-0000-4000-8000-000000000002';
 benefit constant uuid:='af170000-0000-4000-8000-000000000004';
begin
 insert into public.live_benefit_campaigns(id,celebrity_id,status,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id,published_at)
 values(campaign,'af170000-0000-4000-8000-000000000003','published',now()-interval '2 days',now()-interval '1 day',actor,admin,now());
 insert into public.live_benefit_campaign_items(campaign_id,benefit_id,priority,winner_quantity,fulfillment_method)
 values(campaign,benefit,1,1,p_method);
 insert into public.benefit_draws(id,campaign_id,idempotency_key,algorithm,seed_hash,actor_app_user_id,actor_admin_allowlist_id,correlation_id)
 values(draw,campaign,gen_random_uuid(),'sha256-weighted-rank-v1',repeat('a',64),actor,admin,gen_random_uuid());
 insert into public.benefit_draw_candidates(id,draw_id,campaign_id,benefit_id,app_user_id,weight,digest,uniform_value,rank_value,result)
 values(candidate,draw,campaign,benefit,actor,1,repeat('b',64),0.5,1,'won');
 insert into public.benefit_draw_winners(id,draw_id,campaign_id,benefit_id,app_user_id,candidate_id)
 values(winner,draw,campaign,benefit,actor,candidate);
 if p_published then
  insert into public.benefit_draw_publications(draw_id,campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id)
  values(draw,campaign,actor,admin,gen_random_uuid());
 end if;
 insert into public.benefit_fulfillments(id,winner_id,method,status,claim_disposition,recipient_deadline_at,closed_at,claim_closed_reason,claim_closed_by_app_user_id,claim_closed_by_admin_allowlist_id)
 values(fulfillment,winner,p_method,p_status,p_disposition,p_deadline,
 case when p_disposition='unclaimed' then now() end,case when p_disposition='unclaimed' then 'local fixture closed claim' end,
 case when p_disposition='unclaimed' then actor end,case when p_disposition='unclaimed' then admin end);
 return fulfillment;
end $$;

create function pg_temp.report(p_status text default 'open',p_created timestamptz default clock_timestamp())
 returns uuid language plpgsql as $$
declare report uuid:=gen_random_uuid();
begin
 insert into public.content_reports(id,app_user_id,celebrity_id,target_type,target_id,target_revision,target_app_user_id,reason,idempotency_key,status,created_at)
 values(report,'af170000-0000-4000-8000-000000000001','af170000-0000-4000-8000-000000000003',
  'fan_post',gen_random_uuid(),1,'af170000-0000-4000-8000-000000000001','PRIVATE_REPORT_REASON',gen_random_uuid(),p_status,p_created);
 return report;
end $$;
select public.configure_telegram_alerts('-1001234567890',true);
update public.telegram_alert_settings set activated_at='2000-01-01';
delete from public.telegram_alert_outbox;

do $$
declare report uuid; payload jsonb; batch uuid; before_n integer;
begin
 perform pg_temp.expect(exists(select 1 from pg_trigger where tgrelid='public.content_reports'::regclass
   and tgfoid='public.capture_telegram_activity()'::regprocedure and not tgisinternal),'real report trigger attached');
 report:=pg_temp.report();
 update public.content_reports set reason='PRIVATE_UPDATED_REASON' where id=report;
 perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='content_report_created'),'report insert captured once, update ignored');
 perform pg_temp.expect((select activity_context='팬 게시글 · 신고 '||report::text and activity_quantity is null
   and activity_actor_id is null and activity_source_id is null from public.telegram_alert_outbox where kind='content_report_created'),'report allowlisted context only');
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890'); batch:=(payload->>'batch_id')::uuid;
 perform pg_temp.expect(payload#>>'{alerts,0,kind}'='content_report_created' and payload#>>'{alerts,0,actor_email}' is null
   and payload#>>'{alerts,0,actor_name}' is null and payload#>'{alerts,0,detail}' is null,'report anonymous claimed DTO');
 perform pg_temp.expect(payload::text !~ '(PRIVATE_|pm-fixture|reason|reporter|target_app_user_id|"body")','no report private fields');
 perform pg_temp.expect(public.reject_telegram_alert_batch(batch,'-1001234567890'),'report batch rejected locally');
 perform public.configure_telegram_alerts('-1001234567890',false);
 report:=pg_temp.report();
 perform pg_temp.expect(not exists(select 1 from public.telegram_alert_outbox where source_id=md5('content_reports:'||report::text)::uuid),'disabled report uncaptured');
 perform public.configure_telegram_alerts('-1001234567890',true);
 report:=pg_temp.report('open','1999-01-01');
 perform pg_temp.expect(not exists(select 1 from public.telegram_alert_outbox where source_id=md5('content_reports:'||report::text)::uuid),'preactivation report uncaptured');
 before_n:=(select count(*) from public.content_reports);
 begin
  perform pg_temp.report();
  raise exception 'rollback fixture';
 exception when raise_exception then if sqlerrm<>'rollback fixture' then raise; end if; end;
 perform pg_temp.expect((select count(*)=before_n from public.content_reports),'report transaction rollback');
 perform pg_temp.expect(not exists(select 1 from public.telegram_alert_outbox where status='pending'),'capture rolls back with source');
end $$;
-- Inject an outbox failure only for this test, proving the business INSERT survives.
create function pg_temp.fail_report_capture() returns trigger language plpgsql as $$
begin if new.kind='content_report_created' then raise exception 'injected capture failure'; end if; return new; end $$;
create trigger pm_test_fail_capture before insert on public.telegram_alert_outbox for each row execute function pg_temp.fail_report_capture();
do $$ declare report uuid; begin
 report:=pg_temp.report();
 perform pg_temp.expect(exists(select 1 from public.content_reports where id=report),'report source survives capture failure');
 perform pg_temp.expect(not exists(select 1 from public.telegram_alert_outbox where source_id=md5('content_reports:'||report::text)::uuid),'failed capture emits no partial row');
end $$;
drop trigger pm_test_fail_capture on public.telegram_alert_outbox;
update public.telegram_alert_settings set activated_at='2000-01-01';

-- Typed temporary event rows isolate every transition, real fulfillment joins supply its label.
create temp table benefit_fulfillment_events as select * from public.benefit_fulfillment_events with no data;
create trigger capture after insert on benefit_fulfillment_events for each row execute function public.capture_telegram_activity();
do $$
declare fulfillment uuid:=pg_temp.fulfillment(); event_id uuid:=gen_random_uuid(); payload jsonb;
begin
 delete from public.telegram_alert_outbox;
 insert into benefit_fulfillment_events(id,fulfillment_id,from_status,to_status,created_at,operator_memo,tracking_number)
 values(event_id,fulfillment,'information_required','ready',clock_timestamp(),'PRIVATE_MEMO','PRIVATE_TRACKING');
 insert into benefit_fulfillment_events select * from benefit_fulfillment_events;
 insert into benefit_fulfillment_events(id,fulfillment_id,from_status,to_status,created_at) values
  (gen_random_uuid(),fulfillment,'ready','ready',clock_timestamp()),
  (gen_random_uuid(),fulfillment,null,'ready',clock_timestamp()),
  (gen_random_uuid(),fulfillment,'shipping_preparing','ready',clock_timestamp()),
  (gen_random_uuid(),fulfillment,'information_required','shipping_preparing',clock_timestamp());
 perform pg_temp.expect((select count(*)=1 and min(activity_context)='수령 정보 접수 · 전달 준비 필요 · 검증 경품'
   from public.telegram_alert_outbox where kind='fulfillment_updated'),'recipient ready transition captured once with benefit label');
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 perform pg_temp.expect(payload::text !~ '(PRIVATE_|operator_memo|tracking_number|address|phone|recipient|pm-fixture)','fulfillment DTO has no recipient details');
 perform public.reject_telegram_alert_batch((payload->>'batch_id')::uuid,'-1001234567890');
end $$;

-- Exercise mint context through real immutable attempt history, including arbitrary uppercase codes.
do $$
declare job uuid:=gen_random_uuid(); payload jsonb;
begin
 delete from public.telegram_alert_outbox;
 insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key)
 values(job,'passport',gen_random_uuid(),'telegram-pm-job-'||job::text);
 insert into public.blockchain_job_attempt_history(blockchain_job_id,attempt_number,event,to_status,safe_error_code)
 values(job,3,'failed','FAILED','PRIVATE_USER_SECRET_123');
 perform pg_temp.expect((select count(*)=1 and min(activity_context)='팬 패스 · 시도 3회 · 작업 '||job::text||' · 오류 UNKNOWN_JOB_ERROR'
   from public.telegram_alert_outbox where kind='mint_failed'),'mint type attempt job id and redacted error');
 insert into public.blockchain_job_attempt_history(blockchain_job_id,attempt_number,event,to_status,safe_error_code)
 values(job,4,'failed','FAILED','GIWA_RPC_READ_FAILED');
 perform pg_temp.expect(exists(select 1 from public.telegram_alert_outbox where activity_context like '%오류 GIWA_RPC_READ_FAILED'),'allowlisted mint error remains useful');
 update public.telegram_alert_settings set next_send_at='-infinity';
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 perform pg_temp.expect(payload::text !~ '(PRIVATE_|payload|wallet|tx_hash|"body")','mint DTO hides arbitrary safe-code content');
 perform public.reject_telegram_alert_batch((payload->>'batch_id')::uuid,'-1001234567890');
end $$;

create function pg_temp.enqueue(p_n integer default 1) returns void language sql as $$
 insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity)
 select case when i=1 then 'content_report_created' else 'business_received' end,gen_random_uuid(),s.activation_id,s.chat_id,
 clock_timestamp(),case when i=1 then '콘텐츠 · 신고 테스트' else null end,null
 from public.telegram_alert_settings s cross join generate_series(1,p_n) i;
$$;
do $$
declare batch uuid; payload jsonb; audit jsonb; settings jsonb; role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  perform pg_temp.expect(not has_function_privilege(role_name,'public.reject_telegram_alert_batch(uuid,text)','execute'),'reject denied '||role_name);
 end loop;
 perform pg_temp.expect(has_function_privilege('service_role','public.reject_telegram_alert_batch(uuid,text)','execute'),'service reject allowed');
 delete from public.telegram_alert_outbox;
 update public.telegram_alert_settings set next_send_at='-infinity';
 perform pg_temp.enqueue(5);
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890'); batch:=(payload->>'batch_id')::uuid;
 perform pg_temp.expect(jsonb_array_length(payload->'alerts')=5,'mixed batch maximum five');
 select jsonb_agg(to_jsonb(o) order by id) into audit from public.telegram_alert_outbox o;
 select to_jsonb(s) into settings from public.telegram_alert_settings s;
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-999'),'reject wrong chat');
 perform pg_temp.expect(not public.reject_telegram_alert_batch(gen_random_uuid(),'-1001234567890'),'reject wrong batch');
 perform pg_temp.expect(audit=(select jsonb_agg(to_jsonb(o) order by id) from public.telegram_alert_outbox o)
  and settings=(select to_jsonb(s) from public.telegram_alert_settings s),'wrong claimant mutates nothing');
 update public.telegram_alert_settings set lease_expires_at=clock_timestamp()-interval '1 second';
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'expired settings lease');
 update public.telegram_alert_settings set lease_expires_at=clock_timestamp()+interval '1 minute';
 update public.telegram_alert_outbox set lease_expires_at=clock_timestamp()-interval '1 second';
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'expired row leases n=0');
 perform pg_temp.expect((select batch_id=batch from public.telegram_alert_settings),'n=0 keeps lease ownership');
 update public.telegram_alert_outbox set lease_expires_at=clock_timestamp()+interval '1 minute';
 update public.telegram_alert_outbox set activation_id=gen_random_uuid();
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'old activation rows n=0');
 update public.telegram_alert_outbox set activation_id=(select activation_id from public.telegram_alert_settings);
 select jsonb_agg(to_jsonb(o)-array['status','last_error','finished_at','lease_expires_at'] order by id) into audit from public.telegram_alert_outbox o;
 perform pg_temp.expect(public.reject_telegram_alert_batch(batch,'-1001234567890'),'valid batch quarantine');
 perform pg_temp.expect((select count(*)=5 and bool_and(status='failed' and last_error='INVALID_PAYLOAD' and attempt_count=0
  and finished_at is not null and lease_expires_at is null) from public.telegram_alert_outbox),'whole batch includes four valid companions without provider attempts');
 perform pg_temp.expect(audit=(select jsonb_agg(to_jsonb(o)-array['status','last_error','finished_at','lease_expires_at'] order by id)
  from public.telegram_alert_outbox o),'quarantine preserves full audit including source activation destination batch');
 perform pg_temp.expect((select batch_id is null and lease_expires_at is null from public.telegram_alert_settings),'quarantine clears lease');
 perform pg_temp.enqueue();
 update public.telegram_alert_settings set next_send_at='-infinity';
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890'); batch:=(payload->>'batch_id')::uuid;
 perform pg_temp.expect(jsonb_array_length(payload->'alerts')=1,'next valid batch progresses');
 perform pg_temp.expect(public.begin_telegram_alert_send(batch,'-1001234567890'),'next batch begins');
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'sending cannot be quarantined');
 perform pg_temp.expect(public.finish_telegram_alert_batch(batch,'sent',123),'next batch sent');
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'sent cannot be quarantined');
 update public.telegram_alert_settings set next_send_at='-infinity'; perform pg_temp.enqueue();
 payload:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890'); batch:=(payload->>'batch_id')::uuid;
 perform public.configure_telegram_alerts('-1001234567890',false);
 perform public.configure_telegram_alerts('-1001234567890',true);
 perform pg_temp.expect(not public.reject_telegram_alert_batch(batch,'-1001234567890'),'reactivation fences previous claimant');
end $$;
set local role service_role;
do $$ begin
 if public.reject_telegram_alert_batch(gen_random_uuid(),'-1001234567890') then raise exception 'service unknown batch accepted'; end if;
end $$;
reset role;

-- The KST day is [midnight, generation time); aggregate committed domain facts even with an empty outbox.
do $$
declare owner_id constant uuid:='af170000-0000-4000-8000-000000000001';
 artist constant uuid:='af170000-0000-4000-8000-000000000003';
 post uuid; comment uuid:=gen_random_uuid(); notice uuid:=gen_random_uuid(); cheer uuid;
 fulfillment uuid:=pg_temp.fulfillment(); ledger uuid:=gen_random_uuid(); stats jsonb; before_stats jsonb; expected jsonb;
 start_at constant timestamptz:='2040-01-01T15:00:00Z'; now_at constant timestamptz:='2040-01-02T03:00:00Z';
 stamp timestamptz;
begin
 foreach stamp in array array['2040-01-01T14:59:59Z'::timestamptz,start_at,now_at-interval '1 second',now_at,'2040-01-02T15:00:00Z'::timestamptz] loop
  insert into public.fan_posts(celebrity_id,app_user_id,body,idempotency_key,create_request_hash,created_at)
  values(artist,owner_id,'PRIVATE_POST_BODY',gen_random_uuid(),'local-fixture',stamp) returning id into post;
 end loop;
 insert into public.fan_post_comments(id,post_id,app_user_id,body,idempotency_key,created_at)
 values(comment,post,owner_id,'PRIVATE_COMMENT',gen_random_uuid(),start_at);
 insert into public.fan_post_comments(post_id,parent_id,app_user_id,body,idempotency_key,created_at)
 values(post,comment,owner_id,'PRIVATE_REPLY',gen_random_uuid(),now_at-interval '1 second');
 insert into public.celebrity_notices(id,celebrity_id,slug,publication_status)
 values(notice,artist,'telegram-pm-notice','draft');
 insert into public.celebrity_notice_comments(notice_id,app_user_id,body,idempotency_key,created_at)
 values(notice,owner_id,'PRIVATE_NOTICE_COMMENT',gen_random_uuid(),start_at);
 insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key,created_at)
 values(artist,owner_id,'PRIVATE_CHEER',gen_random_uuid(),start_at) returning id into cheer;
 insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key,reply_to_id,created_at)
 values(artist,owner_id,'PRIVATE_CHEER_REPLY',gen_random_uuid(),cheer,now_at-interval '1 second');
 insert into public.benefit_fulfillment_events(fulfillment_id,from_status,to_status,correlation_id,created_at)
 values(fulfillment,'information_required','ready',gen_random_uuid(),start_at),
  (fulfillment,'ready','ready',gen_random_uuid(),start_at),
  (fulfillment,null,'ready',gen_random_uuid(),start_at),
  (fulfillment,'information_required','ready',gen_random_uuid(),now_at);
 insert into public.fan_ticket_ledger(id,app_user_id,celebrity_id,entry_kind,amount,source_type,source_id,idempotency_key,policy_version,owner_sequence,resulting_balance)
 values(ledger,owner_id,artist,'credit',20,'telegram_pm_fixture',gen_random_uuid(),gen_random_uuid(),(select max(version) from public.reward_policy_versions),1,20);
 insert into public.benefit_ticket_entries(idempotency_key,campaign_id,benefit_id,app_user_id,ticket_amount,ticket_ledger_id,benefit_ticket_total,entered_at)
 select gen_random_uuid(),w.campaign_id,w.benefit_id,owner_id,7,ledger,7,start_at
 from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id where f.id=fulfillment;
 stats:=public.telegram_command_stats('today',now_at);
 perform pg_temp.expect(stats->>'date'='2040-01-02','today KST date');
 perform pg_temp.expect(stats#>>'{activity,fan_posts}'='2','KST midnight inclusive generation instant exclusive');
 perform pg_temp.expect(stats#>>'{activity,fan_comments}'='3','fan and notice comments including replies');
 perform pg_temp.expect(stats#>>'{activity,cheers}'='2','cheers include replies');
 perform pg_temp.expect(stats#>>'{activity,recipient_submissions}'='1','recipient submissions exact transition and time range');
 perform pg_temp.expect(stats#>>'{activity,raffle_entries}'='1' and stats#>>'{activity,raffle_tickets}'='7','entry count and ticket sum are separate units');
 expected:=jsonb_build_object(
  'checkins',(select count(*) from public.community_stamps where kind='daily_checkin' and issued_at>=start_at and issued_at<now_at),
  'reactions',(select count(*) from public.fan_reactions where completed_at>=start_at and completed_at<now_at),
  'fan_posts',2,'fan_comments',3,'cheers',2,'raffle_entries',1,'raffle_tickets',7,'recipient_submissions',1);
 perform pg_temp.expect(stats->'activity'=expected,'all eight activity fields use source facts');
 before_stats:=stats;
 delete from public.telegram_alert_outbox;
 perform pg_temp.expect(public.telegram_command_stats('today',now_at)=before_stats,'today independent of outbox retention and delivery');
 perform pg_temp.expect(stats::text !~ '(PRIVATE_|pm-fixture|app_user_id|email|"body")','today aggregate contains no identity or content');
end $$;

-- Published, active physical/pickup fulfillment only; NULL deadline is pending but never overdue.
do $$
declare baseline jsonb:=public.telegram_command_stats('ops','2040-01-02T03:00:00Z'); stats jsonb; oldest timestamptz;
begin
 perform pg_temp.fulfillment('information_required','physical_shipping','active',null);
 perform pg_temp.fulfillment('information_required','on_site_pickup','active','2040-01-02T03:00:00Z');
 perform pg_temp.fulfillment('information_required','physical_shipping','active','2040-01-03');
 perform pg_temp.fulfillment('ready','physical_shipping','active','2039-01-01');
 perform pg_temp.fulfillment('ready','digital','active','2039-01-01');
 perform pg_temp.fulfillment('information_required','physical_shipping','unclaimed','2039-01-01');
 perform pg_temp.fulfillment('information_required','physical_shipping','active','2039-01-01',false);
 perform pg_temp.report(); perform pg_temp.report('dismissed'); perform pg_temp.report('resolved');
 insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,status,last_error,finished_at)
 select 'business_received',gen_random_uuid(),activation_id,chat_id,clock_timestamp(),'failed',error,clock_timestamp()
 from public.telegram_alert_settings cross join unnest(array['INVALID_PAYLOAD','REJECTED','INVALID_PAYLOAD']) error;
 stats:=public.telegram_command_stats('ops','2040-01-02T03:00:00Z');
 perform pg_temp.expect((stats#>>'{fulfillment,information_required}')::integer=(baseline#>>'{fulfillment,information_required}')::integer+3,'ops excludes closed digital unpublished pending');
 perform pg_temp.expect((stats#>>'{fulfillment,overdue}')::integer=(baseline#>>'{fulfillment,overdue}')::integer+1,'deadline equal now overdue; NULL and future excluded');
 perform pg_temp.expect((stats#>>'{fulfillment,ready}')::integer=(baseline#>>'{fulfillment,ready}')::integer+1,'ops physical ready preparation');
 select min(f.created_at) into oldest from public.benefit_fulfillments f
 join public.benefit_draw_winners w on w.id=f.winner_id join public.benefit_draw_publications p on p.draw_id=w.draw_id
 where f.status='information_required' and f.claim_disposition='active' and f.method<>'digital';
 perform pg_temp.expect((stats#>>'{fulfillment,oldest_information_required_at}')::timestamptz=oldest,'oldest pending source timestamp');
 perform pg_temp.expect((stats->>'content_reports_pending')::integer=(baseline->>'content_reports_pending')::integer+1,'only open reports pending');
 perform pg_temp.expect((stats->>'telegram_failed')::integer=(baseline->>'telegram_failed')::integer+3
  and (stats->>'telegram_invalid')::integer=(baseline->>'telegram_invalid')::integer+2
  and (stats->>'telegram_invalid')::integer<=(stats->>'telegram_failed')::integer,'invalid count is a subset of all failed');
 perform pg_temp.expect(stats::text !~ '(PRIVATE_|pm-fixture|app_user_id|email|"body")','ops aggregate contains no recipient identity');
end $$;
select 'PASS Telegram PM report capture, fulfillment transitions, mint redaction, quarantine fencing and source aggregates';
rollback;
