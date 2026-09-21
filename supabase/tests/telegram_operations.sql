begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end $$;
select public.configure_telegram_alerts('-1001234567890',true);
update public.telegram_alert_settings set activated_at='2000-01-01';
delete from public.telegram_alert_outbox;
-- Trigger contract tests isolate canonical event rows from unrelated domain setup.
-- Real source table bindings and column types are also checked below.
do $$
declare t text;
begin
 foreach t in array array['benefit_ticket_entries','benefit_claims','fan_reactions','live_survey_responses',
 'live_journey_completions','live_collectible_claims','community_stamp_invite_redemptions','certification_submissions',
 'benefit_fulfillment_events','benefit_fulfillments','business_inquiries','blockchain_job_attempt_history',
 'notification_delivery_outbox','notification_delivery_plans','live_events','live_status_overrides','live_schedule_revisions','outbound_link_visits'] loop
   perform pg_temp.expect(exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgfoid='public.capture_telegram_activity()'::regprocedure),'trigger installed '||t);
 end loop;
end $$;
-- Structurally typed copies let state transitions use the real source columns.
create temp table benefit_ticket_entries as select * from public.benefit_ticket_entries with no data;
create trigger capture after insert on benefit_ticket_entries for each row execute function public.capture_telegram_activity();
insert into benefit_ticket_entries(id,entered_at,ticket_amount,benefit_id) values(gen_random_uuid(),clock_timestamp(),3,(select id from public.benefits limit 1));
select pg_temp.expect((select count(*)=1 and min(activity_quantity)=3 from public.telegram_alert_outbox where kind='raffle_entered'),'raffle captured');
insert into benefit_ticket_entries select * from benefit_ticket_entries;
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='raffle_entered'),'replayed fact deduped');
create temp table certification_submissions as select * from public.certification_submissions with no data;
create trigger capture after update on certification_submissions for each row execute function public.capture_telegram_activity();
insert into certification_submissions(id,status,reviewed_at,celebrity_id) values(gen_random_uuid(),'pending',clock_timestamp(),(select id from public.celebrities limit 1));
update certification_submissions set status='approved';
update certification_submissions set status='approved';
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='certification_approved'),'review transition once');
create temp table notification_delivery_outbox as select * from public.notification_delivery_outbox with no data;
create trigger capture after insert or update on notification_delivery_outbox for each row execute function public.capture_telegram_activity();
insert into notification_delivery_outbox(id,status,available_at,last_error_code) values(gen_random_uuid(),'failed','infinity','LIVE_CANCELLED');
update notification_delivery_outbox set last_error_code='PROVIDER_ERROR',available_at=clock_timestamp();
select pg_temp.expect((select count(*)=0 from public.telegram_alert_outbox where kind='delivery_failed'),'normal cancellation and retry not incidents');
update notification_delivery_outbox set available_at='infinity';
update notification_delivery_outbox set available_at='infinity';
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='delivery_failed'),'same failed status becomes terminal once');
update notification_delivery_outbox set status='pending',available_at=clock_timestamp();
update notification_delivery_outbox set status='failed',available_at='infinity';
select pg_temp.expect((select count(*)=2 from public.telegram_alert_outbox where kind='delivery_failed'),'manual retry refailure');
select pg_temp.expect(not public.telegram_delivery_needs_attention('failed','infinity',code),'normal suppression '||code)
from unnest(array['SCHEDULE_SUPERSEDED','LIVE_CANCELLED','EMAIL_KIND_SUPPRESSED','EMAIL_NOT_ELIGIBLE','CURRENT_STATE_INELIGIBLE','SUBSCRIPTION_OWNER_CHANGED','KAKAO_NOT_ELIGIBLE','KAKAO_STATE_CHANGED','PUSH_SUBSCRIPTION_GONE']) code;
select pg_temp.expect(public.telegram_delivery_needs_attention('failed','infinity','EMAIL_SEND_OUTCOME_UNKNOWN'),'uncertain send needs attention');
-- Exercise the remaining typed event branches, including direct published INSERT.
create temp table benefit_claims as select * from public.benefit_claims with no data;
create trigger capture after insert or update on benefit_claims for each row execute function public.capture_telegram_activity();
insert into benefit_claims(id,claimed_at,benefit_id) values(gen_random_uuid(),clock_timestamp(),(select id from public.benefits limit 1));
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='benefit_claimed'),'benefit_claims capture');
create temp table fan_reactions as select * from public.fan_reactions with no data;
create trigger capture after insert or update on fan_reactions for each row execute function public.capture_telegram_activity();
insert into fan_reactions(id,completed_at,celebrity_id) values(gen_random_uuid(),clock_timestamp(),(select id from public.celebrities limit 1));
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='reaction_completed'),'fan_reactions capture');
create temp table live_survey_responses as select * from public.live_survey_responses with no data;
create trigger capture after insert or update on live_survey_responses for each row execute function public.capture_telegram_activity();
insert into live_survey_responses(id,status,submitted_at,live_event_id) values(gen_random_uuid(),'submitted',clock_timestamp(),(select id from public.live_events where publication_status='published' limit 1));
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='mission_submitted'),'live_survey_responses capture');
create temp table live_journey_completions as select * from public.live_journey_completions with no data;
create trigger capture after insert or update on live_journey_completions for each row execute function public.capture_telegram_activity();
insert into live_journey_completions(id,completed_at,live_event_id) values(gen_random_uuid(),clock_timestamp(),(select id from public.live_events where publication_status='published' limit 1));
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='journey_completed'),'live_journey_completions capture');
create temp table live_collectible_claims as select * from public.live_collectible_claims with no data;
create trigger capture after insert or update on live_collectible_claims for each row execute function public.capture_telegram_activity();
insert into live_collectible_claims(id,claimed_at,live_event_id) values(gen_random_uuid(),clock_timestamp(),(select id from public.live_events where publication_status='published' limit 1));
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='collectible_claimed'),'live_collectible_claims capture');
create temp table community_stamp_invite_redemptions as select * from public.community_stamp_invite_redemptions with no data;
create trigger capture after insert or update on community_stamp_invite_redemptions for each row execute function public.capture_telegram_activity();
insert into community_stamp_invite_redemptions(id,redeemed_at) values(gen_random_uuid(),clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='invite_redeemed'),'community_stamp_invite_redemptions capture');
create temp table benefit_fulfillment_events as select * from public.benefit_fulfillment_events with no data;
create trigger capture after insert or update on benefit_fulfillment_events for each row execute function public.capture_telegram_activity();
insert into benefit_fulfillment_events(id,to_status,from_status,created_at) values(gen_random_uuid(),'shipping_completed','shipping_in_transit',clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='fulfillment_updated'),'benefit_fulfillment_events capture');
create temp table business_inquiries as select * from public.business_inquiries with no data;
create trigger capture after insert or update on business_inquiries for each row execute function public.capture_telegram_activity();
insert into business_inquiries(id,status,created_at) values(gen_random_uuid(),'pending',clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='business_received'),'business_inquiries capture');
create temp table blockchain_job_attempt_history as select * from public.blockchain_job_attempt_history with no data;
create trigger capture after insert or update on blockchain_job_attempt_history for each row execute function public.capture_telegram_activity();
insert into blockchain_job_attempt_history(id,event,created_at) values(987654321,'completed',clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='mint_completed'),'blockchain_job_attempt_history capture');
create temp table live_events as select * from public.live_events with no data;
create trigger capture after insert or update on live_events for each row execute function public.capture_telegram_activity();
insert into live_events(id,publication_status) values((select id from public.live_events where publication_status='published' limit 1),'published');
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='live_published'),'live_events capture');
create temp table live_status_overrides as select * from public.live_status_overrides with no data;
create trigger capture after insert or update on live_status_overrides for each row execute function public.capture_telegram_activity();
insert into live_status_overrides(id,live_event_id,effective_status,created_at) values(gen_random_uuid(),(select id from public.live_events where publication_status='published' limit 1),'cancelled',clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='live_cancelled'),'live_status_overrides capture');
create temp table live_schedule_revisions as select * from public.live_schedule_revisions with no data;
create trigger capture after insert or update on live_schedule_revisions for each row execute function public.capture_telegram_activity();
insert into live_schedule_revisions(id,live_event_id,before_starts_at,after_starts_at,created_at) values(gen_random_uuid(),(select id from public.live_events where publication_status='published' limit 1),clock_timestamp()-interval '1 day',clock_timestamp(),clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='live_rescheduled'),'live_schedule_revisions capture');
insert into live_schedule_revisions(id,live_event_id,before_starts_at,after_starts_at,before_reservation_opens_at,after_reservation_opens_at,created_at)
select gen_random_uuid(),id,starts_at,starts_at,starts_at-interval '1 day',starts_at-interval '2 days',clock_timestamp() from public.live_events where publication_status='published' limit 1;
select pg_temp.expect((select count(*)=2 from public.telegram_alert_outbox where kind='live_rescheduled'),'reservation-only reschedule');
update business_inquiries set status='delivery_unknown';
select pg_temp.expect((select count(*)=1 and min(activity_context) like '전송 결과 불명%' from public.telegram_alert_outbox where kind='business_failed'),'business uncertain');
insert into blockchain_job_attempt_history(id,event,created_at) values(987654322,'failed',clock_timestamp());
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='mint_failed'),'mint terminal failed');
create temp table benefit_fulfillments as select * from public.benefit_fulfillments with no data;
create trigger capture after update on benefit_fulfillments for each row execute function public.capture_telegram_activity();
insert into benefit_fulfillments(id,claim_disposition) values(gen_random_uuid(),'active');
update benefit_fulfillments set claim_disposition='unclaimed';
update benefit_fulfillments set claim_disposition='unclaimed';
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='fulfillment_unclaimed'),'unclaimed transition once');
update certification_submissions set status='pending';
update certification_submissions set status='rejected';
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='certification_rejected'),'rejection');

