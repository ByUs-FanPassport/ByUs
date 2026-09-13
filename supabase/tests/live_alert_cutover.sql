-- Disposable database only. All sender/receipt values are synthetic; no HTTP.
do $$ begin if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local only'; end if; end $$;
begin;
select public.configure_fan_notification_delivery('email','disabled');
select public.configure_fan_notification_delivery('kakao','disabled');
create temporary table cutover_history as select id,md5(to_jsonb(d)::text) hash from public.external_notification_delivery_outbox d;
select alert_safety_test.assert((select count(*)=0 from public.claim_email_notification_deliveries_safely('cutover-disabled',2,120)),'disabled cutover must not claim historical pending');
select alert_safety_test.assert((select count(*)=0 from public.claim_kakao_notification_deliveries('cutover-disabled',2,120)),'disabled Kakao must not claim');
-- clock_timestamp models notifications created by a later request transaction.
create function alert_safety_test.fresh_notification(o uuid) returns uuid language plpgsql as $$ declare n uuid; live_id uuid:=extensions.gen_random_uuid(); begin
 insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at)
 select live_id,'cutover-'||live_id,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at
 from public.live_events where id='92000000-0000-4000-8000-000000000003';
 insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
 select live_id,locale,title,summary,hero_alt from public.live_event_localizations where live_event_id='92000000-0000-4000-8000-000000000003';
 insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,created_at)
 values(o,'live_10m','cutover:'||extensions.gen_random_uuid(),live_id,now(),'/live/alert-safety-live',clock_timestamp()) returning id into n;
 return n;
