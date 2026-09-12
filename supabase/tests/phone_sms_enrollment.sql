-- Disposable clean-replay database only. Never run against a deployed database.
do $$ begin
  if current_database()<>'byus_clean' or inet_server_addr() is not null then
    raise exception 'Phone SMS tests require disposable local byus_clean';
  end if;
end $$;

create schema phone_sms_test;
create function phone_sms_test.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'PHONE_SMS_TEST: %',message; end if; end $$;

create function phone_sms_test.reserve(owner_id uuid,challenge_id uuid,request_id uuid,phone text,seed text)
returns jsonb language sql as $$
  select public.reserve_owned_phone_sms_challenge(owner_id,challenge_id,request_id,phone,
    encode(extensions.digest('phone:'||phone,'sha256'),'hex'),encode(extensions.digest('otp:'||seed,'sha256'),'hex'))
$$;

create function phone_sms_test.enroll(owner_id uuid,challenge_id uuid,request_id uuid,phone text,seed text)
returns uuid language plpgsql as $$
declare reserved jsonb; verified jsonb; channel jsonb;
begin
  reserved:=phone_sms_test.reserve(owner_id,challenge_id,request_id,phone,seed);
  perform phone_sms_test.assert((reserved->>'created')::boolean,'fresh challenge created');
  perform phone_sms_test.assert(reserved->>'destinationLabel'='010-****-'||right(phone,4),'only masked phone returned');
  perform phone_sms_test.assert(public.begin_phone_sms_send(owner_id,challenge_id),'first send begin allowed');
  perform phone_sms_test.assert(not public.begin_phone_sms_send(owner_id,challenge_id),'send begin is one-shot');
  perform phone_sms_test.assert(public.finish_phone_sms_send(owner_id,challenge_id,'unknown',null,null),'unknown outcome recorded');
  verified:=public.verify_owned_phone_sms_challenge(owner_id,challenge_id,encode(extensions.digest('otp:'||seed,'sha256'),'hex'));
  perform phone_sms_test.assert((verified->>'verified')::boolean,'unknown ACK-loss state remains verifiable');
  channel:=public.confirm_owned_phone_sms_enrollment(owner_id,challenge_id,'kakao-alimtalk-v1');
  return (channel->>'id')::uuid;
end $$;

insert into public.app_users(id,privy_user_id,verified_email) values
 ('92000000-0000-4000-8000-000000000001','did:privy:sms-owner','sms-owner@example.invalid'),
 ('92000000-0000-4000-8000-000000000002','did:privy:sms-stranger','sms-stranger@example.invalid'),
 ('92000000-0000-4000-8000-000000000003','did:privy:sms-disabled','sms-disabled@example.invalid'),
 ('92000000-0000-4000-8000-000000000004','did:privy:sms-oauth','sms-oauth@example.invalid'),
 ('92000000-0000-4000-8000-000000000005','did:privy:sms-cross-a','sms-cross-a@example.invalid'),
 ('92000000-0000-4000-8000-000000000006','did:privy:sms-cross-b','sms-cross-b@example.invalid');

-- Owner binding, idempotency, collision, wrong-code persistence and replay.
do $$
declare o uuid:='92000000-0000-4000-8000-000000000001'; s uuid:='92000000-0000-4000-8000-000000000002';
  c uuid:='92000000-0000-4000-8000-000000000101'; r uuid:='92000000-0000-4000-8000-000000000201';
  response jsonb; i integer;
begin
  response:=phone_sms_test.reserve(o,c,r,'01011112222','wrong-five');
  perform phone_sms_test.assert((response->>'created')::boolean,'initial reserve');
  response:=phone_sms_test.reserve(o,'92000000-0000-4000-8000-000000000102',r,'01011112222','different-digest-ignored');
  perform phone_sms_test.assert(not (response->>'created')::boolean and (response->>'challengeId')::uuid=c,'request replay returns original without send permission');
  begin
    perform phone_sms_test.reserve(o,'92000000-0000-4000-8000-000000000103',r,'01099998888','collision');
    raise exception 'PHONE_SMS_TEST: changed phone reused request id';
  exception when others then if sqlerrm='PHONE_SMS_TEST: changed phone reused request id' or sqlerrm<>'PHONE_SMS_REQUEST_ID_COLLISION' then raise; end if; end;
  perform phone_sms_test.assert(not public.begin_phone_sms_send(s,c),'cross-owner send denied');
  response:=public.verify_owned_phone_sms_challenge(s,c,repeat('a',64));
  perform phone_sms_test.assert(response->>'error'='PHONE_SMS_CHALLENGE_NOT_FOUND','cross-owner verify is opaque');
  perform phone_sms_test.assert(public.begin_phone_sms_send(o,c),'send begins');
  for i in 1..4 loop
    response:=public.verify_owned_phone_sms_challenge(o,c,repeat('a',64));
    perform phone_sms_test.assert(response->>'error'='PHONE_SMS_CODE_MISMATCH','wrong code typed before final attempt');
  end loop;
  response:=public.verify_owned_phone_sms_challenge(o,c,repeat('a',64));
  perform phone_sms_test.assert(response->>'error'='PHONE_SMS_ATTEMPTS_EXHAUSTED','fifth wrong code exhausts');
  perform phone_sms_test.assert((select failed_attempts=5 and phone is null and otp_digest is null and cancelled_at is not null
    from public.phone_sms_verification_challenges where id=c),'five failures persist and purge secrets');
