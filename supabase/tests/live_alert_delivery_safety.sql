-- Requires the upgrade fixture from verify-backend-security.sh. No provider calls.
do $$ begin if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local only'; end if; end $$;
begin;
do $$ declare o uuid; n uuid; k text; lang text; expected text;
begin
for lang,k,expected in select * from(values('en','live_10m','email'),('ko','live_10m','kakao'),('ko','survey_reminder','email'),('ko','collectible_claim_available','email'),('ko','collectible_claim_expiring','email'))v loop
 o:=alert_safety_test.owner(lang,true);n:=alert_safety_test.notification(o,k::public.notification_kind);
 perform alert_safety_test.assert((select channel=expected from public.external_notification_delivery_outbox where notification_id=n),lang||' '||k||' routes to '||expected);
end loop;
end $$;
rollback;
select 'LIVE alert routing PASS' as result;

begin;
create function alert_safety_test.claim(o uuid default null) returns jsonb language plpgsql as $$
declare n uuid; j jsonb; begin
 n:=alert_safety_test.notification(coalesce(o,alert_safety_test.owner('en')));
 select to_jsonb(q) into j from public.claim_email_notification_deliveries_safely('email-safety',100,120) q where notification_id=n;
 perform alert_safety_test.assert(j is not null,'fixture claims an eligible Email');return j;
end $$;
create function alert_safety_test.begin(j jsonb) returns boolean language sql as $$
 select public.begin_email_notification_send((j->>'id')::uuid,j->>'lease_owner',(j->>'attempt_count')::integer,encode(extensions.digest(j->>'destination','sha256'),'hex'))
$$;
create function alert_safety_test.finish(j jsonb,outcome text,message_id text default null) returns boolean language sql as $$
 select public.finish_email_notification_send((j->>'id')::uuid,j->>'lease_owner',(j->>'attempt_count')::integer,outcome,message_id,case when outcome='unknown' then 'EMAIL_SEND_OUTCOME_UNKNOWN' end)
$$;

