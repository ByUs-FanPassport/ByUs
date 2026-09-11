-- Phone provenance, consent and delivery attempts are separate facts.
-- No UPDATE/DELETE/claim in this migration targets existing Email deliveries.
alter table public.fan_notification_channels
  add column verification_method text,
  add column enrollment_generation uuid,
  add column kakao_subject_hash text;
alter table public.fan_notification_channels add constraint kakao_phone_verification_shape check (
  verification_method is null or (kind='kakao'
    and verification_method='kakao_profile_owner_confirmation'
    and enrollment_generation is not null and kakao_subject_hash~'^[a-f0-9]{64}$')
);
alter table public.kakao_connection_states
  add column purpose text not null default 'connection' check(purpose in('connection','alimtalk')),
  add column consent_version text,
  add column consented_at timestamptz,
  add column phone_staged_at timestamptz;
create table public.kakao_phone_enrollments (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null unique references public.app_users(id) on delete restrict,
  state_hash text not null unique references public.kakao_connection_states(state_hash) on delete restrict,
  subject_hash text not null check(subject_hash~'^[a-f0-9]{64}$'),
  phone text not null check(phone~'^010[0-9]{8}$'),
  consent_version text not null check(consent_version='kakao-alimtalk-v1'),
  consented_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null
);
alter table public.kakao_phone_enrollments enable row level security;
alter table public.kakao_phone_enrollments force row level security;
revoke all on public.kakao_phone_enrollments from public,anon,authenticated,service_role;

