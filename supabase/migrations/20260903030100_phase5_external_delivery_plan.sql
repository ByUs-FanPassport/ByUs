-- Provider-neutral Email/Kakao routing. Raw destinations are joined only while leasing.
create table public.notification_delivery_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null unique references public.fan_notifications(id) on delete restrict,
  primary_channel_id uuid not null references public.fan_notification_channels(id) on delete restrict,
  fallback_channel_id uuid references public.fan_notification_channels(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  current_sequence integer not null default 1 check(current_sequence in (1,2)),
  created_at timestamptz not null default pg_catalog.now(),updated_at timestamptz not null default pg_catalog.now(),sent_at timestamptz
);
create table public.external_notification_delivery_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.notification_delivery_plans(id) on delete restrict,
  notification_id uuid not null references public.fan_notifications(id) on delete restrict,
  channel_id uuid not null references public.fan_notification_channels(id) on delete restrict,
  channel text not null check(channel in ('email','kakao')),
  sequence integer not null check(sequence in (1,2)),
  template_key text not null check(template_key~'^[a-z0-9:_-]{3,160}$'),
  locale text not null default 'ko' check(locale in ('ko','en')),
  status public.notification_delivery_status not null default 'pending',
  available_at timestamptz not null default pg_catalog.now(),attempt_count integer not null default 0 check(attempt_count between 0 and 20),
  lease_owner text,lease_expires_at timestamptz,sent_at timestamptz,last_error_code text,
  created_at timestamptz not null default pg_catalog.now(),updated_at timestamptz not null default pg_catalog.now(),
  unique(plan_id,sequence),
  check((status='processing' and lease_owner is not null and lease_expires_at is not null and sent_at is null)
    or(status='sent' and sent_at is not null and lease_owner is null and lease_expires_at is null)
    or(status in('pending','failed') and sent_at is null and lease_owner is null and lease_expires_at is null))
);
create table public.notification_delivery_test_sink (
  id uuid primary key default extensions.gen_random_uuid(),delivery_id uuid not null unique references public.external_notification_delivery_outbox(id) on delete restrict,
  environment text not null check(environment='dev'),channel text not null check(channel in('email','kakao')),
  template_key text not null,redacted_destination text not null,payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
  result text not null check(result in('sent','permanent_failure','retryable_failure')),created_at timestamptz not null default pg_catalog.now()
);
create index external_notification_delivery_due_idx on public.external_notification_delivery_outbox(status,available_at,id) where status in('pending','failed','processing');
alter table public.notification_delivery_plans enable row level security;alter table public.notification_delivery_plans force row level security;
alter table public.external_notification_delivery_outbox enable row level security;alter table public.external_notification_delivery_outbox force row level security;
alter table public.notification_delivery_test_sink enable row level security;alter table public.notification_delivery_test_sink force row level security;
revoke all on table public.notification_delivery_plans,public.external_notification_delivery_outbox,public.notification_delivery_test_sink from public,anon,authenticated,service_role;

create function public.create_external_notification_plan(p_notification_id uuid,p_now timestamptz default pg_catalog.now())
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid;v_kind text;v_primary public.fan_notification_channels%rowtype;v_fallback public.fan_notification_channels%rowtype;v_plan uuid;
begin
 select app_user_id,kind::text into v_owner,v_kind from public.fan_notifications where id=p_notification_id;
 if not found then raise exception 'PHASE5_NOTIFICATION_NOT_FOUND';end if;
 select * into v_primary from public.fan_notification_channels where app_user_id=v_owner and status='eligible' and consented_at is not null and consent_revoked_at is null and verified_at is not null order by case kind when 'kakao' then 1 else 2 end,priority,id limit 1;
 if not found then return null;end if;
 if v_primary.kind='kakao' then select * into v_fallback from public.fan_notification_channels where app_user_id=v_owner and kind='email' and status='eligible' and consented_at is not null and consent_revoked_at is null and verified_at is not null limit 1;end if;
 insert into public.notification_delivery_plans(notification_id,primary_channel_id,fallback_channel_id,created_at,updated_at) values(p_notification_id,v_primary.id,v_fallback.id,p_now,p_now)
 on conflict(notification_id) do update set notification_id=excluded.notification_id returning id into v_plan;
 insert into public.external_notification_delivery_outbox(plan_id,notification_id,channel_id,channel,sequence,template_key,available_at)
 values(v_plan,p_notification_id,v_primary.id,v_primary.kind,1,v_kind,p_now) on conflict(plan_id,sequence) do nothing;
 return v_plan;
