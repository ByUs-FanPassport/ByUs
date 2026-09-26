-- Keep referential/onchain history under an anonymized disabled UUID. Never label
-- access disablement as completed deletion: provider + object cleanup are durable.
create table public.account_deletion_requests (
  app_user_id uuid primary key references public.app_users(id) on delete restrict,
  provider_subject text,
  status text not null default 'pending' check(status in('pending','completed')),
  attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_error_code text check(last_error_code in('STORAGE_UNAVAILABLE','PROVIDER_UNAVAILABLE','FINALIZATION_UNAVAILABLE','CLEANUP_PENDING')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(), completed_at timestamptz,
  check((status='pending' and completed_at is null) or (status='completed' and completed_at is not null and provider_subject is null))
);
create table public.account_subject_tombstones (
  subject_hash text primary key check(subject_hash ~ '^[a-f0-9]{64}$'),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  deleted_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table public.account_deletion_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  bucket text not null check(bucket in('fan-avatars','certification-proofs')),
  object_path text not null, storage_deleted_at timestamptz, generation bigint not null default 0,
  unique(bucket,object_path), check(object_path like app_user_id::text||'/%')
);
create table public.fan_private_uploads (
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  bucket text not null check(bucket in('fan-avatars','certification-proofs')),
  object_path text not null,
  expires_at timestamptz not null default pg_catalog.clock_timestamp()+interval '1 hour',
  primary key(bucket,object_path), check(object_path like app_user_id::text||'/%')
);
alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
alter table public.account_subject_tombstones enable row level security;
alter table public.account_subject_tombstones force row level security;
alter table public.account_deletion_objects enable row level security;
alter table public.account_deletion_objects force row level security;
alter table public.fan_private_uploads enable row level security;
alter table public.fan_private_uploads force row level security;
revoke all on public.account_deletion_requests,public.account_subject_tombstones,public.account_deletion_objects,public.fan_private_uploads from public,anon,authenticated,service_role;

create function public.fan_web_account_erasing(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(pg_catalog.current_setting('byus.account_deletion_owner',true)=p_owner::text,false)
    and exists(select 1 from public.account_deletion_requests d join public.app_users u on u.id=d.app_user_id
      where d.app_user_id=p_owner and d.status='pending' and u.status='disabled')
$$;

-- Preserve identity, wallet ownership and welcome-stamp behavior of the existing
-- canonical function. Subject lock -> user lock is also the deletion lock order.
alter function public.sync_privy_identity(text,text,bigint,text) rename to sync_privy_identity_before_account_deletion;
create function public.sync_privy_identity(p_privy_user_id text,p_verified_email text,p_chain_id bigint,p_wallet_address text)
returns table(app_user_id uuid,wallet_id uuid) language plpgsql security definer set search_path='' as $$
declare owner_id uuid; v_subject_hash text:=encode(extensions.digest(pg_catalog.btrim(p_privy_user_id),'sha256'),'hex');
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-subject:'||v_subject_hash,0));
  if exists(select 1 from public.account_subject_tombstones t where t.subject_hash=v_subject_hash) then
    raise exception 'ACCOUNT_DELETED' using errcode='42501'; end if;
  select id into owner_id from public.app_users where privy_user_id=pg_catalog.btrim(p_privy_user_id);
  if owner_id is not null then perform public.fan_web_lock_active_user(owner_id); end if;
  return query select * from public.sync_privy_identity_before_account_deletion(p_privy_user_id,p_verified_email,p_chain_id,p_wallet_address);
end $$;

create function public.fan_web_begin_private_upload(p_app_user_id uuid,p_bucket text,p_object_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  insert into public.fan_private_uploads(app_user_id,bucket,object_path) values(p_app_user_id,p_bucket,p_object_path);
end $$;
create function public.fan_web_finish_private_upload(p_app_user_id uuid,p_bucket text,p_object_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||p_app_user_id::text,0));
  if not exists(select 1 from public.fan_private_uploads where app_user_id=p_app_user_id and bucket=p_bucket and object_path=p_object_path) then return; end if;
  if exists(select 1 from public.account_deletion_requests where app_user_id=p_app_user_id) then
    insert into public.account_deletion_objects(app_user_id,bucket,object_path) values(p_app_user_id,p_bucket,p_object_path)
      on conflict(bucket,object_path) do update set storage_deleted_at=null,generation=public.account_deletion_objects.generation+1;
    update public.account_deletion_requests set status='pending',completed_at=null,available_at=pg_catalog.clock_timestamp()
      where app_user_id=p_app_user_id;
  end if;
  delete from public.fan_private_uploads where app_user_id=p_app_user_id and bucket=p_bucket and object_path=p_object_path;
end $$;

-- Narrow erasure exceptions preserve status/ledger audit facts, never permit a
-- normal caller to rewrite immutable business history.
create or replace function public.protect_user_profile_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if public.fan_web_account_erasing(old.app_user_id) then return old; end if;
    raise exception 'FAN020_PROFILE_IDENTITY_IMMUTABLE' using errcode='23514';
  end if;
  if new.app_user_id<>old.app_user_id or new.created_at<>old.created_at or new.nickname_catalog_version<>old.nickname_catalog_version then
    raise exception 'FAN020_PROFILE_IDENTITY_IMMUTABLE' using errcode='23514'; end if;
  return new;
end $$;
create or replace function public.reject_certification_immutable_mutation() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid;
begin
  if tg_table_name='certification_review_operations' and tg_op='UPDATE' then
    select app_user_id into owner_id from public.certification_submissions where id=old.submission_id;
    if public.fan_web_account_erasing(owner_id) and (to_jsonb(new)-'rejection_reason')=(to_jsonb(old)-'rejection_reason')
      and (new.rejection_reason is null or new.rejection_reason='Account deleted') then return new; end if;
  end if;
  raise exception 'certification record is immutable';
end $$;
create or replace function public.reject_benefit_economy_history_mutation() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid;
begin
  if tg_table_name='benefit_fulfillment_events' and tg_op='UPDATE' then
    select w.app_user_id into owner_id from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id where f.id=old.fulfillment_id;
    if public.fan_web_account_erasing(owner_id) and (to_jsonb(new)-array['carrier','tracking_number','operator_memo'])=(to_jsonb(old)-array['carrier','tracking_number','operator_memo'])
      and new.carrier is null and new.tracking_number is null and new.operator_memo is null then return new; end if;
  end if;
  raise exception 'benefit economy history is append-only';
end $$;

CREATE OR REPLACE FUNCTION public.protect_kakao_attempt_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op='UPDATE' and public.fan_web_account_erasing(old.app_user_id) and new.payload='{}'::jsonb
    and (to_jsonb(new)-'payload')=(to_jsonb(old)-'payload') then return new; end if;
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


CREATE OR REPLACE FUNCTION public.reject_submitted_live_survey_answer_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare response_status public.live_survey_response_status; owner_id uuid;
begin
  if tg_op='UPDATE' and old.free_text is not null and new.free_text='[deleted]'
    and (to_jsonb(new)-'free_text')=(to_jsonb(old)-'free_text') then
    select app_user_id into owner_id from public.live_survey_responses where id=old.response_id;
    if public.fan_web_account_erasing(owner_id) then return new; end if;
  end if;
  select status into strict response_status from public.live_survey_responses
  where id = coalesce(new.response_id, old.response_id);
  if response_status <> 'draft' then raise exception 'submitted survey answers are immutable'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


-- Audit action/entity/time remain immutable; only summaries belonging to the
-- deleting owner can be erased because review reasons may quote private input.
create function public.fan_web_owns_audit(p_owner uuid,p_actor uuid,p_entity text) returns boolean
language sql stable security definer set search_path='' as $$
  select p_actor=p_owner or p_entity=p_owner::text or p_entity in (
    select id::text from public.certification_submissions where app_user_id=p_owner
    union all select id::text from public.live_survey_responses where app_user_id=p_owner
    union all select id::text from public.cs_inquiries where app_user_id=p_owner
    union all select m.id::text from public.cs_messages m join public.cs_inquiries i on i.id=m.inquiry_id where i.app_user_id=p_owner or m.actor_app_user_id=p_owner
    union all select id::text from public.fan_posts where app_user_id=p_owner
    union all select id::text from public.fan_post_comments where app_user_id=p_owner
    union all select id::text from public.content_reports where app_user_id=p_owner or target_app_user_id=p_owner
    union all select id::text from public.schedule_suggestions where app_user_id=p_owner
    union all select id::text from public.fanpage_requests where app_user_id=p_owner
    union all select id::text from public.live_fan_submissions where app_user_id=p_owner
    union all select id::text from public.benefit_draw_winners where app_user_id=p_owner
    union all select f.id::text from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id where w.app_user_id=p_owner
  )
$$;
revoke all on function public.fan_web_owns_audit(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function public.reject_audit_log_mutation() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid:=nullif(pg_catalog.current_setting('byus.account_deletion_owner',true),'')::uuid;
begin
  if tg_op='UPDATE' then
    if public.fan_web_account_erasing(owner_id) and public.fan_web_owns_audit(owner_id,old.actor_app_user_id,old.entity_id)
      and new.before_after_summary='{}'::jsonb
      and (to_jsonb(new)-'before_after_summary')=(to_jsonb(old)-'before_after_summary') then return new; end if;
  end if;
  raise exception 'audit logs are append-only';
end $$;

create function public.has_approved_account_deletion(p_privy_user_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.account_deletion_requests d join public.app_users u on u.id=d.app_user_id
    where d.provider_subject=p_privy_user_id and u.status='disabled')
    or exists(select 1 from public.account_subject_tombstones where subject_hash=encode(extensions.digest(p_privy_user_id,'sha256'),'hex'))
$$;

create function public.begin_owned_account_deletion(p_privy_user_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.app_users%rowtype; v_subject_hash text:=encode(extensions.digest(p_privy_user_id,'sha256'),'hex');
begin
  if p_privy_user_id is null or p_privy_user_id<>pg_catalog.btrim(p_privy_user_id) or length(p_privy_user_id) not between 10 and 240 then
    raise exception 'ACCOUNT_DELETION_INVALID' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-subject:'||v_subject_hash,0));
  if exists(select 1 from public.account_subject_tombstones t where t.subject_hash=v_subject_hash) then
    return (select jsonb_build_object('appUserId',d.app_user_id,'status',d.status) from public.account_subject_tombstones t
      join public.account_deletion_requests d on d.app_user_id=t.app_user_id where t.subject_hash=v_subject_hash); end if;
  select * into u from public.app_users where privy_user_id=p_privy_user_id;
  if not found then raise exception 'ACCOUNT_DELETION_UNAVAILABLE' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||u.id::text,0));
  select * into u from public.app_users where id=u.id for update;
  insert into public.account_deletion_requests(app_user_id,provider_subject) values(u.id,u.privy_user_id) on conflict(app_user_id) do nothing;
  perform pg_catalog.set_config('byus.account_deletion_owner',u.id::text,true);
  update public.app_users set status='disabled' where id=u.id;
  update public.admin_allowlist set active=false,email=u.id::text||'@deleted.invalid' where email=u.verified_email;
  update public.community_stamp_share_links set revoked_at=pg_catalog.clock_timestamp() where owner_app_user_id=u.id and revoked_at is null;
  update public.push_subscriptions set disabled_at=coalesce(disabled_at,pg_catalog.clock_timestamp()) where app_user_id=u.id;
  update public.fan_notification_channels set status='disabled',consent_revoked_at=coalesce(consent_revoked_at,pg_catalog.clock_timestamp()) where app_user_id=u.id;
  update public.fan_notifications set superseded_at=coalesce(superseded_at,pg_catalog.clock_timestamp()) where app_user_id=u.id;
  delete from public.fan_web_notification_intents where recipient_app_user_id=u.id;
  delete from public.schedule_subscriptions where app_user_id=u.id;
  update public.content_assets set deleted_at=coalesce(deleted_at,pg_catalog.clock_timestamp()),cleanup_requested_at=coalesce(cleanup_requested_at,pg_catalog.clock_timestamp()),cleanup_retry_at=pg_catalog.clock_timestamp()
    where app_user_id=u.id and storage_deleted_at is null;
  insert into public.account_deletion_objects(app_user_id,bucket,object_path)
    select u.id,'fan-avatars',object_path from public.app_user_avatars where app_user_id=u.id and object_path is not null
    union select u.id,'certification-proofs',object_path from public.certification_uploads where app_user_id=u.id
    union select u.id,bucket,object_path from public.fan_private_uploads where app_user_id=u.id
    union select u.id,bucket_id,name from storage.objects where bucket_id in('fan-avatars','certification-proofs') and name like u.id::text||'/%'
    on conflict(bucket,object_path) do nothing;
  return jsonb_build_object('appUserId',u.id,'status',(select status from public.account_deletion_requests where app_user_id=u.id));
end $$;

create function public.scrub_account_deletion(p_app_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare subject text;
begin
  if not public.fan_web_account_erasing(p_app_user_id) then raise exception 'ACCOUNT_DELETION_UNAVAILABLE'; end if;
  select provider_subject into subject from public.account_deletion_requests where app_user_id=p_app_user_id;
  update public.audit_logs set before_after_summary='{}'::jsonb
    where public.fan_web_owns_audit(p_app_user_id,actor_app_user_id,entity_id) and before_after_summary<>'{}'::jsonb;
  delete from public.user_profiles where app_user_id=p_app_user_id;
  delete from public.app_user_avatars where app_user_id=p_app_user_id;
  delete from public.fan_notification_channel_private where channel_id in(select id from public.fan_notification_channels where app_user_id=p_app_user_id);
  update public.fan_notification_channels set destination_label='Deleted',destination_fingerprint=encode(extensions.digest('deleted-channel:'||id::text,'sha256'),'hex'),kakao_subject_hash=null,verification_method=null,enrollment_generation=null where app_user_id=p_app_user_id;
  update public.fan_connected_accounts set status='disconnected',disconnected_at=coalesce(disconnected_at,pg_catalog.clock_timestamp()),provider_subject_hash=encode(extensions.digest('deleted-account:'||id::text,'sha256'),'hex') where app_user_id=p_app_user_id;
  delete from public.kakao_connection_states where app_user_id=p_app_user_id;
  delete from public.kakao_phone_enrollments where app_user_id=p_app_user_id;
  update public.phone_sms_verification_challenges set phone=null,otp_digest=null,cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()) where app_user_id=p_app_user_id;
  update public.push_subscriptions set endpoint='https://deleted.invalid/'||id::text,endpoint_hash=encode(extensions.digest('deleted-push:'||id::text,'sha256'),'hex'),p256dh=repeat('0',40),auth_secret=repeat('0',16),user_agent=null where app_user_id=p_app_user_id;
  delete from public.benefit_recipient_private r using public.benefit_draw_winners w where w.id=r.winner_id and w.app_user_id=p_app_user_id;
  update public.benefit_fulfillment_events e set carrier=null,tracking_number=null,operator_memo=null
    from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id where e.fulfillment_id=f.id and w.app_user_id=p_app_user_id;
  update public.certification_submissions set note=null,rejection_reason=case when rejection_reason is null then null else 'Account deleted' end where app_user_id=p_app_user_id;
  update public.certification_review_operations r set rejection_reason=case when r.rejection_reason is null then null else 'Account deleted' end
    from public.certification_submissions s where r.submission_id=s.id and s.app_user_id=p_app_user_id;
  update public.cs_messages set body='[deleted]' where inquiry_id in(select id from public.cs_inquiries where app_user_id=p_app_user_id) or actor_app_user_id=p_app_user_id;
  update public.cs_inquiries set subject='[deleted]' where app_user_id=p_app_user_id;
  update public.celebrity_notice_comments set body='[deleted]',removed_at=coalesce(removed_at,pg_catalog.clock_timestamp()) where app_user_id=p_app_user_id;
  update public.fan_lounge_messages set body='[deleted]',removed_at=coalesce(removed_at,pg_catalog.clock_timestamp()) where app_user_id=p_app_user_id;
  update public.fan_posts set body='',hide_reason=null,deleted_at=coalesce(deleted_at,pg_catalog.clock_timestamp()) where app_user_id=p_app_user_id;
  update public.fan_post_comments set body='[deleted]',hide_reason=null,deleted_at=coalesce(deleted_at,pg_catalog.clock_timestamp()) where app_user_id=p_app_user_id;
  delete from public.fan_post_likes where app_user_id=p_app_user_id;
  delete from public.fan_lounge_message_reactions where app_user_id=p_app_user_id;
  delete from public.user_blocks where app_user_id=p_app_user_id or blocked_app_user_id=p_app_user_id;
  delete from public.content_translations where source_app_user_id=p_app_user_id;
  update public.content_translation_requests set app_user_id=null where app_user_id=p_app_user_id;
  delete from public.content_write_events where app_user_id=p_app_user_id;
  update public.content_reports set reason='Account deleted',resolution_reason=null where app_user_id=p_app_user_id or target_app_user_id=p_app_user_id;
  delete from public.live_fan_submissions where app_user_id=p_app_user_id;
  delete from public.schedule_suggestions where app_user_id=p_app_user_id;
  delete from public.fanpage_requests where app_user_id=p_app_user_id;
  update public.fan_notifications set payload='{}'::jsonb where app_user_id=p_app_user_id;
  update public.kakao_notification_attempts set payload='{}'::jsonb where app_user_id=p_app_user_id;
  update public.live_survey_answers a set free_text='[deleted]' from public.live_survey_responses r
    where a.response_id=r.id and r.app_user_id=p_app_user_id and a.free_text is not null;
  delete from public.instagram_owner_flows where actor_app_user_id=p_app_user_id;
  delete from public.instagram_connection_flows where celebrity_id in(select celebrity_id from public.instagram_connections where owner_app_user_id=p_app_user_id);
  update public.instagram_connections set owner_app_user_id=null,identity=null,ig_user_id=null,ig_scoped_id=null,token_ciphertext=null,token_issued_at=null,token_expires_at=null,
    authorization_started_at=null,connected_at=null,media='[]'::jsonb,media_fetched_at=null,live_observation=null,live_enabled=false,generation=extensions.gen_random_uuid(),lease_id=null,lease_until=null,live_lease_id=null,live_lease_until=null
    where owner_app_user_id=p_app_user_id;
  delete from public.apple_reauth_challenges where privy_user_id=subject;
  delete from public.apple_session_grants where privy_user_id=subject;
  delete from public.apple_relay_availability where subject_hash in(select subject_hash from public.apple_lifecycle_subjects where privy_user_id=subject);
  delete from public.apple_lifecycle_subjects where privy_user_id=subject;
  delete from public.apple_auth_owners where privy_user_id=subject;
end $$;

create function public.claim_account_deletion(p_app_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; job public.account_deletion_requests%rowtype; token uuid:=extensions.gen_random_uuid();
begin
  -- Choose without a row lock, then take the common user lock before any owner rows.
  select app_user_id into owner_id from public.account_deletion_requests where status='pending'
    and (p_app_user_id is null or app_user_id=p_app_user_id) and available_at<=pg_catalog.clock_timestamp()
    and (lease_until is null or lease_until<=pg_catalog.clock_timestamp()) order by available_at,app_user_id limit 1;
  if owner_id is null then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||owner_id::text,0));
  select * into job from public.account_deletion_requests where app_user_id=owner_id and status='pending'
    and (lease_until is null or lease_until<=pg_catalog.clock_timestamp()) for update;
  if not found then return null; end if;
  update public.account_deletion_requests set lease_token=token,lease_until=pg_catalog.clock_timestamp()+interval '5 minutes',attempts=attempts+1,last_error_code=null where app_user_id=owner_id;
  perform pg_catalog.set_config('byus.account_deletion_owner',owner_id::text,true);
  perform public.scrub_account_deletion(owner_id);
  -- An upload process can die before its finally block. Once its bounded lease
  -- expires, delete again instead of trusting a removal made before upload ended.
  insert into public.account_deletion_objects(app_user_id,bucket,object_path)
    select app_user_id,bucket,object_path from public.fan_private_uploads
      where app_user_id=owner_id and expires_at<=pg_catalog.clock_timestamp()
    on conflict(bucket,object_path) do update set storage_deleted_at=null,generation=public.account_deletion_objects.generation+1;
  delete from public.fan_private_uploads where app_user_id=owner_id and expires_at<=pg_catalog.clock_timestamp();
  return jsonb_build_object('appUserId',owner_id,'leaseToken',token,'providerSubject',job.provider_subject,
    'objects',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'bucket',o.bucket,'path',o.object_path,'generation',o.generation)) from (
      select * from public.account_deletion_objects where app_user_id=owner_id and storage_deleted_at is null order by id limit 100) o),'[]'::jsonb));