-- Actual external plan rows: primary failure with fallback is not terminal.
do $$ declare actor uuid:=gen_random_uuid(); notification uuid:=gen_random_uuid(); channel_id uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); primary_id uuid:=gen_random_uuid(); fallback_id uuid:=gen_random_uuid(); before_count integer; begin
 insert into public.app_users(id,privy_user_id,verified_email,status) values(actor,'did:privy:telegram-external','external@example.test','active');
 insert into public.fan_notifications(id,app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link)
 values(notification,actor,'live_10m','telegram:external', (select id from public.live_events limit 1),clock_timestamp(),'/my');
 insert into public.fan_notification_channels(id,app_user_id,kind,status,destination_fingerprint,destination_label)
 values(channel_id,actor,'email','disabled',repeat('f',64),'test');
 insert into public.notification_delivery_plans(id,notification_id,primary_channel_id) values(plan,notification,channel_id);
 insert into public.external_notification_delivery_outbox(id,plan_id,notification_id,channel_id,channel,sequence,template_key,status,available_at,last_error_code)
 values(primary_id,plan,notification,channel_id,'email',1,'live_10m','failed','infinity','PROVIDER_ERROR');
 select count(*) into before_count from public.telegram_alert_outbox where kind='delivery_failed';
 insert into public.external_notification_delivery_outbox(id,plan_id,notification_id,channel_id,channel,sequence,template_key)
 values(fallback_id,plan,notification,channel_id,'email',2,'live_10m');
 update public.notification_delivery_plans set current_sequence=2 where id=plan;
 perform pg_temp.expect((select count(*)=before_count from public.telegram_alert_outbox where kind='delivery_failed'),'fallback pending no incident');
 update public.external_notification_delivery_outbox set status='failed',available_at='infinity',last_error_code='EMAIL_SEND_OUTCOME_UNKNOWN' where id=fallback_id;
 update public.notification_delivery_plans set status='failed' where id=plan;
 update public.notification_delivery_plans set status='failed' where id=plan;
 perform pg_temp.expect((select count(*)=before_count+1 from public.telegram_alert_outbox where kind='delivery_failed'),'external terminal once');
 perform pg_temp.expect(exists(select 1 from public.telegram_alert_outbox where kind='delivery_failed' and activity_context like '이메일 전송 결과 불명%'),'uncertain email correctly labeled');
 perform pg_temp.expect((public.telegram_command_stats('ops',clock_timestamp())->>'failed_deliveries')::int>=1,'ops same predicate');
