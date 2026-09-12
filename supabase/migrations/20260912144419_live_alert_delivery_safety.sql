-- No production activation or historical queue mutation. New claims require
-- the guarded worker protocol; old workers fail closed after migration.
create table public.email_notification_send_attempts (
  delivery_id uuid primary key references public.external_notification_delivery_outbox(id) on delete restrict,
  worker_id text not null,
  attempt_count integer not null check(attempt_count>0),
  destination_fingerprint text not null check(destination_fingerprint~'^[0-9a-f]{64}$'),
  status text not null default 'sending' check(status in('sending','accepted','unknown')),
  provider_message_id text,
  error_code text,
  lease_expires_at timestamptz not null,
  started_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check((status='accepted' and provider_message_id is not null) or (status<>'accepted' and provider_message_id is null))
);
alter table public.email_notification_send_attempts enable row level security;
alter table public.email_notification_send_attempts force row level security;
revoke all on public.email_notification_send_attempts from public,anon,authenticated,service_role;

create function public.kakao_channel_supports_notification(p_channel_id uuid,p_kind text,p_payload jsonb,p_locale text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.fan_notification_channels c
    join public.fan_connected_accounts a on a.app_user_id=c.app_user_id and a.provider='kakao'
    join public.fan_notification_channel_private p on p.channel_id=c.id
    where c.id=p_channel_id and c.kind='kakao' and c.status='eligible'
      and c.verification_method='kakao_profile_owner_confirmation'
      and c.enrollment_generation is not null and c.verified_at is not null
      and c.consented_at is not null and c.consent_revoked_at is null
      and c.consent_version='kakao-alimtalk-v1'
      and a.status='connected' and a.provider_subject_hash=c.kakao_subject_hash
      and p.destination~'^010[0-9]{8}$'
      and encode(extensions.digest(p.destination,'sha256'),'hex')=c.destination_fingerprint
      and public.kakao_alimtalk_template_id(p_kind,p_payload,p_locale) is not null
  )
$$;
revoke all on function public.kakao_channel_supports_notification(uuid,text,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.create_external_notification_plan(p_notification_id uuid,p_now timestamptz default pg_catalog.now())
returns uuid language plpgsql security definer set search_path='' as $$
declare n public.fan_notifications%rowtype; locale text; primary_channel public.fan_notification_channels%rowtype;
  fallback_channel uuid; plan_id uuid; notification_payload jsonb;
begin
  select id into plan_id from public.notification_delivery_plans where notification_id=p_notification_id;
  if found then return plan_id; end if;
  select notification.* into n from public.fan_notifications notification
    join public.app_users u on u.id=notification.app_user_id and u.status='active'
    where notification.id=p_notification_id;
  if not found then return null; end if;
  select coalesce(preferred_locale,'ko') into strict locale from public.app_users where id=n.app_user_id;
  notification_payload:=public.build_external_notification_payload(n.id,locale);
  select c.* into primary_channel from public.fan_notification_channels c
    where c.app_user_id=n.app_user_id and c.status='eligible' and c.verified_at is not null
      and c.consented_at is not null and c.consent_revoked_at is null
      and ((c.kind='email' and n.kind::text not in('live_24h','live_cancelled'))
        or (c.kind='kakao' and public.kakao_channel_supports_notification(c.id,n.kind::text,notification_payload,locale)))
    order by case c.kind when 'kakao' then 1 else 2 end,c.priority,c.id limit 1;
  if not found then return null; end if;
  if primary_channel.kind='kakao' and n.kind::text not in('live_24h','live_cancelled') then
    select id into fallback_channel from public.fan_notification_channels
      where app_user_id=n.app_user_id and kind='email' and status='eligible' and verified_at is not null
        and consented_at is not null and consent_revoked_at is null limit 1;
  end if;
  insert into public.notification_delivery_plans(notification_id,primary_channel_id,fallback_channel_id,email_locale,created_at,updated_at)
    values(n.id,primary_channel.id,fallback_channel,locale,p_now,p_now)
    on conflict(notification_id) do nothing returning id into plan_id;
  if not found then
    select id into plan_id from public.notification_delivery_plans where notification_id=n.id;
    return plan_id;
  end if;
  insert into public.external_notification_delivery_outbox(plan_id,notification_id,channel_id,channel,sequence,template_key,locale,available_at)
    values(plan_id,n.id,primary_channel.id,primary_channel.kind,1,n.kind::text,locale,greatest(n.scheduled_for,p_now));
  return plan_id;
end $$;

create or replace function public.claim_email_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if p_worker_id is null or length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size is null or p_batch_size not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID'; end if;
  update public.external_notification_delivery_outbox d set status='failed',available_at='infinity',
    last_error_code=case when n.kind::text in('live_24h','live_cancelled') then 'EMAIL_KIND_SUPPRESSED' else 'EMAIL_NOT_ELIGIBLE' end,
    lease_owner=null,lease_expires_at=null,updated_at=p_now
    from public.fan_notifications n where n.id=d.notification_id and d.channel='email'
      and d.attempt_count<8 and d.available_at<=p_now and n.scheduled_for<=p_now
      and (d.status in('pending','failed') or (d.status='processing' and d.lease_expires_at<=p_now))
      and not exists(select 1 from public.email_notification_send_attempts a where a.delivery_id=d.id)
      and not public.email_notification_delivery_is_eligible(d.notification_id,d.channel_id,p_now);
  return query with due as(
    select d.id from public.external_notification_delivery_outbox d
      where d.channel='email' and d.attempt_count<8 and d.available_at<=p_now
        and (d.status in('pending','failed') or (d.status='processing' and d.lease_expires_at<=p_now))
        and not exists(select 1 from public.email_notification_send_attempts a where a.delivery_id=d.id)
        and public.email_notification_delivery_is_eligible(d.notification_id,d.channel_id,p_now)
      order by d.available_at,d.id for update skip locked limit p_batch_size
  ), claimed as(
    update public.external_notification_delivery_outbox d set status='processing',attempt_count=d.attempt_count+1,
      lease_owner=p_worker_id,lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),last_error_code=null,updated_at=p_now
      from due where d.id=due.id returning d.*
  ) select c.id,c.notification_id,c.plan_id,c.channel,c.sequence,c.template_key,c.locale,p.destination,
      public.build_external_notification_payload(c.notification_id,c.locale),c.attempt_count,c.lease_owner,c.lease_expires_at
    from claimed c join public.fan_notification_channel_private p on p.channel_id=c.channel_id;