end $$;
create function public.finish_account_deletion_object(p_app_user_id uuid,p_lease_token uuid,p_object_id uuid,p_generation bigint) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||p_app_user_id::text,0));
  if not exists(select 1 from public.account_deletion_requests where app_user_id=p_app_user_id and lease_token=p_lease_token and lease_until>pg_catalog.clock_timestamp() and status='pending') then raise exception 'ACCOUNT_DELETION_LEASE_LOST'; end if;
  update public.account_deletion_objects set storage_deleted_at=pg_catalog.clock_timestamp()
    where id=p_object_id and app_user_id=p_app_user_id and generation=p_generation;
end $$;
create function public.account_deletion_storage_ready(p_app_user_id uuid,p_lease_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.account_deletion_requests where app_user_id=p_app_user_id and lease_token=p_lease_token and lease_until>pg_catalog.clock_timestamp() and status='pending')
    and not exists(select 1 from public.account_deletion_objects where app_user_id=p_app_user_id and storage_deleted_at is null)
    and not exists(select 1 from public.content_assets where app_user_id=p_app_user_id and (storage_deleted_at is null or upload_settled_at is null))
    and not exists(select 1 from public.fan_private_uploads where app_user_id=p_app_user_id and expires_at>pg_catalog.clock_timestamp())
