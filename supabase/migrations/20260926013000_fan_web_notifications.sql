-- Enum values are used through text/casts in runtime functions, never as new enum
-- constants in a constraint evaluated in the migration transaction.
alter type public.notification_kind add value if not exists 'content_reply';
alter type public.notification_kind add value if not exists 'official_post';
alter type public.notification_kind add value if not exists 'schedule_reminder';
alter type public.notification_kind add value if not exists 'schedule_changed';
alter type public.notification_kind add value if not exists 'schedule_cancelled';
alter type public.notification_kind add value if not exists 'schedule_suggestion_reviewed';
alter type public.notification_kind add value if not exists 'fanpage_request_reviewed';
alter table public.fan_notifications add column web_only boolean not null default false;
alter table public.notification_preferences add column reply_notifications boolean not null default true,
  add column official_post_notifications boolean not null default true, add column schedule_notifications boolean not null default true;

create function public.fan_web_notification_kind(p_kind text) returns boolean language sql immutable set search_path='' as $$
  select p_kind in('content_reply','official_post','schedule_reminder','schedule_changed','schedule_cancelled','schedule_suggestion_reviewed','fanpage_request_reviewed')
$$;
do $$ declare previous text; begin
  select pg_get_expr(conbin,conrelid) into strict previous from pg_constraint
    where conrelid='public.fan_notifications'::regclass and conname='fan_notifications_source_shape';
  alter table public.fan_notifications drop constraint fan_notifications_source_shape;
  execute 'alter table public.fan_notifications add constraint fan_notifications_source_shape check (('||previous||') or (public.fan_web_notification_kind(kind::text) and live_event_id is null and benefit_id is null and web_only))';
end $$;
alter table public.fan_notifications add constraint fan_notifications_web_only_kind
  check (not public.fan_web_notification_kind(kind::text) or web_only);

create function public.fan_web_force_notification_channel() returns trigger language plpgsql set search_path='' as $$
begin
  if public.fan_web_notification_kind(new.kind::text) then new.web_only:=true; end if;
  return new;
end $$;
create trigger fan_web_force_notification_channel before insert or update on public.fan_notifications
  for each row execute function public.fan_web_force_notification_channel();

create function public.fan_web_notification_can_send(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select not n.web_only and not public.fan_web_notification_kind(n.kind::text)
    from public.fan_notifications n join public.app_users u on u.id=n.app_user_id and u.status='active'
    where n.id=p_notification_id),false)
$$;