end $$;

-- The later successful proof wins across the OAuth and SMS enrollment flows.
-- Each loser is invalidated while both still serialize on the owner row.
do $$
declare a uuid:='92000000-0000-4000-8000-000000000005'; b uuid:='92000000-0000-4000-8000-000000000006';
  oauth_a jsonb; oauth_b jsonb; sms_b uuid:='92000000-0000-4000-8000-000000000171'; response jsonb;
begin
  perform public.create_owned_kakao_alimtalk_state(a,repeat('2',64),repeat('a',64),'/settings');
  perform public.consume_owned_kakao_connection_state(a,repeat('2',64));
  perform public.complete_owned_kakao_connection(a,repeat('3',64));
  oauth_a:=public.stage_owned_kakao_phone_enrollment(a,repeat('2',64),repeat('3',64),'01061112222');
  perform phone_sms_test.enroll(a,'92000000-0000-4000-8000-000000000170',
    '92000000-0000-4000-8000-000000000270','01063334444','sms-wins');
  perform phone_sms_test.assert(public.get_owned_kakao_phone_enrollment(a) is null,'SMS confirmation clears older OAuth phone enrollment');
  begin
    perform public.confirm_owned_kakao_phone_enrollment(a,(oauth_a->>'id')::uuid,'kakao-alimtalk-v1');
    raise exception 'PHONE_SMS_TEST: obsolete OAuth confirmation accepted';
  exception when others then if sqlerrm='PHONE_SMS_TEST: obsolete OAuth confirmation accepted' then raise; end if; end;

  perform public.create_owned_kakao_alimtalk_state(b,repeat('4',64),repeat('b',64),'/settings');
  perform public.consume_owned_kakao_connection_state(b,repeat('4',64));
  perform public.complete_owned_kakao_connection(b,repeat('5',64));
  oauth_b:=public.stage_owned_kakao_phone_enrollment(b,repeat('4',64),repeat('5',64),'01065556666');
  response:=phone_sms_test.reserve(b,sms_b,'92000000-0000-4000-8000-000000000271','01067778888','oauth-wins');
  perform public.begin_phone_sms_send(b,sms_b);
  response:=public.verify_owned_phone_sms_challenge(b,sms_b,encode(extensions.digest('otp:oauth-wins','sha256'),'hex'));
  perform phone_sms_test.assert((response->>'verified')::boolean,'SMS proof prepared before OAuth confirmation');
  perform public.confirm_owned_kakao_phone_enrollment(b,(oauth_b->>'id')::uuid,'kakao-alimtalk-v1');
  perform phone_sms_test.assert((select cancelled_at is not null and phone is null and otp_digest is null
    from public.phone_sms_verification_challenges where id=sms_b),'OAuth confirmation cancels older SMS proof');
  begin
    perform public.confirm_owned_phone_sms_enrollment(b,sms_b,'kakao-alimtalk-v1');
    raise exception 'PHONE_SMS_TEST: obsolete SMS confirmation accepted';
  exception when others then if sqlerrm='PHONE_SMS_TEST: obsolete SMS confirmation accepted' or sqlerrm<>'PHONE_SMS_CONFIRMATION_INVALID' then raise; end if; end;
end $$;