$$;
create function public.complete_account_deletion(p_app_user_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare subject text;
begin
  select provider_subject into subject from public.account_deletion_requests where app_user_id=p_app_user_id;
  if subject is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-subject:'||encode(extensions.digest(subject,'sha256'),'hex'),0)); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||p_app_user_id::text,0));
  if not public.account_deletion_storage_ready(p_app_user_id,p_lease_token) then return false; end if;
  perform pg_catalog.set_config('byus.account_deletion_owner',p_app_user_id::text,true);
  perform public.scrub_account_deletion(p_app_user_id);
  if subject is not null then insert into public.account_subject_tombstones(subject_hash,app_user_id) values(encode(extensions.digest(subject,'sha256'),'hex'),p_app_user_id) on conflict do nothing; end if;
  update public.app_users set privy_user_id='deleted:'||id::text,verified_email=id::text||'@deleted.invalid',preferred_locale=null,last_authenticated_at=null where id=p_app_user_id and status='disabled';
  update public.account_deletion_requests set provider_subject=null,status='completed',completed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_until=null,last_error_code=null where app_user_id=p_app_user_id;
  return true;
end $$;
create function public.retry_account_deletion(p_app_user_id uuid,p_lease_token uuid,p_error_code text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||p_app_user_id::text,0));
  update public.account_deletion_requests set lease_token=null,lease_until=null,last_error_code=p_error_code,
    available_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
    where app_user_id=p_app_user_id and lease_token=p_lease_token and status='pending';