-- Preserve every existing consent, release, Apple and LIVE-state condition.
alter function public.notification_delivery_is_eligible(uuid,timestamptz) rename to notification_delivery_is_eligible_before_fan_web;
create function public.notification_delivery_is_eligible(p_notification_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.fan_web_notification_can_send(p_notification_id) and public.notification_delivery_is_eligible_before_fan_web(p_notification_id,p_at)
$$;
alter function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz) rename to email_notification_delivery_is_eligible_before_fan_web;
create function public.email_notification_delivery_is_eligible(p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.fan_web_notification_can_send(p_notification_id) and public.email_notification_delivery_is_eligible_before_fan_web(p_notification_id,p_channel_id,p_at)
$$;
alter function public.kakao_notification_delivery_is_eligible(uuid,timestamptz) rename to kakao_notification_delivery_is_eligible_before_fan_web;
create function public.kakao_notification_delivery_is_eligible(p_delivery_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.fan_web_notification_can_send(o.notification_id) and public.kakao_notification_delivery_is_eligible_before_fan_web(p_delivery_id,p_at)
  from public.external_notification_delivery_outbox o where o.id=p_delivery_id
$$;
alter function public.create_external_notification_plan(uuid,timestamptz) rename to create_external_notification_plan_before_fan_web;
create function public.create_external_notification_plan(p_notification_id uuid,p_now timestamptz default pg_catalog.now())
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not public.fan_web_notification_can_send(p_notification_id) then return null; end if;
  return public.create_external_notification_plan_before_fan_web(p_notification_id,p_now);
end $$;
create or replace function public.phase5_enqueue_notification_deliveries() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.fan_web_notification_can_send(new.id) then return new; end if;
  insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
    select new.id,s.id,greatest(new.scheduled_for,pg_catalog.now()) from public.push_subscriptions s
    where s.app_user_id=new.app_user_id and s.disabled_at is null on conflict(notification_id,subscription_id) do nothing;
  perform public.create_external_notification_plan(new.id,pg_catalog.now()); return new;
end $$;
create function public.fan_web_guard_external_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.fan_web_notification_can_send(new.notification_id) then return null; end if;
  return new;
end $$;
-- Backfills, direct enqueue and claim transitions cannot reintroduce web-only delivery.
create trigger fan_web_outbound_push before insert on public.notification_delivery_outbox for each row execute function public.fan_web_guard_external_notification();
create trigger fan_web_outbound_plan before insert on public.notification_delivery_plans for each row execute function public.fan_web_guard_external_notification();
create trigger fan_web_outbound_external before insert on public.external_notification_delivery_outbox for each row execute function public.fan_web_guard_external_notification();
create trigger fan_web_claim_push before update of status on public.notification_delivery_outbox for each row when(new.status='processing') execute function public.fan_web_guard_external_notification();
create trigger fan_web_claim_external before update of status on public.external_notification_delivery_outbox for each row when(new.status='processing') execute function public.fan_web_guard_external_notification();

-- Producers hold actor/domain locks. Persist only an intent here; never acquire
-- another user's lock. Delivery materialization acquires recipient locks first.
create table public.fan_web_notification_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_app_user_id uuid not null references public.app_users(id) on delete restrict,
  kind text not null check(public.fan_web_notification_kind(kind)),
  target_type text not null, target_id uuid not null, revision integer not null check(revision>0),
  scheduled_for timestamptz not null, created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(recipient_app_user_id,kind,target_id,revision)
);
alter table public.fan_web_notification_intents enable row level security;
alter table public.fan_web_notification_intents force row level security;
revoke all on public.fan_web_notification_intents from public,anon,authenticated,service_role;
create function public.fan_web_emit_notification(p_owner uuid,p_kind text,p_target_type text,p_target_id uuid,p_revision integer,p_at timestamptz)
returns void language sql security definer set search_path='' as $$
  insert into public.fan_web_notification_intents(recipient_app_user_id,kind,target_type,target_id,revision,scheduled_for)
    values(p_owner,p_kind,p_target_type,p_target_id,p_revision,p_at)
    on conflict(recipient_app_user_id,kind,target_id,revision) do nothing
$$;
create function public.fan_web_drain_notification_intents(p_app_user_id uuid default null,p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare owner_id uuid; intent public.fan_web_notification_intents%rowtype; enabled boolean; inserted integer:=0;
begin
  if p_limit not between 1 and 1000 then raise exception 'INVALID_NOTIFICATION_BATCH'; end if;
  for owner_id in select distinct recipient_app_user_id from public.fan_web_notification_intents
    where (p_app_user_id is null or recipient_app_user_id=p_app_user_id) and scheduled_for<=pg_catalog.clock_timestamp()
    order by recipient_app_user_id limit p_limit loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||owner_id::text,0));
    if not exists(select 1 from public.app_users where id=owner_id and status='active') then
      delete from public.fan_web_notification_intents where recipient_app_user_id=owner_id; continue; end if;
    for intent in select * from public.fan_web_notification_intents where recipient_app_user_id=owner_id
      and scheduled_for<=pg_catalog.clock_timestamp() order by scheduled_for,id limit p_limit for update skip locked loop
      select case when intent.kind='content_reply' then reply_notifications when intent.kind='official_post' then official_post_notifications else schedule_notifications end
        into enabled from public.notification_preferences where app_user_id=owner_id;
      if enabled is distinct from false then
        insert into public.fan_notifications(app_user_id,kind,source_key,scheduled_for,deep_link,payload,web_only)
          values(owner_id,intent.kind::public.notification_kind,'web:'||intent.kind||':'||intent.target_id||':'||intent.revision,intent.scheduled_for,'/my',
            jsonb_build_object('targetType',intent.target_type,'targetId',intent.target_id,'revision',intent.revision),true)
          on conflict(app_user_id,source_key) do nothing;
        if found then inserted:=inserted+1; end if;
      end if;
      delete from public.fan_web_notification_intents where id=intent.id;
    end loop;
  end loop;
  return inserted;