end $$;

create function public.claim_email_notification_deliveries_safely(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language sql security definer set search_path='' as $$
  select * from public.claim_email_notification_deliveries(p_worker_id,p_batch_size,p_lease_seconds,p_now)
$$;
-- Old worker binaries have no begin protocol and must not obtain new jobs.
revoke all on function public.claim_email_notification_deliveries(text,integer,integer,timestamptz),
  public.claim_external_notification_deliveries(text,integer,integer,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_email_notification_deliveries_safely(text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_email_notification_deliveries_safely(text,integer,integer,timestamptz) to service_role;

create function public.begin_email_notification_send(p_delivery_id uuid,p_worker_id text,p_attempt_count integer,p_destination_fingerprint text)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.external_notification_delivery_outbox%rowtype; owner_id uuid; destination_hash text; inserted uuid;
begin
  select n.app_user_id into owner_id from public.external_notification_delivery_outbox o
    join public.fan_notifications n on n.id=o.notification_id where o.id=p_delivery_id and o.channel='email';
  if not found then return false; end if;
  -- Lock current owner/channel before delivery, matching enrollment/consent writes.
  perform 1 from public.app_users where id=owner_id and status='active' for share;
  if not found then return false; end if;
  perform 1 from public.fan_notification_channels c join public.external_notification_delivery_outbox o on o.channel_id=c.id
    where o.id=p_delivery_id for share of c;
  select encode(extensions.digest(p.destination,'sha256'),'hex') into destination_hash
    from public.fan_notification_channel_private p join public.external_notification_delivery_outbox o on o.channel_id=p.channel_id
    where o.id=p_delivery_id for share of p;
  select * into d from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if not found or d.channel<>'email' or d.status<>'processing'
    or d.lease_owner is distinct from p_worker_id or p_worker_id is null
    or d.attempt_count is distinct from p_attempt_count or p_attempt_count is null
    or d.lease_expires_at is null or d.lease_expires_at<=pg_catalog.now()
    or destination_hash is null or destination_hash is distinct from p_destination_fingerprint
    or not coalesce(public.email_notification_delivery_is_eligible(d.notification_id,d.channel_id),false) then return false; end if;
  insert into public.email_notification_send_attempts(delivery_id,worker_id,attempt_count,destination_fingerprint,lease_expires_at)
    values(d.id,p_worker_id,p_attempt_count,destination_hash,d.lease_expires_at)
    on conflict(delivery_id) do nothing returning delivery_id into inserted;
  return inserted is not null;
end $$;

create function public.finish_email_notification_send(p_delivery_id uuid,p_worker_id text,p_attempt_count integer,p_outcome text,p_provider_message_id text,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.email_notification_send_attempts%rowtype; target_plan uuid;
begin
  if p_outcome is null or p_outcome not in('accepted','unknown')
    or (p_outcome='accepted' and (p_provider_message_id is null or length(p_provider_message_id) not between 1 and 512))
    or (p_outcome='unknown' and p_provider_message_id is not null)
    or (p_error_code is not null and p_error_code!~'^[A-Z0-9_]{1,80}$') then raise exception 'EMAIL_RESULT_INVALID'; end if;
  select plan_id into target_plan from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if not found then return false; end if;
  select * into a from public.email_notification_send_attempts where delivery_id=p_delivery_id for update;
  if not found or a.worker_id is distinct from p_worker_id or a.attempt_count is distinct from p_attempt_count then return false; end if;
  if a.status='accepted' then
    return p_outcome='unknown' or a.provider_message_id is not distinct from p_provider_message_id;
  end if;
  -- The recorded attempt owns its result even after the original lease expires.
  update public.email_notification_send_attempts set status=p_outcome,provider_message_id=p_provider_message_id,
    error_code=p_error_code,updated_at=pg_catalog.now() where delivery_id=p_delivery_id;
  if p_outcome='accepted' then
    update public.external_notification_delivery_outbox set status='sent',sent_at=pg_catalog.now(),
      lease_owner=null,lease_expires_at=null,last_error_code=null,updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='sent',sent_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=target_plan;
  else
    update public.external_notification_delivery_outbox set status='failed',available_at='infinity',last_error_code='EMAIL_SEND_OUTCOME_UNKNOWN',
      lease_owner=null,lease_expires_at=null,updated_at=pg_catalog.now() where id=p_delivery_id;
    update public.notification_delivery_plans set status='failed',updated_at=pg_catalog.now() where id=target_plan;
  end if;
  return true;
end $$;
revoke all on function public.begin_email_notification_send(uuid,text,integer,text),
  public.finish_email_notification_send(uuid,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_email_notification_send(uuid,text,integer,text),
  public.finish_email_notification_send(uuid,text,integer,text,text,text) to service_role;

-- Existing adapters may call these paths before begin (validation failure), but
-- no legacy/manual path may mutate a delivery after its send permission is spent.
alter function public.revalidate_email_notification_delivery(uuid,text,timestamptz) rename to revalidate_email_before_send_guard;
create function public.revalidate_email_notification_delivery(p_delivery_id uuid,p_worker_id text,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if exists(select 1 from public.email_notification_send_attempts where delivery_id=p_delivery_id) then return false; end if;
  return public.revalidate_email_before_send_guard(p_delivery_id,p_worker_id,p_now);
end $$;
alter function public.complete_external_notification_delivery(uuid,text,text,timestamptz) rename to complete_external_before_email_guard;
create function public.complete_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_provider_message_id text,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if exists(select 1 from public.email_notification_send_attempts where delivery_id=p_delivery_id) then raise exception 'EMAIL_GUARDED_RESULT_REQUIRED'; end if;
  return public.complete_external_before_email_guard(p_delivery_id,p_worker_id,p_provider_message_id,p_now);
end $$;
alter function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz) rename to fail_external_before_email_guard;
create function public.fail_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if exists(select 1 from public.email_notification_send_attempts where delivery_id=p_delivery_id) then raise exception 'EMAIL_GUARDED_RESULT_REQUIRED'; end if;
  return public.fail_external_before_email_guard(p_delivery_id,p_worker_id,p_error_code,p_retryable,p_now);
end $$;
alter function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) rename to admin_retry_before_email_guard;
create function public.admin_retry_notification_delivery(p_delivery_id uuid,p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_idempotency_key uuid,p_correlation_id uuid,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  perform 1 from public.external_notification_delivery_outbox where id=p_delivery_id for update;
  if exists(select 1 from public.email_notification_send_attempts where delivery_id=p_delivery_id) then raise exception 'EMAIL_ALREADY_BEGUN_RETRY_FORBIDDEN'; end if;
  return public.admin_retry_before_email_guard(p_delivery_id,p_actor_app_user_id,p_actor_admin_allowlist_id,p_idempotency_key,p_correlation_id,p_now);
end $$;
revoke all on function public.revalidate_email_before_send_guard(uuid,text,timestamptz),
  public.complete_external_before_email_guard(uuid,text,text,timestamptz),
  public.fail_external_before_email_guard(uuid,text,text,boolean,timestamptz),
  public.admin_retry_before_email_guard(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.revalidate_email_notification_delivery(uuid,text,timestamptz),
  public.complete_external_notification_delivery(uuid,text,text,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revalidate_email_notification_delivery(uuid,text,timestamptz),
  public.complete_external_notification_delivery(uuid,text,text,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;

-- Preserve the existing admin DTO and pagination, and hide forbidden retry actions.
alter function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) rename to get_admin_deliveries_before_email_guard;
create function public.get_admin_notification_deliveries(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_status public.notification_delivery_status default null,p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$ declare result jsonb; items jsonb; begin
  result:=public.get_admin_deliveries_before_email_guard(p_actor_app_user_id,p_actor_admin_allowlist_id,p_status,p_limit,p_cursor_created_at,p_cursor_id);
  select coalesce(jsonb_agg(case when a.delivery_id is null then item.value else item.value||jsonb_build_object(
    'manuallyRetryable',false,'providerStatus',case when a.status='accepted' then null when a.status='sending' and a.lease_expires_at<=pg_catalog.now() then 'unknown' else a.status end,
    'providerMessageId',case when a.provider_message_id~'^[A-Za-z0-9_-]{2,128}$' then a.provider_message_id end,'providerStatusCode',a.error_code) end order by item.ordinality),'[]'::jsonb)
    into items from jsonb_array_elements(result->'items') with ordinality item
    left join public.email_notification_send_attempts a on a.delivery_id=(item.value->>'id')::uuid and item.value->>'channel'='email';
  return jsonb_set(result,'{items}',items);
end $$;
revoke all on function public.get_admin_deliveries_before_email_guard(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) to service_role;
