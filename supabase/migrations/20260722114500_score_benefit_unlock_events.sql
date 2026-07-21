-- SCORE-006 / BEN-013. Score projection events, durable notification-center
-- records, and push delivery outbox are committed with the score ledger row.

create table public.fan_level_events (
  id uuid primary key default extensions.gen_random_uuid(),
  source_ledger_id uuid not null references public.fan_score_ledger(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  previous_score integer not null check (previous_score >= 0),
  current_score integer not null check (current_score >= 0),
  previous_level text not null check (previous_level in ('Bronze','Silver','Gold','Platinum','Diamond')),
  current_level text not null check (current_level in ('Bronze','Silver','Gold','Platinum','Diamond')),
  occurred_at timestamptz not null default now(),
  constraint fan_level_events_upgrade_only check (
    case current_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 when 'Platinum' then 4 else 5 end
    > case previous_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 when 'Platinum' then 4 else 5 end
  ),
  unique (app_user_id, celebrity_id, current_level)
);

create table public.benefit_eligibility_changes (
  id uuid primary key default extensions.gen_random_uuid(),
  source_ledger_id uuid not null references public.fan_score_ledger(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  benefit_id uuid not null references public.benefits(id) on delete restrict,
  benefit_policy_version integer not null check (benefit_policy_version > 0),
  previous_state text not null check (previous_state = 'locked'),
  current_state text not null check (current_state = 'eligible'),
  previous_score integer not null check (previous_score >= 0),
  current_score integer not null check (current_score >= 0),
  occurred_at timestamptz not null default now(),
  unique (source_ledger_id, benefit_id),
  unique (app_user_id, benefit_id, benefit_policy_version)
);

-- Extend the PUSH/FAN-019 foundation instead of creating a parallel inbox.
alter table public.fan_notifications drop constraint fan_notifications_source_shape;
alter table public.fan_notifications
  add column celebrity_id uuid references public.celebrities(id) on delete restrict,
  add column source_event_id uuid,
  add column target_type text check (target_type is null or target_type in ('celebrity','benefit')),
  add column target_id uuid,
  add column deep_link text check (deep_link is null or (deep_link ~ '^/[a-z0-9/_-]+$' and deep_link !~ '//')),
  add column payload jsonb not null default '{}'::jsonb,
  add constraint fan_notifications_source_shape check (
    (kind in ('live_24h','live_10m','survey_reminder') and live_event_id is not null and benefit_id is null)
    or (kind = 'benefit_available' and benefit_id is not null and live_event_id is null)
    or (kind = 'level_up' and celebrity_id is not null and live_event_id is null and benefit_id is null)
    or (kind = 'benefit_unlocked' and celebrity_id is not null and benefit_id is not null and live_event_id is null)
  ),
  add constraint fan_notifications_event_payload check (
    kind not in ('level_up','benefit_unlocked')
    or (source_event_id is not null and target_type is not null and target_id is not null and deep_link is not null
      and jsonb_typeof(payload)='object' and payload ? 'schemaVersion' and payload ? 'celebrityId')
  ),
  add constraint fan_notifications_event_once unique(kind,source_event_id);

create function public.reject_progress_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'fan progress events are append-only';
end;
$$;
create trigger fan_level_events_append_only before update or delete on public.fan_level_events
for each row execute function public.reject_progress_event_mutation();
create trigger benefit_eligibility_changes_append_only before update or delete on public.benefit_eligibility_changes
for each row execute function public.reject_progress_event_mutation();
create trigger fan_level_events_reject_truncate before truncate on public.fan_level_events
for each statement execute function public.reject_progress_event_mutation();
create trigger benefit_eligibility_changes_reject_truncate before truncate on public.benefit_eligibility_changes
for each statement execute function public.reject_progress_event_mutation();

create function public.fan_level_for_score(p_score integer)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case when p_score >= 35 then 'Diamond' when p_score >= 20 then 'Platinum'
    when p_score >= 10 then 'Gold' when p_score >= 5 then 'Silver' else 'Bronze' end;
$$;

create function public.fan_level_rank(p_level text)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case p_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3
    when 'Platinum' then 4 when 'Diamond' then 5 else 0 end;
$$;

create function public.project_score_unlock_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_previous_score integer;
  v_current_score integer;
  v_previous_level text;
  v_current_level text;
  v_level_event_id uuid;
  v_change_id uuid;
  v_notification_id uuid;
  v_level record;
  v_benefit record;
begin
  -- validate_fan_score_weight already serializes this exact scope before insert.
  select coalesce(sum(points), 0)::integer into v_current_score
  from public.fan_score_ledger
  where app_user_id = new.app_user_id and celebrity_id = new.celebrity_id;
  v_previous_score := v_current_score - new.points;
  v_previous_level := public.fan_level_for_score(v_previous_score);
  v_current_level := public.fan_level_for_score(v_current_score);

  for v_level in
    select level.name from (values ('Silver',5,2),('Gold',10,3),('Platinum',20,4),('Diamond',35,5)) level(name,threshold,rank)
    where v_previous_score < level.threshold and v_current_score >= level.threshold
    order by level.rank
  loop
    v_level_event_id := extensions.gen_random_uuid();
    insert into public.fan_level_events(
      id,source_ledger_id,app_user_id,celebrity_id,previous_score,current_score,previous_level,current_level,occurred_at
    ) values (
      v_level_event_id,new.id,new.app_user_id,new.celebrity_id,v_previous_score,v_current_score,v_previous_level,v_level.name,new.created_at
    ) on conflict (app_user_id,celebrity_id,current_level) do nothing
    returning id into v_level_event_id;

    if v_level_event_id is not null then
      v_notification_id := extensions.gen_random_uuid();
      insert into public.fan_notifications(
        id,app_user_id,kind,source_key,scheduled_for,celebrity_id,source_event_id,target_type,target_id,deep_link,payload,created_at
      ) values (
        v_notification_id,new.app_user_id,'level_up','level:'||new.celebrity_id::text||':'||lower(v_level.name),new.created_at,
        new.celebrity_id,v_level_event_id,'celebrity',new.celebrity_id,
        '/passports',jsonb_build_object('schemaVersion',1,'celebrityId',new.celebrity_id,'previousScore',v_previous_score,
          'currentScore',v_current_score,'previousLevel',v_previous_level,'currentLevel',v_level.name),new.created_at
      ) on conflict (app_user_id,source_key) do nothing returning id into v_notification_id;
      if v_notification_id is not null then
        insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
        select v_notification_id,subscription.id,new.created_at from public.push_subscriptions subscription
        where subscription.app_user_id=new.app_user_id and subscription.disabled_at is null
        on conflict (notification_id,subscription_id) do nothing;
      end if;
    end if;
  end loop;

  perform public.project_benefit_unlock_events(new.id);
  return new;
end;
$$;

create function public.project_benefit_unlock_events(p_source_ledger_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  source_ledger public.fan_score_ledger%rowtype;
  previous_score integer;
  current_score integer;
  previous_level text;
  current_level text;
  benefit_record record;
  change_id uuid;
  created_notification_id uuid;
begin
  select * into source_ledger from public.fan_score_ledger where id=p_source_ledger_id;
  if not found then raise exception 'score ledger source is required'; end if;
  select coalesce(sum(points),0)::integer into current_score from public.fan_score_ledger
    where app_user_id=source_ledger.app_user_id and celebrity_id=source_ledger.celebrity_id;
  previous_score:=current_score-source_ledger.points;
  previous_level:=public.fan_level_for_score(previous_score);
  current_level:=public.fan_level_for_score(current_score);

  for benefit_record in
    select benefit.id,benefit.slug,benefit.revision from public.benefits benefit
    where benefit.celebrity_id=source_ledger.celebrity_id and benefit.publication_status='published' and benefit.archived_at is null
      and source_ledger.created_at>=benefit.claim_opens_at and source_ledger.created_at<benefit.claim_closes_at
      and (benefit.stock_limit is null or (select count(*) from public.benefit_claims claim where claim.benefit_id=benefit.id)<benefit.stock_limit)
      and (benefit.delivery_type<>'unique_code' or exists(select 1 from public.benefit_unique_codes code where code.benefit_id=benefit.id and code.claimed_by_claim_id is null))
      and not exists(select 1 from public.benefit_claims claim where claim.benefit_id=benefit.id and claim.app_user_id=source_ledger.app_user_id)
      and current_score>=benefit.minimum_score and public.fan_level_rank(current_level)>=public.fan_level_rank(benefit.minimum_level)
      and (benefit.required_stamp_type is null or exists(select 1 from public.stamps stamp where stamp.app_user_id=source_ledger.app_user_id and stamp.celebrity_id=source_ledger.celebrity_id and stamp.stamp_type=benefit.required_stamp_type))
      and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities activity where activity.app_user_id=source_ledger.app_user_id and activity.celebrity_id=source_ledger.celebrity_id and activity.activity_type=benefit.required_activity_type))
      and not (
        previous_score>=benefit.minimum_score and public.fan_level_rank(previous_level)>=public.fan_level_rank(benefit.minimum_level)
        and (benefit.required_stamp_type is null or exists(select 1 from public.stamps prior_stamp where prior_stamp.app_user_id=source_ledger.app_user_id and prior_stamp.celebrity_id=source_ledger.celebrity_id and prior_stamp.stamp_type=benefit.required_stamp_type and prior_stamp.activity_id is distinct from source_ledger.activity_id))
        and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities prior_activity where prior_activity.app_user_id=source_ledger.app_user_id and prior_activity.celebrity_id=source_ledger.celebrity_id and prior_activity.activity_type=benefit.required_activity_type and prior_activity.id is distinct from source_ledger.activity_id))
      ) order by benefit.id
  loop
    change_id:=extensions.gen_random_uuid();
    insert into public.benefit_eligibility_changes(id,source_ledger_id,app_user_id,celebrity_id,benefit_id,benefit_policy_version,previous_state,current_state,previous_score,current_score,occurred_at)
    values(change_id,source_ledger.id,source_ledger.app_user_id,source_ledger.celebrity_id,benefit_record.id,benefit_record.revision,'locked','eligible',previous_score,current_score,source_ledger.created_at)
    on conflict(app_user_id,benefit_id,benefit_policy_version) do nothing returning id into change_id;
    if change_id is null then continue; end if;
    created_notification_id:=extensions.gen_random_uuid();
    insert into public.fan_notifications(id,app_user_id,kind,source_key,benefit_id,scheduled_for,celebrity_id,source_event_id,target_type,target_id,deep_link,payload,created_at)
    values(created_notification_id,source_ledger.app_user_id,'benefit_unlocked','benefit:'||benefit_record.id::text||':policy:'||benefit_record.revision::text,benefit_record.id,source_ledger.created_at,source_ledger.celebrity_id,change_id,'benefit',benefit_record.id,'/benefits/'||benefit_record.id::text,
      jsonb_build_object('schemaVersion',1,'celebrityId',source_ledger.celebrity_id,'benefitId',benefit_record.id,'benefitSlug',benefit_record.slug,'benefitPolicyVersion',benefit_record.revision,'previousScore',previous_score,'currentScore',current_score),source_ledger.created_at)
    on conflict(app_user_id,source_key) do nothing returning id into created_notification_id;
    if created_notification_id is not null then
      insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
      select created_notification_id,subscription.id,source_ledger.created_at from public.push_subscriptions subscription
      where subscription.app_user_id=source_ledger.app_user_id and subscription.disabled_at is null
        and coalesce((select preference.benefit_notifications from public.notification_preferences preference where preference.app_user_id=source_ledger.app_user_id),true)
      on conflict(notification_id,subscription_id) do nothing;
    end if;
  end loop;
