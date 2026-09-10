\set ON_ERROR_STOP on
begin;

-- Core notification ordering, immutable replay identity, unknown-subject state,
-- terminal deletion, independent relay clocks, and cross-owner mapping.
do $$
declare
  v_now bigint:=floor(extract(epoch from clock_timestamp()))::bigint;
  v_result jsonb;
  v_generation bigint;
  v_conflict boolean:=false;
begin
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-email-enabled-1','payloadHash',repeat('1',64),
    'audience','kr.byus.app','type','email-enabled','subjectHash',repeat('a',64),
    'eventTime',v_now-20,'issuedAt',v_now,'emailFingerprint',repeat('c',64)
  ));
  if v_result<>jsonb_build_object('outcome','applied','matched',false) then
    raise exception 'email-enabled initial event result invalid: %',v_result;
  end if;
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-email-disabled-1','payloadHash',repeat('2',64),
    'audience','kr.byus.app','type','email-disabled','subjectHash',repeat('a',64),
    'eventTime',v_now-20,'issuedAt',v_now,'emailFingerprint',repeat('c',64)
  ));
  if v_result->>'outcome'<>'applied' or (select state from public.apple_relay_availability
      where subject_hash=repeat('a',64) and destination_fingerprint=repeat('c',64))<>'disabled' then
    raise exception 'equal-time restrictive relay tie did not win';
  end if;
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-email-enabled-old','payloadHash',repeat('3',64),
    'audience','kr.byus.app','type','email-enabled','subjectHash',repeat('a',64),
    'eventTime',v_now-30,'issuedAt',v_now,'emailFingerprint',repeat('c',64)
  ));
  if v_result->>'outcome'<>'stale' then raise exception 'older relay event was not stale'; end if;

  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-unknown-revoked','payloadHash',repeat('4',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',repeat('b',64),
    'eventTime',v_now-15,'issuedAt',v_now
  ));
  if v_result->>'matched'<>'false' then raise exception 'unknown subject incorrectly matched'; end if;
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-unknown-revoked','payloadHash',repeat('4',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',repeat('b',64),
    'eventTime',v_now-15,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'duplicate' then raise exception 'exact event replay not duplicate'; end if;
  begin
    perform public.apply_apple_account_notification(jsonb_build_object(
      'eventId','evt-unknown-revoked','payloadHash',repeat('5',64),
      'audience','kr.byus.web','type','consent-revoked','subjectHash',repeat('b',64),
      'eventTime',v_now-15,'issuedAt',v_now
    ));
  exception when check_violation then v_conflict:=true; end;
  if not v_conflict then raise exception 'conflicting payload hash was accepted'; end if;

  v_result:=public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:apple-owner-1','sessionHash',repeat('6',64),
    'appleSubjectHash',repeat('b',64),'appleEmailFingerprint',repeat('c',64),
    'googleSubjectHash',null
  ));
  if (v_result->>'allowed')::boolean or (v_result->>'generation')::bigint<>1
    or v_result->>'appleState'<>'revoked' then
    raise exception 'unknown revoked subject mapping did not gate and increment: %',v_result;
  end if;

  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-account-deleted','payloadHash',repeat('7',64),
    'audience','kr.byus.web','type','account-deleted','subjectHash',repeat('b',64),
    'eventTime',v_now-10,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'applied' or v_result->>'matched'<>'true' then
    raise exception 'mapped account deletion was not applied';
  end if;
  select generation into v_generation from public.apple_auth_owners
    where privy_user_id='did:privy:apple-owner-1';
  if v_generation<>2 then raise exception 'mapped deletion did not increment generation'; end if;
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-consent-after-delete','payloadHash',repeat('8',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',repeat('b',64),
    'eventTime',v_now-1,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'stale' or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=repeat('b',64))<>'deleted' then
    raise exception 'account deletion was not terminal';
  end if;

  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-equal-consent','payloadHash',repeat('a',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',repeat('0',64),
    'eventTime',v_now-8,'issuedAt',v_now
  ));
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-equal-delete','payloadHash',repeat('b',64),
    'audience','kr.byus.web','type','account-deleted','subjectHash',repeat('0',64),
    'eventTime',v_now-8,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'applied' or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=repeat('0',64))<>'deleted' then
    raise exception 'equal-time credential tie did not choose deletion';
  end if;

  -- Relay state has its own clock and still accepts an older-than-credential event.
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-email-after-delete-clock','payloadHash',repeat('9',64),
    'audience','kr.byus.web','type','email-enabled','subjectHash',repeat('b',64),
    'eventTime',v_now-100,'issuedAt',v_now,'emailFingerprint',repeat('d',64)
  ));
  if v_result->>'outcome'<>'applied' or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=repeat('b',64))<>'deleted' then
    raise exception 'email clock changed credential state or was coupled to its clock';
  end if;

  v_conflict:=false;
  begin
    perform public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:apple-owner-2','sessionHash',repeat('a',64),
      'appleSubjectHash',repeat('b',64),'appleEmailFingerprint',null,'googleSubjectHash',null
    ));
  exception when check_violation then v_conflict:=true; end;
  if not v_conflict then raise exception 'cross-owner Apple subject mapping was accepted'; end if;