do $$ declare o uuid; n uuid; j jsonb; snap jsonb; c uuid; old_plan uuid; f regprocedure; begin
 -- Excluded Email kinds are not accidentally enabled by routing fallback.
 o:=alert_safety_test.owner('en',true);
 foreach n in array array[alert_safety_test.notification(o,'live_24h'),alert_safety_test.notification(o,'live_cancelled')] loop
  perform alert_safety_test.assert(not exists(select 1 from public.external_notification_delivery_outbox where notification_id=n),'excluded kind has no eligible external channel');
 end loop;
 -- Replanning is a no-op, even when eligibility has changed.
 o:=alert_safety_test.owner('ko',true);n:=alert_safety_test.notification(o);
 select to_jsonb(d),d.plan_id into snap,old_plan from public.external_notification_delivery_outbox d where notification_id=n;
 update public.fan_notification_channels set status='disabled',consent_revoked_at=now() where app_user_id=o and kind='kakao';
 perform alert_safety_test.assert(public.create_external_notification_plan(n)=old_plan,'existing plan identity retained');
 perform alert_safety_test.assert((select to_jsonb(d)=snap from public.external_notification_delivery_outbox d where notification_id=n),'existing pending not rerouted');

 j:=alert_safety_test.claim();
 perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,null,1,repeat('a',64)),'null owner rejected');
 perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,j->>'lease_owner',0,encode(extensions.digest(j->>'destination','sha256'),'hex')),'stale lease generation rejected');
 perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,j->>'lease_owner',(j->>'attempt_count')::int,repeat('a',64)),'changed destination rejected');
 perform alert_safety_test.assert(alert_safety_test.begin(j),'first begin succeeds');
 perform alert_safety_test.assert(not alert_safety_test.begin(j),'repeated begin denied');
 perform alert_safety_test.assert(not public.revalidate_email_notification_delivery((j->>'id')::uuid,j->>'lease_owner'),'old revalidation cannot touch begun row');
 update public.external_notification_delivery_outbox set lease_expires_at=now()-interval '1 second' where id=(j->>'id')::uuid;
 select to_jsonb(d) into snap from public.external_notification_delivery_outbox d where id=(j->>'id')::uuid;
 select channel_id into c from public.external_notification_delivery_outbox where id=(j->>'id')::uuid;
 update public.fan_notification_channels set status='disabled',consent_revoked_at=now() where id=c;
 perform * from public.claim_email_notification_deliveries_safely('restart',100,120);
 perform alert_safety_test.assert((select to_jsonb(d)=snap from public.external_notification_delivery_outbox d where id=(j->>'id')::uuid),'expired begun job excluded from both suppression and claim');
 perform alert_safety_test.assert(alert_safety_test.finish(j,'unknown'),'uncertain result recorded after lease expiry');
 perform alert_safety_test.assert(not public.finish_email_notification_send((j->>'id')::uuid,'other-worker',(j->>'attempt_count')::int,'accepted','other-id',null),'wrong attempt owner rejected');
 perform alert_safety_test.assert(alert_safety_test.finish(j,'accepted','ses-accepted'),'late acknowledgement resolves unknown without another send');
 perform alert_safety_test.assert(alert_safety_test.finish(j,'unknown'),'late unknown is harmless');
 perform alert_safety_test.assert(not alert_safety_test.finish(j,'accepted','different-message'),'conflicting accepted receipt rejected');
 perform alert_safety_test.assert((select status='sent' from public.external_notification_delivery_outbox where id=(j->>'id')::uuid),'accepted remains sent');
 begin
  perform public.fail_external_notification_delivery((j->>'id')::uuid,j->>'lease_owner','RETRY',true);
  raise exception 'legacy fail bypass accepted';
 exception when others then if sqlerrm<>'EMAIL_GUARDED_RESULT_REQUIRED' then raise; end if; end;
 begin
  perform public.complete_external_notification_delivery((j->>'id')::uuid,j->>'lease_owner','legacy');
  raise exception 'legacy complete bypass accepted';
 exception when others then if sqlerrm<>'EMAIL_GUARDED_RESULT_REQUIRED' then raise; end if; end;

 o:=alert_safety_test.owner('en');j:=alert_safety_test.claim(o);
 update public.fan_notification_channels set status='disabled',consent_revoked_at=now() where app_user_id=o;
 perform alert_safety_test.assert(not alert_safety_test.begin(j),'consent withdrawal prevents begin');
 j:=alert_safety_test.claim();update public.external_notification_delivery_outbox set lease_expires_at=now()-interval '1 second' where id=(j->>'id')::uuid;
 perform alert_safety_test.assert(not alert_safety_test.begin(j),'expired lease prevents begin');

 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in(
  'claim_email_notification_deliveries','claim_external_notification_deliveries','revalidate_email_before_send_guard',
  'complete_external_before_email_guard','fail_external_before_email_guard','admin_retry_before_email_guard',
  'complete_external_notification_delivery_before_alimtalk','fail_external_notification_delivery_before_alimtalk',
  'get_admin_deliveries_before_email_guard','kakao_channel_supports_notification') loop
  perform alert_safety_test.assert(not has_function_privilege('service_role',f,'execute'),'legacy/helper service access denied: '||f);
  perform alert_safety_test.assert(not has_function_privilege('anon',f,'execute'),'anonymous access denied: '||f);
 end loop;
 perform alert_safety_test.assert(not has_table_privilege('service_role','public.email_notification_send_attempts','insert,update,delete,select'),'attempt ledger cannot be edited by API role');
end $$;
-- Verify actual legacy calls are denied, not just metadata.
set local role service_role;
do $$ begin
 begin perform * from public.claim_email_notification_deliveries('old-worker',2,120);raise exception 'legacy email claim allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.claim_external_notification_deliveries('old-worker',2,120);raise exception 'legacy external claim allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;

insert into public.app_users(id,privy_user_id,verified_email) values('92000000-0000-4000-8000-000000000020','did:privy:alert-admin','alert-admin@example.invalid');
insert into public.admin_allowlist(id,email,role,active) values('92000000-0000-4000-8000-000000000021','alert-admin@example.invalid','admin',true);
do $$ declare j jsonb; result jsonb; item jsonb; begin
 j:=alert_safety_test.claim();perform alert_safety_test.begin(j);perform alert_safety_test.finish(j,'unknown');
 begin
  perform public.admin_retry_notification_delivery((j->>'id')::uuid,'92000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000021',extensions.gen_random_uuid(),extensions.gen_random_uuid());
  raise exception 'manual resend allowed';
 exception when others then if sqlerrm<>'EMAIL_ALREADY_BEGUN_RETRY_FORBIDDEN' then raise;end if;end;
 result:=public.get_admin_notification_deliveries('92000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000021',null,100);
 select value into item from jsonb_array_elements(result->'items') where value->>'id'=j->>'id';
 perform alert_safety_test.assert(item->>'providerStatus'='unknown' and item->>'manuallyRetryable'='false','admin reports unknown and forbids retry');
end $$;
-- These local helpers/jobs are retained only for the following concurrency test.
create table alert_safety_test.race_job as select alert_safety_test.claim() as job;
commit;
select 'Email single-begin, result ownership, unknown, backlog preservation and ACL PASS' as result;
