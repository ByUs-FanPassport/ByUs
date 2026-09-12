-- Manual phone ownership proof for Kakao Alimtalk. The OTP secret and clear
-- OTP never enter Postgres; the server stores only an owner/challenge-bound
-- HMAC digest. Existing delivery release controls and queued rows are untouched.

create table public.phone_sms_verification_challenges (
  id uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  request_id uuid not null,
  phone text check(phone is null or phone~'^010[0-9]{8}$'),
  phone_rate_key text not null check(phone_rate_key~'^[a-f0-9]{64}$'),
  otp_digest text check(otp_digest is null or otp_digest~'^[a-f0-9]{64}$'),
  key_version text not null default 'v1' check(key_version='v1'),
  send_status text not null default 'reserved'
    check(send_status in('reserved','sending','accepted','rejected','unknown')),
  failed_attempts smallint not null default 0 check(failed_attempts between 0 and 5),
  provider_message_id text check(provider_message_id is null or provider_message_id~'^[A-Za-z0-9_-]{2,128}$'),
  provider_group_id text check(provider_group_id is null or provider_group_id~'^[A-Za-z0-9_-]{2,128}$'),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  resend_at timestamptz not null,
  sending_at timestamptz,
  send_finished_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  unique(app_user_id,request_id),
  check(expires_at=created_at+interval '5 minutes'),
  check(resend_at=created_at+interval '60 seconds'),
  check((phone is null)=(otp_digest is null)),
  check(phone is not null or consumed_at is not null or cancelled_at is not null or expired_at is not null),
  check(verified_at is null or send_status in('sending','accepted','unknown'))
);