end $$;

alter function public.enqueue_due_fan_notifications(timestamptz) rename to enqueue_due_fan_notifications_before_fan_web;
create function public.enqueue_due_fan_notifications(p_now timestamptz default pg_catalog.now())
returns integer language plpgsql security definer set search_path='' as $$
declare drained integer;
begin
  drained:=public.fan_web_drain_notification_intents();
  return drained+public.enqueue_due_fan_notifications_before_fan_web(p_now);
end $$;

create function public.fan_web_content_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if tg_table_name='fan_post_comments' then
    if new.parent_id is null then select app_user_id into owner_id from public.fan_posts where id=new.post_id;
    else select app_user_id into owner_id from public.fan_post_comments where id=new.parent_id; end if;
    if owner_id<>new.app_user_id and exists(select 1 from public.app_users where id=owner_id and status='active')
      and public.fan_web_content_visible(owner_id,'fan_post_comment',new.id) then
      perform public.fan_web_emit_notification(owner_id,'content_reply','fan_post_comment',new.id,1,pg_catalog.clock_timestamp()); end if;
  elsif new.publication_status='published' and new.ever_published_at is not null
    and (tg_op='INSERT' or old.ever_published_at is null) then
    for owner_id in select p.app_user_id from public.fan_passports p join public.app_users u on u.id=p.app_user_id and u.status='active'
      where p.celebrity_id=new.celebrity_id and p.business_status='issued' order by p.app_user_id loop
      if public.fan_web_content_visible(owner_id,'notice',new.id) then
        perform public.fan_web_emit_notification(owner_id,'official_post','notice',new.id,1,pg_catalog.clock_timestamp()); end if;
    end loop;
  end if;
  return new;
end $$;
create trigger fan_web_reply_notification after insert on public.fan_post_comments for each row execute function public.fan_web_content_notifications();
create trigger fan_web_official_notification after insert or update on public.celebrity_notices for each row execute function public.fan_web_content_notifications();

create function public.fan_web_schedule_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; s public.celebrity_schedules%rowtype; kind text; target uuid;
begin
  if tg_table_name='schedule_subscriptions' then
    select * into s from public.celebrity_schedules where id=new.schedule_id;
    if s.status='published' and s.starts_at>pg_catalog.clock_timestamp() then
      perform public.fan_web_emit_notification(new.app_user_id,'schedule_reminder','schedule',s.id,s.revision,greatest(s.starts_at-interval '24 hours',pg_catalog.clock_timestamp())); end if;
  elsif tg_table_name='celebrity_schedules' then
    if old.revision=new.revision then return new; end if;
    delete from public.fan_web_notification_intents where target_type='schedule' and target_id=new.id and revision<new.revision;
    update public.fan_notifications set superseded_at=pg_catalog.clock_timestamp(),superseded_by_revision=new.revision
      where web_only and payload->>'targetType'='schedule' and payload->>'targetId'=new.id::text and superseded_at is null;
    if old.status='published' and new.status in('published','cancelled') then
      kind:=case when new.status='cancelled' then 'schedule_cancelled' else 'schedule_changed' end;
      for owner_id in select sub.app_user_id from public.schedule_subscriptions sub join public.app_users u on u.id=sub.app_user_id and u.status='active'
        where sub.schedule_id=new.id order by sub.app_user_id loop
        perform public.fan_web_emit_notification(owner_id,kind,'schedule',new.id,new.revision,pg_catalog.clock_timestamp());
        if new.status='published' and new.starts_at>pg_catalog.clock_timestamp() then
          perform public.fan_web_emit_notification(owner_id,'schedule_reminder','schedule',new.id,new.revision,greatest(new.starts_at-interval '24 hours',pg_catalog.clock_timestamp())); end if;
      end loop;
    end if;
  elsif old.status='pending' and new.status in('approved','rejected') then
    if exists(select 1 from public.app_users where id=new.app_user_id and status='active') then
      kind:=case when tg_table_name='schedule_suggestions' then 'schedule_suggestion_reviewed' else 'fanpage_request_reviewed' end;
      perform public.fan_web_emit_notification(new.app_user_id,kind,tg_table_name,new.id,new.revision,pg_catalog.clock_timestamp()); end if;
  end if;
  return new;