end $$;
do $$ declare ch text; o uuid; outsider uuid; old_n uuid; new_n uuid; equal_n uuid; other_n uuid; j jsonb; snap text; cutoff timestamptz; next_cutoff timestamptz; first_cutoff timestamptz;
begin
 foreach ch in array array['email','kakao'] loop
  o:=alert_safety_test.owner(case when ch='email' then 'en' else 'ko' end,ch='kakao');
  outsider:=alert_safety_test.owner(case when ch='email' then 'en' else 'ko' end,ch='kakao');
  old_n:=alert_safety_test.fresh_notification(o);
  cutoff:=public.configure_fan_notification_delivery(ch,'test',array[o]);
  perform alert_safety_test.assert(cutoff>=transaction_timestamp(),'cutoff from current DB clock');
  perform alert_safety_test.assert(not public.fan_notification_is_released(old_n,ch),'old notification excluded');
  equal_n:=alert_safety_test.fresh_notification(o);update public.fan_notifications set created_at=cutoff where id=equal_n;
  perform alert_safety_test.assert(not public.fan_notification_is_released(equal_n,ch),'exact cutoff excluded');
  other_n:=alert_safety_test.fresh_notification(outsider);
  perform alert_safety_test.assert(not public.fan_notification_is_released(other_n,ch),'test excludes other users');
  new_n:=alert_safety_test.fresh_notification(o);
  perform alert_safety_test.assert(public.fan_notification_is_released(new_n,ch),'test allows fresh approved user');
  if ch='email' then
   select to_jsonb(q) into j from public.claim_email_notification_deliveries_safely('cutover-test',100,120) q where notification_id=new_n;
  else
   select to_jsonb(q) into j from public.claim_kakao_notification_deliveries('cutover-test',2,120) q where notification_id=new_n;
  end if;
  perform alert_safety_test.assert(j is not null,ch||' newly released row claimed');
  perform alert_safety_test.assert((select bool_and(status='pending' and attempt_count=0) from public.external_notification_delivery_outbox where notification_id in(old_n,equal_n,other_n)),'excluded rows remain pending');
  select md5(to_jsonb(d)::text) into snap from public.external_notification_delivery_outbox d where d.id=(j->>'id')::uuid;
  perform public.configure_fan_notification_delivery(ch,'disabled');
  if ch='email' then
   perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,'cutover-test',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'paused Email begin denied');
   perform alert_safety_test.assert(not public.revalidate_email_notification_delivery((j->>'id')::uuid,'cutover-test'),'paused revalidate denied');
   perform alert_safety_test.assert(not public.fail_external_notification_delivery((j->>'id')::uuid,'cutover-test','RETRY',true),'paused fail denied');
   perform alert_safety_test.assert(not public.complete_external_notification_delivery((j->>'id')::uuid,'cutover-test','synthetic'),'paused legacy complete denied');
  else
   perform alert_safety_test.assert(not public.begin_kakao_notification_send((j->>'id')::uuid,(j->>'attempt_token')::uuid,j->>'template_id',repeat('a',64)),'paused Kakao begin denied');
   perform alert_safety_test.assert(not public.record_kakao_notification_submission((j->>'id')::uuid,(j->>'attempt_token')::uuid,'suppressed',null,null,'BAD_PAYLOAD'),'paused Kakao pre-begin suppression denied');
  end if;
  perform alert_safety_test.assert((select md5(to_jsonb(d)::text)=snap from public.external_notification_delivery_outbox d where d.id=(j->>'id')::uuid),'claimed row unchanged after disabled calls');
  old_n:=alert_safety_test.fresh_notification(o); -- Created during the pause.
  next_cutoff:=public.configure_fan_notification_delivery(ch,'enabled');
  perform alert_safety_test.assert(next_cutoff>cutoff,'reactivation advances cutoff');
  perform alert_safety_test.assert(not public.fan_notification_is_released(old_n,ch) and not public.fan_notification_is_released(new_n,ch),'paused and earlier-window rows excluded');
  if ch='email' then
   perform alert_safety_test.assert(not public.revalidate_email_notification_delivery((j->>'id')::uuid,'cutover-test'),'reactivated old revalidation denied');
   perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,'cutover-test',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'reactivated old Email begin denied');
  else
   perform alert_safety_test.assert(not public.begin_kakao_notification_send((j->>'id')::uuid,(j->>'attempt_token')::uuid,j->>'template_id',repeat('a',64)),'reactivated old Kakao begin denied');
  end if;
  new_n:=alert_safety_test.fresh_notification(o);
  if ch='email' then
   select to_jsonb(q) into j from public.claim_email_notification_deliveries_safely('cutover-new',100,120) q where notification_id=new_n;
   perform alert_safety_test.assert(j is not null,'fresh Email claimed after reactivation');
   perform alert_safety_test.assert(public.begin_email_notification_send((j->>'id')::uuid,'cutover-new',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'fresh Email begin allowed');
   perform public.configure_fan_notification_delivery(ch,'disabled');
   perform alert_safety_test.assert(public.finish_email_notification_send((j->>'id')::uuid,'cutover-new',(j->>'attempt_count')::int,'accepted','synthetic-accepted',null),'prior Email ACK survives pause');
  else
   select to_jsonb(q) into j from public.claim_kakao_notification_deliveries('cutover-new',2,120) q where notification_id=new_n;
   perform alert_safety_test.assert(j is not null,'fresh Kakao claimed after reactivation');
   perform alert_safety_test.assert(public.begin_kakao_notification_send((j->>'id')::uuid,(j->>'attempt_token')::uuid,j->>'template_id',repeat('a',64)),'fresh Kakao begin allowed');
   perform public.configure_fan_notification_delivery(ch,'disabled');
   perform alert_safety_test.assert(public.record_kakao_notification_submission((j->>'id')::uuid,(j->>'attempt_token')::uuid,'accepted','synthetic-kakao','synthetic-group',null),'prior Kakao ACK survives pause');
  end if;
 end loop;
end $$;
select alert_safety_test.assert(not exists(select 1 from cutover_history b left join public.external_notification_delivery_outbox d on d.id=b.id where b.hash is distinct from md5(to_jsonb(d)::text)),'all historical row hashes unchanged across claim and activation cycles');

-- Suppression cannot mutate an old ineligible row; late plan creation cannot
-- turn an old notification into an eligible new delivery.
do $$ declare o uuid; n uuid; d uuid; j jsonb; snap text; begin
 o:=alert_safety_test.owner('en');n:=alert_safety_test.fresh_notification(o);
 select id into d from public.external_notification_delivery_outbox where notification_id=n;
 update public.fan_notification_channels set status='disabled',consent_revoked_at=now() where app_user_id=o;
 select md5(to_jsonb(x)::text) into snap from public.external_notification_delivery_outbox x where id=d;
 perform public.configure_fan_notification_delivery('email','enabled');
 perform * from public.claim_email_notification_deliveries_safely('old-ineligible',100,120);
 perform alert_safety_test.assert((select md5(to_jsonb(x)::text)=snap from public.external_notification_delivery_outbox x where id=d),'old ineligible suppression excluded');
 o:=alert_safety_test.owner('en');
 update public.fan_notification_channels set status='disabled' where app_user_id=o;
 n:=alert_safety_test.fresh_notification(o);
 perform alert_safety_test.assert(not exists(select 1 from public.notification_delivery_plans where notification_id=n),'late-plan fixture initially has no plan');
 perform public.configure_fan_notification_delivery('email','enabled');
 update public.fan_notification_channels set status='eligible' where app_user_id=o;
 perform public.create_external_notification_plan(n);
 perform alert_safety_test.assert(exists(select 1 from public.external_notification_delivery_outbox where notification_id=n),'late plan created');
 perform alert_safety_test.assert(not public.fan_notification_is_released(n,'email'),'new plan does not release an old notification');
 -- A directly supplied delivery ID still cannot bypass the release predicate.
 perform alert_safety_test.assert(not public.begin_email_notification_send(d,'old-ineligible',1,repeat('a',64)),'direct old begin denied');
end $$;

insert into public.app_users(id,privy_user_id,verified_email) values('93000000-0000-4000-8000-000000000020','did:privy:cutover-admin','cutover-admin@example.invalid');
insert into public.admin_allowlist(id,email,role,active) values('93000000-0000-4000-8000-000000000021','cutover-admin@example.invalid','admin',true);
do $$ declare n uuid; d uuid; result jsonb; begin
 n:=alert_safety_test.fresh_notification(alert_safety_test.owner('en'));
 select id into d from public.external_notification_delivery_outbox where notification_id=n;
 update public.external_notification_delivery_outbox set status='failed',available_at='infinity' where id=d;
 perform public.configure_fan_notification_delivery('email','enabled');
 begin
  perform public.admin_retry_notification_delivery(d,'93000000-0000-4000-8000-000000000020','93000000-0000-4000-8000-000000000021',extensions.gen_random_uuid(),extensions.gen_random_uuid());
  raise exception 'manual replay allowed';
 exception when others then if sqlerrm<>'FAN_DELIVERY_NOT_RELEASED' then raise; end if; end;
 result:=public.get_admin_notification_deliveries('93000000-0000-4000-8000-000000000020','93000000-0000-4000-8000-000000000021',null,100);
 perform alert_safety_test.assert(exists(select 1 from jsonb_array_elements(result->'items') i where i->>'id'=d::text and i->>'manuallyRetryable'='false'),'admin DTO hides historical retry');
end $$;
do $$ declare f regprocedure; role_name text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform alert_safety_test.assert(not has_table_privilege(role_name,'public.fan_notification_delivery_control','select,insert,update,delete'),'control table private');
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and (proname like '%before_release' or proname in('configure_fan_notification_delivery','lock_fan_notification_delivery_control','fan_notification_is_released')) loop
   perform alert_safety_test.assert(not has_function_privilege(role_name,f,'execute'),'release helper inaccessible: '||f);
  end loop;
 end loop;
end $$;
-- A LIVE-only rollout must not silently activate other service notifications.
do $$ declare ch text; n uuid; k text; j jsonb; before_hash text; begin
 foreach ch in array array['email','kakao'] loop
  perform public.configure_fan_notification_delivery(ch,'disabled');
  update public.fan_notification_delivery_control set allowed_kinds=array['live_reserved','live_24h','live_10m','live_changed','live_cancelled'] where channel=ch;
  perform public.configure_fan_notification_delivery(ch,'enabled');
  n:=alert_safety_test.fresh_notification(alert_safety_test.owner('en'));
  foreach k in array array['live_reserved','live_24h','live_10m','live_changed','live_cancelled'] loop
   update public.fan_notifications set kind=k::public.notification_kind where id=n;
   perform alert_safety_test.assert(public.fan_notification_is_released(n,ch),'new LIVE kind released: '||k);
  end loop;
  foreach k in array array['survey_reminder'] loop
   update public.fan_notifications set kind=k::public.notification_kind where id=n;
   perform alert_safety_test.assert(not public.fan_notification_is_released(n,ch),'non-LIVE kind blocked: '||k);
  end loop;
  if ch='email' then
   perform alert_safety_test.assert(not exists(select 1 from public.claim_email_notification_deliveries_safely('scope-check',2,120) where notification_id=n),'non-LIVE Email not claimed');
  else
   perform alert_safety_test.assert(not exists(select 1 from public.claim_kakao_notification_deliveries('scope-check',2,120) where notification_id=n),'non-LIVE Kakao not claimed');
  end if;
  n:=alert_safety_test.fresh_notification(alert_safety_test.owner(case when ch='kakao' then 'ko' else 'en' end,ch='kakao'));
  if ch='email' then
   select to_jsonb(q) into j from public.claim_email_notification_deliveries_safely('scope-begin',2,120) q where notification_id=n;
  else
   select to_jsonb(q) into j from public.claim_kakao_notification_deliveries('scope-begin',2,120) q where notification_id=n;
  end if;
  perform alert_safety_test.assert(j is not null,'LIVE scope candidate claimed');
  select md5(to_jsonb(d)::text) into before_hash from public.external_notification_delivery_outbox d where id=(j->>'id')::uuid;
  update public.fan_notification_delivery_control set allowed_kinds=array['live_reserved'] where channel=ch;
  if ch='email' then
   perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,'scope-begin',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'Email scope rechecked before send');
  else
   perform alert_safety_test.assert(not public.begin_kakao_notification_send((j->>'id')::uuid,(j->>'attempt_token')::uuid,j->>'template_id',repeat('a',64)),'Kakao scope rechecked before send');
  end if;
  perform alert_safety_test.assert((select md5(to_jsonb(d)::text)=before_hash from public.external_notification_delivery_outbox d where id=(j->>'id')::uuid),'scope-blocked send preserves delivery');
  update public.fan_notification_delivery_control set allowed_kinds=array['live_reserved','live_24h','live_10m','live_changed','live_cancelled'] where channel=ch;
  perform public.configure_fan_notification_delivery(ch,'disabled');
  perform public.configure_fan_notification_delivery(ch,'enabled');
  perform alert_safety_test.assert((select cardinality(allowed_kinds)=5 from public.fan_notification_delivery_control where channel=ch),'reactivation preserves kind scope');
 end loop;
 begin update public.fan_notification_delivery_control set allowed_kinds=array['level_up'];raise exception 'invalid kind accepted';exception when check_violation then null;end;
end $$;
set local role service_role;
do $$ begin
 begin perform public.configure_fan_notification_delivery('email','enabled');raise exception 'runtime activated';exception when insufficient_privilege then null;end;
 begin update public.fan_notification_delivery_control set mode='enabled';raise exception 'runtime mutated control';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'LIVE delivery disabled/cutover/test/restart/ACK/preservation/ACL PASS' as result;
