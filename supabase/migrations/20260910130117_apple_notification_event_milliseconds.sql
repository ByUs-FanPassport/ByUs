begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('apple-account-lifecycle:v1',0)
);

alter table public.apple_notification_events
  disable trigger apple_notification_events_reject_update_delete;

update public.apple_notification_events
set event_time=event_time*1000
where event_time>0 and event_time<1000000000000;

update public.apple_relay_availability
set event_time=event_time*1000
where event_time>0 and event_time<1000000000000;

update public.apple_lifecycle_subjects
set credential_event_time=credential_event_time*1000
where credential_event_time>0 and credential_event_time<1000000000000;

alter table public.apple_notification_events
  enable trigger apple_notification_events_reject_update_delete;

alter table public.apple_notification_events
  add constraint apple_notification_events_event_time_milliseconds_check
  check (event_time>=1000000000000);

alter table public.apple_relay_availability
  add constraint apple_relay_availability_event_time_milliseconds_check
  check (event_time>=1000000000000);

alter table public.apple_lifecycle_subjects
  add constraint apple_lifecycle_subjects_credential_event_time_milliseconds_check
  check (credential_event_time=0 or credential_event_time>=1000000000000);

comment on column public.apple_notification_events.event_time is
  'Apple event time normalized to integer Unix milliseconds.';
comment on column public.apple_notification_events.issued_at is
  'Verified JWT iat NumericDate in integer Unix seconds.';
comment on column public.apple_relay_availability.event_time is
  'Latest Apple relay event time in integer Unix milliseconds.';
comment on column public.apple_lifecycle_subjects.credential_event_time is
  'Latest Apple credential event time in integer Unix milliseconds; zero means no credential event recorded.';

