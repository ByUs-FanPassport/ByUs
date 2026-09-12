-- Release policy is a second gate independent of provider modes. Migration
-- deliberately leaves every existing delivery/plan/consent row untouched.
create table public.fan_notification_delivery_control (
  channel text primary key check(channel in ('email','kakao')),
  mode text not null default 'disabled' check(mode in ('disabled','test','enabled')),
  activated_at timestamptz,
  test_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(mode='disabled' or activated_at is not null),
  check((mode='test' and cardinality(test_user_ids) between 1 and 2 and array_position(test_user_ids,null) is null)
    or (mode<>'test' and cardinality(test_user_ids)=0))
);
alter table public.fan_notification_delivery_control enable row level security;
alter table public.fan_notification_delivery_control force row level security;
revoke all on public.fan_notification_delivery_control from public,anon,authenticated,service_role;
insert into public.fan_notification_delivery_control(channel) values('email'),('kakao');

-- Operations-only API: no caller-supplied/backdated cutoff, no runtime grant.
-- Pause provider modes and drain prior invocations before changing release mode.
create function public.configure_fan_notification_delivery(p_channel text,p_mode text,p_test_user_ids uuid[] default '{}')
returns timestamptz language plpgsql security definer set search_path='' as $$
declare prior timestamptz; cutoff timestamptz;
begin
  if p_channel is null or p_channel not in('email','kakao') or p_mode is null or p_mode not in('disabled','test','enabled')
    or p_test_user_ids is null or array_ndims(p_test_user_ids)>1
    or array_position(p_test_user_ids,null) is not null
    or (p_mode='test' and cardinality(p_test_user_ids) not between 1 and 2)
    or (p_mode<>'test' and cardinality(p_test_user_ids)<>0) then raise exception 'FAN_DELIVERY_CONTROL_INVALID'; end if;
  if p_mode='test' and exists(select 1 from unnest(p_test_user_ids) u(id)
    where not exists(select 1 from public.app_users a where a.id=u.id and a.status='active')) then
    raise exception 'FAN_DELIVERY_TEST_USER_INVALID';
  end if;
  select activated_at into prior from public.fan_notification_delivery_control where channel=p_channel for update;
  if not found then raise exception 'FAN_DELIVERY_CONTROL_MISSING'; end if;
  -- Take the timestamp after acquiring the control lock. Every release creates
  -- a new window, including test -> enabled and disabled -> enabled.
  cutoff:=case when p_mode='disabled' then prior
    else greatest(pg_catalog.clock_timestamp(),prior+interval '1 microsecond') end;
  update public.fan_notification_delivery_control set mode=p_mode,activated_at=cutoff,
    test_user_ids=p_test_user_ids,updated_at=pg_catalog.clock_timestamp() where channel=p_channel;
  return cutoff;
end $$;
revoke all on function public.configure_fan_notification_delivery(text,text,uuid[]) from public,anon,authenticated,service_role;

create function public.lock_fan_notification_delivery_control(p_channel text)
returns void language plpgsql security definer set search_path='' as $$ begin
  perform 1 from public.fan_notification_delivery_control where channel=p_channel for share;
end $$;
create function public.fan_notification_is_released(p_notification_id uuid,p_channel text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fan_notification_delivery_control c
    join public.fan_notifications n on n.id=p_notification_id
    where c.channel=p_channel and n.created_at>c.activated_at
      and (c.mode='enabled' or (c.mode='test' and n.app_user_id=any(c.test_user_ids))))