end $$;

create function public.claim_external_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if length(trim(p_worker_id)) not between 3 and 120 or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID';end if;
 return query with due as(select o.id from public.external_notification_delivery_outbox o where o.attempt_count<8 and o.available_at<=p_now and(o.status='pending' or o.status='failed' or(o.status='processing' and o.lease_expires_at<=p_now)) order by o.available_at,o.id for update skip locked limit p_batch_size),claimed as(update public.external_notification_delivery_outbox o set status='processing',attempt_count=o.attempt_count+1,lease_owner=p_worker_id,lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),last_error_code=null,updated_at=p_now from due where o.id=due.id returning o.*)
 select c.id,c.notification_id,c.plan_id,c.channel,c.sequence,c.template_key,c.locale,p.destination,
   jsonb_build_object('title',coalesce(n.payload->>'title','ByUs'),'detail',coalesce(n.payload->>'detail','새 소식을 확인해 주세요.'),'deepLink',coalesce(n.deep_link,'/my')),
   c.attempt_count,c.lease_owner,c.lease_expires_at from claimed c join public.fan_notification_channel_private p on p.channel_id=c.channel_id join public.fan_notifications n on n.id=c.notification_id;
end $$;

create function public.complete_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_provider_message_id text,p_now timestamptz default pg_catalog.now())returns boolean language plpgsql security definer set search_path='' as $$
declare v_plan uuid;begin update public.external_notification_delivery_outbox set status='sent',sent_at=p_now,lease_owner=null,lease_expires_at=null,updated_at=p_now where id=p_delivery_id and status='processing' and lease_owner=p_worker_id and lease_expires_at>p_now returning plan_id into v_plan;if not found then return false;end if;update public.notification_delivery_plans set status='sent',sent_at=p_now,updated_at=p_now where id=v_plan;return true;end $$;
create function public.fail_external_notification_delivery(p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,p_now timestamptz default pg_catalog.now())returns boolean language plpgsql security definer set search_path='' as $$
declare v public.external_notification_delivery_outbox%rowtype;v_plan public.notification_delivery_plans%rowtype;v_fallback public.fan_notification_channels%rowtype;begin
 select * into v from public.external_notification_delivery_outbox where id=p_delivery_id and status='processing' and lease_owner=p_worker_id and lease_expires_at>p_now for update;if not found then return false;end if;
 update public.external_notification_delivery_outbox set status='failed',available_at=case when p_retryable then p_now+interval '1 minute' else 'infinity'::timestamptz end,last_error_code=left(regexp_replace(upper(p_error_code),'[^A-Z0-9_]','','g'),80),lease_owner=null,lease_expires_at=null,updated_at=p_now where id=v.id;
 if not p_retryable then select * into v_plan from public.notification_delivery_plans where id=v.plan_id for update;if v.sequence=1 and v_plan.fallback_channel_id is not null then select * into v_fallback from public.fan_notification_channels where id=v_plan.fallback_channel_id;insert into public.external_notification_delivery_outbox(plan_id,notification_id,channel_id,channel,sequence,template_key,locale,available_at)values(v.plan_id,v.notification_id,v_fallback.id,v_fallback.kind,2,v.template_key,v.locale,p_now)on conflict(plan_id,sequence)do nothing;update public.notification_delivery_plans set current_sequence=2,updated_at=p_now where id=v.plan_id;else update public.notification_delivery_plans set status='failed',updated_at=p_now where id=v.plan_id;end if;end if;return true;end $$;
create function public.record_notification_test_sink(p_delivery_id uuid,p_environment text,p_channel text,p_template_key text,p_redacted_destination text,p_payload_hash text,p_result text)returns boolean language plpgsql security definer set search_path='' as $$begin if p_environment<>'dev' then raise exception 'PHASE5_TEST_SINK_DEV_ONLY';end if;insert into public.notification_delivery_test_sink(delivery_id,environment,channel,template_key,redacted_destination,payload_hash,result)values(p_delivery_id,p_environment,p_channel,p_template_key,p_redacted_destination,p_payload_hash,p_result)on conflict(delivery_id)do nothing;return true;end $$;

revoke all on function public.create_external_notification_plan(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_external_notification_deliveries(text,integer,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_external_notification_delivery(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.record_notification_test_sink(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_external_notification_plan(uuid,timestamptz),public.claim_external_notification_deliveries(text,integer,integer,timestamptz),public.complete_external_notification_delivery(uuid,text,text,timestamptz),public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),public.record_notification_test_sink(uuid,text,text,text,text,text,text) to service_role;