create or replace function public.apply_apple_account_notification(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_event_id text:=p_event->>'eventId';
  v_payload_hash text:=p_event->>'payloadHash';
  v_audience text:=p_event->>'audience';
  v_type text:=p_event->>'type';
  v_subject_hash text:=p_event->>'subjectHash';
  v_email_fingerprint text:=p_event->>'emailFingerprint';
  v_event_time bigint;
  v_issued_at bigint;
  v_existing_hash text;
  v_prior_state text;
  v_prior_time bigint;
  v_prior_relay_state text;
  v_prior_relay_time bigint;
  v_owner text;
  v_desired_state text;
  v_applied boolean:=false;
  v_matched boolean:=false;
  v_now_epoch bigint:=pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('apple-account-lifecycle:v1',0)
  );
  if p_event is null or pg_catalog.jsonb_typeof(p_event)<>'object'
    or v_event_id is null or v_event_id<>btrim(v_event_id) or length(v_event_id) not between 1 and 256
    or v_payload_hash is null or v_payload_hash!~'^[0-9a-f]{64}$'
    or v_subject_hash is null or v_subject_hash!~'^[0-9a-f]{64}$'
    or v_audience not in ('kr.byus.web','kr.byus.app')
    or v_type not in ('consent-revoked','account-deleted','email-disabled','email-enabled')
    or pg_catalog.jsonb_typeof(p_event->'eventTime')<>'number'
    or pg_catalog.jsonb_typeof(p_event->'issuedAt')<>'number'
    or (p_event->>'eventTime')!~'^[0-9]+$'
    or (p_event->>'issuedAt')!~'^[0-9]+$' then
    raise exception 'APPLE_NOTIFICATION_INVALID' using errcode='22023';
  end if;
  v_event_time:=(p_event->>'eventTime')::bigint;
  v_issued_at:=(p_event->>'issuedAt')::bigint;
  if v_event_time<=0 or v_issued_at<=0 then
    raise exception 'APPLE_NOTIFICATION_TIME_INVALID' using errcode='22023';
  end if;
  if v_event_time<1000000000000 then
    v_event_time:=v_event_time*1000;
  end if;
  if v_event_time<1000000000000
    or v_event_time>(v_now_epoch+60)*1000
    or v_issued_at>v_now_epoch+60 then
    raise exception 'APPLE_NOTIFICATION_TIME_INVALID' using errcode='22023';
  end if;
  if v_type in ('email-disabled','email-enabled') then
    if v_email_fingerprint is null or v_email_fingerprint!~'^[0-9a-f]{64}$' then
      raise exception 'APPLE_NOTIFICATION_EMAIL_FINGERPRINT_INVALID' using errcode='22023';
    end if;
  elsif v_email_fingerprint is not null then
    raise exception 'APPLE_NOTIFICATION_EMAIL_FINGERPRINT_UNEXPECTED' using errcode='22023';
  end if;

  select event.payload_hash into v_existing_hash
  from public.apple_notification_events event
  where event.audience=v_audience and event.event_id=v_event_id;
  if found then
    if v_existing_hash<>v_payload_hash then
      raise exception 'APPLE_NOTIFICATION_EVENT_CONFLICT' using errcode='23514';
    end if;
    select subject.privy_user_id is not null into v_matched
    from public.apple_lifecycle_subjects subject where subject.subject_hash=v_subject_hash;
    return pg_catalog.jsonb_build_object(
      'outcome','duplicate','matched',coalesce(v_matched,false)
    );
  end if;

  insert into public.apple_notification_events(
    audience,event_id,payload_hash,event_type,subject_hash,event_time,issued_at
  ) values(v_audience,v_event_id,v_payload_hash,v_type,v_subject_hash,v_event_time,v_issued_at);

  if v_type in ('consent-revoked','account-deleted') then
    v_desired_state:=case when v_type='account-deleted' then 'deleted' else 'revoked' end;
    select subject.credential_state,subject.credential_event_time,subject.privy_user_id
      into v_prior_state,v_prior_time,v_owner
    from public.apple_lifecycle_subjects subject
    where subject.subject_hash=v_subject_hash for update;
    if not found then
      insert into public.apple_lifecycle_subjects(
        subject_hash,credential_state,credential_event_time
      ) values(v_subject_hash,v_desired_state,v_event_time);
      v_applied:=true;
    elsif v_prior_state<>'deleted' and (
      v_event_time>v_prior_time
      or (v_event_time=v_prior_time and v_desired_state='deleted')
    ) then
      update public.apple_lifecycle_subjects
      set credential_state=v_desired_state,credential_event_time=v_event_time,
        updated_at=pg_catalog.now()
      where subject_hash=v_subject_hash;
      v_applied:=true;
      if v_owner is not null then
        update public.apple_auth_owners
        set generation=generation+1,updated_at=pg_catalog.now()
        where privy_user_id=v_owner;
      end if;
    end if;
  else
    insert into public.apple_lifecycle_subjects(
      subject_hash,credential_state,credential_event_time
    ) values(v_subject_hash,'authorized',0)
    on conflict(subject_hash) do nothing;
    select subject.privy_user_id into v_owner
    from public.apple_lifecycle_subjects subject where subject.subject_hash=v_subject_hash;
    select relay.state,relay.event_time into v_prior_relay_state,v_prior_relay_time
    from public.apple_relay_availability relay
    where relay.subject_hash=v_subject_hash
      and relay.destination_fingerprint=v_email_fingerprint for update;
    if not found then
      insert into public.apple_relay_availability(
        subject_hash,destination_fingerprint,state,event_time
      ) values(
        v_subject_hash,v_email_fingerprint,
        case when v_type='email-disabled' then 'disabled' else 'enabled' end,
        v_event_time
      );
      v_applied:=true;
    elsif v_event_time>v_prior_relay_time or (
      v_event_time=v_prior_relay_time and v_type='email-disabled'
        and v_prior_relay_state='enabled'
    ) then
      update public.apple_relay_availability
      set state=case when v_type='email-disabled' then 'disabled' else 'enabled' end,
        event_time=v_event_time,updated_at=pg_catalog.now()
      where subject_hash=v_subject_hash and destination_fingerprint=v_email_fingerprint;
      v_applied:=true;
    end if;
  end if;
  v_matched:=v_owner is not null;
  return pg_catalog.jsonb_build_object(
    'outcome',case when v_applied then 'applied' else 'stale' end,
    'matched',v_matched
  );
end;
$$;

commit;