-- Durable 24-hour owner quota, global 100/day budget, and retention cleanup.
do $$
declare quota_owner uuid:=extensions.gen_random_uuid(); global_owner uuid:=extensions.gen_random_uuid(); request_owner uuid:=extensions.gen_random_uuid();
  challenge uuid; i integer; needed integer;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (quota_owner,'did:privy:sms-quota-'||quota_owner,quota_owner||'@example.invalid'),
    (global_owner,'did:privy:sms-global-'||global_owner,global_owner||'@example.invalid'),
    (request_owner,'did:privy:sms-global-request-'||request_owner,request_owner||'@example.invalid');
  for i in 1..10 loop
    challenge:=extensions.gen_random_uuid();
    insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone_rate_key,
      created_at,expires_at,resend_at,cancelled_at)
    values(challenge,quota_owner,extensions.gen_random_uuid(),encode(extensions.digest('owner-day-'||i,'sha256'),'hex'),
      now()-interval '1 hour',now()-interval '55 minutes',now()-interval '59 minutes',now()-interval '55 minutes');
    insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at)
    values(challenge,quota_owner,encode(extensions.digest('owner-day-'||i,'sha256'),'hex'),now()-interval '1 hour');
  end loop;
  begin
    perform public.reserve_owned_phone_sms_challenge(quota_owner,extensions.gen_random_uuid(),extensions.gen_random_uuid(),
      '01068889999',repeat('6',64),repeat('7',64));
    raise exception 'PHONE_SMS_TEST: owner daily quota exceeded';
  exception when others then if sqlerrm='PHONE_SMS_TEST: owner daily quota exceeded' or sqlerrm<>'PHONE_SMS_RATE_LIMIT_24_HOUR' then raise; end if; end;

  select 100-count(*) into needed from public.phone_sms_rate_limit_events where reserved_at>now()-interval '24 hours';
  for i in 1..needed loop
    challenge:=extensions.gen_random_uuid();
    insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone_rate_key,
      created_at,expires_at,resend_at,cancelled_at)
    values(challenge,global_owner,extensions.gen_random_uuid(),encode(extensions.digest('global-day-'||i,'sha256'),'hex'),
      now()-interval '1 hour',now()-interval '55 minutes',now()-interval '59 minutes',now()-interval '55 minutes');
    insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at)
    values(challenge,global_owner,encode(extensions.digest('global-day-'||i,'sha256'),'hex'),now()-interval '1 hour');
  end loop;
  begin
    perform public.reserve_owned_phone_sms_challenge(request_owner,extensions.gen_random_uuid(),extensions.gen_random_uuid(),
      '01069990000',repeat('8',64),repeat('9',64));
    raise exception 'PHONE_SMS_TEST: global daily budget exceeded';
  exception when others then if sqlerrm='PHONE_SMS_TEST: global daily budget exceeded' or sqlerrm<>'PHONE_SMS_GLOBAL_BUDGET' then raise; end if; end;
  delete from public.phone_sms_rate_limit_events where app_user_id in(quota_owner,global_owner);
  delete from public.phone_sms_verification_challenges where app_user_id in(quota_owner,global_owner);

  challenge:=extensions.gen_random_uuid();
  insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone_rate_key,
    created_at,expires_at,resend_at,expired_at)
  values(challenge,'92000000-0000-4000-8000-000000000001',extensions.gen_random_uuid(),repeat('a',64),
    now()-interval '25 hours',now()-interval '24 hours 55 minutes',now()-interval '24 hours 59 minutes',now()-interval '24 hours 55 minutes');
  insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at)
  values(challenge,'92000000-0000-4000-8000-000000000001',repeat('a',64),now()-interval '25 hours');
  perform public.maintain_kakao_notification_deliveries();
  perform phone_sms_test.assert(not exists(select 1 from public.phone_sms_verification_challenges where id=challenge)
    and not exists(select 1 from public.phone_sms_rate_limit_events where challenge_id=challenge),'24-hour cleanup removes rate hash and sanitized challenge');
end $$;

-- Expiry purges secrets while the 24-hour rate event survives.
do $$
declare o uuid:='92000000-0000-4000-8000-000000000002'; c uuid:='92000000-0000-4000-8000-000000000110'; response jsonb;
begin
  insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone,phone_rate_key,otp_digest,
    send_status,created_at,expires_at,resend_at,sending_at)
  values(c,o,'92000000-0000-4000-8000-000000000210','01022223333',repeat('b',64),repeat('c',64),
    'sending',now()-interval '6 minutes',now()-interval '1 minute',now()-interval '5 minutes',now()-interval '6 minutes');
  insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at)
    values(c,o,repeat('b',64),now()-interval '6 minutes');
  perform phone_sms_test.assert(not public.finish_phone_sms_send(o,c,'unknown',null,null),'late provider result cannot revive expired challenge');
  response:=public.verify_owned_phone_sms_challenge(o,c,repeat('c',64));
  perform phone_sms_test.assert(response->>'error'='PHONE_SMS_CHALLENGE_EXPIRED','expired code rejected');
  perform phone_sms_test.assert((select phone is null and otp_digest is null and expired_at is not null
    from public.phone_sms_verification_challenges where id=c),'expiry purges secrets');
  perform phone_sms_test.assert(exists(select 1 from public.phone_sms_rate_limit_events where challenge_id=c),'expiry preserves rate history');