end $$;

-- Actual API fact, retry dedupe, rollback and fail-open.
select public.record_banksy_outbound(null,'exhibition','raffle_list','fa100000-0000-4000-8000-000000000001');
select public.record_banksy_outbound(null,'exhibition','raffle_list','fa100000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='campaign_outbound'),'actual outbound request deduped');
do $$ begin
 begin
  perform public.record_banksy_outbound(null,'goods','raffle_list',gen_random_uuid());
  raise exception 'rollback';
 exception when raise_exception then null; end;
 perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='campaign_outbound'),'rollback atomic');
end $$;
create function pg_temp.fail_capture() returns trigger language plpgsql as $$ begin raise exception 'queue failure'; end $$;
create trigger fail_capture before insert on public.telegram_alert_outbox for each row execute function pg_temp.fail_capture();
select public.record_banksy_outbound(null,'goods','raffle_list','fa100000-0000-4000-8000-000000000002');
select pg_temp.expect(exists(select 1 from public.outbound_link_visits where request_id='fa100000-0000-4000-8000-000000000002'),'fail open');
drop trigger fail_capture on public.telegram_alert_outbox;
-- Seven independent activities drain FIFO in 5+2, including a failure, no starvation.
delete from public.telegram_alert_outbox;
insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,created_at,activity_context)
select case when i=7 then 'mint_failed' else 'raffle_entered' end,gen_random_uuid(),activation_id,chat_id,clock_timestamp(),clock_timestamp()+i*interval '1 microsecond','test'
from public.telegram_alert_settings cross join generate_series(1,7) i;
do $$ declare b jsonb; begin
 b:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 perform pg_temp.expect(jsonb_array_length(b->'alerts')=5,'first 5');
 perform pg_temp.expect(b->'alerts'->0->>'actor_email' is null and b->'alerts'->0 ? 'activity_context','anonymous projection');
 perform pg_temp.expect(not exists(select 1 from jsonb_array_elements(b->'alerts') a where a->>'kind'='mint_failed'),'FIFO no priority jump');
 perform public.begin_telegram_alert_send((b->>'batch_id')::uuid,'-1001234567890');
 perform public.finish_telegram_alert_batch((b->>'batch_id')::uuid,'sent',123);
 update public.telegram_alert_settings set next_send_at='-infinity';
 b:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
 perform pg_temp.expect(jsonb_array_length(b->'alerts')=2 and b->'alerts'->1->>'kind'='mint_failed','remaining 2 include failure');
