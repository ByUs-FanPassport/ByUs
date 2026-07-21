-- PUSH-001..005 / FAN-019: private notification inbox, Web Push subscriptions,
-- and duplicate-safe reminder scheduling. Delivery workers consume the outbox;
-- browser credentials never enter a public projection.

create type public.notification_kind as enum (
  'live_24h', 'live_10m', 'survey_reminder', 'benefit_available'
);
create type public.notification_delivery_status as enum ('pending', 'processing', 'sent', 'failed');

create table public.push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_hash),
  constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://[^[:space:]]+$'),
  constraint push_subscriptions_endpoint_hash check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  constraint push_subscriptions_keys_complete check (length(p256dh) between 20 and 200 and length(auth_secret) between 8 and 100)
);

create table public.notification_preferences (
  app_user_id uuid primary key references public.app_users(id) on delete restrict,
  live_reminders boolean not null default true,
  survey_reminders boolean not null default true,
  benefit_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fan_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  kind public.notification_kind not null,
  source_key text not null,
  live_event_id uuid references public.live_events(id) on delete restrict,
  benefit_id uuid references public.benefits(id) on delete restrict,
  scheduled_for timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (app_user_id, source_key),
  constraint fan_notifications_source_shape check (
    (kind in ('live_24h','live_10m','survey_reminder') and live_event_id is not null and benefit_id is null)
    or (kind = 'benefit_available' and benefit_id is not null and live_event_id is null)
  ),
  constraint fan_notifications_source_key_safe check (source_key ~ '^[a-z0-9:_-]{3,160}$')
);

create table public.notification_delivery_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null references public.fan_notifications(id) on delete restrict,
  subscription_id uuid not null references public.push_subscriptions(id) on delete restrict,
  status public.notification_delivery_status not null default 'pending',
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  lease_owner text,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, subscription_id),
  constraint notification_delivery_state check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null and sent_at is null)
    or (status = 'sent' and sent_at is not null and lease_owner is null and lease_expires_at is null)
    or (status in ('pending','failed') and sent_at is null and lease_owner is null and lease_expires_at is null)
  )
);

create index fan_notifications_owner_created_idx on public.fan_notifications(app_user_id, created_at desc, id desc);
create index notification_delivery_due_idx on public.notification_delivery_outbox(status, available_at) where status in ('pending','failed');
create index push_subscriptions_owner_active_idx on public.push_subscriptions(app_user_id) where disabled_at is null;

create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function public.set_updated_at();
create trigger notification_preferences_set_updated_at before update on public.notification_preferences
for each row execute function public.set_updated_at();
create trigger notification_delivery_outbox_set_updated_at before update on public.notification_delivery_outbox
for each row execute function public.set_updated_at();