-- All enrollment, withdrawal and send authorization mutations lock the owner
-- first. This internal helper is never a client-facing RPC.
create function public.lock_kakao_notification_owner(p_app_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  select status::text into v_status from public.app_users where id=p_app_user_id for update;
  if not found or v_status<>'active' then raise exception 'KAKAO_OWNER_UNAVAILABLE'; end if;
end $$;

create function public.invalidate_kakao_notification_destination(p_app_user_id uuid,p_cancel_states boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare v public.fan_notification_channels%rowtype;
begin
  -- Called while holding the owner row, including account-disable triggers.
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  if p_cancel_states then
    update public.kakao_connection_states set expires_at=least(expires_at,pg_catalog.now()),
      consumed_at=coalesce(consumed_at,pg_catalog.now())
    where app_user_id=p_app_user_id and purpose='alimtalk' and phone_staged_at is null;
  end if;
  for v in select * from public.fan_notification_channels
    where app_user_id=p_app_user_id and kind='kakao' for update
  loop
    if v.consented_at is not null and v.consent_revoked_at is null then
      insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version)
        values(v.id,p_app_user_id,false,coalesce(v.consent_version,'kakao-alimtalk-v1'));
    end if;
    delete from public.fan_notification_channel_private where channel_id=v.id;
    update public.fan_notification_channels set status='disabled',verified_at=null,
      consent_revoked_at=coalesce(consent_revoked_at,pg_catalog.now()),
      verification_method=null,enrollment_generation=null,kakao_subject_hash=null,
      destination_label='Kakao',
      destination_fingerprint=encode(extensions.digest('kakao-withdrawn:'||id::text,'sha256'),'hex'),
      updated_at=pg_catalog.now() where id=v.id;
  end loop;
end $$;

-- Wrap the existing connection completion/disconnection behavior so its return
-- contract is retained while owner locking and destination revocation are added.
alter function public.complete_owned_kakao_connection(uuid,text,timestamptz)
  rename to complete_owned_kakao_connection_before_alimtalk;
create function public.complete_owned_kakao_connection(p_app_user_id uuid,p_subject_hash text,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.fan_connected_accounts%rowtype;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into v from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' for update;
  if found and (v.status<>'connected' or v.provider_subject_hash is distinct from p_subject_hash) then
    -- Revoke the prior destination, but preserve the already-consumed fresh
    -- OAuth state that is about to stage this new subject.
    perform public.invalidate_kakao_notification_destination(p_app_user_id,false);
  end if;
  return public.complete_owned_kakao_connection_before_alimtalk(p_app_user_id,p_subject_hash,p_now);
end $$;

-- Old test-sink proofs never inherit production phone verification metadata.
alter function public.enroll_owned_kakao_notification_channel(uuid,text,text,text,text,timestamptz)
  rename to enroll_owned_kakao_notification_channel_before_alimtalk;
create function public.enroll_owned_kakao_notification_channel(
  p_app_user_id uuid,p_proof_hash text,p_recipient_key text,p_destination_label text,p_consent_version text,
  p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  v_result:=public.enroll_owned_kakao_notification_channel_before_alimtalk(
    p_app_user_id,p_proof_hash,p_recipient_key,p_destination_label,p_consent_version,p_now);
  update public.fan_notification_channels set verification_method=null,enrollment_generation=null,kakao_subject_hash=null
    where app_user_id=p_app_user_id and kind='kakao';
  return v_result;
end $$;

alter function public.disconnect_owned_kakao_connection(uuid,timestamptz)
  rename to disconnect_owned_kakao_connection_before_alimtalk;
create function public.disconnect_owned_kakao_connection(p_app_user_id uuid,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  perform 1 from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' for update;
  v_result:=public.disconnect_owned_kakao_connection_before_alimtalk(p_app_user_id,p_now);
  perform public.invalidate_kakao_notification_destination(p_app_user_id);
  return v_result;
end $$;

create function public.revoke_disabled_owner_kakao_destination()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status::text<>'active' and old.status is distinct from new.status then
    perform public.invalidate_kakao_notification_destination(new.id);
  end if;
  return new;
end $$;
create trigger app_user_revoke_kakao_destination after update of status on public.app_users
  for each row execute function public.revoke_disabled_owner_kakao_destination();

create function public.create_owned_kakao_alimtalk_state(
  p_app_user_id uuid,p_state_hash text,p_code_verifier text,p_return_path text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  if (select count(*) from public.kakao_connection_states where app_user_id=p_app_user_id
    and purpose='alimtalk' and created_at>pg_catalog.now()-interval '10 minutes')>=5 then
    raise exception 'KAKAO_ENROLLMENT_RATE_LIMIT';
  end if;
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  update public.kakao_connection_states set expires_at=least(expires_at,pg_catalog.now()),
    consumed_at=coalesce(consumed_at,pg_catalog.now())
    where app_user_id=p_app_user_id and purpose='alimtalk';
  perform public.create_owned_kakao_connection_state(p_app_user_id,p_state_hash,p_code_verifier,p_return_path);
  update public.kakao_connection_states set purpose='alimtalk',consent_version='kakao-alimtalk-v1',
    consented_at=pg_catalog.now() where state_hash=p_state_hash and app_user_id=p_app_user_id;
  return true;
end $$;

create or replace function public.consume_owned_kakao_connection_state(
  p_app_user_id uuid,p_state_hash text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.kakao_connection_states%rowtype;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into v from public.kakao_connection_states where state_hash=p_state_hash for update;
  if not found or v.app_user_id<>p_app_user_id then raise exception 'PHASE5_KAKAO_STATE_NOT_OWNED'; end if;
  if v.consumed_at is not null then raise exception 'PHASE5_KAKAO_STATE_REPLAY'; end if;
  if p_now>=v.expires_at then raise exception 'PHASE5_KAKAO_STATE_EXPIRED'; end if;
  update public.kakao_connection_states set consumed_at=p_now where id=v.id;
  return jsonb_build_object('codeVerifier',v.code_verifier,'returnPath',v.return_path,
    'purpose',v.purpose,'consentVersion',v.consent_version);
end $$;

create function public.stage_owned_kakao_phone_enrollment(
  p_app_user_id uuid,p_state_hash text,p_subject_hash text,p_phone text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state public.kakao_connection_states%rowtype; v public.kakao_phone_enrollments%rowtype;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  perform 1 from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao'
    and status='connected' and provider_subject_hash=p_subject_hash for update;
  if not found or p_phone is null or p_phone!~'^010[0-9]{8}$' then raise exception 'KAKAO_PHONE_ACCOUNT_UNAVAILABLE'; end if;
  select * into v_state from public.kakao_connection_states where state_hash=p_state_hash for update;
  if not found or v_state.app_user_id<>p_app_user_id or v_state.purpose<>'alimtalk'
    or v_state.consented_at is null or v_state.consent_version<>'kakao-alimtalk-v1'
    or v_state.consumed_at is null or v_state.phone_staged_at is not null
    or v_state.expires_at<=pg_catalog.now() then raise exception 'KAKAO_PHONE_STATE_INVALID'; end if;
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  insert into public.kakao_phone_enrollments(app_user_id,state_hash,subject_hash,phone,consent_version,consented_at,expires_at)
    values(p_app_user_id,p_state_hash,p_subject_hash,p_phone,'kakao-alimtalk-v1',v_state.consented_at,v_state.expires_at)
    returning * into v;
  update public.kakao_connection_states set phone_staged_at=pg_catalog.now() where id=v_state.id;
  return jsonb_build_object('id',v.id,'destinationLabel','010-****-'||right(v.phone,4),'expiresAt',v.expires_at);
end $$;

create function public.get_owned_kakao_phone_enrollment(p_app_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',pending.id,'destinationLabel','010-****-'||right(pending.phone,4),'expiresAt',pending.expires_at)
  from public.kakao_phone_enrollments pending
  join public.app_users owner on owner.id=pending.app_user_id and owner.status='active'
  join public.fan_connected_accounts account on account.app_user_id=owner.id and account.provider='kakao'
    and account.status='connected' and account.provider_subject_hash=pending.subject_hash
  where pending.app_user_id=p_app_user_id and pending.expires_at>pg_catalog.now()
$$;

create function public.confirm_owned_kakao_phone_enrollment(
  p_app_user_id uuid,p_enrollment_id uuid,p_consent_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.kakao_phone_enrollments%rowtype; c public.fan_notification_channels%rowtype; v_subject text;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select provider_subject_hash into v_subject from public.fan_connected_accounts
    where app_user_id=p_app_user_id and provider='kakao' and status='connected' for update;
  if not found then raise exception 'KAKAO_PHONE_ACCOUNT_UNAVAILABLE'; end if;
  select * into v from public.kakao_phone_enrollments where id=p_enrollment_id for update;
  if not found or v.app_user_id<>p_app_user_id or v.subject_hash<>v_subject or v.expires_at<=pg_catalog.now()
    or p_consent_version is distinct from 'kakao-alimtalk-v1' then raise exception 'KAKAO_PHONE_CONFIRMATION_INVALID'; end if;
  insert into public.kakao_notification_enrollment_proofs(proof_hash,app_user_id,consumed_at)
    values(encode(extensions.digest(v.id::text,'sha256'),'hex'),p_app_user_id,pg_catalog.now());
  insert into public.fan_notification_channels(app_user_id,kind,status,consent_version,consented_at,
    destination_fingerprint,destination_label,verified_at,priority,verification_method,enrollment_generation,kakao_subject_hash)
  values(p_app_user_id,'kakao','eligible','kakao-alimtalk-v1',pg_catalog.now(),
    encode(extensions.digest(v.phone,'sha256'),'hex'),'010-****-'||right(v.phone,4),pg_catalog.now(),100,
    'kakao_profile_owner_confirmation',v.id,v.subject_hash)
  on conflict(app_user_id,kind) do update set status='eligible',consent_version=excluded.consent_version,
    consented_at=excluded.consented_at,consent_revoked_at=null,destination_fingerprint=excluded.destination_fingerprint,
    destination_label=excluded.destination_label,verified_at=excluded.verified_at,verification_method=excluded.verification_method,
    enrollment_generation=excluded.enrollment_generation,kakao_subject_hash=excluded.kakao_subject_hash,updated_at=pg_catalog.now()
  returning * into c;
  insert into public.fan_notification_channel_private(channel_id,destination)
    values(c.id,v.phone) on conflict(channel_id) do update set destination=excluded.destination,updated_at=pg_catalog.now();
  insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version)
    values(c.id,p_app_user_id,true,'kakao-alimtalk-v1');
  delete from public.kakao_phone_enrollments where id=v.id;
  return jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'consented',true,
    'destinationLabel',c.destination_label,'verifiedAt',c.verified_at);
end $$;

create function public.cancel_owned_kakao_phone_enrollment(p_app_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  update public.kakao_connection_states set expires_at=least(expires_at,pg_catalog.now()),
    consumed_at=coalesce(consumed_at,pg_catalog.now()) where app_user_id=p_app_user_id and purpose='alimtalk';
  return true;
end $$;

alter function public.set_owned_notification_channel_consent(uuid,uuid,boolean,text,timestamptz)
  rename to set_owned_notification_channel_consent_before_alimtalk;
create function public.set_owned_notification_channel_consent(
  p_app_user_id uuid,p_channel_id uuid,p_consented boolean,p_consent_version text,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.fan_notification_channels%rowtype;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into c from public.fan_notification_channels where id=p_channel_id and app_user_id=p_app_user_id;
  if not found then raise exception 'PHASE5_NOTIFICATION_CHANNEL_NOT_OWNED'; end if;
  if c.kind='email' then return public.set_owned_notification_channel_consent_before_alimtalk(p_app_user_id,p_channel_id,p_consented,p_consent_version,p_now); end if;
  if p_consented is distinct from false then raise exception 'KAKAO_FRESH_ENROLLMENT_REQUIRED'; end if;
  perform 1 from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' for update;
  perform public.invalidate_kakao_notification_destination(p_app_user_id);
  select * into c from public.fan_notification_channels where id=p_channel_id;
  return jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'consented',false,
    'destinationLabel',c.destination_label,'verifiedAt',c.verified_at);
end $$;

-- Exact provider registrations independently verified 2026-09-11. The rejected
-- digital-delivered template is deliberately absent. Locale is never coerced.
create function public.kakao_alimtalk_template_id(p_kind text,p_payload jsonb,p_locale text)
returns text language sql immutable set search_path='' as $$
  select case when p_locale='ko' then case p_kind
    when 'live_reserved' then 'KA01TP260907033445072mn78mTsLaVg'
    when 'live_24h' then 'KA01TP260907034017949sLbNPkQLGBs'
    when 'live_10m' then 'KA01TP260907034304115ByqnnAhlCoc'
    when 'live_changed' then 'KA01TP260907034426918n2VAUyqbqv0'
    when 'live_cancelled' then 'KA01TP260907034513012XiUpGjJ4bQU'
    when 'benefit_won' then 'KA01TP260907034548427ueVqEj03Jn9'
    when 'recipient_information_required' then 'KA01TP260907034624117IQ9ntqowc3u'
    when 'fulfillment_meaningful_update' then case p_payload#>>'{context,fulfillmentStatus}'
      when 'shipping_in_transit' then 'KA01TP260907034658771D6kucvQvlwr'
      when 'shipping_completed' then 'KA01TP260907034727320h5IICVSvdTi'
      when 'pickup_available' then 'KA01TP260907034757052KImeu1gLE8v'
      when 'pickup_completed' then 'KA01TP260907034829220P6ks9Ph30oV'
    end
  end end
$$;

alter table public.external_notification_delivery_outbox add column kakao_enrollment_generation uuid;
create function public.snapshot_kakao_notification_enrollment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.channel='kakao' then
    select enrollment_generation into new.kakao_enrollment_generation
      from public.fan_notification_channels where id=new.channel_id;
  end if;
  return new;
end $$;
create trigger external_notification_snapshot_kakao_enrollment before insert on public.external_notification_delivery_outbox
  for each row execute function public.snapshot_kakao_notification_enrollment();

create table public.kakao_notification_attempts (
  delivery_id uuid primary key references public.external_notification_delivery_outbox(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  channel_id uuid not null references public.fan_notification_channels(id) on delete restrict,
  attempt_token uuid not null,
  status text not null check(status in('prepared','sending','accepted','unknown','delivered','failed','suppressed')),
  template_id text,
  profile_id text not null default 'KA01PF260907031546722DH51U2gFGrk',
  destination_fingerprint text check(destination_fingerprint is null or destination_fingerprint~'^[a-f0-9]{64}$'),
  subject_hash text,
  enrollment_generation uuid,
  consented_at timestamptz,
  payload jsonb not null,
  payload_fingerprint text not null check(payload_fingerprint~'^[a-f0-9]{64}$'),
  request_hash text check(request_hash is null or request_hash~'^[a-f0-9]{64}$'),
  lease_expires_at timestamptz not null,
  sending_at timestamptz,
  provider_message_id text check(provider_message_id is null or provider_message_id~'^[A-Za-z0-9_-]{2,128}$'),
  group_id text check(group_id is null or group_id~'^[A-Za-z0-9_-]{2,128}$'),
  provider_status_code text check(provider_status_code is null or provider_status_code~'^[0-9]{4}$'),
  error_code text check(error_code is null or error_code~'^[A-Z0-9_]{1,80}$'),
  next_reconcile_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  delivered_at timestamptz,
  check(status not in('prepared','sending','accepted','delivered') or
    (template_id is not null and enrollment_generation is not null and subject_hash is not null and consented_at is not null)),
  check(status not in('accepted','delivered') or (provider_message_id is not null and group_id is not null))
);
create unique index kakao_attempt_provider_message_id_key on public.kakao_notification_attempts(provider_message_id) where provider_message_id is not null;
create index kakao_attempt_reconciliation_due on public.kakao_notification_attempts(next_reconcile_at)
  where status in('sending','accepted','unknown') and provider_message_id is not null;
alter table public.kakao_notification_attempts enable row level security;
alter table public.kakao_notification_attempts force row level security;
revoke all on public.kakao_notification_attempts from public,anon,authenticated,service_role;

create function public.protect_kakao_attempt_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'UPDATE' then raise exception 'KAKAO_ATTEMPT_HISTORY_IMMUTABLE'; end if;
  if row(new.delivery_id,new.app_user_id,new.channel_id,new.template_id,new.profile_id,new.destination_fingerprint,
    new.subject_hash,new.enrollment_generation,new.consented_at,new.payload,new.payload_fingerprint,new.created_at)
    is distinct from row(old.delivery_id,old.app_user_id,old.channel_id,old.template_id,old.profile_id,old.destination_fingerprint,
    old.subject_hash,old.enrollment_generation,old.consented_at,old.payload,old.payload_fingerprint,old.created_at) then
    raise exception 'KAKAO_ATTEMPT_SNAPSHOT_IMMUTABLE';
  end if;
  if old.sending_at is not null and row(new.attempt_token,new.request_hash,new.sending_at)
    is distinct from row(old.attempt_token,old.request_hash,old.sending_at) then
    raise exception 'KAKAO_SEND_AUTHORIZATION_IMMUTABLE';
  end if;
  if old.status in('delivered','failed','suppressed') and new.status<>old.status then
    raise exception 'KAKAO_ATTEMPT_TERMINAL';
  end if;
  return new;
end $$;
create trigger kakao_attempt_snapshot_immutable before update or delete on public.kakao_notification_attempts
  for each row execute function public.protect_kakao_attempt_snapshot();
create trigger kakao_attempt_no_truncate before truncate on public.kakao_notification_attempts
  for each statement execute function public.reject_benefit_economy_history_truncate();

create function public.kakao_notification_payload(p_notification_id uuid,p_locale text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when payload->>'deepLink' is not null and pg_catalog.strpos(payload->>'deepLink','?')=0
    then pg_catalog.jsonb_set(payload,'{deepLink}',pg_catalog.to_jsonb((payload->>'deepLink')||'?locale=ko'),false)
    else payload end
  from (select coalesce(public.build_external_notification_payload(p_notification_id,p_locale),'{}'::jsonb) payload) built
$$;

create function public.kakao_notification_current_state_is_eligible(
  p_notification_id uuid,p_at timestamptz default pg_catalog.now()
) returns boolean language sql stable security definer set search_path='' as $$
  select notification.scheduled_for<=p_at
    and notification.superseded_at is null
    and owner.status='active'
    and notification.kind::text in(
      'live_reserved','live_24h','live_10m','live_changed','live_cancelled',
      'benefit_won','recipient_information_required','fulfillment_meaningful_update')
    and case
      when notification.kind::text in('live_reserved','live_changed') then
        coalesce(preference.live_reminders,true)
        and live.publication_status='published' and live.archived_at is null
        and public.live_effective_status_at(live.id,p_at)='scheduled'
        and notification.source_key='live:'||live.id::text||':schedule:'||live.schedule_revision::text||':'||
          case notification.kind::text when 'live_reserved' then 'reserved' else 'changed' end
        and exists(select 1 from public.live_reservations reservation
          where reservation.app_user_id=notification.app_user_id and reservation.live_event_id=live.id)
      when notification.kind::text in('live_24h','live_10m') then
        coalesce(preference.live_reminders,true)
        and live.publication_status='published' and live.archived_at is null
        and public.live_effective_status_at(live.id,p_at)='scheduled'
        and notification.source_key='live:'||live.id::text||':schedule:'||live.schedule_revision::text||':'||
          case notification.kind::text when 'live_24h' then '24h' else '10m' end
      when notification.kind::text='live_cancelled' then
        coalesce(preference.live_reminders,true)
        and live.publication_status='published' and live.archived_at is null
        and public.live_effective_status_at(live.id,p_at)='cancelled'
        and notification.source_key='live:'||live.id::text||':schedule:'||live.schedule_revision::text||':cancelled'
        and exists(select 1 from public.live_reservations reservation
          where reservation.app_user_id=notification.app_user_id and reservation.live_event_id=live.id)
      when notification.kind::text='benefit_won' then
        coalesce(preference.benefit_notifications,true)
        and benefit.publication_status='published' and benefit.archived_at is null
        and exists(select 1 from public.benefit_draw_winners winner
          join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
          where winner.app_user_id=notification.app_user_id and winner.benefit_id=notification.benefit_id
            and notification.source_key='benefit_won:'||winner.id::text||':1')
      when notification.kind::text='recipient_information_required' then
        coalesce(preference.benefit_notifications,true)
        and benefit.publication_status='published' and benefit.archived_at is null
        and exists(select 1 from public.benefit_draw_winners winner
          join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
          join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
          where winner.app_user_id=notification.app_user_id and winner.benefit_id=notification.benefit_id
            and fulfillment.status='information_required' and fulfillment.claim_disposition='active'
            and not exists(select 1 from public.benefit_recipient_private recipient where recipient.winner_id=winner.id)
            and (notification.source_key='recipient_information_required:'||winner.id::text||':'||fulfillment.revision::text
              or (fulfillment.recipient_deadline_at>p_at and notification.source_key=public.benefit_recipient_reminder_source_key(
                winner.id,fulfillment.fulfillment_policy_version,fulfillment.recipient_deadline_at))))
      when notification.kind::text='fulfillment_meaningful_update' then
        coalesce(preference.benefit_notifications,true)
        and benefit.publication_status='published' and benefit.archived_at is null
        and notification.payload->>'fulfillmentStatus' in(
          'shipping_in_transit','shipping_completed','pickup_available','pickup_completed')
        and exists(select 1 from public.benefit_draw_winners winner
          join public.benefit_draw_publications publication on publication.draw_id=winner.draw_id
          join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
          left join public.benefit_fulfillment_events event on event.fulfillment_id=fulfillment.id
            and notification.source_key='fulfillment_meaningful_update:'||event.fulfillment_id::text||':'||event.id::text
          where winner.app_user_id=notification.app_user_id and winner.benefit_id=notification.benefit_id
            and fulfillment.status::text=notification.payload->>'fulfillmentStatus'
            and (event.id is not null or notification.source_key=
              'fulfillment_meaningful_update:'||fulfillment.id::text||':'||fulfillment.revision::text))
      else false
    end
  from public.fan_notifications notification
  join public.app_users owner on owner.id=notification.app_user_id
  left join public.notification_preferences preference on preference.app_user_id=notification.app_user_id
  left join public.live_events live on live.id=notification.live_event_id
  left join public.benefits benefit on benefit.id=notification.benefit_id
  where notification.id=p_notification_id
$$;

create function public.kakao_notification_delivery_is_eligible(p_delivery_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.external_notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    join public.app_users owner on owner.id=notification.app_user_id and owner.status='active'
    join public.fan_notification_channels channel on channel.id=delivery.channel_id and channel.app_user_id=owner.id
    join public.fan_notification_channel_private private on private.channel_id=channel.id
    join public.fan_connected_accounts account on account.app_user_id=owner.id and account.provider='kakao'
    where delivery.id=p_delivery_id and delivery.channel='kakao' and channel.kind='kakao'
      and channel.status='eligible' and channel.verification_method='kakao_profile_owner_confirmation'
      and channel.enrollment_generation=delivery.kakao_enrollment_generation
      and channel.verified_at is not null and channel.consented_at is not null and channel.consent_revoked_at is null
      and channel.consent_version='kakao-alimtalk-v1'
      and account.status='connected' and account.provider_subject_hash=channel.kakao_subject_hash
      and private.destination~'^010[0-9]{8}$'
      and encode(extensions.digest(private.destination,'sha256'),'hex')=channel.destination_fingerprint
      and public.kakao_alimtalk_template_id(delivery.template_key,
        public.build_external_notification_payload(notification.id,delivery.locale),delivery.locale) is not null
      and public.notification_delivery_is_eligible(notification.id,p_at)
      and public.kakao_notification_current_state_is_eligible(notification.id,p_at)
  )
$$;

create function public.maintain_kakao_notification_deliveries()
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.kakao_phone_enrollments where expires_at<=pg_catalog.now();
  update public.kakao_notification_attempts set status='unknown',error_code='SOLAPI_SEND_OUTCOME_UNKNOWN',updated_at=pg_catalog.now()
    where status='sending' and lease_expires_at<=pg_catalog.now();
end $$;

create function public.claim_kakao_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)
returns table(id uuid,attempt_token uuid,notification_id uuid,template_key text,locale text,destination text,
  payload jsonb,template_id text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare d public.external_notification_delivery_outbox%rowtype; c public.fan_notification_channels%rowtype;
  a public.kakao_notification_attempts%rowtype; v_payload jsonb; v_template text; v_owner uuid; v_eligible boolean;
begin
  if p_worker_id is null or length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size is null or p_batch_size not between 1 and 2
    or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then raise exception 'KAKAO_CLAIM_INVALID'; end if;
  for d in select delivery.* from public.external_notification_delivery_outbox delivery
    left join public.kakao_notification_attempts attempt on attempt.delivery_id=delivery.id
    where delivery.channel='kakao' and delivery.available_at<=pg_catalog.now()
      and (delivery.status in('pending','failed') or (delivery.status='processing' and delivery.lease_expires_at<=pg_catalog.now()))
      and (attempt.delivery_id is null or (attempt.status='prepared' and attempt.lease_expires_at<=pg_catalog.now()))
    order by delivery.available_at,delivery.id for update of delivery skip locked limit p_batch_size
  loop
    select * into strict c from public.fan_notification_channels where public.fan_notification_channels.id=d.channel_id;
    select app_user_id into strict v_owner from public.fan_notifications where public.fan_notifications.id=d.notification_id;
    v_payload:=public.kakao_notification_payload(d.notification_id,d.locale);
    v_template:=public.kakao_alimtalk_template_id(d.template_key,v_payload,d.locale);
    v_eligible:=public.kakao_notification_delivery_is_eligible(d.id);
    insert into public.kakao_notification_attempts(delivery_id,app_user_id,channel_id,attempt_token,status,template_id,
      destination_fingerprint,subject_hash,enrollment_generation,consented_at,payload,payload_fingerprint,lease_expires_at,error_code)
    values(d.id,v_owner,d.channel_id,extensions.gen_random_uuid(),case when v_eligible then 'prepared' else 'suppressed' end,v_template,
      c.destination_fingerprint,c.kakao_subject_hash,c.enrollment_generation,c.consented_at,v_payload,
      encode(extensions.digest(v_payload::text,'sha256'),'hex'),pg_catalog.now()+make_interval(secs=>p_lease_seconds),
      case when not v_eligible then 'KAKAO_NOT_ELIGIBLE' end)
    on conflict(delivery_id) do update set attempt_token=excluded.attempt_token,
      lease_expires_at=excluded.lease_expires_at,updated_at=pg_catalog.now(),
      status=case when v_eligible then 'prepared' else 'suppressed' end,
      error_code=case when not v_eligible then 'KAKAO_NOT_ELIGIBLE' end
      where public.kakao_notification_attempts.status='prepared' and public.kakao_notification_attempts.sending_at is null
    returning * into a;
    if not found then continue; end if;
    if not v_eligible then
      update public.external_notification_delivery_outbox set status='failed',available_at='infinity',last_error_code='KAKAO_NOT_ELIGIBLE',
        lease_owner=null,lease_expires_at=null,updated_at=pg_catalog.now() where public.external_notification_delivery_outbox.id=d.id;
      update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now() where public.notification_delivery_plans.id=d.plan_id;
      continue;
    end if;
    update public.external_notification_delivery_outbox set status='processing',lease_owner=p_worker_id,
      lease_expires_at=a.lease_expires_at,last_error_code=null,updated_at=pg_catalog.now()
      where public.external_notification_delivery_outbox.id=d.id;
    id:=d.id; attempt_token:=a.attempt_token; notification_id:=d.notification_id; template_key:=d.template_key;
    locale:=d.locale; payload:=a.payload; template_id:=a.template_id; lease_expires_at:=a.lease_expires_at;
    select private.destination into destination from public.fan_notification_channel_private private where private.channel_id=d.channel_id;
    return next;
  end loop;
end $$;

create function public.record_kakao_notification_submission(
  p_delivery_id uuid,p_attempt_token uuid,p_outcome text,p_provider_message_id text,
  p_group_id text,p_error_code text
) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.kakao_notification_attempts%rowtype; d public.external_notification_delivery_outbox%rowtype;
begin
  if p_outcome is null or p_outcome not in('accepted','rejected','unknown','suppressed')
    or (p_provider_message_id is not null and p_provider_message_id!~'^[A-Za-z0-9_-]{2,128}$')
    or (p_group_id is not null and p_group_id!~'^[A-Za-z0-9_-]{2,128}$')
    or (p_error_code is not null and p_error_code!~'^[A-Z0-9_]{1,80}$') then
    raise exception 'KAKAO_SUBMISSION_RESULT_INVALID';
  end if;
  select * into a from public.kakao_notification_attempts where delivery_id=p_delivery_id for update;
  if not found or a.attempt_token is distinct from p_attempt_token then return false; end if;
  select * into d from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if not found then return false; end if;
  if p_provider_message_id is not null and exists(select 1 from public.kakao_notification_attempts other
    where other.provider_message_id=p_provider_message_id and other.delivery_id<>p_delivery_id) then
    raise exception 'KAKAO_PROVIDER_MESSAGE_ID_CONFLICT';
  end if;
  if a.provider_message_id is not null and a.provider_message_id is distinct from p_provider_message_id then return false; end if;
  if a.group_id is not null and a.group_id is distinct from p_group_id then return false; end if;

  if a.status in('delivered','failed','suppressed') then
    return (a.status='delivered' and p_outcome in('accepted','unknown')
      and (p_provider_message_id is null or a.provider_message_id=p_provider_message_id))
      or a.status=p_outcome;
  end if;
  if a.status='accepted' then
    if p_outcome='unknown' then return true; end if;
    return p_outcome='accepted' and a.provider_message_id=p_provider_message_id and a.group_id=p_group_id;
  end if;

  if p_outcome='suppressed' then
    if a.status<>'prepared' or a.sending_at is not null or p_provider_message_id is not null or p_group_id is not null then return false; end if;
    update public.kakao_notification_attempts set status='suppressed',error_code=coalesce(p_error_code,'KAKAO_PAYLOAD_SUPPRESSED'),
      next_reconcile_at='infinity',updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
    update public.external_notification_delivery_outbox set status='failed',available_at='infinity',last_error_code=coalesce(p_error_code,'KAKAO_PAYLOAD_SUPPRESSED'),
      lease_owner=null,lease_expires_at=null,updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now()
      where id=d.plan_id and status='pending';
    return true;
  end if;

  -- A maintenance tick may have converted an expired send to unknown before
  -- the HTTP acknowledgement reached the database. Both states retain the
  -- immutable send authorization and may accept this single late ACK.
  if a.status not in('sending','unknown') or a.sending_at is null then return false; end if;
  if p_outcome='accepted' then
    if p_provider_message_id is null or p_group_id is null or p_error_code is not null then return false; end if;
    update public.kakao_notification_attempts set status='accepted',provider_message_id=p_provider_message_id,
      group_id=p_group_id,error_code=null,next_reconcile_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where delivery_id=p_delivery_id;
  elsif p_outcome='unknown' then
    if p_provider_message_id is not null or p_group_id is not null then return false; end if;
    update public.kakao_notification_attempts set status='unknown',
      error_code=coalesce(p_error_code,'SOLAPI_SEND_OUTCOME_UNKNOWN'),updated_at=pg_catalog.now()
      where delivery_id=p_delivery_id;
  else
    if p_provider_message_id is not null or p_group_id is not null then return false; end if;
    update public.kakao_notification_attempts set status='failed',error_code=coalesce(p_error_code,'SOLAPI_PROVIDER_REJECTED'),
      next_reconcile_at='infinity',updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
    update public.external_notification_delivery_outbox set status='failed',available_at='infinity',
      last_error_code=coalesce(p_error_code,'SOLAPI_PROVIDER_REJECTED'),lease_owner=null,lease_expires_at=null,
      updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now()
      where id=d.plan_id and status='pending';
  end if;
  return true;
end $$;

create function public.claim_kakao_notification_reconciliations(p_batch_size integer)
returns table(id uuid,provider_message_id text,group_id text,destination_fingerprint text,template_id text,status text)
language plpgsql security definer set search_path='' as $$
begin
  if p_batch_size is null or p_batch_size not between 1 and 2 then raise exception 'KAKAO_RECONCILIATION_CLAIM_INVALID'; end if;
  return query with due as(
    select attempt.delivery_id from public.kakao_notification_attempts attempt
    where attempt.status in('sending','accepted','unknown') and attempt.provider_message_id is not null
      and attempt.group_id is not null and attempt.destination_fingerprint is not null
      and attempt.template_id is not null and attempt.next_reconcile_at<=pg_catalog.now()
    order by attempt.next_reconcile_at,attempt.delivery_id for update skip locked limit p_batch_size
  ), claimed as(
    update public.kakao_notification_attempts attempt set next_reconcile_at=pg_catalog.now()+interval '60 seconds',
      updated_at=pg_catalog.now() from due where attempt.delivery_id=due.delivery_id returning attempt.*
  )
  select claimed.delivery_id,claimed.provider_message_id,claimed.group_id,claimed.destination_fingerprint,
    claimed.template_id,claimed.status from claimed;
end $$;

create function public.record_kakao_notification_result(
  p_delivery_id uuid,p_provider_message_id text,p_outcome text,p_status_code text
) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.kakao_notification_attempts%rowtype; d public.external_notification_delivery_outbox%rowtype;
begin
  if p_provider_message_id is null or p_provider_message_id!~'^[A-Za-z0-9_-]{2,128}$'
    or p_outcome is null or p_outcome not in('pending','delivered','failed','unknown')
    or (p_status_code is not null and p_status_code!~'^[0-9]{4}$') then
    raise exception 'KAKAO_CANONICAL_RESULT_INVALID';
  end if;
  select * into a from public.kakao_notification_attempts where delivery_id=p_delivery_id for update;
  if not found or a.provider_message_id is distinct from p_provider_message_id then return false; end if;
  select * into d from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if not found then return false; end if;
  if a.status in('delivered','failed','suppressed') then
    return (a.status='delivered' and p_outcome='delivered' and p_status_code='4000')
      or (a.status='failed' and p_outcome='failed' and a.provider_status_code is not distinct from p_status_code);
  end if;
  if a.status not in('sending','accepted','unknown') then return false; end if;

  if p_outcome='delivered' then
    if p_status_code is distinct from '4000' then return false; end if;
    update public.kakao_notification_attempts set status='delivered',provider_status_code='4000',error_code=null,
      delivered_at=pg_catalog.now(),next_reconcile_at='infinity',updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
    update public.external_notification_delivery_outbox set status='sent',sent_at=pg_catalog.now(),
      lease_owner=null,lease_expires_at=null,last_error_code=null,updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='sent',sent_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=d.plan_id and status='pending';
  elsif p_outcome='failed' then
    -- Only codes explicitly published by SOLAPI are evidence of terminal
    -- failure. Unknown four-digit values remain reconcilable unknowns.
    if p_status_code is null or p_status_code <> all(array[
      '1010','1011','1013','1014','1020','1021','1022','1023','1024','1025',
      '1026','1027','1028','1029','1030','1031','1032','1033','1034','1035',
      '1036','1037','1039','1040','1041','1042','1043','1044','1045','1046',
      '1047','1048','1049','1050','1052','1053','1054','1055','1056','1057',
      '1058','1059','1060','1061','1062','1064','1065','1070','1157','1158',
      '1159','2011','2012','2024','2025','2061','2062','2064','2065','2230',
      '2254','3010','3011','3012','3013','3014','3024','3031','3032','3040',
      '3041','3042','3043','3044','3045','3046','3047','3048','3050','3051',
      '3052','3053','3054','3055','3056','3057','3058','3059','3060','3061',
      '3062','3063','3101','3102','3103','3104','3105','3106','3107','3108',
      '3109','3110','3111','3112','3113','3114','3115','3116','3117','3118'
    ]::text[]) then return false; end if;
    update public.kakao_notification_attempts set status='failed',provider_status_code=p_status_code,
      error_code='SOLAPI_FINAL_'||p_status_code,next_reconcile_at='infinity',updated_at=pg_catalog.now()
      where delivery_id=p_delivery_id;
    update public.external_notification_delivery_outbox set status='failed',available_at='infinity',
      last_error_code='SOLAPI_FINAL_'||p_status_code,lease_owner=null,lease_expires_at=null,updated_at=pg_catalog.now()
      where id=p_delivery_id;
    update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now()
      where id=d.plan_id and status='pending';
  elsif p_outcome='pending' then
    if p_status_code is not null and p_status_code not in('2000','3000') then return false; end if;
    update public.kakao_notification_attempts set provider_status_code=p_status_code,
      next_reconcile_at=pg_catalog.now()+interval '60 seconds',updated_at=pg_catalog.now()
      where delivery_id=p_delivery_id;
  else
    if p_status_code is not null then return false; end if;
    update public.kakao_notification_attempts set status='unknown',provider_status_code=null,
      error_code=coalesce(error_code,'SOLAPI_CANONICAL_UNKNOWN'),next_reconcile_at=pg_catalog.now()+interval '60 seconds',
      updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
  end if;
  return true;
end $$;

create function public.record_kakao_notification_receipt(
  p_delivery_id uuid,p_provider_message_id text,p_group_id text
) returns boolean language plpgsql security definer set search_path='' as $$
declare a public.kakao_notification_attempts%rowtype;
begin
  if p_provider_message_id is null or p_provider_message_id!~'^[A-Za-z0-9_-]{2,128}$'
    or p_group_id is null or p_group_id!~'^[A-Za-z0-9_-]{2,128}$' then
    raise exception 'KAKAO_RECEIPT_INVALID';
  end if;
  select * into a from public.kakao_notification_attempts where delivery_id=p_delivery_id for update;
  if not found then return false; end if;
  if exists(select 1 from public.kakao_notification_attempts other
    where other.provider_message_id=p_provider_message_id and other.delivery_id<>p_delivery_id) then
    raise exception 'KAKAO_PROVIDER_MESSAGE_ID_CONFLICT';
  end if;
  if a.provider_message_id is not null or a.group_id is not null then
    return a.provider_message_id=p_provider_message_id and a.group_id=p_group_id;
  end if;
  if a.status not in('sending','accepted','unknown') or a.sending_at is null then return false; end if;
  update public.kakao_notification_attempts set provider_message_id=p_provider_message_id,group_id=p_group_id,
    next_reconcile_at=pg_catalog.now(),updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
  return true;
end $$;

-- Legacy senders are now Email-only. Keep the signature for existing workers,
-- but delegate the entire claim to the current consent-aware Email function.
create or replace function public.claim_external_notification_deliveries(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now()
) returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,
  locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language sql security definer set search_path='' as $$
  select * from public.claim_email_notification_deliveries(p_worker_id,p_batch_size,p_lease_seconds,p_now)
$$;

alter function public.complete_external_notification_delivery(uuid,text,text,timestamptz)
  rename to complete_external_notification_delivery_before_alimtalk;
create function public.complete_external_notification_delivery(
  p_delivery_id uuid,p_worker_id text,p_provider_message_id text,p_now timestamptz default pg_catalog.now()
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.external_notification_delivery_outbox where id=p_delivery_id and channel='kakao') then
    raise exception 'KAKAO_DEDICATED_RESULT_REQUIRED';
  end if;
  return public.complete_external_notification_delivery_before_alimtalk(p_delivery_id,p_worker_id,p_provider_message_id,p_now);
end $$;

alter function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz)
  rename to fail_external_notification_delivery_before_alimtalk;
create function public.fail_external_notification_delivery(
  p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_now timestamptz default pg_catalog.now()
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.external_notification_delivery_outbox where id=p_delivery_id and channel='kakao') then
    raise exception 'KAKAO_DEDICATED_RESULT_REQUIRED';
  end if;
  return public.fail_external_notification_delivery_before_alimtalk(p_delivery_id,p_worker_id,p_error_code,p_retryable,p_now);
end $$;

alter function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz)
  rename to admin_retry_notification_delivery_before_alimtalk;
create function public.admin_retry_notification_delivery(
  p_delivery_id uuid,p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_idempotency_key uuid,
  p_correlation_id uuid,p_now timestamptz default pg_catalog.now()
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if exists(select 1 from public.external_notification_delivery_outbox where id=p_delivery_id and channel='kakao') then
    raise exception 'delivery is not final failed: Kakao manual retry forbidden';
  end if;
  return public.admin_retry_notification_delivery_before_alimtalk(p_delivery_id,p_actor_app_user_id,
    p_actor_admin_allowlist_id,p_idempotency_key,p_correlation_id,p_now);
end $$;

create or replace function public.get_admin_notification_deliveries(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,
  p_status public.notification_delivery_status default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  if p_limit<1 or p_limit>100 then raise exception 'limit must be between 1 and 100'; end if;
  return jsonb_build_object(
    'counts',(select jsonb_build_object(
      'pending',count(*)filter(where status='pending'),'processing',count(*)filter(where status='processing'),
      'sent',count(*)filter(where status='sent'),'failed',count(*)filter(where status='failed'))
      from(select status from public.notification_delivery_outbox union all
        select status from public.external_notification_delivery_outbox) counted),
    'items',coalesce((select jsonb_agg(pg_catalog.to_jsonb(item) order by item."createdAt" desc,item.id desc) from(
      select push.id,'push'::text channel,notification.kind::text kind,push.status::text status,
        push.attempt_count "attemptCount",case when push.available_at='infinity'::timestamptz
          then '9999-12-31T23:59:59Z'::timestamptz else push.available_at end "nextAttemptAt",
        'Web Push ••••'||right(subscription.endpoint_hash,4) "destinationLabel",push.last_error_code "errorCode",
        push.created_at "createdAt",push.sent_at "sentAt",
        (push.status='failed' and push.available_at='infinity'::timestamptz and retry.id is null) "manuallyRetryable",
        null::text "providerStatus",null::text "providerMessageId",null::text "providerStatusCode"
      from public.notification_delivery_outbox push
      join public.fan_notifications notification on notification.id=push.notification_id
      join public.push_subscriptions subscription on subscription.id=push.subscription_id
      left join public.notification_delivery_manual_retries retry on retry.delivery_type='push' and retry.delivery_id=push.id
      where p_status is null or push.status=p_status
      union all
      select external.id,external.channel,notification.kind::text,external.status::text,external.attempt_count,
        case when external.available_at='infinity'::timestamptz
          then '9999-12-31T23:59:59Z'::timestamptz else external.available_at end,
        channel.destination_label,external.last_error_code,external.created_at,external.sent_at,
        (external.channel<>'kakao' and external.status='failed' and external.available_at='infinity'::timestamptz and retry.id is null),
        attempt.status,attempt.provider_message_id,attempt.provider_status_code
      from public.external_notification_delivery_outbox external
      join public.fan_notifications notification on notification.id=external.notification_id
      join public.fan_notification_channels channel on channel.id=external.channel_id
      left join public.notification_delivery_manual_retries retry on retry.delivery_type='external' and retry.delivery_id=external.id
      left join public.kakao_notification_attempts attempt on attempt.delivery_id=external.id
      where p_status is null or external.status=p_status
      order by "createdAt" desc,id desc limit p_limit
    ) item),'[]'::jsonb)
  );
end $$;

create function public.begin_kakao_notification_send(p_delivery_id uuid,p_attempt_token uuid,p_template_id text,p_request_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.kakao_notification_attempts%rowtype; d public.external_notification_delivery_outbox%rowtype;
  c public.fan_notification_channels%rowtype; v_owner uuid; v_owner_status text; v_subject text; v_valid boolean;
begin
  if p_request_hash is null or p_request_hash!~'^[a-f0-9]{64}$' then raise exception 'KAKAO_REQUEST_HASH_INVALID'; end if;
  select app_user_id into v_owner from public.kakao_notification_attempts where delivery_id=p_delivery_id;
  if not found then return false; end if;
  select status::text into v_owner_status from public.app_users where public.app_users.id=v_owner for update;
  select provider_subject_hash into v_subject from public.fan_connected_accounts
    where app_user_id=v_owner and provider='kakao' and status='connected' for update;
  select channel.* into c from public.fan_notification_channels channel
    join public.kakao_notification_attempts attempt on attempt.channel_id=channel.id
    where attempt.delivery_id=p_delivery_id for update of channel;
  select * into d from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  select * into a from public.kakao_notification_attempts where delivery_id=p_delivery_id for update;
  -- The winning CAS call alone receives permission. Repeated calls, including a
  -- retry after a lost response, must never return true for an existing sending.
  if a.attempt_token is distinct from p_attempt_token or a.status<>'prepared' or a.sending_at is not null
    or a.lease_expires_at<=pg_catalog.now() or d.status<>'processing' then return false; end if;
  v_valid:=v_owner_status='active' and public.kakao_notification_delivery_is_eligible(p_delivery_id)
    and a.enrollment_generation=c.enrollment_generation and a.subject_hash=v_subject
    and a.destination_fingerprint=c.destination_fingerprint and a.consented_at=c.consented_at
    and a.template_id is not distinct from p_template_id
    and a.payload_fingerprint=encode(extensions.digest(public.kakao_notification_payload(d.notification_id,d.locale)::text,'sha256'),'hex');
  if v_valid is distinct from true then
    update public.kakao_notification_attempts set status='suppressed',error_code='KAKAO_STATE_CHANGED',updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
    update public.external_notification_delivery_outbox set status='failed',available_at='infinity',last_error_code='KAKAO_STATE_CHANGED',
      lease_owner=null,lease_expires_at=null,updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now() where id=d.plan_id;
    return false;
  end if;
  update public.kakao_notification_attempts set status='sending',sending_at=pg_catalog.now(),request_hash=p_request_hash,
    updated_at=pg_catalog.now() where delivery_id=p_delivery_id and status='prepared' and attempt_token=p_attempt_token;
  if not found then return false; end if;
  update public.external_notification_delivery_outbox set attempt_count=attempt_count+1,
    available_at='infinity',lease_expires_at='infinity',updated_at=pg_catalog.now() where id=p_delivery_id;
  return true;
end $$;

-- New RPCs are service-role only. Internal and renamed implementation helpers
-- remain executable only through their security-definer wrappers or triggers.
revoke all on function
  public.lock_kakao_notification_owner(uuid),
  public.invalidate_kakao_notification_destination(uuid,boolean),
  public.complete_owned_kakao_connection_before_alimtalk(uuid,text,timestamptz),
  public.enroll_owned_kakao_notification_channel_before_alimtalk(uuid,text,text,text,text,timestamptz),
  public.disconnect_owned_kakao_connection_before_alimtalk(uuid,timestamptz),
  public.set_owned_notification_channel_consent_before_alimtalk(uuid,uuid,boolean,text,timestamptz),
  public.revoke_disabled_owner_kakao_destination(),
  public.kakao_alimtalk_template_id(text,jsonb,text),
  public.snapshot_kakao_notification_enrollment(),
  public.protect_kakao_attempt_snapshot(),
  public.kakao_notification_payload(uuid,text),
  public.kakao_notification_current_state_is_eligible(uuid,timestamptz),
  public.kakao_notification_delivery_is_eligible(uuid,timestamptz),
  public.complete_external_notification_delivery_before_alimtalk(uuid,text,text,timestamptz),
  public.fail_external_notification_delivery_before_alimtalk(uuid,text,text,boolean,timestamptz),
  public.admin_retry_notification_delivery_before_alimtalk(uuid,uuid,uuid,uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;

revoke all on function
  public.complete_owned_kakao_connection(uuid,text,timestamptz),
  public.enroll_owned_kakao_notification_channel(uuid,text,text,text,text,timestamptz),
  public.disconnect_owned_kakao_connection(uuid,timestamptz),
  public.create_owned_kakao_alimtalk_state(uuid,text,text,text),
  public.consume_owned_kakao_connection_state(uuid,text,timestamptz),
  public.stage_owned_kakao_phone_enrollment(uuid,text,text,text),
  public.get_owned_kakao_phone_enrollment(uuid),
  public.confirm_owned_kakao_phone_enrollment(uuid,uuid,text),
  public.cancel_owned_kakao_phone_enrollment(uuid),
  public.set_owned_notification_channel_consent(uuid,uuid,boolean,text,timestamptz),
  public.maintain_kakao_notification_deliveries(),
  public.claim_kakao_notification_deliveries(text,integer,integer),
  public.begin_kakao_notification_send(uuid,uuid,text,text),
  public.record_kakao_notification_submission(uuid,uuid,text,text,text,text),
  public.claim_kakao_notification_reconciliations(integer),
  public.record_kakao_notification_result(uuid,text,text,text),
  public.record_kakao_notification_receipt(uuid,text,text),
  public.claim_external_notification_deliveries(text,integer,integer,timestamptz),
  public.complete_external_notification_delivery(uuid,text,text,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz),
  public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer)
from public,anon,authenticated,service_role;

grant execute on function
  public.complete_owned_kakao_connection(uuid,text,timestamptz),
  public.enroll_owned_kakao_notification_channel(uuid,text,text,text,text,timestamptz),
  public.disconnect_owned_kakao_connection(uuid,timestamptz),
  public.create_owned_kakao_alimtalk_state(uuid,text,text,text),
  public.consume_owned_kakao_connection_state(uuid,text,timestamptz),
  public.stage_owned_kakao_phone_enrollment(uuid,text,text,text),
  public.get_owned_kakao_phone_enrollment(uuid),
  public.confirm_owned_kakao_phone_enrollment(uuid,uuid,text),
  public.cancel_owned_kakao_phone_enrollment(uuid),
  public.set_owned_notification_channel_consent(uuid,uuid,boolean,text,timestamptz),
  public.maintain_kakao_notification_deliveries(),
  public.claim_kakao_notification_deliveries(text,integer,integer),
  public.begin_kakao_notification_send(uuid,uuid,text,text),
  public.record_kakao_notification_submission(uuid,uuid,text,text,text,text),
  public.claim_kakao_notification_reconciliations(integer),
  public.record_kakao_notification_result(uuid,text,text,text),
  public.record_kakao_notification_receipt(uuid,text,text),
  public.claim_external_notification_deliveries(text,integer,integer,timestamptz),
  public.complete_external_notification_delivery(uuid,text,text,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz),
  public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer)
to service_role;