end $$;

-- A late/abandoned upload can re-open object cleanup after an earlier pass.
-- Preserve the receipt as pending until the new generation is removed.
create function public.fan_web_reopen_content_deletion() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.storage_deleted_at is null or new.upload_settled_at is null then
    update public.account_deletion_requests set status='pending',completed_at=null,available_at=pg_catalog.clock_timestamp()
      where app_user_id=new.app_user_id and status='completed';
  end if;
  return new;
end $$;
create trigger fan_web_reopen_content_deletion after update on public.content_assets
  for each row execute function public.fan_web_reopen_content_deletion();
revoke all on function public.fan_web_reopen_content_deletion() from public,anon,authenticated,service_role;

-- System publishers hold source/domain rows, not an acting fan's write lock.
-- An inactive recipient is a no-op; do not roll back publishing for other fans.
-- Existing enqueue/claim/pre-send checks still reject a concurrent disablement.
create or replace function public.insert_action_required_notification(p_app_user_id uuid,p_kind public.notification_kind,p_source_key text,
  p_live_event_id uuid,p_benefit_id uuid,p_deep_link text,p_payload jsonb,p_scheduled_for timestamptz default now())
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then return null; end if;
  insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,benefit_id,scheduled_for,deep_link,payload)
    values(p_app_user_id,p_kind,p_source_key,p_live_event_id,p_benefit_id,p_scheduled_for,p_deep_link,p_payload)
    on conflict(app_user_id,source_key) do update set source_key=excluded.source_key returning id into result;
  return result;