end;
$$;

create function public.project_stamp_benefit_unlock_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ledger_id uuid;
begin
  select ledger.id into ledger_id from public.fan_score_ledger ledger
  where ledger.activity_id=new.activity_id and ledger.app_user_id=new.app_user_id and ledger.celebrity_id=new.celebrity_id;
  if ledger_id is not null then perform public.project_benefit_unlock_events(ledger_id); end if;
  return new;
end;
$$;

create trigger fan_score_ledger_project_unlock_events
after insert on public.fan_score_ledger
for each row execute function public.project_score_unlock_events();
create trigger stamps_project_benefit_unlock_events
after insert on public.stamps
for each row execute function public.project_stamp_benefit_unlock_events();

alter table public.fan_level_events enable row level security;
alter table public.fan_level_events force row level security;
alter table public.benefit_eligibility_changes enable row level security;
alter table public.benefit_eligibility_changes force row level security;
alter table public.fan_notifications enable row level security;
alter table public.fan_notifications force row level security;
alter table public.notification_delivery_outbox enable row level security;
alter table public.notification_delivery_outbox force row level security;

revoke all on public.fan_level_events, public.benefit_eligibility_changes from public,anon,authenticated,service_role;
revoke all on function public.fan_level_for_score(integer), public.fan_level_rank(text),
  public.reject_progress_event_mutation(), public.project_score_unlock_events(),
  public.project_benefit_unlock_events(uuid), public.project_stamp_benefit_unlock_events() from public,anon,authenticated;

comment on table public.fan_notifications is 'Durable Notification Center truth; push failure never removes this row.';
comment on table public.notification_delivery_outbox is 'Per-subscription at-least-once delivery queue; delivery id is the downstream idempotency key.';