-- This ledger outlives challenge PII cleanup so cancel/expiry cannot reset
-- owner, phone or global quotas.
create table public.phone_sms_rate_limit_events (
  challenge_id uuid primary key references public.phone_sms_verification_challenges(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  phone_rate_key text not null check(phone_rate_key~'^[a-f0-9]{64}$'),
  reserved_at timestamptz not null default pg_catalog.now()
);
create index phone_sms_rate_owner_time_idx on public.phone_sms_rate_limit_events(app_user_id,reserved_at);
create index phone_sms_rate_phone_time_idx on public.phone_sms_rate_limit_events(phone_rate_key,reserved_at);
create index phone_sms_rate_global_time_idx on public.phone_sms_rate_limit_events(reserved_at);

alter table public.phone_sms_verification_challenges enable row level security;
alter table public.phone_sms_verification_challenges force row level security;
alter table public.phone_sms_rate_limit_events enable row level security;
alter table public.phone_sms_rate_limit_events force row level security;
revoke all on public.phone_sms_verification_challenges,public.phone_sms_rate_limit_events
  from public,anon,authenticated,service_role;

create function public.protect_phone_sms_challenge_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if row(new.id,new.app_user_id,new.request_id,new.phone_rate_key,new.key_version,new.created_at,new.expires_at,new.resend_at)
    is distinct from row(old.id,old.app_user_id,old.request_id,old.phone_rate_key,old.key_version,old.created_at,old.expires_at,old.resend_at)
    or (old.phone is null and new.phone is not null)
    or (old.phone is not null and new.phone is not null and old.phone<>new.phone)
    or (old.otp_digest is null and new.otp_digest is not null)
    or (old.otp_digest is not null and new.otp_digest is not null and old.otp_digest<>new.otp_digest) then
    raise exception 'PHONE_SMS_CHALLENGE_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger phone_sms_challenge_identity_immutable before update
  on public.phone_sms_verification_challenges for each row
  execute function public.protect_phone_sms_challenge_identity();

create function public.phone_sms_mask(p_phone text)
returns text language sql immutable set search_path='' as $$
  select case when p_phone~'^010[0-9]{8}$' then '010-****-'||right(p_phone,4) end
$$;

create function public.reserve_owned_phone_sms_challenge(
  p_app_user_id uuid,p_challenge_id uuid,p_request_id uuid,p_phone text,
  p_phone_rate_key text,p_otp_digest text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.phone_sms_verification_challenges%rowtype; now_at timestamptz:=pg_catalog.now();
begin
  if p_app_user_id is null or p_challenge_id is null or p_request_id is null
    or p_phone!~'^010[0-9]{8}$' or p_phone_rate_key!~'^[a-f0-9]{64}$'
    or p_otp_digest!~'^[a-f0-9]{64}$' then raise exception 'PHONE_SMS_REQUEST_INVALID'; end if;

  -- The only global SMS lock path always precedes the existing owner-row lock.
  perform pg_catalog.pg_advisory_xact_lock(7142,100);
  perform public.lock_kakao_notification_owner(p_app_user_id);

  select * into existing from public.phone_sms_verification_challenges
    where app_user_id=p_app_user_id and request_id=p_request_id for update;
  if found then
    if existing.phone_rate_key<>p_phone_rate_key
      or (existing.phone is not null and existing.phone<>p_phone) then
      raise exception 'PHONE_SMS_REQUEST_ID_COLLISION';
    end if;
    return jsonb_build_object('challengeId',existing.id,'destinationLabel',
      coalesce(public.phone_sms_mask(existing.phone),'010-****-****'),
      'expiresAt',existing.expires_at,'resendAt',existing.resend_at,
      'status',existing.send_status,'created',false);
  end if;
  if exists(select 1 from public.phone_sms_verification_challenges where id=p_challenge_id) then
    raise exception 'PHONE_SMS_CHALLENGE_ID_COLLISION';
  end if;
  if exists(select 1 from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '60 seconds'
      and (app_user_id=p_app_user_id or phone_rate_key=p_phone_rate_key)) then
    raise exception 'PHONE_SMS_COOLDOWN';
  end if;
  if (select count(*) from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '10 minutes'
      and app_user_id=p_app_user_id)>=3
    or (select count(*) from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '10 minutes'
      and phone_rate_key=p_phone_rate_key)>=3 then raise exception 'PHONE_SMS_RATE_LIMIT_10_MIN'; end if;
  if (select count(*) from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '24 hours'
      and app_user_id=p_app_user_id)>=10
    or (select count(*) from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '24 hours'
      and phone_rate_key=p_phone_rate_key)>=10 then raise exception 'PHONE_SMS_RATE_LIMIT_24_HOUR'; end if;
  if (select count(*) from public.phone_sms_rate_limit_events where reserved_at>now_at-interval '24 hours')>=100 then
    raise exception 'PHONE_SMS_GLOBAL_BUDGET';
  end if;

  update public.phone_sms_verification_challenges set cancelled_at=now_at,phone=null,otp_digest=null
    where app_user_id=p_app_user_id and consumed_at is null and cancelled_at is null and expired_at is null;
  insert into public.phone_sms_verification_challenges(
    id,app_user_id,request_id,phone,phone_rate_key,otp_digest,created_at,expires_at,resend_at)
  values(p_challenge_id,p_app_user_id,p_request_id,p_phone,p_phone_rate_key,p_otp_digest,
    now_at,now_at+interval '5 minutes',now_at+interval '60 seconds');
  insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at)
    values(p_challenge_id,p_app_user_id,p_phone_rate_key,now_at);
  return jsonb_build_object('challengeId',p_challenge_id,'destinationLabel',public.phone_sms_mask(p_phone),
    'expiresAt',now_at+interval '5 minutes','resendAt',now_at+interval '60 seconds',
    'status','reserved','created',true);
end $$;

create function public.begin_phone_sms_send(p_app_user_id uuid,p_challenge_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare now_at timestamptz:=pg_catalog.now();
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  update public.phone_sms_verification_challenges set send_status='sending',sending_at=now_at
    where id=p_challenge_id and app_user_id=p_app_user_id and send_status='reserved'
      and consumed_at is null and cancelled_at is null and expired_at is null and expires_at>now_at
      and phone is not null and otp_digest is not null;
  return found;
end $$;

create function public.finish_phone_sms_send(
  p_app_user_id uuid,p_challenge_id uuid,p_outcome text,
  p_provider_message_id text,p_provider_group_id text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_outcome not in('accepted','rejected','unknown')
    or (p_provider_message_id is not null and p_provider_message_id!~'^[A-Za-z0-9_-]{2,128}$')
    or (p_provider_group_id is not null and p_provider_group_id!~'^[A-Za-z0-9_-]{2,128}$')
    or (p_outcome='accepted' and (p_provider_message_id is null or p_provider_group_id is null)) then
    raise exception 'PHONE_SMS_SEND_RESULT_INVALID';
  end if;
  perform public.lock_kakao_notification_owner(p_app_user_id);
  update public.phone_sms_verification_challenges set send_status=p_outcome,
    provider_message_id=p_provider_message_id,provider_group_id=p_provider_group_id,
    send_finished_at=pg_catalog.now()
    where id=p_challenge_id and app_user_id=p_app_user_id and send_status='sending'
      and consumed_at is null and cancelled_at is null and expired_at is null
      and expires_at>pg_catalog.now();
  return found;
end $$;

create function public.verify_owned_phone_sms_challenge(
  p_app_user_id uuid,p_challenge_id uuid,p_candidate_digest text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.phone_sms_verification_challenges%rowtype; now_at timestamptz:=pg_catalog.now(); next_fail smallint;
begin
  if p_candidate_digest is null or p_candidate_digest!~'^[a-f0-9]{64}$' then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_CODE_INVALID');
  end if;
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into v from public.phone_sms_verification_challenges where id=p_challenge_id for update;
  if not found or v.app_user_id<>p_app_user_id then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_CHALLENGE_NOT_FOUND');
  end if;
  if v.consumed_at is not null or v.verified_at is not null then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_CHALLENGE_REPLAY');
  end if;
  if v.cancelled_at is not null or v.expired_at is not null then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_CHALLENGE_INACTIVE');
  end if;
  if v.expires_at<=now_at then
    update public.phone_sms_verification_challenges set expired_at=now_at,phone=null,otp_digest=null where id=v.id;
    return jsonb_build_object('verified',false,'error','PHONE_SMS_CHALLENGE_EXPIRED');
  end if;
  if v.send_status not in('sending','accepted','unknown') then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_SEND_NOT_VERIFIABLE');
  end if;
  if v.failed_attempts>=5 or v.otp_digest is null then
    return jsonb_build_object('verified',false,'error','PHONE_SMS_ATTEMPTS_EXHAUSTED');
  end if;
  if v.otp_digest<>p_candidate_digest then
    next_fail:=v.failed_attempts+1;
    update public.phone_sms_verification_challenges set failed_attempts=next_fail,
      cancelled_at=case when next_fail>=5 then now_at else cancelled_at end,
      phone=case when next_fail>=5 then null else phone end,
      otp_digest=case when next_fail>=5 then null else otp_digest end where id=v.id;
    return jsonb_build_object('verified',false,'error',case when next_fail>=5
      then 'PHONE_SMS_ATTEMPTS_EXHAUSTED' else 'PHONE_SMS_CODE_MISMATCH' end);
  end if;
  update public.phone_sms_verification_challenges set verified_at=now_at where id=v.id;
  return jsonb_build_object('verified',true);
end $$;

create function public.confirm_owned_phone_sms_enrollment(
  p_app_user_id uuid,p_challenge_id uuid,p_consent_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.phone_sms_verification_challenges%rowtype; c public.fan_notification_channels%rowtype; now_at timestamptz:=pg_catalog.now();
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into v from public.phone_sms_verification_challenges where id=p_challenge_id for update;
  if not found or v.app_user_id<>p_app_user_id or v.verified_at is null or v.consumed_at is not null
    or v.cancelled_at is not null or v.expired_at is not null or v.expires_at<=now_at
    or v.phone is null or v.otp_digest is null or p_consent_version is distinct from 'kakao-alimtalk-v1' then
    raise exception 'PHONE_SMS_CONFIRMATION_INVALID';
  end if;
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  update public.kakao_connection_states set expires_at=least(expires_at,now_at),consumed_at=coalesce(consumed_at,now_at)
    where app_user_id=p_app_user_id and purpose='alimtalk';
  insert into public.fan_notification_channels(app_user_id,kind,status,consent_version,consented_at,
    destination_fingerprint,destination_label,verified_at,priority,verification_method,enrollment_generation,kakao_subject_hash)
  values(p_app_user_id,'kakao','eligible','kakao-alimtalk-v1',now_at,
    encode(extensions.digest(v.phone,'sha256'),'hex'),public.phone_sms_mask(v.phone),v.verified_at,100,
    'sms_otp',v.id,null)
  on conflict(app_user_id,kind) do update set status='eligible',consent_version=excluded.consent_version,
    consented_at=excluded.consented_at,consent_revoked_at=null,destination_fingerprint=excluded.destination_fingerprint,
    destination_label=excluded.destination_label,verified_at=excluded.verified_at,
    verification_method=excluded.verification_method,enrollment_generation=excluded.enrollment_generation,
    kakao_subject_hash=null,updated_at=now_at
  returning * into c;
  insert into public.fan_notification_channel_private(channel_id,destination,updated_at)
    values(c.id,v.phone,now_at) on conflict(channel_id) do update set destination=excluded.destination,updated_at=now_at;
  insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version,created_at)
    values(c.id,p_app_user_id,true,'kakao-alimtalk-v1',now_at);
  update public.phone_sms_verification_challenges set consumed_at=now_at,phone=null,otp_digest=null where id=v.id;
  update public.phone_sms_verification_challenges set cancelled_at=now_at,phone=null,otp_digest=null
    where app_user_id=p_app_user_id and id<>v.id and consumed_at is null and cancelled_at is null and expired_at is null;
  return jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'consented',true,
    'destinationLabel',c.destination_label,'verifiedAt',c.verified_at);
end $$;

-- A successful OAuth phone confirmation wins over every older SMS proof for
-- the owner. A failed OAuth confirmation rolls this cancellation back.
alter function public.confirm_owned_kakao_phone_enrollment(uuid,uuid,text)
  rename to confirm_owned_kakao_phone_enrollment_before_sms;
create function public.confirm_owned_kakao_phone_enrollment(
  p_app_user_id uuid,p_enrollment_id uuid,p_consent_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; now_at timestamptz:=pg_catalog.now();
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  update public.phone_sms_verification_challenges set cancelled_at=coalesce(cancelled_at,now_at),phone=null,otp_digest=null
    where app_user_id=p_app_user_id and consumed_at is null and expired_at is null;
  result:=public.confirm_owned_kakao_phone_enrollment_before_sms(p_app_user_id,p_enrollment_id,p_consent_version);
  return result;
end $$;

create function public.cancel_owned_phone_sms_challenge(p_app_user_id uuid,p_challenge_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  update public.phone_sms_verification_challenges set cancelled_at=pg_catalog.now(),phone=null,otp_digest=null
    where id=p_challenge_id and app_user_id=p_app_user_id and consumed_at is null
      and cancelled_at is null and expired_at is null;
  return found;
end $$;

-- Explicit withdrawal and owner disable revoke every proof type and pending OTP.
create or replace function public.invalidate_kakao_notification_destination(p_app_user_id uuid,p_cancel_states boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare v public.fan_notification_channels%rowtype;
begin
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  update public.phone_sms_verification_challenges set cancelled_at=coalesce(cancelled_at,pg_catalog.now()),phone=null,otp_digest=null
    where app_user_id=p_app_user_id and consumed_at is null and expired_at is null;
  if p_cancel_states then
    update public.kakao_connection_states set expires_at=least(expires_at,pg_catalog.now()),consumed_at=coalesce(consumed_at,pg_catalog.now())
      where app_user_id=p_app_user_id and purpose='alimtalk' and phone_staged_at is null;
  end if;
  for v in select * from public.fan_notification_channels where app_user_id=p_app_user_id and kind='kakao' for update loop
    if v.consented_at is not null and v.consent_revoked_at is null then
      insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version)
        values(v.id,p_app_user_id,false,coalesce(v.consent_version,'kakao-alimtalk-v1'));
    end if;
    delete from public.fan_notification_channel_private where channel_id=v.id;
    update public.fan_notification_channels set status='disabled',verified_at=null,
      consent_revoked_at=coalesce(consent_revoked_at,pg_catalog.now()),verification_method=null,
      enrollment_generation=null,kakao_subject_hash=null,destination_label='Kakao',
      destination_fingerprint=encode(extensions.digest('kakao-withdrawn:'||id::text,'sha256'),'hex'),updated_at=pg_catalog.now()
      where id=v.id;
  end loop;
end $$;

create function public.invalidate_oauth_kakao_notification_destination(p_app_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.fan_notification_channels%rowtype;
begin
  select * into v from public.fan_notification_channels where app_user_id=p_app_user_id and kind='kakao' for update;
  if not found or v.verification_method is distinct from 'kakao_profile_owner_confirmation' then return; end if;
  if v.consented_at is not null and v.consent_revoked_at is null then
    insert into public.fan_notification_consent_audits(channel_id,app_user_id,consented,consent_version)
      values(v.id,p_app_user_id,false,coalesce(v.consent_version,'kakao-alimtalk-v1'));
  end if;
  delete from public.fan_notification_channel_private where channel_id=v.id;
  update public.fan_notification_channels set status='disabled',verified_at=null,
    consent_revoked_at=coalesce(consent_revoked_at,pg_catalog.now()),verification_method=null,
    enrollment_generation=null,kakao_subject_hash=null,destination_label='Kakao',
    destination_fingerprint=encode(extensions.digest('kakao-withdrawn:'||id::text,'sha256'),'hex'),updated_at=pg_catalog.now()
    where id=v.id;
end $$;

create or replace function public.complete_owned_kakao_connection(p_app_user_id uuid,p_subject_hash text,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.fan_connected_accounts%rowtype;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  select * into v from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' for update;
  if found and (v.status<>'connected' or v.provider_subject_hash is distinct from p_subject_hash) then
    perform public.invalidate_oauth_kakao_notification_destination(p_app_user_id);
  end if;
  return public.complete_owned_kakao_connection_before_alimtalk(p_app_user_id,p_subject_hash,p_now);
end $$;

create or replace function public.disconnect_owned_kakao_connection(p_app_user_id uuid,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.lock_kakao_notification_owner(p_app_user_id);
  perform 1 from public.fan_connected_accounts where app_user_id=p_app_user_id and provider='kakao' for update;
  v_result:=public.disconnect_owned_kakao_connection_before_alimtalk(p_app_user_id,p_now);
  perform public.invalidate_oauth_kakao_notification_destination(p_app_user_id);
  return v_result;
end $$;

alter table public.fan_notification_channels drop constraint kakao_phone_verification_shape;
alter table public.fan_notification_channels add constraint kakao_phone_verification_shape check (
  (verification_method is null and enrollment_generation is null and kakao_subject_hash is null)
  or (kind='kakao' and verification_method='kakao_profile_owner_confirmation'
    and enrollment_generation is not null and kakao_subject_hash is not null
    and kakao_subject_hash~'^[a-f0-9]{64}$')
  or (kind='kakao' and verification_method='sms_otp'
    and enrollment_generation is not null and kakao_subject_hash is null)
);

alter table public.kakao_notification_attempts add column verification_method text;
update public.kakao_notification_attempts set verification_method=case
  when subject_hash is not null then 'kakao_profile_owner_confirmation'
end;
do $$ declare constraint_name text; begin
  select conname into constraint_name from pg_catalog.pg_constraint
    where conrelid='public.kakao_notification_attempts'::regclass and contype='c'
      and pg_catalog.pg_get_constraintdef(oid) like '%template_id IS NOT NULL%enrollment_generation IS NOT NULL%subject_hash IS NOT NULL%';
  if constraint_name is null then raise exception 'PHONE_SMS_ATTEMPT_CHECK_NOT_FOUND'; end if;
  execute pg_catalog.format('alter table public.kakao_notification_attempts drop constraint %I',constraint_name);
end $$;
alter table public.kakao_notification_attempts add constraint kakao_attempt_verification_shape check (
  (verification_method is null and status in('suppressed','failed','unknown') and subject_hash is null)
  or (verification_method='kakao_profile_owner_confirmation' and subject_hash is not null
    and subject_hash~'^[a-f0-9]{64}$'
    and (status not in('prepared','sending','accepted','unknown','delivered')
      or (template_id is not null and enrollment_generation is not null and consented_at is not null)))
  or (verification_method='sms_otp' and subject_hash is null
    and (status not in('prepared','sending','accepted','unknown','delivered')
      or (template_id is not null and enrollment_generation is not null and consented_at is not null)))
);

create or replace function public.protect_kakao_attempt_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'UPDATE' then raise exception 'KAKAO_ATTEMPT_HISTORY_IMMUTABLE'; end if;
  if row(new.delivery_id,new.app_user_id,new.channel_id,new.template_id,new.profile_id,new.destination_fingerprint,
    new.verification_method,new.subject_hash,new.enrollment_generation,new.consented_at,new.payload,new.payload_fingerprint,new.created_at)
    is distinct from row(old.delivery_id,old.app_user_id,old.channel_id,old.template_id,old.profile_id,old.destination_fingerprint,
    old.verification_method,old.subject_hash,old.enrollment_generation,old.consented_at,old.payload,old.payload_fingerprint,old.created_at) then
    raise exception 'KAKAO_ATTEMPT_SNAPSHOT_IMMUTABLE';
  end if;
  if old.sending_at is not null and row(new.attempt_token,new.request_hash,new.sending_at)
    is distinct from row(old.attempt_token,old.request_hash,old.sending_at) then raise exception 'KAKAO_SEND_AUTHORIZATION_IMMUTABLE'; end if;
  if old.status in('delivered','failed','suppressed') and new.status<>old.status then raise exception 'KAKAO_ATTEMPT_TERMINAL'; end if;
  return new;
end $$;

create or replace function public.kakao_channel_supports_notification(p_channel_id uuid,p_kind text,p_payload jsonb,p_locale text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fan_notification_channels c
    join public.fan_notification_channel_private p on p.channel_id=c.id
    where c.id=p_channel_id and c.kind='kakao' and c.status='eligible'
      and c.enrollment_generation is not null and c.verified_at is not null
      and c.consented_at is not null and c.consent_revoked_at is null and c.consent_version='kakao-alimtalk-v1'
      and ((c.verification_method='sms_otp' and c.kakao_subject_hash is null)
        or (c.verification_method='kakao_profile_owner_confirmation' and exists(
          select 1 from public.fan_connected_accounts a where a.app_user_id=c.app_user_id and a.provider='kakao'
            and a.status='connected' and a.provider_subject_hash=c.kakao_subject_hash)))
      and p.destination~'^010[0-9]{8}$'
      and encode(extensions.digest(p.destination,'sha256'),'hex')=c.destination_fingerprint
      and public.kakao_alimtalk_template_id(p_kind,p_payload,p_locale) is not null)
$$;

create or replace function public.kakao_notification_delivery_is_eligible(p_delivery_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.external_notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    join public.app_users owner on owner.id=notification.app_user_id and owner.status='active'
    join public.fan_notification_channels channel on channel.id=delivery.channel_id and channel.app_user_id=owner.id
    join public.fan_notification_channel_private private on private.channel_id=channel.id
    where delivery.id=p_delivery_id and delivery.channel='kakao' and channel.kind='kakao' and channel.status='eligible'
      and channel.enrollment_generation=delivery.kakao_enrollment_generation
      and channel.verified_at is not null and channel.consented_at is not null and channel.consent_revoked_at is null
      and channel.consent_version='kakao-alimtalk-v1'
      and ((channel.verification_method='sms_otp' and channel.kakao_subject_hash is null)
        or (channel.verification_method='kakao_profile_owner_confirmation' and exists(
          select 1 from public.fan_connected_accounts account where account.app_user_id=owner.id and account.provider='kakao'
            and account.status='connected' and account.provider_subject_hash=channel.kakao_subject_hash)))
      and private.destination~'^010[0-9]{8}$'
      and encode(extensions.digest(private.destination,'sha256'),'hex')=channel.destination_fingerprint
      and public.kakao_alimtalk_template_id(delivery.template_key,
        public.build_external_notification_payload(notification.id,delivery.locale),delivery.locale) is not null
      and public.notification_delivery_is_eligible(notification.id,p_at)
      and public.kakao_notification_current_state_is_eligible(notification.id,p_at))
$$;

create or replace function public.claim_kakao_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)
returns table(id uuid,attempt_token uuid,notification_id uuid,template_key text,locale text,destination text,
  payload jsonb,template_id text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare d public.external_notification_delivery_outbox%rowtype; c public.fan_notification_channels%rowtype;
  a public.kakao_notification_attempts%rowtype; v_payload jsonb; v_template text; v_owner uuid; v_eligible boolean;
begin
  perform public.lock_fan_notification_delivery_control('kakao');
  if p_worker_id is null or length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size is null or p_batch_size not between 1 and 2
    or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then raise exception 'KAKAO_CLAIM_INVALID'; end if;
  for d in select delivery.* from public.external_notification_delivery_outbox delivery
    left join public.kakao_notification_attempts attempt on attempt.delivery_id=delivery.id
    where public.fan_notification_is_released(delivery.notification_id,'kakao') and delivery.channel='kakao'
      and delivery.available_at<=pg_catalog.now()
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
      destination_fingerprint,verification_method,subject_hash,enrollment_generation,consented_at,payload,payload_fingerprint,
      lease_expires_at,error_code)
    values(d.id,v_owner,d.channel_id,extensions.gen_random_uuid(),case when v_eligible then 'prepared' else 'suppressed' end,
      v_template,c.destination_fingerprint,c.verification_method,c.kakao_subject_hash,c.enrollment_generation,c.consented_at,
      v_payload,encode(extensions.digest(v_payload::text,'sha256'),'hex'),pg_catalog.now()+make_interval(secs=>p_lease_seconds),
      case when not v_eligible then 'KAKAO_NOT_ELIGIBLE' end)
    on conflict(delivery_id) do update set attempt_token=excluded.attempt_token,lease_expires_at=excluded.lease_expires_at,
      updated_at=pg_catalog.now(),status=case when v_eligible then 'prepared' else 'suppressed' end,
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

-- Replace the cutover's inner implementation only. Its public wrapper keeps
-- the release lock and historical pending controls unchanged.
create or replace function public.begin_kakao_before_release(p_delivery_id uuid,p_attempt_token uuid,p_template_id text,p_request_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.kakao_notification_attempts%rowtype; d public.external_notification_delivery_outbox%rowtype;
  c public.fan_notification_channels%rowtype; v_owner uuid; v_owner_status text; v_subject text; v_valid boolean;
begin
  if p_request_hash is null or p_request_hash!~'^[a-f0-9]{64}$' then raise exception 'KAKAO_REQUEST_HASH_INVALID'; end if;
  select app_user_id into v_owner from public.kakao_notification_attempts where delivery_id=p_delivery_id;
  if not found then return false; end if;
  select status::text into v_owner_status from public.app_users where id=v_owner for update;
  select channel.* into c from public.fan_notification_channels channel
    join public.kakao_notification_attempts attempt on attempt.channel_id=channel.id
    where attempt.delivery_id=p_delivery_id for update of channel;
  if c.verification_method='kakao_profile_owner_confirmation' then
    select provider_subject_hash into v_subject from public.fan_connected_accounts
      where app_user_id=v_owner and provider='kakao' and status='connected' for update;
  end if;
  select * into d from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  select * into a from public.kakao_notification_attempts where delivery_id=p_delivery_id for update;
  if a.attempt_token is distinct from p_attempt_token or a.status<>'prepared' or a.sending_at is not null
    or a.lease_expires_at<=pg_catalog.now() or d.status<>'processing' then return false; end if;
  v_valid:=v_owner_status='active' and public.kakao_notification_delivery_is_eligible(p_delivery_id)
    and a.verification_method is not distinct from c.verification_method
    and a.enrollment_generation is not distinct from c.enrollment_generation
    and ((a.verification_method='sms_otp' and a.subject_hash is null and c.kakao_subject_hash is null)
      or (a.verification_method='kakao_profile_owner_confirmation' and a.subject_hash is not distinct from v_subject
        and c.kakao_subject_hash is not distinct from v_subject))
    and a.destination_fingerprint is not distinct from c.destination_fingerprint
    and a.consented_at is not distinct from c.consented_at
    and a.template_id is not distinct from p_template_id
    and a.payload_fingerprint=encode(extensions.digest(public.kakao_notification_payload(d.notification_id,d.locale)::text,'sha256'),'hex');
  if v_valid is distinct from true then
    update public.kakao_notification_attempts set status='suppressed',error_code='KAKAO_STATE_CHANGED',updated_at=pg_catalog.now()
      where delivery_id=p_delivery_id;
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

create or replace function public.maintain_kakao_notification_deliveries()
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.kakao_phone_enrollments where expires_at<=pg_catalog.now();
  update public.phone_sms_verification_challenges set expired_at=coalesce(expired_at,pg_catalog.now()),phone=null,otp_digest=null
    where expires_at<=pg_catalog.now() and consumed_at is null and cancelled_at is null;
  delete from public.phone_sms_rate_limit_events where reserved_at<=pg_catalog.now()-interval '24 hours';
  delete from public.phone_sms_verification_challenges where created_at<=pg_catalog.now()-interval '24 hours'
    and phone is null and otp_digest is null;
  update public.kakao_notification_attempts set status='unknown',error_code='SOLAPI_SEND_OUTCOME_UNKNOWN',updated_at=pg_catalog.now()
    where status='sending' and lease_expires_at<=pg_catalog.now();
end $$;
select cron.schedule('phone-sms-challenge-retention','*/5 * * * *','select public.maintain_kakao_notification_deliveries()');

revoke all on function public.protect_phone_sms_challenge_identity(),public.phone_sms_mask(text),
  public.invalidate_oauth_kakao_notification_destination(uuid),
  public.confirm_owned_kakao_phone_enrollment_before_sms(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.reserve_owned_phone_sms_challenge(uuid,uuid,uuid,text,text,text),
  public.begin_phone_sms_send(uuid,uuid),public.finish_phone_sms_send(uuid,uuid,text,text,text),
  public.verify_owned_phone_sms_challenge(uuid,uuid,text),public.confirm_owned_phone_sms_enrollment(uuid,uuid,text),
  public.cancel_owned_phone_sms_challenge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.confirm_owned_kakao_phone_enrollment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_owned_phone_sms_challenge(uuid,uuid,uuid,text,text,text),
  public.begin_phone_sms_send(uuid,uuid),public.finish_phone_sms_send(uuid,uuid,text,text,text),
  public.verify_owned_phone_sms_challenge(uuid,uuid,text),public.confirm_owned_phone_sms_enrollment(uuid,uuid,text),
  public.cancel_owned_phone_sms_challenge(uuid,uuid) to service_role;
grant execute on function public.confirm_owned_kakao_phone_enrollment(uuid,uuid,text) to service_role;