end $$;

-- SMS enrollment works without OAuth, stores no fake subject, and replay fails.
do $$
declare o uuid:='92000000-0000-4000-8000-000000000002'; c uuid:='92000000-0000-4000-8000-000000000120';
  ch uuid; response jsonb;
begin
  ch:=phone_sms_test.enroll(o,c,'92000000-0000-4000-8000-000000000220','01033334444','sms-only');
  perform phone_sms_test.assert(not exists(select 1 from public.fan_connected_accounts where app_user_id=o and provider='kakao'),'SMS proof needs no OAuth account');
  perform phone_sms_test.assert((select verification_method='sms_otp' and kakao_subject_hash is null and enrollment_generation=c
    from public.fan_notification_channels where id=ch),'SMS channel proof shape');
  perform phone_sms_test.assert((select phone is null and otp_digest is null and consumed_at is not null
    from public.phone_sms_verification_challenges where id=c),'confirmation consumes and purges challenge');
  response:=public.verify_owned_phone_sms_challenge(o,c,repeat('d',64));
  perform phone_sms_test.assert(response->>'error'='PHONE_SMS_CHALLENGE_REPLAY','consumed proof cannot verify again');
  begin
    perform public.confirm_owned_phone_sms_enrollment(o,c,'kakao-alimtalk-v1');
    raise exception 'PHONE_SMS_TEST: confirmation replay accepted';
  exception when others then if sqlerrm='PHONE_SMS_TEST: confirmation replay accepted' or sqlerrm<>'PHONE_SMS_CONFIRMATION_INVALID' then raise; end if; end;
end $$;

-- OAuth disconnect/change preserves an SMS-derived channel, while explicit
-- consent withdrawal and account disable invalidate SMS channels/challenges.
do $$
declare o uuid:='92000000-0000-4000-8000-000000000004'; d uuid:='92000000-0000-4000-8000-000000000003';
  channel_id uuid; pending uuid:='92000000-0000-4000-8000-000000000131'; disabled_pending uuid:='92000000-0000-4000-8000-000000000132';
  queued_notification uuid; queued_delivery uuid; claimed record;
begin
  perform public.complete_owned_kakao_connection(o,repeat('e',64));
  channel_id:=phone_sms_test.enroll(o,'92000000-0000-4000-8000-000000000130','92000000-0000-4000-8000-000000000230','01044445555','disconnect-keeps');
  perform public.disconnect_owned_kakao_connection(o);
  perform phone_sms_test.assert((select status='eligible' and verification_method='sms_otp' from public.fan_notification_channels where id=channel_id),'OAuth disconnect preserves SMS channel');
  perform public.complete_owned_kakao_connection(o,repeat('f',64));
  perform phone_sms_test.assert((select status='eligible' and verification_method='sms_otp' from public.fan_notification_channels where id=channel_id),'OAuth subject change preserves SMS channel');
  update public.phone_sms_rate_limit_events set reserved_at=now()-interval '2 minutes'
    where app_user_id=o and challenge_id='92000000-0000-4000-8000-000000000130';
  perform phone_sms_test.reserve(o,pending,'92000000-0000-4000-8000-000000000231','01044446666','withdraw-pending');
  insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
  values(o,'live_10m','test:sms-withdrawn-before-claim','91000000-0000-4000-8000-000000000003',now(),
    '/live/alimtalk-test-live','{"title":"Withdrawn","detail":"Suppress"}') returning id into queued_notification;
  select id into strict queued_delivery from public.external_notification_delivery_outbox
    where notification_id=queued_notification and channel='kakao';
  update public.external_notification_delivery_outbox set available_at='-infinity' where id=queued_delivery;
  perform public.set_owned_notification_channel_consent(o,channel_id,false,'kakao-alimtalk-v1');
  perform phone_sms_test.assert((select status='disabled' and verification_method is null from public.fan_notification_channels where id=channel_id),'explicit withdrawal revokes SMS channel');
  perform phone_sms_test.assert((select cancelled_at is not null and phone is null and otp_digest is null from public.phone_sms_verification_challenges where id=pending),'withdrawal invalidates pending OTP');
  perform public.claim_kakao_notification_deliveries('withdrawn-worker',1,60);
  perform phone_sms_test.assert((select status='suppressed' and verification_method is null and subject_hash is null
    from public.kakao_notification_attempts where delivery_id=queued_delivery),'withdrawn queued delivery suppresses without aborting claim batch');
  perform phone_sms_test.reserve(d,disabled_pending,'92000000-0000-4000-8000-000000000232','01055556666','disable-pending');
  update public.app_users set status='disabled' where id=d;
  perform phone_sms_test.assert((select cancelled_at is not null and phone is null and otp_digest is null from public.phone_sms_verification_challenges where id=disabled_pending),'owner disable invalidates pending OTP');
