\set ON_ERROR_STOP on
begin;

do $$
declare
  v_now bigint:=floor(extract(epoch from clock_timestamp()))::bigint;
  v_update_blocked boolean:=false;
  v_old_writer_blocked boolean:=false;
  v_state_before record;
  v_result jsonb;
  v_subject_subsecond text:=lpad('4',64,'9');
  v_subject_out_of_order text:=lpad('7',64,'9');
  v_subject_tie text:=lpad('5',64,'9');
  v_subject_relay text:=lpad('6',64,'9');
  v_relay_fingerprint text:=repeat('4',64);
begin
  if (select event_time from public.apple_notification_events
      where event_id='upgrade-legacy-seconds') is distinct from 1789040700000
    or (select event_time from public.apple_relay_availability
      where subject_hash=lpad('1',64,'9') and destination_fingerprint=repeat('8',64))
        is distinct from 1789040701000
    or (select credential_event_time from public.apple_lifecycle_subjects
      where subject_hash=lpad('1',64,'9')) is distinct from 1789040700000 then
    raise exception 'legacy Apple event seconds were not converted exactly';
  end if;
  if (select event_time from public.apple_notification_events
      where event_id='upgrade-canonical-milliseconds') is distinct from 1789040700123
    or (select event_time from public.apple_relay_availability
      where subject_hash=lpad('3',64,'9') and destination_fingerprint=repeat('7',64))
        is distinct from 1789040701123
    or (select credential_event_time from public.apple_lifecycle_subjects
      where subject_hash=lpad('3',64,'9')) is distinct from 1789040700123 then
    raise exception 'canonical Apple milliseconds changed during backfill';
  end if;
  if (select credential_event_time from public.apple_lifecycle_subjects
      where subject_hash=lpad('2',64,'9')) is distinct from 0 then
    raise exception 'zero credential event sentinel was not preserved';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.apple_notification_events'::regclass
      and tgname='apple_notification_events_reject_update_delete'
      and tgenabled='O' and not tgisinternal
  ) then
    raise exception 'Apple notification immutable-row trigger was not re-enabled';
  end if;
  begin
    update public.apple_notification_events set event_time=event_time+1
    where event_id='upgrade-legacy-seconds';
  exception when raise_exception then
    v_update_blocked:=true;
  end;
  if not v_update_blocked then
    raise exception 'Apple notification ledger UPDATE was not blocked';
  end if;

  select credential_state,credential_event_time into v_state_before
  from public.apple_lifecycle_subjects where subject_hash=lpad('2',64,'9');
  begin
    update public.apple_lifecycle_subjects
    set credential_state='revoked',credential_event_time=1789040700000
    where subject_hash=lpad('2',64,'9');
    insert into public.apple_notification_events(
      audience,event_id,payload_hash,event_type,subject_hash,event_time,issued_at
    ) values(
      'kr.byus.web','upgrade-old-writer-seconds',repeat('3',64),'consent-revoked',
      lpad('2',64,'9'),v_now-1,v_now
    );
  exception when check_violation then
    v_old_writer_blocked:=true;
  end;
  if not v_old_writer_blocked
    or exists(select 1 from public.apple_notification_events
      where event_id='upgrade-old-writer-seconds')
    or (select row(credential_state,credential_event_time)
      from public.apple_lifecycle_subjects where subject_hash=lpad('2',64,'9'))
      is distinct from row(v_state_before.credential_state,v_state_before.credential_event_time) then
    raise exception 'old seconds writer did not fail atomically before state changes';
  end if;

  -- Mixed seconds/milliseconds preserve exact subsecond credential ordering.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-subsecond-consent','payloadHash',repeat('2',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',v_subject_subsecond,
    'eventTime',v_now-10,'issuedAt',v_now
  ));
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-subsecond-delete','payloadHash',repeat('1',64),
    'audience','kr.byus.web','type','account-deleted','subjectHash',v_subject_subsecond,
    'eventTime',(v_now-10)*1000+1,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'applied'
    or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=v_subject_subsecond)<>'deleted'
    or (select credential_event_time from public.apple_lifecycle_subjects
      where subject_hash=v_subject_subsecond)<>(v_now-10)*1000+1
    or (select event_time from public.apple_notification_events
      where event_id='upgrade-subsecond-consent')<>(v_now-10)*1000 then
    raise exception 'mixed-unit credential subsecond ordering was not exact';
  end if;

  -- Arrival order cannot replace a newer .999 event with an older .001 event
  -- from the same second.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-out-of-order-newer','payloadHash',repeat('f',64),
    'audience','kr.byus.web','type','consent-revoked','subjectHash',v_subject_out_of_order,
    'eventTime',(v_now-9)*1000+999,'issuedAt',v_now
  ));
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-out-of-order-older','payloadHash',repeat('0',64),
    'audience','kr.byus.web','type','account-deleted','subjectHash',v_subject_out_of_order,
    'eventTime',(v_now-9)*1000+1,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'stale'
    or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=v_subject_out_of_order)<>'revoked'
    or (select credential_event_time from public.apple_lifecycle_subjects
      where subject_hash=v_subject_out_of_order)<>(v_now-9)*1000+999 then
    raise exception 'late same-second older event replaced exact newer state';
  end if;

  -- Equal canonical timestamps keep the restrictive credential tie behavior.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-tie-consent','payloadHash',repeat('a',64),
    'audience','kr.byus.app','type','consent-revoked','subjectHash',v_subject_tie,
    'eventTime',(v_now-8)*1000+321,'issuedAt',v_now
  ));
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-tie-delete','payloadHash',repeat('b',64),
    'audience','kr.byus.app','type','account-deleted','subjectHash',v_subject_tie,
    'eventTime',(v_now-8)*1000+321,'issuedAt',v_now
  ));
  if v_result->>'outcome'<>'applied'
    or (select credential_state from public.apple_lifecycle_subjects
      where subject_hash=v_subject_tie)<>'deleted' then
    raise exception 'equal-millisecond restrictive credential tie did not win';
  end if;

  -- Relay ordering also mixes a legacy second input with exact milliseconds.
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-relay-enabled','payloadHash',repeat('c',64),
    'audience','kr.byus.app','type','email-enabled','subjectHash',v_subject_relay,
    'eventTime',v_now-6,'issuedAt',v_now,'emailFingerprint',v_relay_fingerprint
  ));
  perform public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-relay-disabled','payloadHash',repeat('d',64),
    'audience','kr.byus.app','type','email-disabled','subjectHash',v_subject_relay,
    'eventTime',(v_now-6)*1000,'issuedAt',v_now,'emailFingerprint',v_relay_fingerprint
  ));
  v_result:=public.apply_apple_account_notification(jsonb_build_object(
    'eventId','upgrade-relay-newer','payloadHash',repeat('e',64),
    'audience','kr.byus.app','type','email-enabled','subjectHash',v_subject_relay,
    'eventTime',(v_now-6)*1000+1,'issuedAt',v_now,'emailFingerprint',v_relay_fingerprint
  ));
  if v_result->>'outcome'<>'applied'
    or (select state from public.apple_relay_availability
      where subject_hash=v_subject_relay and destination_fingerprint=v_relay_fingerprint)<>'enabled'
    or (select event_time from public.apple_relay_availability
      where subject_hash=v_subject_relay and destination_fingerprint=v_relay_fingerprint)<>(v_now-6)*1000+1 then
    raise exception 'mixed-unit relay tie or subsecond ordering changed';
  end if;
end $$;

rollback;
select 'apple event-time upgrade assertions passed' as result;