end $$;

-- Fence existing owner writes BEFORE their domain locks while keeping their
-- exact signatures/defaults/results and original implementation unchanged.
do $$ declare f record; old_name text; args text; call_args text; result_type text; code text; begin
  for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v'
      and 'p_app_user_id'=any(p.proargnames) and p.prosrc ~* '\m(insert|update|delete)\M'
      and p.prosrc not like '%fan_web_lock_active_user%' and p.proname not like '%account_deletion%'
      and p.proname not like 'fan_web_%' and p.proname not like '%_before_%'
      and p.proname not in('abandon_content_asset_upload','insert_action_required_notification','enqueue_historical_fan_action','record_product_event_v1')
      and has_function_privilege('service_role',p.oid,'EXECUTE') loop
    args:=pg_get_function_arguments(f.oid); result_type:=pg_get_function_result(f.oid);
    select string_agg(quote_ident(a),', ' order by ordinal) into call_args
      from unnest(f.proargnames) with ordinality x(a,ordinal) where ordinal<=f.pronargs;
    old_name:=left(f.proname,43)||'_fw_'||substr(md5(f.oid::text),1,8);
    execute format('alter function %s rename to %I',f.oid::regprocedure,old_name);
    code:=case when f.proretset then 'return query select * from ' when result_type='void' then 'perform ' else 'return ' end
      ||format('public.%I(%s);',old_name,call_args)||case when result_type='void' then ' return;' else '' end;
    execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as $f$ begin if p_app_user_id is not null then perform public.fan_web_lock_active_user(p_app_user_id); end if; %s end $f$',f.proname,args,result_type,code);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
    execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function public.%I(%s) to service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  end loop;
