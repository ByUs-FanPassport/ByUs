-- Apple account lifecycle notifications are cryptographically verified by the
-- server before these service-only RPCs are called.  One global transaction
-- lock deliberately serializes this low-volume identity control plane so event,
-- mapping, generation, challenge, and grant changes cannot deadlock or split.

create table public.apple_auth_owners (
  privy_user_id text primary key check (
    privy_user_id=btrim(privy_user_id) and length(privy_user_id) between 3 and 255
  ),
  generation bigint not null default 0 check (generation>=0),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.apple_lifecycle_subjects (
  subject_hash text primary key check (subject_hash ~ '^[0-9a-f]{64}$'),
  privy_user_id text references public.apple_auth_owners(privy_user_id) on delete restrict,
  apple_email_fingerprint text check (
    apple_email_fingerprint is null or apple_email_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  credential_state text not null check (credential_state in ('authorized','revoked','deleted')),
  credential_event_time bigint not null check (credential_event_time>=0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create index apple_lifecycle_subjects_owner_idx
  on public.apple_lifecycle_subjects(privy_user_id,credential_state,subject_hash);

create table public.apple_relay_availability (
  subject_hash text not null references public.apple_lifecycle_subjects(subject_hash) on delete restrict,
  destination_fingerprint text not null check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('enabled','disabled')),
  event_time bigint not null check (event_time>0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key(subject_hash,destination_fingerprint)
);

create table public.apple_notification_events (
  audience text not null check (audience in ('kr.byus.web','kr.byus.app')),
  event_id text not null check (
    event_id=btrim(event_id) and length(event_id) between 1 and 256
  ),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  event_type text not null check (
    event_type in ('consent-revoked','account-deleted','email-disabled','email-enabled')
  ),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  event_time bigint not null check (event_time>0),
  issued_at bigint not null check (issued_at>0),
  received_at timestamptz not null default pg_catalog.now(),
  primary key(audience,event_id)
);
create index apple_notification_events_subject_idx
  on public.apple_notification_events(subject_hash,event_time,event_id);

create table public.apple_reauth_challenges (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  cookie_hash text not null check (cookie_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  privy_user_id text not null references public.apple_auth_owners(privy_user_id) on delete restrict,
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('apple','google')),
  provider_subject_hash text not null check (provider_subject_hash ~ '^[0-9a-f]{64}$'),
  owner_generation bigint not null check (owner_generation>=0),
  return_path text not null default '/login' check (
    length(return_path)<=2048
    and return_path !~ E'[\\r\\n]'
    and (return_path='/login' or return_path like '/login?%')
  ),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check (consumed_at is null or consumed_at>=created_at)
);
create index apple_reauth_challenges_expiry_idx
  on public.apple_reauth_challenges(expires_at) where consumed_at is null;

create table public.apple_session_grants (
  privy_user_id text not null references public.apple_auth_owners(privy_user_id) on delete restrict,
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('apple','google')),
  provider_subject_hash text not null check (provider_subject_hash ~ '^[0-9a-f]{64}$'),
  owner_generation bigint not null check (owner_generation>=0),
  created_at timestamptz not null default pg_catalog.now(),
  primary key(privy_user_id,session_hash)
);

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'apple_auth_owners','apple_lifecycle_subjects','apple_relay_availability',
    'apple_notification_events','apple_reauth_challenges','apple_session_grants'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('alter table public.%I force row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',v_table);
  end loop;
end $$;

create trigger apple_notification_events_reject_update_delete
before update or delete on public.apple_notification_events for each row
execute function public.reject_benefit_economy_history_mutation();
create trigger apple_notification_events_reject_truncate
before truncate on public.apple_notification_events for each statement
execute function public.reject_benefit_economy_history_truncate();

create function public.apply_apple_account_notification(p_event jsonb)
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
  if v_event_time<=0 or v_issued_at<=0
    or v_event_time>v_now_epoch+60 or v_issued_at>v_now_epoch+60 then
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

create function public.check_apple_session_access(p_identity jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_privy_user_id text:=p_identity->>'privyUserId';
  v_session_hash text:=p_identity->>'sessionHash';
  v_apple_subject_hash text:=p_identity->>'appleSubjectHash';
  v_apple_email_fingerprint text:=p_identity->>'appleEmailFingerprint';
  v_google_subject_hash text:=p_identity->>'googleSubjectHash';
  v_mapped_owner text;
  v_apple_state text;
  v_generation bigint;
  v_requires_grant boolean;
  v_allowed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('apple-account-lifecycle:v1',0)
  );
  if p_identity is null or pg_catalog.jsonb_typeof(p_identity)<>'object'
    or v_privy_user_id is null or v_privy_user_id<>btrim(v_privy_user_id)
    or length(v_privy_user_id) not between 3 and 255
    or v_session_hash is null or v_session_hash!~'^[0-9a-f]{64}$'
    or (v_apple_subject_hash is not null and v_apple_subject_hash!~'^[0-9a-f]{64}$')
    or (v_apple_email_fingerprint is not null and v_apple_email_fingerprint!~'^[0-9a-f]{64}$')
    or (v_google_subject_hash is not null and v_google_subject_hash!~'^[0-9a-f]{64}$')
    or (v_apple_subject_hash is null and v_apple_email_fingerprint is not null) then
    raise exception 'APPLE_SESSION_IDENTITY_INVALID' using errcode='22023';
  end if;
  insert into public.apple_auth_owners(privy_user_id) values(v_privy_user_id)
  on conflict(privy_user_id) do nothing;

  if v_apple_subject_hash is not null then
    select subject.privy_user_id,subject.credential_state
      into v_mapped_owner,v_apple_state
    from public.apple_lifecycle_subjects subject
    where subject.subject_hash=v_apple_subject_hash for update;
    if not found then
      insert into public.apple_lifecycle_subjects(
        subject_hash,privy_user_id,apple_email_fingerprint,credential_state,credential_event_time
      ) values(v_apple_subject_hash,v_privy_user_id,v_apple_email_fingerprint,'authorized',0);
      v_apple_state:='authorized';
    elsif v_mapped_owner is null then
      update public.apple_lifecycle_subjects
      set privy_user_id=v_privy_user_id,
        apple_email_fingerprint=coalesce(v_apple_email_fingerprint,apple_email_fingerprint),
        updated_at=pg_catalog.now()
      where subject_hash=v_apple_subject_hash;
      if v_apple_state in ('revoked','deleted') then
        update public.apple_auth_owners
        set generation=generation+1,updated_at=pg_catalog.now()
        where privy_user_id=v_privy_user_id;
      end if;
    elsif v_mapped_owner<>v_privy_user_id then
      raise exception 'APPLE_SUBJECT_OWNER_CONFLICT' using errcode='23514';
    else
      update public.apple_lifecycle_subjects
      set apple_email_fingerprint=coalesce(v_apple_email_fingerprint,apple_email_fingerprint),
        updated_at=pg_catalog.now()
      where subject_hash=v_apple_subject_hash;
    end if;
  end if;

  select owner_row.generation into strict v_generation
  from public.apple_auth_owners owner_row where owner_row.privy_user_id=v_privy_user_id;
  select exists(
    select 1 from public.apple_lifecycle_subjects subject
    where subject.privy_user_id=v_privy_user_id
      and subject.credential_state in ('revoked','deleted')
  ) into v_requires_grant;
  v_allowed:=not v_requires_grant;
  if v_requires_grant then
    v_allowed:=exists(
      select 1 from public.apple_session_grants grant_row
      where grant_row.privy_user_id=v_privy_user_id
        and grant_row.session_hash=v_session_hash
        and (
          (grant_row.provider='google'
            and v_google_subject_hash is not null
            and grant_row.provider_subject_hash=v_google_subject_hash)
          or
          (grant_row.provider='apple'
            and v_apple_subject_hash is not null
            and grant_row.provider_subject_hash=v_apple_subject_hash
            and grant_row.owner_generation=v_generation
            and v_apple_state<>'deleted')
        )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'allowed',v_allowed,
    'generation',v_generation,
    'appleState',v_apple_state,
    'appleRecoveryAllowed',v_apple_subject_hash is not null and v_apple_state<>'deleted',
    'googleRecoveryAllowed',v_google_subject_hash is not null
  );
end;
$$;

create function public.create_apple_reauth_challenge(p_challenge jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_state_hash text:=p_challenge->>'stateHash';
  v_cookie_hash text:=p_challenge->>'cookieHash';
  v_nonce_hash text:=p_challenge->>'nonceHash';
  v_privy_user_id text:=p_challenge->>'privyUserId';
  v_session_hash text:=p_challenge->>'sessionHash';
  v_provider text:=p_challenge->>'provider';
  v_provider_subject_hash text:=p_challenge->>'providerSubjectHash';
  v_generation bigint;
  v_current_generation bigint;
  v_expires_at timestamptz;
  v_return_path text:=coalesce(p_challenge->>'returnPath','/login');
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('apple-account-lifecycle:v1',0)
  );
  if p_challenge is null or pg_catalog.jsonb_typeof(p_challenge)<>'object'
    or v_state_hash is null or v_state_hash!~'^[0-9a-f]{64}$'
    or v_cookie_hash is null or v_cookie_hash!~'^[0-9a-f]{64}$'
    or v_nonce_hash is null or v_nonce_hash!~'^[0-9a-f]{64}$'
    or v_privy_user_id is null or v_privy_user_id<>btrim(v_privy_user_id)
    or length(v_privy_user_id) not between 3 and 255
    or v_session_hash is null or v_session_hash!~'^[0-9a-f]{64}$'
    or v_provider not in ('apple','google')
    or v_provider_subject_hash is null or v_provider_subject_hash!~'^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_challenge->'generation')<>'number'
    or (p_challenge->>'generation')!~'^[0-9]+$'
    or pg_catalog.jsonb_typeof(p_challenge->'expiresAt')<>'string'
    or length(v_return_path)>2048 or v_return_path~E'[\\r\\n]'
    or not (v_return_path='/login' or v_return_path like '/login?%') then
    raise exception 'APPLE_REAUTH_CHALLENGE_INVALID' using errcode='22023';
  end if;
  begin
    v_generation:=(p_challenge->>'generation')::bigint;
    v_expires_at:=(p_challenge->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'APPLE_REAUTH_CHALLENGE_INVALID' using errcode='22023';
  end;
  if v_expires_at<=pg_catalog.now() or v_expires_at>pg_catalog.now()+interval '10 minutes' then
    raise exception 'APPLE_REAUTH_CHALLENGE_EXPIRY_INVALID' using errcode='22023';
  end if;
  select owner_row.generation into v_current_generation
  from public.apple_auth_owners owner_row where owner_row.privy_user_id=v_privy_user_id;
  if not found or v_current_generation<>v_generation then
    raise exception 'APPLE_REAUTH_GENERATION_STALE' using errcode='23514';
  end if;
  if v_provider='apple' and not exists(
    select 1 from public.apple_lifecycle_subjects subject
    where subject.subject_hash=v_provider_subject_hash
      and subject.privy_user_id=v_privy_user_id
      and subject.credential_state<>'deleted'
  ) then
    raise exception 'APPLE_REAUTH_SUBJECT_INVALID' using errcode='23514';
  end if;
  if (select count(*) from public.apple_reauth_challenges challenge
      where challenge.privy_user_id=v_privy_user_id
        and challenge.consumed_at is null and challenge.expires_at>pg_catalog.now()
        and challenge.created_at>pg_catalog.now()-interval '10 minutes')>=5 then
    raise exception 'APPLE_REAUTH_CHALLENGE_RATE_LIMITED' using errcode='23514';
  end if;
  insert into public.apple_reauth_challenges(
    state_hash,cookie_hash,nonce_hash,privy_user_id,session_hash,provider,
    provider_subject_hash,owner_generation,return_path,expires_at
  ) values(
    v_state_hash,v_cookie_hash,v_nonce_hash,v_privy_user_id,v_session_hash,v_provider,
    v_provider_subject_hash,v_generation,v_return_path,v_expires_at
  );
  return true;
exception when unique_violation then
  raise exception 'APPLE_REAUTH_STATE_CONFLICT' using errcode='23514';
end;
$$;

create function public.read_apple_reauth_challenge(
  p_state_hash text,p_cookie_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.apple_reauth_challenges%rowtype;
begin
  if p_state_hash is null or p_state_hash!~'^[0-9a-f]{64}$'
    or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$' then
    return null;
  end if;
  select challenge.* into v from public.apple_reauth_challenges challenge
  where challenge.state_hash=p_state_hash and challenge.cookie_hash=p_cookie_hash
    and challenge.consumed_at is null and challenge.expires_at>pg_catalog.now();
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'nonceHash',v.nonce_hash,'privyUserId',v.privy_user_id,
    'sessionHash',v.session_hash,'provider',v.provider,
    'providerSubjectHash',v.provider_subject_hash,'generation',v.owner_generation,
    'returnPath',v.return_path
  );
end;
$$;

create function public.complete_apple_reauthentication(
  p_state_hash text,p_cookie_hash text,p_provider_subject_hash text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v public.apple_reauth_challenges%rowtype;
  v_current_generation bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('apple-account-lifecycle:v1',0)
  );
  if p_state_hash is null or p_state_hash!~'^[0-9a-f]{64}$'
    or p_cookie_hash is null or p_cookie_hash!~'^[0-9a-f]{64}$'
    or p_provider_subject_hash is null or p_provider_subject_hash!~'^[0-9a-f]{64}$' then
    return false;
  end if;
  select challenge.* into v from public.apple_reauth_challenges challenge
  where challenge.state_hash=p_state_hash for update;
  if not found or v.cookie_hash<>p_cookie_hash or v.consumed_at is not null
    or v.expires_at<=pg_catalog.now() or v.provider_subject_hash<>p_provider_subject_hash then
    return false;
  end if;
  select owner_row.generation into v_current_generation
  from public.apple_auth_owners owner_row where owner_row.privy_user_id=v.privy_user_id;
  if not found or v_current_generation<>v.owner_generation then return false; end if;
  if v.provider='apple' and not exists(
    select 1 from public.apple_lifecycle_subjects subject
    where subject.subject_hash=v.provider_subject_hash
      and subject.privy_user_id=v.privy_user_id
      and subject.credential_state<>'deleted'
  ) then return false; end if;
  update public.apple_reauth_challenges set consumed_at=pg_catalog.now()
  where state_hash=v.state_hash and consumed_at is null;
  insert into public.apple_session_grants(
    privy_user_id,session_hash,provider,provider_subject_hash,owner_generation
  ) values(
    v.privy_user_id,v.session_hash,v.provider,v.provider_subject_hash,v.owner_generation
  ) on conflict(privy_user_id,session_hash) do update set
    provider=excluded.provider,
    provider_subject_hash=excluded.provider_subject_hash,
    owner_generation=excluded.owner_generation,
    created_at=excluded.created_at;
  return true;
end;
$$;

-- Preserve the complete existing raffle-aware eligibility chain and add only
-- Apple private-relay suppression.  Apple events never mutate user consent or
-- channel state.
alter function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  rename to email_notification_delivery_is_eligible_apple_lifecycle_base;
create function public.email_notification_delivery_is_eligible(
  p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible_apple_lifecycle_base(
    p_notification_id,p_channel_id,p_at
  ) and not exists(
    select 1
    from public.fan_notification_channels channel
    join public.app_users app_user on app_user.id=channel.app_user_id
    join public.apple_lifecycle_subjects subject
      on subject.privy_user_id=app_user.privy_user_id
    where channel.id=p_channel_id and channel.kind='email'
      and (
        channel.destination_fingerprint=subject.apple_email_fingerprint
        or exists(
          select 1 from public.apple_relay_availability relay_match
          where relay_match.subject_hash=subject.subject_hash
            and relay_match.destination_fingerprint=channel.destination_fingerprint
        )
      )
      and (
        subject.credential_state in ('revoked','deleted')
        or exists(
          select 1 from public.apple_relay_availability disabled_relay
          where disabled_relay.subject_hash=subject.subject_hash
            and disabled_relay.destination_fingerprint=channel.destination_fingerprint
            and disabled_relay.state='disabled'
        )
      )
  );
$$;

create function public.apple_email_notification_delivery_is_eligible(
  p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible(
    p_notification_id,p_channel_id,p_at
  );
$$;

-- These pre-existing sender functions were compiled against the renamed
-- eligibility function OID. Rebind their named calls through a new internal
-- entrypoint so claim, fallback, and pre-send revalidation all reach the
-- current wrapper even when PostgreSQL retains an older function dependency.
do $$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz)',
    'public.claim_email_notification_deliveries(text,integer,integer,timestamptz)',
    'public.claim_external_notification_deliveries(text,integer,integer,timestamptz)',
    'public.revalidate_email_notification_delivery(uuid,text,timestamptz)'
  ] loop
    select pg_catalog.replace(
      pg_catalog.pg_get_functiondef(v_signature::regprocedure),
      'public.email_notification_delivery_is_eligible(',
      'public.apple_email_notification_delivery_is_eligible('
    ) into strict v_definition;
    execute v_definition;
  end loop;
end $$;

revoke all on function public.apply_apple_account_notification(jsonb),
  public.check_apple_session_access(jsonb),
  public.create_apple_reauth_challenge(jsonb),
  public.read_apple_reauth_challenge(text,text),
  public.complete_apple_reauthentication(text,text,text),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz),
  public.apple_email_notification_delivery_is_eligible(uuid,uuid,timestamptz),
  public.email_notification_delivery_is_eligible_apple_lifecycle_base(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_apple_account_notification(jsonb),
  public.check_apple_session_access(jsonb),
  public.create_apple_reauth_challenge(jsonb),
  public.read_apple_reauth_challenge(text,text),
  public.complete_apple_reauthentication(text,text,text),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  to service_role;

comment on function public.apply_apple_account_notification(jsonb) is
  'Service-only persistence for server-verified Apple lifecycle notification claims.';
comment on function public.check_apple_session_access(jsonb) is
  'Service-only session gate over server-verified current Privy identities; never deletes accounts, wallets, or provider records.';