create function public.notification_delivery_is_eligible(p_notification_id uuid,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when notification.kind::text in ('live_24h','live_10m') then
      coalesce(preference.live_reminders,true)
      and public.live_effective_status_at(notification.live_event_id,p_at)='scheduled'
    when notification.kind::text='survey_reminder' then
      coalesce(preference.survey_reminders,true)
      and public.live_effective_status_at(notification.live_event_id,p_at)='ended'
      and not exists (select 1 from public.live_survey_responses response where response.app_user_id=notification.app_user_id and response.live_event_id=notification.live_event_id and response.status='submitted')
    when notification.kind::text in ('benefit_available','benefit_unlocked') then
      coalesce(preference.benefit_notifications,true)
      and exists (select 1 from public.benefits benefit where benefit.id=notification.benefit_id and benefit.publication_status='published'
        and benefit.archived_at is null and p_at>=benefit.claim_opens_at and p_at<benefit.claim_closes_at
        and not exists (select 1 from public.benefit_claims claim where claim.benefit_id=benefit.id and claim.app_user_id=notification.app_user_id))
    else true
  end
  from public.fan_notifications notification
  left join public.notification_preferences preference on preference.app_user_id=notification.app_user_id
  where notification.id=p_notification_id;
$$;

create function public.backfill_notification_deliveries(p_now timestamptz default now(),p_app_user_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
  select notification.id,subscription.id,greatest(notification.scheduled_for,p_now)
  from public.fan_notifications notification
  join public.push_subscriptions subscription on subscription.app_user_id=notification.app_user_id and subscription.disabled_at is null
  where notification.scheduled_for<=p_now and (p_app_user_id is null or notification.app_user_id=p_app_user_id)
    and public.notification_delivery_is_eligible(notification.id,p_now)
  on conflict (notification_id,subscription_id) do nothing;
  get diagnostics changed=row_count; return changed;
end $$;

create function public.register_push_subscription(p_app_user_id uuid,p_endpoint text,p_endpoint_hash text,p_p256dh text,p_auth_secret text,p_user_agent text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing public.push_subscriptions%rowtype; subscription_id uuid;
begin
  if p_endpoint !~ '^https://[^[:space:]]+$' or p_endpoint_hash !~ '^[0-9a-f]{64}$'
    or p_endpoint_hash<>encode(extensions.digest(p_endpoint,'sha256'),'hex')
    or length(p_p256dh) not between 20 and 200 or length(p_auth_secret) not between 8 and 100 then raise exception 'invalid push subscription'; end if;
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then raise exception 'active app user required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_endpoint_hash,0));
  select * into existing from public.push_subscriptions where endpoint_hash=p_endpoint_hash for update;
  if found and existing.app_user_id<>p_app_user_id then
    if exists(select 1 from public.notification_delivery_outbox where subscription_id=existing.id and status='processing') then raise exception using errcode='55P03',message='push subscription transfer is busy'; end if;
    update public.notification_delivery_outbox set status='failed',available_at='infinity'::timestamptz,last_error_code='SUBSCRIPTION_OWNER_CHANGED'
      where subscription_id=existing.id and status in ('pending','failed');
    update public.push_subscriptions set app_user_id=p_app_user_id,endpoint=p_endpoint,p256dh=p_p256dh,auth_secret=p_auth_secret,user_agent=p_user_agent,disabled_at=null where id=existing.id returning id into subscription_id;
  elsif found then
    update public.push_subscriptions set endpoint=p_endpoint,p256dh=p_p256dh,auth_secret=p_auth_secret,user_agent=p_user_agent,disabled_at=null where id=existing.id returning id into subscription_id;
  else
    insert into public.push_subscriptions(app_user_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent) values(p_app_user_id,p_endpoint,p_endpoint_hash,p_p256dh,p_auth_secret,p_user_agent) returning id into subscription_id;
  end if;
  perform public.backfill_notification_deliveries(now(),p_app_user_id);
  return true;
end $$;

create function public.enqueue_due_fan_notifications(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0; current_count integer;
begin
  -- A late cron run may catch up while the live is still scheduled, but never
  -- emits both reminders after the event has begun. The owner/source unique key
  -- makes repeated and concurrent scheduler invocations converge.
  with candidates as (
    select reservation.app_user_id, live.id live_event_id, reminder.kind,
      reminder.due_at, reminder.source_key
    from public.live_reservations reservation
    join public.live_events live on live.id = reservation.live_event_id
    cross join lateral (values
      ('live_24h'::public.notification_kind, live.starts_at - interval '24 hours', 'live:'||live.id::text||':24h'),
      ('live_10m'::public.notification_kind, live.starts_at - interval '10 minutes', 'live:'||live.id::text||':10m')
    ) reminder(kind, due_at, source_key)
    where live.publication_status = 'published' and public.live_effective_status_at(live.id,p_now)='scheduled'
      and reminder.due_at <= p_now and p_now < live.starts_at
      and coalesce((select preference.live_reminders from public.notification_preferences preference where preference.app_user_id=reservation.app_user_id),true)
  ), inserted as (
    insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for)
    select app_user_id,kind,source_key,live_event_id,due_at from candidates
    on conflict (app_user_id,source_key) do nothing returning id,app_user_id,scheduled_for
  )
  insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
  select inserted.id,subscription.id,greatest(inserted.scheduled_for,p_now) from inserted
  join public.push_subscriptions subscription on subscription.app_user_id=inserted.app_user_id and subscription.disabled_at is null;
  get diagnostics current_count = row_count; inserted_count := inserted_count + current_count;

  -- Only verified attendees with a published survey are candidates. A submitted
  -- response is excluded at insertion time; drafts remain eligible.
  with candidates as (
    select attendance.app_user_id, live.id live_event_id, live.ends_at due_at,
      'live:'||live.id::text||':survey' source_key
    from public.live_attendances attendance
    join public.live_events live on live.id = attendance.live_event_id
    join public.live_surveys survey on survey.live_event_id = live.id and survey.publication_status = 'published'
    where live.ends_at <= p_now and public.live_effective_status_at(live.id,p_now)='ended'
      and coalesce((select preference.survey_reminders from public.notification_preferences preference where preference.app_user_id=attendance.app_user_id),true)
      and not exists (select 1 from public.live_survey_responses response
        where response.app_user_id=attendance.app_user_id and response.live_event_id=live.id and response.status='submitted')
  ), inserted as (
    insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for)
    select app_user_id,'survey_reminder',source_key,live_event_id,due_at from candidates
    on conflict (app_user_id,source_key) do nothing returning id,app_user_id,scheduled_for
  )
  insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
  select inserted.id,subscription.id,greatest(inserted.scheduled_for,p_now) from inserted
  join public.push_subscriptions subscription on subscription.app_user_id=inserted.app_user_id and subscription.disabled_at is null;
  get diagnostics current_count = row_count; inserted_count := inserted_count + current_count;

  -- Benefit notifications are projected only by the authoritative eligibility
  -- transition trigger (BEN-013), never from the claim window alone.
  inserted_count:=inserted_count+public.backfill_notification_deliveries(p_now,null);
  return inserted_count;
end; $$;

create function public.claim_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)
returns table(id uuid,notification_id uuid,kind public.notification_kind,endpoint text,p256dh text,auth_secret text,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if length(trim(p_worker_id)) not between 3 and 120 or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'invalid notification worker claim'; end if;
  update public.notification_delivery_outbox delivery set status='failed',available_at='infinity'::timestamptz,
    last_error_code='CURRENT_STATE_INELIGIBLE',lease_owner=null,lease_expires_at=null
  where (delivery.status in ('pending','failed') or (delivery.status='processing' and delivery.lease_expires_at<=now())) and delivery.available_at<=now()
    and not public.notification_delivery_is_eligible(delivery.notification_id,now());
  return query
  with due as (
    select delivery.id from public.notification_delivery_outbox delivery
    where delivery.attempt_count < 8 and delivery.available_at <= now()
      and (delivery.status in ('pending','failed') or (delivery.status='processing' and delivery.lease_expires_at <= now()))
      and exists (select 1 from public.push_subscriptions subscription where subscription.id=delivery.subscription_id and subscription.disabled_at is null)
      and public.notification_delivery_is_eligible(delivery.notification_id,now())
    order by delivery.available_at,delivery.id for update skip locked limit p_batch_size
  ), claimed as (
    update public.notification_delivery_outbox delivery set status='processing',attempt_count=delivery.attempt_count+1,
      lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),last_error_code=null
    from due where delivery.id=due.id returning delivery.*
  )
  select claimed.id,claimed.notification_id,notification.kind,subscription.endpoint,subscription.p256dh,subscription.auth_secret,
    claimed.attempt_count,claimed.lease_owner,claimed.lease_expires_at
  from claimed join public.fan_notifications notification on notification.id=claimed.notification_id
  join public.push_subscriptions subscription on subscription.id=claimed.subscription_id
  where subscription.disabled_at is null;
end $$;

create function public.complete_notification_delivery(p_delivery_id uuid,p_worker_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.notification_delivery_outbox set status='sent',sent_at=now(),lease_owner=null,lease_expires_at=null
  where id=p_delivery_id and status='processing' and lease_owner=p_worker_id and lease_expires_at>now();
  get diagnostics changed=row_count; return changed=1;
end $$;

create function public.retry_notification_delivery(p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_disable_subscription boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer; target_subscription uuid;
begin
  select subscription_id into target_subscription from public.notification_delivery_outbox
  where id=p_delivery_id and status='processing' and lease_owner=p_worker_id and lease_expires_at>now() for update;
  if target_subscription is null then return false; end if;
  update public.notification_delivery_outbox set status='failed',available_at=case when p_retryable and attempt_count<8 then now()+make_interval(secs=>least(3600,30*power(2,attempt_count-1)::integer)) else 'infinity'::timestamptz end,
    last_error_code=left(regexp_replace(upper(p_error_code),'[^A-Z0-9_]','','g'),80),lease_owner=null,lease_expires_at=null where id=p_delivery_id;
  get diagnostics changed=row_count;
  if p_disable_subscription then
    update public.push_subscriptions set disabled_at=coalesce(disabled_at,now()) where id=target_subscription;
    update public.notification_delivery_outbox set status='failed',available_at='infinity'::timestamptz,last_error_code='PUSH_SUBSCRIPTION_GONE'
    where subscription_id=target_subscription and id<>p_delivery_id and status in ('pending','failed');
  end if;
  return changed=1;
end $$;

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.fan_notifications enable row level security;
alter table public.notification_delivery_outbox enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.notification_preferences force row level security;
alter table public.fan_notifications force row level security;
alter table public.notification_delivery_outbox force row level security;
revoke all on public.push_subscriptions, public.notification_preferences, public.fan_notifications, public.notification_delivery_outbox from public, anon, authenticated;
revoke all on function public.enqueue_due_fan_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.notification_delivery_is_eligible(uuid,timestamptz),public.backfill_notification_deliveries(timestamptz,uuid),public.register_push_subscription(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_notification_deliveries(text,integer,integer),public.complete_notification_delivery(uuid,text),public.retry_notification_delivery(uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant select,insert,update on public.push_subscriptions to service_role;
grant select,insert,update on public.notification_preferences to service_role;
grant select,insert,update on public.fan_notifications to service_role;
grant select,insert,update on public.notification_delivery_outbox to service_role;
grant execute on function public.enqueue_due_fan_notifications(timestamptz) to service_role;
grant execute on function public.register_push_subscription(uuid,text,text,text,text,text) to service_role;
grant execute on function public.claim_notification_deliveries(text,integer,integer),public.complete_notification_delivery(uuid,text),public.retry_notification_delivery(uuid,text,text,boolean,boolean) to service_role;

comment on function public.enqueue_due_fan_notifications(timestamptz) is
'Cron entrypoint. Duplicate-safe by app_user_id/source_key; excludes submitted survey respondents.';