end $$;

-- SMS-only destination participates in plan -> claim -> begin, snapshots its
-- null subject explicitly, and grants only one provider-send permission.
do $$
declare o uuid:='92000000-0000-4000-8000-000000000002'; notification uuid; delivery uuid; claimed record;
begin
  insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
  values(o,'live_10m','test:sms-only-delivery','91000000-0000-4000-8000-000000000003',now(),
    '/live/alimtalk-test-live','{"title":"SMS ownership","detail":"Alimtalk"}') returning id into notification;
  select id into strict delivery from public.external_notification_delivery_outbox where notification_id=notification and channel='kakao';
  update public.external_notification_delivery_outbox set available_at='-infinity' where id=delivery;
  select * into strict claimed from public.claim_kakao_notification_deliveries('sms-worker',1,60);
  perform phone_sms_test.assert(claimed.id=delivery,'SMS-only delivery claimed');
  perform phone_sms_test.assert((select verification_method='sms_otp' and subject_hash is null from public.kakao_notification_attempts where delivery_id=delivery),'attempt snapshots SMS method and null subject');
  perform phone_sms_test.assert(public.begin_kakao_notification_send(delivery,claimed.attempt_token,claimed.template_id,repeat('1',64)),'SMS-only begin succeeds');
  perform phone_sms_test.assert(not public.begin_kakao_notification_send(delivery,claimed.attempt_token,claimed.template_id,repeat('1',64)),'SMS-only begin is one-shot');
  begin
    update public.kakao_notification_attempts set verification_method='kakao_profile_owner_confirmation' where delivery_id=delivery;
    raise exception 'PHONE_SMS_TEST: attempt method changed';
  exception when others then if sqlerrm='PHONE_SMS_TEST: attempt method changed' or sqlerrm<>'KAKAO_ATTEMPT_SNAPSHOT_IMMUTABLE' then raise; end if; end;
end $$;

-- Direct data authority remains closed; only the six owner-bound RPCs are
-- callable by service_role. The scheduled cleanup is an actual five-minute job.
do $$
declare role_name text; signature text;
begin
  foreach signature in array array[
    'reserve_owned_phone_sms_challenge(uuid,uuid,uuid,text,text,text)',
    'begin_phone_sms_send(uuid,uuid)','finish_phone_sms_send(uuid,uuid,text,text,text)',
    'verify_owned_phone_sms_challenge(uuid,uuid,text)','confirm_owned_phone_sms_enrollment(uuid,uuid,text)',
    'cancel_owned_phone_sms_challenge(uuid,uuid)'] loop
    foreach role_name in array array['anon','authenticated'] loop
      perform phone_sms_test.assert(not has_function_privilege(role_name,'public.'||signature,'EXECUTE'),role_name||' cannot call '||signature);
    end loop;
    perform phone_sms_test.assert(has_function_privilege('service_role','public.'||signature,'EXECUTE'),'service role can call '||signature);
  end loop;
  perform phone_sms_test.assert(not has_table_privilege('service_role','public.phone_sms_verification_challenges','SELECT'),'challenge table has no direct service access');
  perform phone_sms_test.assert(not has_table_privilege('service_role','public.phone_sms_rate_limit_events','SELECT'),'rate table has no direct service access');
  perform phone_sms_test.assert(exists(select 1 from cron.job where jobname='phone-sms-challenge-retention' and schedule='*/5 * * * *'),'five-minute cleanup scheduled');
  perform phone_sms_test.assert((select count(*)=2 from public.fan_notification_delivery_control),'release control rows preserved');
end $$;

select 'Phone SMS enrollment, proof snapshot, revocation and ACL PASS' as result;