end $$;
create trigger fan_web_subscription_notification after insert on public.schedule_subscriptions for each row execute function public.fan_web_schedule_notifications();
create trigger fan_web_schedule_notification after update on public.celebrity_schedules for each row execute function public.fan_web_schedule_notifications();
create trigger fan_web_suggestion_notification after update on public.schedule_suggestions for each row execute function public.fan_web_schedule_notifications();
create trigger fan_web_request_notification after update on public.fanpage_requests for each row execute function public.fan_web_schedule_notifications();

create function public.fan_web_notification_path(p_owner uuid,p_notification uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare n public.fan_notifications%rowtype; target uuid; path text;
begin
  select * into n from public.fan_notifications where id=p_notification and app_user_id=p_owner
    and scheduled_for<=pg_catalog.now() and superseded_at is null;
  if not found or not exists(select 1 from public.app_users where id=p_owner and status='active') then return null; end if;
  if not n.web_only then return coalesce(n.deep_link,'/my'); end if;
  if n.payload->>'targetId' !~ '^[0-9a-f-]{36}$' then return null; end if;
  target:=(n.payload->>'targetId')::uuid;
  if n.kind::text='content_reply' then
    if not public.fan_web_content_visible(p_owner,'fan_post_comment',target) then return null; end if;
    select '/c/'||c.slug||'/community/'||p.id||'#comment-'||target into path
      from public.fan_post_comments x join public.fan_posts p on p.id=x.post_id join public.celebrities c on c.id=p.celebrity_id where x.id=target;
  elsif n.kind::text='official_post' then
    if not public.fan_web_content_visible(p_owner,'notice',target) then return null; end if;
    select '/c/'||c.slug||'/notices/'||x.slug into path from public.celebrity_notices x join public.celebrities c on c.id=x.celebrity_id where x.id=target;
  elsif n.kind::text in('schedule_reminder','schedule_changed','schedule_cancelled') then
    select '/live/calendar/schedules/'||s.id into path from public.celebrity_schedules s
      join public.celebrities c on c.id=s.celebrity_id and c.status='published' and c.archived_at is null
      join public.schedule_subscriptions sub on sub.schedule_id=s.id and sub.app_user_id=p_owner
      where s.id=target and s.revision=(n.payload->>'revision')::integer
      and ((n.kind::text='schedule_cancelled' and s.status='cancelled') or (n.kind::text<>'schedule_cancelled' and s.status='published'))
      and (n.kind::text<>'schedule_reminder' or s.starts_at>pg_catalog.now());
  elsif n.kind::text='schedule_suggestion_reviewed' then
    select '/my/requests?tab=schedules&item='||id into path from public.schedule_suggestions where id=target and app_user_id=p_owner and status<>'pending';
  elsif n.kind::text='fanpage_request_reviewed' then
    select '/my/requests?tab=fanpages&item='||id into path from public.fanpage_requests where id=target and app_user_id=p_owner and status<>'pending';
  end if;
  return path;
end $$;

create function public.get_owned_web_notifications(p_app_user_id uuid,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]'::jsonb) from (
    select n.id,n.created_at,to_jsonb(n)||jsonb_build_object('deep_link',v.path,
      'live_events',case when e.id is null then null else jsonb_build_object('id',e.id,'slug',e.slug,'live_event_localizations',
        coalesce((select jsonb_agg(jsonb_build_object('locale',locale,'title',title)) from public.live_event_localizations where live_event_id=e.id and locale=p_locale),'[]'::jsonb)) end,
      'benefits',case when b.id is null then null else jsonb_build_object('id',b.id,'slug',b.slug,'benefit_localizations',
        coalesce((select jsonb_agg(jsonb_build_object('locale',locale,'title',title)) from public.benefit_localizations where benefit_id=b.id and locale=p_locale),'[]'::jsonb)) end) item
    from public.fan_notifications n left join public.live_events e on e.id=n.live_event_id left join public.benefits b on b.id=n.benefit_id
    cross join lateral(select public.fan_web_notification_path(p_app_user_id,n.id) path) v
    where n.app_user_id=p_app_user_id and v.path is not null order by n.created_at desc,n.id desc limit 100
  ) x