$$;
revoke all on function public.lock_fan_notification_delivery_control(text),public.fan_notification_is_released(uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.claim_email_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_fan_notification_delivery_control('email');
  if p_worker_id is null or length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size is null or p_batch_size not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID'; end if;
  update public.external_notification_delivery_outbox d set status='failed',available_at='infinity',
    last_error_code=case when n.kind::text in('live_24h','live_cancelled') then 'EMAIL_KIND_SUPPRESSED' else 'EMAIL_NOT_ELIGIBLE' end,
    lease_owner=null,lease_expires_at=null,updated_at=p_now
    from public.fan_notifications n where n.id=d.notification_id and d.channel='email'
      and public.fan_notification_is_released(d.notification_id,'email')
      and d.attempt_count<8 and d.available_at<=p_now and n.scheduled_for<=p_now
      and (d.status in('pending','failed') or (d.status='processing' and d.lease_expires_at<=p_now))
      and not exists(select 1 from public.email_notification_send_attempts a where a.delivery_id=d.id)
      and not public.email_notification_delivery_is_eligible(d.notification_id,d.channel_id,p_now);
  return query with due as(
    select d.id from public.external_notification_delivery_outbox d
      where d.channel='email' and public.fan_notification_is_released(d.notification_id,'email')
      and d.attempt_count<8 and d.available_at<=p_now
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
    where public.fan_notification_is_released(delivery.notification_id,'kakao') and delivery.channel='kakao' and delivery.available_at<=pg_catalog.now()
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

alter function public.begin_email_notification_send(uuid,text,integer,text) rename to begin_email_before_release;
create function public.begin_email_notification_send(p_delivery_id uuid,p_worker_id text,p_attempt_count integer,p_destination_fingerprint text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  perform public.lock_fan_notification_delivery_control('email');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='email';
  if n is not null and not public.fan_notification_is_released(n,'email') then return false; end if;
  return public.begin_email_before_release(p_delivery_id,p_worker_id,p_attempt_count,p_destination_fingerprint);
end $$;
revoke all on function public.begin_email_notification_send(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.begin_email_notification_send(uuid,text,integer,text) to service_role;

alter function public.begin_kakao_notification_send(uuid,uuid,text,text) rename to begin_kakao_before_release;
create function public.begin_kakao_notification_send(p_delivery_id uuid,p_attempt_token uuid,p_template_id text,p_request_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  perform public.lock_fan_notification_delivery_control('kakao');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='kakao';
  if n is not null and not public.fan_notification_is_released(n,'kakao') then return false; end if;
  return public.begin_kakao_before_release(p_delivery_id,p_attempt_token,p_template_id,p_request_hash);
end $$;
revoke all on function public.begin_kakao_notification_send(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_kakao_notification_send(uuid,uuid,text,text) to service_role;

alter function public.revalidate_email_notification_delivery(uuid,text,timestamptz) rename to revalidate_email_before_release;
create function public.revalidate_email_notification_delivery(p_delivery_id uuid,p_worker_id text,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  perform public.lock_fan_notification_delivery_control('email');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='email';
  if n is not null and not public.fan_notification_is_released(n,'email') then return false; end if;
  return public.revalidate_email_before_release(p_delivery_id,p_worker_id,p_now);
end $$;
revoke all on function public.revalidate_email_notification_delivery(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.revalidate_email_notification_delivery(uuid,text,timestamptz) to service_role;

alter function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz) rename to fail_external_before_release;
create function public.fail_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  perform public.lock_fan_notification_delivery_control('email');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='email';
  if n is not null and not public.fan_notification_is_released(n,'email') then return false; end if;
  return public.fail_external_before_release(p_delivery_id,p_worker_id,p_error_code,p_retryable,p_now);
end $$;
revoke all on function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz) to service_role;

alter function public.complete_external_notification_delivery(uuid,text,text,timestamptz) rename to complete_external_before_release;
create function public.complete_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_provider_message_id text,p_now timestamptz default pg_catalog.now())
returns boolean language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
  perform public.lock_fan_notification_delivery_control('email');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='email';
  if n is not null and not public.fan_notification_is_released(n,'email') then return false; end if;
  return public.complete_external_before_release(p_delivery_id,p_worker_id,p_provider_message_id,p_now);
end $$;
revoke all on function public.complete_external_notification_delivery(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_external_notification_delivery(uuid,text,text,timestamptz) to service_role;

alter function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) rename to admin_retry_before_release;
create function public.admin_retry_notification_delivery(p_delivery_id uuid,p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_idempotency_key uuid,p_correlation_id uuid,p_now timestamptz default pg_catalog.now())
returns jsonb language plpgsql security definer set search_path='' as $$ declare d record; begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  -- Admin retry can address either push or external; push behavior is unchanged.
  perform public.lock_fan_notification_delivery_control('email');
  perform public.lock_fan_notification_delivery_control('kakao');
  select notification_id,channel into d from public.external_notification_delivery_outbox where id=p_delivery_id;
  if found and not public.fan_notification_is_released(d.notification_id,d.channel) then raise exception 'FAN_DELIVERY_NOT_RELEASED'; end if;
  return public.admin_retry_before_release(p_delivery_id,p_actor_app_user_id,p_actor_admin_allowlist_id,p_idempotency_key,p_correlation_id,p_now);
end $$;
revoke all on function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_retry_notification_delivery(uuid,uuid,uuid,uuid,uuid,timestamptz) to service_role;

alter function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) rename to admin_deliveries_before_release;
create function public.get_admin_notification_deliveries(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_status public.notification_delivery_status default null,p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$ declare result jsonb; items jsonb; begin
  result:=public.admin_deliveries_before_release(p_actor_app_user_id,p_actor_admin_allowlist_id,p_status,p_limit,p_cursor_created_at,p_cursor_id);
  select coalesce(jsonb_agg(case when d.id is not null and not public.fan_notification_is_released(d.notification_id,d.channel)
    then item.value||jsonb_build_object('manuallyRetryable',false) else item.value end order by item.ordinality),'[]'::jsonb)
    into items from jsonb_array_elements(result->'items') with ordinality item
    left join public.external_notification_delivery_outbox d on d.id=(item.value->>'id')::uuid and item.value->>'channel' in('email','kakao');
  return jsonb_set(result,'{items}',items);
end $$;
revoke all on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_notification_deliveries(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid) to service_role;

-- Preserve receipt/finish/reconciliation for sends begun before a pause. They
-- only record outcomes; they cannot create a new send permission.
revoke all on function
  public.begin_email_before_release(uuid,text,integer,text),
  public.begin_kakao_before_release(uuid,uuid,text,text),
  public.revalidate_email_before_release(uuid,text,timestamptz),
  public.fail_external_before_release(uuid,text,text,boolean,timestamptz),
  public.complete_external_before_release(uuid,text,text,timestamptz),
  public.admin_retry_before_release(uuid,uuid,uuid,uuid,uuid,timestamptz),
  public.admin_deliveries_before_release(uuid,uuid,public.notification_delivery_status,integer,timestamptz,uuid)
from public,anon,authenticated,service_role;

-- A malformed claimed payload can be suppressed before begin. A pause must
-- protect that prepared historical row as well, while retaining begun ACKs.
alter function public.record_kakao_notification_submission(uuid,uuid,text,text,text,text) rename to kakao_submission_before_release;
create function public.record_kakao_notification_submission(p_delivery_id uuid,p_attempt_token uuid,p_outcome text,p_provider_message_id text,p_group_id text,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$ declare n uuid; begin
  perform public.lock_fan_notification_delivery_control('kakao');
  select notification_id into n from public.external_notification_delivery_outbox where id=p_delivery_id and channel='kakao';
  if n is not null and not public.fan_notification_is_released(n,'kakao')
    and not exists(select 1 from public.kakao_notification_attempts where delivery_id=p_delivery_id and sending_at is not null) then return false; end if;
  return public.kakao_submission_before_release(p_delivery_id,p_attempt_token,p_outcome,p_provider_message_id,p_group_id,p_error_code);
end $$;
revoke all on function public.kakao_submission_before_release(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_kakao_notification_submission(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_kakao_notification_submission(uuid,uuid,text,text,text,text) to service_role;