end $$;
-- Aggregate cohort boundaries: current [start,end), equal-duration previous.
insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
('fa200000-0000-4000-8000-000000000001','did:privy:marketing-prev','prev@example.test','active','2040-01-01T14:59:59Z'),
('fa200000-0000-4000-8000-000000000002','did:privy:marketing-now','now@example.test','active','2040-01-01T15:00:00Z'),
('fa200000-0000-4000-8000-000000000003','did:privy:marketing-future','future@example.test','active','2040-01-08T03:00:00Z');
insert into public.user_profiles(app_user_id,nickname,nickname_normalized,created_at) values
('fa200000-0000-4000-8000-000000000002','텔레그램검증','텔레그램검증','2040-01-08T03:00:00Z');
insert into public.campaign_visits(id,session_hash,first_link_id,last_sequence,created_at) values
('fa300000-0000-4000-8000-000000000001',repeat('a',64),'fa4be7ed-782e-48f2-8537-628e5cd4e920',0,'2040-01-01T15:00:00Z'),
('fa300000-0000-4000-8000-000000000002',repeat('b',64),null,0,'2040-01-01T15:00:00Z');
insert into public.outbound_link_visits(campaign,visit_id,destination,surface,request_id,created_at) values
('banksy','fa300000-0000-4000-8000-000000000001','exhibition','raffle_list',gen_random_uuid(),'2040-01-02T00:00:00Z'),
('banksy','fa300000-0000-4000-8000-000000000001','exhibition','raffle_list',gen_random_uuid(),'2040-01-02T01:00:00Z');
do $$ declare s jsonb; r text; begin
 s:=public.telegram_command_stats('marketing','2040-01-08T03:00:00Z');
 perform pg_temp.expect((s->>'from')::timestamptz='2040-01-01T15:00:00Z','KST window');
 perform pg_temp.expect((s->>'from')::timestamptz-(s->>'previous_from')::timestamptz=(s->>'generated_at')::timestamptz-(s->>'from')::timestamptz,'equal durations');
 perform pg_temp.expect(s->'current'->>'accounts'='1' and s->'previous'->>'accounts'='1','half-open account cohorts');
 perform pg_temp.expect(s->'current'->>'profile_accounts'='0','future profile excluded');
 perform pg_temp.expect(s->'current'->>'tracked_visits'='1' and s->'current'->>'direct_visits'='1' and s->'current'->>'outbound_sessions'='1','separate anonymous cohort, repeated redirects deduped');
 s:=public.telegram_command_stats('ops',clock_timestamp());
 perform pg_temp.expect(s ? 'failed_mints' and s ? 'telegram_unknown','ops projection');
 foreach r in array array['anon','authenticated','service_role'] loop
  perform pg_temp.expect(not has_function_privilege(r,'public.telegram_marketing_window(timestamptz,timestamptz)','execute'),'private projection '||r);
  perform pg_temp.expect(not has_function_privilege(r,'public.capture_telegram_activity()','execute'),'private capture '||r);
 end loop;
end $$;
rollback;