$$;
-- Owner writes take the active-account lock before their preference/domain row.
create function public.fan_web_patch_notification_preferences(p_app_user_id uuid,p_patch jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_each(p_patch) x
    where x.key not in('live_reminders','survey_reminders','benefit_notifications','reply_notifications','official_post_notifications','schedule_notifications') or jsonb_typeof(x.value)<>'boolean') then
    raise exception 'INVALID_NOTIFICATION_PREFERENCES' using errcode='22023'; end if;
  insert into public.notification_preferences(app_user_id) values(p_app_user_id) on conflict do nothing;
  update public.notification_preferences set
    live_reminders=coalesce((p_patch->>'live_reminders')::boolean,live_reminders),
    survey_reminders=coalesce((p_patch->>'survey_reminders')::boolean,survey_reminders),
    benefit_notifications=coalesce((p_patch->>'benefit_notifications')::boolean,benefit_notifications),
    reply_notifications=coalesce((p_patch->>'reply_notifications')::boolean,reply_notifications),
    official_post_notifications=coalesce((p_patch->>'official_post_notifications')::boolean,official_post_notifications),
    schedule_notifications=coalesce((p_patch->>'schedule_notifications')::boolean,schedule_notifications)
    where app_user_id=p_app_user_id;
end $$;
create function public.fan_web_disable_push_subscription(p_app_user_id uuid,p_endpoint_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  update public.push_subscriptions set disabled_at=coalesce(disabled_at,pg_catalog.clock_timestamp())
    where app_user_id=p_app_user_id and endpoint_hash=p_endpoint_hash;
end $$;
revoke all on function public.fan_web_disable_push_subscription(uuid,text) from public,anon,authenticated;
grant execute on function public.fan_web_disable_push_subscription(uuid,text) to service_role;

create function public.count_owned_web_notifications(p_app_user_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from public.fan_notifications n where n.app_user_id=p_app_user_id
    and n.read_at is null and public.fan_web_notification_path(p_app_user_id,n.id) is not null
$$;
create function public.mark_owned_web_notifications_read(p_app_user_id uuid,p_notification_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  perform public.fan_web_lock_active_user(p_app_user_id);
  update public.fan_notifications n set read_at=coalesce(n.read_at,pg_catalog.clock_timestamp())
    where n.app_user_id=p_app_user_id and (p_notification_id is null or n.id=p_notification_id)
    and public.fan_web_notification_path(p_app_user_id,n.id) is not null;
  get diagnostics changed=row_count; return changed>0;
end $$;

-- All snapshots share the inbox visibility/count rules.
alter function public.get_owned_my_fan_activity(uuid,public.content_locale,timestamptz) rename to get_owned_my_fan_activity_before_fan_web;
create function public.get_owned_my_fan_activity(p_app_user_id uuid,p_locale public.content_locale,p_as_of timestamptz default pg_catalog.now())
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(public.get_owned_my_fan_activity_before_fan_web(p_app_user_id,p_locale,p_as_of),'{unreadNotificationCount}',to_jsonb(public.count_owned_web_notifications(p_app_user_id)))
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and (p.proname like 'fan_web_%notification%' or p.proname in(
      'get_owned_web_notifications','count_owned_web_notifications','mark_owned_web_notifications_read',
      'notification_delivery_is_eligible','email_notification_delivery_is_eligible','kakao_notification_delivery_is_eligible',
      'create_external_notification_plan','get_owned_my_fan_activity','enqueue_due_fan_notifications') or p.proname like '%_before_fan_web') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.signature::text not like '%_before_fan_web(%' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;