end $$;

create function public.fan_web_guard_owner_write() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if tg_table_name='live_survey_answers' then
    select app_user_id into owner_id from public.live_survey_responses where id=new.response_id;
  elsif tg_table_name='benefit_recipient_private' then
    select app_user_id into owner_id from public.benefit_draw_winners where id=new.winner_id;
  elsif tg_table_name='fan_notification_channel_private' then
    select app_user_id into owner_id from public.fan_notification_channels where id=new.channel_id;
  elsif tg_table_name='cs_messages' then
    if public.fan_web_account_erasing(new.actor_app_user_id) then return new; end if;
    select app_user_id into owner_id from public.cs_inquiries where id=new.inquiry_id;
  else owner_id:=(to_jsonb(new)->>tg_argv[0])::uuid; end if;
  if owner_id is null then return new; end if;
  if public.fan_web_account_erasing(owner_id) then return new; end if;
  -- Existing disable/consent/provider lifecycle cleanup remains legal. These
  -- exact monotonic changes can only remove contact data and sending authority.
  if tg_op='UPDATE' and exists(select 1 from public.app_users where id=owner_id and status='disabled') then
    if tg_table_name='phone_sms_verification_challenges' then
      if new.phone is null and new.otp_digest is null and new.cancelled_at is not null
        and (old.cancelled_at is null or new.cancelled_at=old.cancelled_at)
        and (to_jsonb(new)-array['phone','otp_digest','cancelled_at'])=(to_jsonb(old)-array['phone','otp_digest','cancelled_at']) then return new; end if;
    elsif tg_table_name='kakao_connection_states' then
      if new.expires_at<=old.expires_at and new.consumed_at is not null
        and (old.consumed_at is null or new.consumed_at=old.consumed_at)
        and (to_jsonb(new)-array['expires_at','consumed_at'])=(to_jsonb(old)-array['expires_at','consumed_at']) then return new; end if;
    elsif tg_table_name='fan_notification_channels' then
      if new.kind='kakao' and new.status='disabled' and new.verified_at is null
        and new.verification_method is null and new.enrollment_generation is null and new.kakao_subject_hash is null
        and new.consent_revoked_at is not null and (old.consent_revoked_at is null or new.consent_revoked_at=old.consent_revoked_at)
        and new.destination_label='Kakao' and new.destination_fingerprint=encode(extensions.digest('kakao-withdrawn:'||new.id::text,'sha256'),'hex')
        and (to_jsonb(new)-array['status','verified_at','consent_revoked_at','verification_method','enrollment_generation','kakao_subject_hash','destination_label','destination_fingerprint','updated_at'])
          =(to_jsonb(old)-array['status','verified_at','consent_revoked_at','verification_method','enrollment_generation','kakao_subject_hash','destination_label','destination_fingerprint','updated_at']) then return new; end if;
    end if;
  end if;
  -- Owner RPCs take this lock first. Indirect/admin writes may already hold a
  -- domain row: fail fast instead of waiting in the opposite lock order.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||owner_id::text,0)) then
    raise exception 'FAN_WEB_ACCOUNT_BUSY' using errcode='55P03'; end if;
  perform public.fan_web_lock_active_user(owner_id); return new;
end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['user_profiles','app_user_avatars','notification_preferences','fan_connected_accounts','fan_notification_channels',
    'kakao_connection_states','kakao_phone_enrollments','phone_sms_verification_challenges','certification_uploads','certification_submissions',
    'cs_inquiries','cs_messages','live_survey_responses','live_survey_answers','benefit_recipient_private','fan_notification_channel_private','celebrity_notice_comments','fan_lounge_messages','fan_posts','fan_post_comments','fan_post_likes'] loop
    execute format('create trigger fan_web_owner_write before insert or update on public.%I for each row execute function public.fan_web_guard_owner_write(''app_user_id'')',table_name);
  end loop;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like '%account_deletion%' or p.proname in('sync_privy_identity','fan_web_account_erasing','fan_web_begin_private_upload','fan_web_finish_private_upload','fan_web_guard_owner_write')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname not in('sync_privy_identity_before_account_deletion','scrub_account_deletion','fan_web_account_erasing','fan_web_guard_owner_write') then
      execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;