end $$;

-- Recovery challenges and session grants are SID-, provider-subject-, cookie-,
-- nonce-, expiry-, and owner-generation-bound.
do $$
declare
  v_now bigint:=floor(extract(epoch from clock_timestamp()))::bigint;
  v_access jsonb;
  v_challenge jsonb;
  v_generation bigint;
  v_rate_limited boolean:=false;
  v_index integer;
  v_completed boolean;
  v_provider text;
begin
  -- A revoked but non-deleted Apple subject can recover the current SID.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-revoked-recovery','payloadHash',repeat('a',64),
    'audience','kr.byus.app','type','consent-revoked','subjectHash',repeat('e',64),
    'eventTime',v_now-10,'issuedAt',v_now
  ));
  v_access:=public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
    'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
    'googleSubjectHash',repeat('f',64)
  ));
  v_generation:=(v_access->>'generation')::bigint;
  if (v_access->>'allowed')::boolean then raise exception 'revoked session initially allowed'; end if;
  if (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',repeat('f',64)))->>'allowed')::boolean then
    raise exception 'token refresh with same SID bypassed gate';
  end if;

  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('2',64),'cookieHash',repeat('3',64),'nonceHash',repeat('4',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
    'provider','apple','providerSubjectHash',repeat('e',64),'generation',v_generation,
    'returnPath','/login?locale=ko&returnTo=%2Fmy',
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  if public.read_apple_reauth_challenge(repeat('2',64),repeat('5',64)) is not null then
    raise exception 'wrong cookie read a challenge';
  end if;
  v_challenge:=public.read_apple_reauth_challenge(repeat('2',64),repeat('3',64));
  if v_challenge->>'nonceHash'<>repeat('4',64)
    or v_challenge->>'returnPath'<>'/login?locale=ko&returnTo=%2Fmy' then
    raise exception 'challenge read contract invalid: %',v_challenge;
  end if;
  if public.complete_apple_reauthentication(repeat('2',64),repeat('5',64),repeat('e',64)) then
    raise exception 'wrong cookie completed a challenge';
  end if;
  if public.complete_apple_reauthentication(repeat('2',64),repeat('3',64),repeat('d',64)) then
    raise exception 'wrong provider subject completed a challenge';
  end if;
  if not public.complete_apple_reauthentication(repeat('2',64),repeat('3',64),repeat('e',64)) then
    raise exception 'valid Apple challenge did not complete';
  end if;
  if public.complete_apple_reauthentication(repeat('2',64),repeat('3',64),repeat('e',64)) then
    raise exception 'consumed challenge was reused';
  end if;
  v_access:=public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
    'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
    'googleSubjectHash',repeat('f',64)
  ));
  if not (v_access->>'allowed')::boolean then raise exception 'Apple grant did not allow current SID'; end if;
  if (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('0',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',repeat('f',64)))->>'allowed')::boolean then
    raise exception 'Apple grant allowed an old/different SID';
  end if;

  -- A subsequent revocation generation invalidates the Apple grant.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-revoked-again','payloadHash',repeat('b',64),
    'audience','kr.byus.app','type','consent-revoked','subjectHash',repeat('e',64),
    'eventTime',v_now-5,'issuedAt',v_now
  ));
  if (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',null))->>'allowed')::boolean then
    raise exception 'new revocation did not invalidate Apple grant';
  end if;

  select generation into v_generation from public.apple_auth_owners
    where privy_user_id='did:privy:recovery';
  update public.apple_session_grants set created_at=clock_timestamp()-interval '1 day'
    where privy_user_id='did:privy:recovery' and session_hash=repeat('1',64);
  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('5',64),'cookieHash',repeat('6',64),'nonceHash',repeat('7',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
    'provider','apple','providerSubjectHash',repeat('e',64),'generation',v_generation,
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  if not public.complete_apple_reauthentication(repeat('5',64),repeat('6',64),repeat('e',64)) then
    raise exception 'fresh Apple proof could not refresh the same SID grant';
  end if;
  if not (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',null))->>'allowed')::boolean
    or (select owner_generation from public.apple_session_grants
      where privy_user_id='did:privy:recovery' and session_hash=repeat('1',64))<>v_generation
    or (select created_at from public.apple_session_grants
      where privy_user_id='did:privy:recovery' and session_hash=repeat('1',64))
        < clock_timestamp()-interval '1 minute' then
    raise exception 'fresh Apple proof did not replace stale generation evidence';
  end if;

  -- Fresh verified Google proof may replace Apple proof for the same Privy SID.
  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('4',64),'cookieHash',repeat('5',64),'nonceHash',repeat('6',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
    'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  v_completed:=public.complete_apple_reauthentication(repeat('4',64),repeat('5',64),repeat('f',64));
  select provider into v_provider from public.apple_session_grants
    where privy_user_id='did:privy:recovery' and session_hash=repeat('1',64);
  v_access:=public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('1',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',repeat('f',64)));
  if not v_completed or v_provider<>'google' or not (v_access->>'allowed')::boolean then
    raise exception 'fresh Google proof did not replace same-SID Apple grant: completed %, provider %, access %',
      v_completed,v_provider,v_access;
  end if;

  -- Google recovery remains valid after later Apple generations while the
  -- verified current Google subject remains linked.
  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('6',64),'cookieHash',repeat('7',64),'nonceHash',repeat('8',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('9',64),
    'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  if not public.complete_apple_reauthentication(repeat('6',64),repeat('7',64),repeat('f',64)) then
    raise exception 'Google recovery failed';
  end if;
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-revoked-third','payloadHash',repeat('c',64),
    'audience','kr.byus.app','type','consent-revoked','subjectHash',repeat('e',64),
    'eventTime',v_now-1,'issuedAt',v_now
  ));
  if not (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('9',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',repeat('f',64)))->>'allowed')::boolean then
    raise exception 'later Apple event invalidated Google grant';
  end if;
  if (public.check_apple_session_access(jsonb_build_object(
      'privyUserId','did:privy:recovery','sessionHash',repeat('9',64),
      'appleSubjectHash',repeat('e',64),'appleEmailFingerprint',repeat('e',64),
      'googleSubjectHash',null))->>'allowed')::boolean then
    raise exception 'removed Google link left Google grant valid';
  end if;

  -- Expiry fails closed.
  select generation into v_generation from public.apple_auth_owners
    where privy_user_id='did:privy:recovery';
  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('a',64),'cookieHash',repeat('b',64),'nonceHash',repeat('c',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('d',64),
    'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  update public.apple_reauth_challenges set expires_at=clock_timestamp()-interval '1 second'
    where state_hash=repeat('a',64);
  if public.read_apple_reauth_challenge(repeat('a',64),repeat('b',64)) is not null
    or public.complete_apple_reauthentication(repeat('a',64),repeat('b',64),repeat('f',64)) then
    raise exception 'expired challenge did not fail closed';
  end if;

  -- Generation change between create and callback fails closed.
  perform public.create_apple_reauth_challenge(jsonb_build_object(
    'stateHash',repeat('d',64),'cookieHash',repeat('c',64),'nonceHash',repeat('b',64),
    'privyUserId','did:privy:recovery','sessionHash',repeat('a',64),
    'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
    'expiresAt',(clock_timestamp()+interval '5 minutes')::text
  ));
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-generation-race','payloadHash',repeat('d',64),
    'audience','kr.byus.app','type','account-deleted','subjectHash',repeat('e',64),
    'eventTime',v_now,'issuedAt',v_now
  ));
  if public.complete_apple_reauthentication(repeat('d',64),repeat('c',64),repeat('f',64)) then
    raise exception 'generation race completed stale challenge';
  end if;
  select generation into v_generation from public.apple_auth_owners
    where privy_user_id='did:privy:recovery';
  for v_index in 1..4 loop
    perform public.create_apple_reauth_challenge(jsonb_build_object(
      'stateHash',encode(extensions.digest('rate-state-'||v_index::text,'sha256'),'hex'),
      'cookieHash',encode(extensions.digest('rate-cookie-'||v_index::text,'sha256'),'hex'),
      'nonceHash',encode(extensions.digest('rate-nonce-'||v_index::text,'sha256'),'hex'),
      'privyUserId','did:privy:recovery',
      'sessionHash',encode(extensions.digest('rate-session-'||v_index::text,'sha256'),'hex'),
      'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
      'expiresAt',(clock_timestamp()+interval '5 minutes')::text
    ));
  end loop;
  begin
    perform public.create_apple_reauth_challenge(jsonb_build_object(
      'stateHash',encode(extensions.digest('rate-state-blocked','sha256'),'hex'),
      'cookieHash',encode(extensions.digest('rate-cookie-blocked','sha256'),'hex'),
      'nonceHash',encode(extensions.digest('rate-nonce-blocked','sha256'),'hex'),
      'privyUserId','did:privy:recovery',
      'sessionHash',encode(extensions.digest('rate-session-blocked','sha256'),'hex'),
      'provider','google','providerSubjectHash',repeat('f',64),'generation',v_generation,
      'expiresAt',(clock_timestamp()+interval '5 minutes')::text
    ));
  exception when check_violation then v_rate_limited:=true; end;
  if not v_rate_limited then raise exception 'active challenge rate limit was not enforced'; end if;
end $$;

-- Real notification eligibility wrapper: prior consent remains authoritative;
-- only recorded Apple private-relay fingerprints are lifecycle-suppressed.
insert into public.app_users(id,privy_user_id,verified_email) values
  ('71000000-0000-4000-8000-000000000001','did:privy:relay-blocked','relay@privaterelay.appleid.com'),
  ('71000000-0000-4000-8000-000000000002','did:privy:google-current','google@example.test'),
  ('71000000-0000-4000-8000-000000000003','did:privy:relay-optout','optout@privaterelay.appleid.com');
insert into public.celebrities(id,slug,status,image_url,published_at) values(
  '71000000-0000-4000-8000-000000000010','apple-lifecycle-artist','published',
  'https://example.test/apple-lifecycle.jpg',clock_timestamp()
);
insert into public.benefits(
  id,slug,celebrity_id,publication_status,delivery_type,claim_opens_at,claim_closes_at,published_at
) values(
  '71000000-0000-4000-8000-000000000020','apple-lifecycle-benefit',
  '71000000-0000-4000-8000-000000000010','published','text',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp()
);
insert into public.fan_notifications(
  id,app_user_id,kind,source_key,benefit_id,scheduled_for
) values
  ('71000000-0000-4000-8000-000000000041','71000000-0000-4000-8000-000000000001',
    'benefit_available','apple-relay-blocked','71000000-0000-4000-8000-000000000020',clock_timestamp()-interval '1 minute'),
  ('71000000-0000-4000-8000-000000000042','71000000-0000-4000-8000-000000000002',
    'benefit_available','apple-google-current','71000000-0000-4000-8000-000000000020',clock_timestamp()-interval '1 minute'),
  ('71000000-0000-4000-8000-000000000043','71000000-0000-4000-8000-000000000003',
    'benefit_available','apple-relay-optout','71000000-0000-4000-8000-000000000020',clock_timestamp()-interval '1 minute'),
  ('71000000-0000-4000-8000-000000000044','71000000-0000-4000-8000-000000000001',
    'benefit_available','apple-relay-claim','71000000-0000-4000-8000-000000000020',clock_timestamp()-interval '1 minute'),
  ('71000000-0000-4000-8000-000000000045','71000000-0000-4000-8000-000000000001',
    'benefit_available','apple-relay-revalidate','71000000-0000-4000-8000-000000000020',clock_timestamp()-interval '1 minute');
insert into public.fan_notification_channels(
  id,app_user_id,kind,status,consent_version,consented_at,consent_revoked_at,
  destination_fingerprint,destination_label,verified_at
) values
  ('71000000-0000-4000-8000-000000000031','71000000-0000-4000-8000-000000000001',
    'email','eligible','2026-09-v1',clock_timestamp(),null,repeat('1',64),'r***@privaterelay.appleid.com',clock_timestamp()),
  ('71000000-0000-4000-8000-000000000032','71000000-0000-4000-8000-000000000002',
    'email','eligible','2026-09-v1',clock_timestamp(),null,repeat('2',64),'g***@example.test',clock_timestamp()),
  ('71000000-0000-4000-8000-000000000033','71000000-0000-4000-8000-000000000003',
    'email','disabled','2026-09-v1',clock_timestamp(),clock_timestamp(),repeat('3',64),'o***@privaterelay.appleid.com',clock_timestamp());
insert into public.notification_delivery_plans(
  id,notification_id,primary_channel_id
) values
  ('71000000-0000-4000-8000-000000000051','71000000-0000-4000-8000-000000000044','71000000-0000-4000-8000-000000000031'),
  ('71000000-0000-4000-8000-000000000052','71000000-0000-4000-8000-000000000045','71000000-0000-4000-8000-000000000031');
insert into public.external_notification_delivery_outbox(
  id,plan_id,notification_id,channel_id,channel,sequence,template_key,status,
  available_at,lease_owner,lease_expires_at
) values
  ('71000000-0000-4000-8000-000000000061','71000000-0000-4000-8000-000000000051',
    '71000000-0000-4000-8000-000000000044','71000000-0000-4000-8000-000000000031',
    'email',1,'benefit_available','pending',clock_timestamp()-interval '1 minute',null,null),
  ('71000000-0000-4000-8000-000000000062','71000000-0000-4000-8000-000000000052',
    '71000000-0000-4000-8000-000000000045','71000000-0000-4000-8000-000000000031',
    'email',1,'benefit_available','processing',clock_timestamp()-interval '1 minute',
    'apple-revalidate-worker',clock_timestamp()+interval '5 minutes');

do $$
declare
  v_now bigint:=floor(extract(epoch from clock_timestamp()))::bigint;
  v_before record;
  v_after record;
  v_claimed bigint;
  v_claim_status text;
  v_revalidated boolean;
  v_revalidate_status text;
begin
  -- Map revoked subjects. Only user 1 supplies a verified Apple relay fingerprint;
  -- user 2's current Google destination is deliberately absent from Apple state.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-relay-blocked','payloadHash',repeat('e',64),'audience','kr.byus.web',
    'type','consent-revoked','subjectHash',repeat('1',64),'eventTime',v_now-2,'issuedAt',v_now
  ));
  perform public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:relay-blocked','sessionHash',repeat('4',64),
    'appleSubjectHash',repeat('1',64),'appleEmailFingerprint',repeat('1',64),'googleSubjectHash',null
  ));
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-google-user-revoked','payloadHash',repeat('f',64),'audience','kr.byus.web',
    'type','consent-revoked','subjectHash',repeat('2',64),'eventTime',v_now-2,'issuedAt',v_now
  ));
  perform public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:google-current','sessionHash',repeat('5',64),
    'appleSubjectHash',repeat('2',64),'appleEmailFingerprint',null,'googleSubjectHash',repeat('6',64)
  ));

  select status,consented_at,consent_revoked_at into v_before
  from public.fan_notification_channels where id='71000000-0000-4000-8000-000000000033';
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','evt-optout-email-enabled','payloadHash',repeat('0',64),'audience','kr.byus.app',
    'type','email-enabled','subjectHash',repeat('3',64),'eventTime',v_now-1,'issuedAt',v_now,
    'emailFingerprint',repeat('3',64)
  ));
  perform public.check_apple_session_access(jsonb_build_object(
    'privyUserId','did:privy:relay-optout','sessionHash',repeat('7',64),
    'appleSubjectHash',repeat('3',64),'appleEmailFingerprint',repeat('3',64),'googleSubjectHash',null
  ));
  select status,consented_at,consent_revoked_at into v_after
  from public.fan_notification_channels where id='71000000-0000-4000-8000-000000000033';
  if row(v_before.status,v_before.consented_at,v_before.consent_revoked_at)
      is distinct from row(v_after.status,v_after.consented_at,v_after.consent_revoked_at) then
    raise exception 'Apple event mutated user email consent/channel state';
  end if;
  if public.email_notification_delivery_is_eligible(
      '71000000-0000-4000-8000-000000000041','71000000-0000-4000-8000-000000000031',clock_timestamp()) then
    raise exception 'revoked Apple private relay remained eligible';
  end if;
  if not public.email_notification_delivery_is_eligible(
      '71000000-0000-4000-8000-000000000042','71000000-0000-4000-8000-000000000032',clock_timestamp()) then
    raise exception 'current Google destination was suppressed by unrelated Apple lifecycle';
  end if;
  if public.email_notification_delivery_is_eligible(
      '71000000-0000-4000-8000-000000000043','71000000-0000-4000-8000-000000000033',clock_timestamp()) then
    raise exception 'prior email opt-out was not preserved';
  end if;
  select count(*) into v_claimed from public.claim_email_notification_deliveries(
    'apple-claim-worker',10,300,clock_timestamp());
  select status into v_claim_status from public.external_notification_delivery_outbox
    where id='71000000-0000-4000-8000-000000000061';
  if v_claimed<>0 or v_claim_status<>'failed' then
    raise exception 'email claim path bypassed Apple eligibility wrapper: claimed %, status %',
      v_claimed,v_claim_status;
  end if;
  v_revalidated:=public.revalidate_email_notification_delivery(
    '71000000-0000-4000-8000-000000000062','apple-revalidate-worker',clock_timestamp());
  select status into v_revalidate_status from public.external_notification_delivery_outbox
    where id='71000000-0000-4000-8000-000000000062';
  if v_revalidated or v_revalidate_status<>'failed' then
    raise exception 'email sender revalidation bypassed Apple eligibility wrapper: result %, status %',
      v_revalidated,v_revalidate_status;
  end if;
end $$;

-- Tables are inaccessible even to service_role; only the RPC surface is usable.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'apple_auth_owners','apple_lifecycle_subjects','apple_relay_availability',
    'apple_notification_events','apple_reauth_challenges','apple_session_grants'
  ] loop
    if has_table_privilege('anon','public.'||v_table,'SELECT')
      or has_table_privilege('authenticated','public.'||v_table,'SELECT')
      or has_table_privilege('service_role','public.'||v_table,'SELECT') then
      raise exception 'private Apple table has a direct SELECT grant: %',v_table;
    end if;
  end loop;
  if has_function_privilege('anon','public.check_apple_session_access(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.check_apple_session_access(jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.check_apple_session_access(jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.apply_apple_account_notification(jsonb)','EXECUTE') then
    raise exception 'Apple RPC execute privileges are invalid';
  end if;
end $$;

rollback;
select 'apple account lifecycle assertions passed' as result;
