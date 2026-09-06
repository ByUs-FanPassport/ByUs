-- Localized, lifecycle-safe email delivery for the complete fan notification set.
-- LIVE cancellation and 24-hour reminders remain available to inbox/push/Kakao,
-- but are deliberately excluded from email at every delivery boundary.

alter table public.app_users
  add column preferred_locale text,
  add constraint app_users_preferred_locale_supported
    check (preferred_locale is null or preferred_locale in ('ko','en'));

create function public.initialize_owned_preferred_locale(
  p_app_user_id uuid,
  p_locale text
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_locale text;
begin
  if p_locale is null or p_locale not in ('ko','en') then
    raise exception 'PREFERRED_LOCALE_INVALID' using errcode='22023';
  end if;

  update public.app_users
  set preferred_locale=p_locale
  where id=p_app_user_id and status='active' and preferred_locale is null
  returning preferred_locale into v_locale;

  if not found then
    select preferred_locale into v_locale
    from public.app_users
    where id=p_app_user_id and status='active';
    if not found then
      raise exception 'ACTIVE_APP_USER_REQUIRED' using errcode='42501';
    end if;
  end if;
  return coalesce(v_locale,'ko');
end $$;

create function public.set_owned_preferred_locale(
  p_app_user_id uuid,
  p_locale text
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_locale text;
begin
  if p_locale is null or p_locale not in ('ko','en') then
    raise exception 'PREFERRED_LOCALE_INVALID' using errcode='22023';
  end if;
  update public.app_users
  set preferred_locale=p_locale
  where id=p_app_user_id and status='active'
  returning preferred_locale into v_locale;
  if not found then
    raise exception 'ACTIVE_APP_USER_REQUIRED' using errcode='42501';
  end if;
  return v_locale;
end $$;

revoke all on function public.initialize_owned_preferred_locale(uuid,text),
  public.set_owned_preferred_locale(uuid,text) from public,anon,authenticated;
grant execute on function public.initialize_owned_preferred_locale(uuid,text),
  public.set_owned_preferred_locale(uuid,text) to service_role;

alter table public.notification_delivery_plans
  add column email_locale text not null default 'ko'
    check (email_locale in ('ko','en'));
update public.notification_delivery_plans plan
set email_locale=coalesce(app_user.preferred_locale,'ko')
from public.fan_notifications notification
join public.app_users app_user on app_user.id=notification.app_user_id
where notification.id=plan.notification_id;

-- The action-required migration accidentally omitted the existing level_up
-- source shape. Restore it while retaining all later Phase 5 kinds.
alter table public.fan_notifications drop constraint fan_notifications_source_shape;
alter table public.fan_notifications add constraint fan_notifications_source_shape check (
  (kind in (
    'live_reserved','live_24h','live_10m','live_changed','live_cancelled',
    'survey_reminder','collectible_claim_available','collectible_claim_expiring'
  ) and live_event_id is not null and benefit_id is null)
  or (kind='level_up' and celebrity_id is not null and live_event_id is null and benefit_id is null)
  or (kind='benefit_unlocked' and celebrity_id is not null and benefit_id is not null and live_event_id is null)
  or (kind in ('benefit_available','benefit_won','recipient_information_required','fulfillment_meaningful_update')
    and benefit_id is not null and live_event_id is null)
);

create function public.email_notification_delivery_is_eligible(
  p_notification_id uuid,
  p_channel_id uuid,
  p_at timestamptz default pg_catalog.now()
) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    notification.kind::text not in ('live_24h','live_cancelled')
    and notification.scheduled_for<=p_at
    and notification.superseded_at is null
    and app_user.status='active'
    and channel.app_user_id=notification.app_user_id
    and channel.kind='email'
    and channel.status='eligible'
    and channel.consented_at is not null
    and channel.consent_revoked_at is null
    and channel.verified_at is not null
    and (
      notification.live_event_id is null or exists (
        select 1 from public.live_events current_live
        where current_live.id=notification.live_event_id
          and current_live.publication_status='published'
          and current_live.archived_at is null
      )
    )
    and case
      when notification.kind::text in ('live_reserved','live_changed') then
        coalesce(preference.live_reminders,true)
        and public.live_effective_status_at(notification.live_event_id,p_at)='scheduled'
        and exists (
          select 1 from public.live_reservations reservation
          where reservation.app_user_id=notification.app_user_id
            and reservation.live_event_id=notification.live_event_id
        )
      when notification.kind::text='live_10m' then
        coalesce(preference.live_reminders,true)
        and public.live_effective_status_at(notification.live_event_id,p_at)='scheduled'
      when notification.kind::text='survey_reminder' then
        coalesce(preference.survey_reminders,true)
        and public.live_effective_status_at(notification.live_event_id,p_at)='ended'
        and exists (
          select 1 from public.live_surveys survey
          where survey.live_event_id=notification.live_event_id
            and survey.publication_status='published'
            and survey.lifecycle_status='published'
            and survey.legacy_contract
            and survey.archived_at is null
        )
        and not exists (
          select 1 from public.live_survey_responses response
          where response.app_user_id=notification.app_user_id
            and response.live_event_id=notification.live_event_id
            and response.status='submitted'
            and response.legacy_contract
        )
      when notification.kind::text in ('benefit_available','benefit_unlocked') then
        coalesce(preference.benefit_notifications,true)
        and exists (
          select 1 from public.benefits benefit
          where benefit.id=notification.benefit_id
            and benefit.publication_status='published'
            and benefit.archived_at is null
            and p_at>=benefit.claim_opens_at and p_at<benefit.claim_closes_at
            and not exists (
              select 1 from public.benefit_claims claim
              where claim.benefit_id=benefit.id
                and claim.app_user_id=notification.app_user_id
            )
        )
      when notification.kind::text='benefit_won' then
        coalesce(preference.benefit_notifications,true)
        and exists (
          select 1 from public.benefit_draw_winners winner
          where winner.benefit_id=notification.benefit_id
            and winner.app_user_id=notification.app_user_id
        )
      when notification.kind::text='recipient_information_required' then
        coalesce(preference.benefit_notifications,true)
        and exists (
          select 1
          from public.benefit_draw_winners winner
          join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
          where winner.benefit_id=notification.benefit_id
            and winner.app_user_id=notification.app_user_id
            and fulfillment.status='information_required'
            and not exists (
              select 1 from public.benefit_recipient_private recipient
              where recipient.winner_id=winner.id
            )
        )
      when notification.kind::text='fulfillment_meaningful_update' then
        coalesce(preference.benefit_notifications,true)
        and exists (
          select 1
          from public.benefit_draw_winners winner
          join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
          left join public.benefit_fulfillment_events event
            on notification.source_key=(
              'fulfillment_meaningful_update:'||event.fulfillment_id::text||':'||event.id::text
            )
          where winner.benefit_id=notification.benefit_id
            and winner.app_user_id=notification.app_user_id
            and fulfillment.status::text=coalesce(
              notification.payload->>'fulfillmentStatus',event.to_status::text,fulfillment.status::text
            )
        )
      when notification.kind::text in ('collectible_claim_available','collectible_claim_expiring') then
        coalesce(preference.live_reminders,true)
        and exists (
          select 1
          from public.live_journey_completions completion
          join public.live_journey_requirement_revisions requirement
            on requirement.id=completion.requirement_revision_id
          join public.live_collectible_claim_windows claim_window
            on claim_window.live_event_id=completion.live_event_id
          where completion.app_user_id=notification.app_user_id
            and completion.live_event_id=notification.live_event_id
            and p_at>=claim_window.opens_at
            and p_at<claim_window.opens_at+pg_catalog.make_interval(hours=>requirement.claim_window_duration_hours)
            and not exists (
              select 1 from public.live_collectible_claims claim
              where claim.app_user_id=notification.app_user_id
                and claim.live_event_id=notification.live_event_id
            )
        )
      when notification.kind::text='level_up' then
        exists (
          select 1 from public.fan_level_events level_event
          where level_event.id=notification.source_event_id
            and level_event.app_user_id=notification.app_user_id
            and level_event.celebrity_id=notification.celebrity_id
        )
      else false
    end
  from public.fan_notifications notification
  join public.app_users app_user on app_user.id=notification.app_user_id
  join public.fan_notification_channels channel on channel.id=p_channel_id
  left join public.notification_preferences preference
    on preference.app_user_id=notification.app_user_id
  where notification.id=p_notification_id
$$;

revoke all on function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  to service_role;

-- The original survey reminder producer predates generalized Quiz/Vote
-- missions. A submitted non-legacy mission response must not suppress the
-- separate legacy post-LIVE survey reminder.
create or replace function public.enqueue_due_fan_notifications(
  p_now timestamptz default pg_catalog.now()
) returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted_count integer := 0; current_count integer;
begin
  with candidates as (
    select reservation.app_user_id, live.id live_event_id, reminder.kind,
      reminder.due_at, reminder.source_key
    from public.live_reservations reservation
    join public.live_events live on live.id=reservation.live_event_id
    cross join lateral (values
      ('live_24h'::public.notification_kind,live.starts_at-interval '24 hours','live:'||live.id::text||':24h'),
      ('live_10m'::public.notification_kind,live.starts_at-interval '10 minutes','live:'||live.id::text||':10m')
    ) reminder(kind,due_at,source_key)
    where live.publication_status='published'
      and live.archived_at is null
      and public.live_effective_status_at(live.id,p_now)='scheduled'
      and reminder.due_at<=p_now and p_now<live.starts_at
      and coalesce((select preference.live_reminders
        from public.notification_preferences preference
        where preference.app_user_id=reservation.app_user_id),true)
  ), inserted as (
    insert into public.fan_notifications(
      app_user_id,kind,source_key,live_event_id,scheduled_for
    )
    select app_user_id,kind,source_key,live_event_id,due_at from candidates
    on conflict (app_user_id,source_key) do nothing
    returning id,app_user_id,scheduled_for
  )
  insert into public.notification_delivery_outbox(
    notification_id,subscription_id,available_at
  )
  select inserted.id,subscription.id,greatest(inserted.scheduled_for,p_now)
  from inserted
  join public.push_subscriptions subscription
    on subscription.app_user_id=inserted.app_user_id
   and subscription.disabled_at is null
  on conflict(notification_id,subscription_id) do nothing;
  get diagnostics current_count=row_count;
  inserted_count:=inserted_count+current_count;

  with candidates as (
    select attendance.app_user_id,live.id live_event_id,live.ends_at due_at,
      'live:'||live.id::text||':survey' source_key
    from public.live_attendances attendance
    join public.live_events live on live.id=attendance.live_event_id
    join public.live_surveys survey
      on survey.live_event_id=live.id
     and survey.publication_status='published'
     and survey.lifecycle_status='published'
     and survey.legacy_contract
     and survey.archived_at is null
    where live.publication_status='published'
      and live.archived_at is null
      and live.ends_at<=p_now
      and public.live_effective_status_at(live.id,p_now)='ended'
      and coalesce((select preference.survey_reminders
        from public.notification_preferences preference
        where preference.app_user_id=attendance.app_user_id),true)
      and not exists (
        select 1 from public.live_survey_responses response
        where response.app_user_id=attendance.app_user_id
          and response.live_event_id=live.id
          and response.status='submitted'
          and response.legacy_contract
      )
  ), inserted as (
    insert into public.fan_notifications(
      app_user_id,kind,source_key,live_event_id,scheduled_for
    )
    select app_user_id,'survey_reminder',source_key,live_event_id,due_at
    from candidates
    on conflict (app_user_id,source_key) do nothing
    returning id,app_user_id,scheduled_for
  )
  insert into public.notification_delivery_outbox(
    notification_id,subscription_id,available_at
  )
  select inserted.id,subscription.id,greatest(inserted.scheduled_for,p_now)
  from inserted
  join public.push_subscriptions subscription
    on subscription.app_user_id=inserted.app_user_id
   and subscription.disabled_at is null
  on conflict(notification_id,subscription_id) do nothing;
  get diagnostics current_count=row_count;
  inserted_count:=inserted_count+current_count;

  inserted_count:=inserted_count+public.backfill_notification_deliveries(p_now,null);
  return inserted_count;
end $$;

create function public.phase5_suppress_excluded_email_delivery()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.channel='email' and new.status<>'sent' and exists (
    select 1 from public.fan_notifications notification
    where notification.id=new.notification_id
      and notification.kind::text in ('live_24h','live_cancelled')
  ) then
    new.status='failed';
    new.available_at='infinity'::timestamptz;
    new.last_error_code='EMAIL_KIND_SUPPRESSED';
    new.lease_owner=null;
    new.lease_expires_at=null;
  end if;
  return new;
end $$;

create trigger phase5_suppress_excluded_email_delivery
before insert or update of status,available_at,channel,notification_id
on public.external_notification_delivery_outbox
for each row execute function public.phase5_suppress_excluded_email_delivery();

revoke all on function public.phase5_suppress_excluded_email_delivery()
  from public,anon,authenticated,service_role;

update public.external_notification_delivery_outbox delivery
set status='failed',available_at='infinity'::timestamptz,
  last_error_code='EMAIL_KIND_SUPPRESSED',lease_owner=null,lease_expires_at=null,
  updated_at=pg_catalog.now()
where delivery.channel='email' and delivery.status<>'sent'
  and exists (
    select 1 from public.fan_notifications notification
    where notification.id=delivery.notification_id
      and notification.kind::text in ('live_24h','live_cancelled')
  );

-- Older planners could expose an email row before the notification itself was
-- due. Preserve the job and move it to its authoritative schedule.
update public.external_notification_delivery_outbox delivery
set available_at=notification.scheduled_for,updated_at=pg_catalog.now()
from public.fan_notifications notification
where notification.id=delivery.notification_id
  and delivery.channel='email'
  and delivery.status in ('pending','failed')
  and delivery.available_at<notification.scheduled_for
  and delivery.available_at<>'infinity'::timestamptz;

create or replace function public.create_external_notification_plan(
  p_notification_id uuid,
  p_now timestamptz default pg_catalog.now()
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_notification public.fan_notifications%rowtype;
  v_locale text;
  v_primary public.fan_notification_channels%rowtype;
  v_fallback public.fan_notification_channels%rowtype;
  v_plan uuid;
begin
  select notification.* into v_notification
  from public.fan_notifications notification
  join public.app_users app_user on app_user.id=notification.app_user_id and app_user.status='active'
  where notification.id=p_notification_id;
  if not found then return null; end if;
  select coalesce(app_user.preferred_locale,'ko') into strict v_locale
  from public.app_users app_user where app_user.id=v_notification.app_user_id;

  select channel.* into v_primary
  from public.fan_notification_channels channel
  where channel.app_user_id=v_notification.app_user_id
    and channel.status='eligible' and channel.consented_at is not null
    and channel.consent_revoked_at is null and channel.verified_at is not null
    and (v_notification.kind::text not in ('live_24h','live_cancelled') or channel.kind='kakao')
  order by case channel.kind when 'kakao' then 1 else 2 end,channel.priority,channel.id
  limit 1;
  if not found then return null; end if;

  if v_primary.kind='kakao' and v_notification.kind::text not in ('live_24h','live_cancelled') then
    select channel.* into v_fallback
    from public.fan_notification_channels channel
    where channel.app_user_id=v_notification.app_user_id and channel.kind='email'
      and channel.status='eligible' and channel.consented_at is not null
      and channel.consent_revoked_at is null and channel.verified_at is not null
    limit 1;
  end if;

  insert into public.notification_delivery_plans(
    notification_id,primary_channel_id,fallback_channel_id,email_locale,created_at,updated_at
  ) values (
    p_notification_id,v_primary.id,v_fallback.id,v_locale,p_now,p_now
  ) on conflict(notification_id) do update set notification_id=excluded.notification_id
  returning id into v_plan;

  insert into public.external_notification_delivery_outbox(
    plan_id,notification_id,channel_id,channel,sequence,template_key,locale,available_at
  ) values (
    v_plan,p_notification_id,v_primary.id,v_primary.kind,1,
    v_notification.kind::text,case when v_primary.kind='email' then v_locale else 'ko' end,
    greatest(v_notification.scheduled_for,p_now)
  ) on conflict(plan_id,sequence) do nothing;
  return v_plan;
end $$;

create or replace function public.fail_external_notification_delivery(
  p_delivery_id uuid,p_worker_id text,p_error_code text,p_retryable boolean,
  p_now timestamptz default pg_catalog.now()
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.external_notification_delivery_outbox%rowtype;
  v_plan public.notification_delivery_plans%rowtype;
  v_fallback public.fan_notification_channels%rowtype;
  v_notification public.fan_notifications%rowtype;
begin
  select * into v_delivery from public.external_notification_delivery_outbox
  where id=p_delivery_id and status='processing' and lease_owner=p_worker_id
    and lease_expires_at>p_now for update;
  if not found then return false; end if;

  update public.external_notification_delivery_outbox
  set status='failed',
    available_at=case when p_retryable then p_now+interval '1 minute' else 'infinity'::timestamptz end,
    last_error_code=left(regexp_replace(upper(p_error_code),'[^A-Z0-9_]','','g'),80),
    lease_owner=null,lease_expires_at=null,updated_at=p_now
  where id=v_delivery.id;

  if not p_retryable then
    select * into v_plan from public.notification_delivery_plans where id=v_delivery.plan_id for update;
    select * into v_notification from public.fan_notifications where id=v_delivery.notification_id;
    if v_delivery.sequence=1 and v_plan.fallback_channel_id is not null
      and v_notification.kind::text not in ('live_24h','live_cancelled') then
      select channel.* into v_fallback
      from public.fan_notification_channels channel
      join public.app_users app_user on app_user.id=channel.app_user_id and app_user.status='active'
      where channel.id=v_plan.fallback_channel_id and channel.kind='email'
        and channel.status='eligible' and channel.consented_at is not null
        and channel.consent_revoked_at is null and channel.verified_at is not null;
      if found and public.email_notification_delivery_is_eligible(
        v_delivery.notification_id,v_fallback.id,p_now
      ) then
        insert into public.external_notification_delivery_outbox(
          plan_id,notification_id,channel_id,channel,sequence,template_key,locale,available_at
        ) values (
          v_plan.id,v_delivery.notification_id,v_fallback.id,v_fallback.kind,2,
          v_delivery.template_key,v_plan.email_locale,greatest(v_notification.scheduled_for,p_now)
        ) on conflict(plan_id,sequence) do nothing;
        update public.notification_delivery_plans
        set current_sequence=2,updated_at=p_now where id=v_plan.id;
      else
        update public.notification_delivery_plans
        set status='failed',updated_at=p_now where id=v_plan.id;
      end if;
    else
      update public.notification_delivery_plans
      set status='failed',updated_at=p_now where id=v_plan.id;
    end if;
  end if;
  return true;
end $$;

create or replace function public.claim_email_notification_deliveries(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,
  p_now timestamptz default pg_catalog.now()
) returns table(
  id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,
  template_key text,locale text,destination text,payload jsonb,attempt_count integer,
  lease_owner text,lease_expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID';
  end if;

  update public.external_notification_delivery_outbox delivery
  set status='failed',available_at='infinity'::timestamptz,
    last_error_code=case when notification.kind::text in ('live_24h','live_cancelled')
      then 'EMAIL_KIND_SUPPRESSED' else 'EMAIL_NOT_ELIGIBLE' end,
    lease_owner=null,lease_expires_at=null,updated_at=p_now
  from public.fan_notifications notification
  where notification.id=delivery.notification_id and delivery.channel='email'
    and delivery.attempt_count<8 and delivery.available_at<=p_now
    and notification.scheduled_for<=p_now
    and (delivery.status in ('pending','failed')
      or (delivery.status='processing' and delivery.lease_expires_at<=p_now))
    and not public.email_notification_delivery_is_eligible(
      delivery.notification_id,delivery.channel_id,p_now
    );

  return query
  with due as (
    select delivery.id
    from public.external_notification_delivery_outbox delivery
    where delivery.channel='email' and delivery.attempt_count<8
      and delivery.available_at<=p_now
      and (delivery.status in ('pending','failed')
        or (delivery.status='processing' and delivery.lease_expires_at<=p_now))
      and public.email_notification_delivery_is_eligible(
        delivery.notification_id,delivery.channel_id,p_now
      )
    order by delivery.available_at,delivery.id
    for update skip locked limit p_batch_size
  ), claimed as (
    update public.external_notification_delivery_outbox delivery
    set status='processing',attempt_count=delivery.attempt_count+1,
      lease_owner=p_worker_id,
      lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),
      last_error_code=null,updated_at=p_now
    from due where delivery.id=due.id returning delivery.*
  )
  select claimed.id,claimed.notification_id,claimed.plan_id,claimed.channel,
    claimed.sequence,claimed.template_key,claimed.locale,private.destination,
    jsonb_build_object(
      'title',case when claimed.locale='ko'
        then coalesce(notification.payload->>'title','ByUs') else 'ByUs' end,
      'detail',case when claimed.locale='ko'
        then coalesce(notification.payload->>'detail','새 소식을 확인해 주세요.')
        else 'You have a new update.' end,
      'deepLink',coalesce(notification.deep_link,case
        when notification.kind::text='survey_reminder' then '/live/'||live.slug||'/survey'
        when notification.live_event_id is not null then '/live/'||live.slug
        when notification.benefit_id is not null then '/benefits/'||notification.benefit_id::text
        when notification.kind::text='level_up' then '/passports'
        else '/my' end),
      'context',jsonb_strip_nulls(jsonb_build_object(
        'kind',notification.kind::text,
        'title',coalesce(live_locale.title,benefit_locale.title),
        'artist',artist_locale.name,
        'imageUrl',coalesce(preview.landscape_poster_url,live.approved_hero_url,artist.image_url),
        'startsAt',live.starts_at,
        'actionAt',case
          when notification.kind::text in ('benefit_available','benefit_unlocked') then benefit.claim_closes_at
          when notification.kind::text in ('collectible_claim_available','collectible_claim_expiring') then collectible.action_at
          else null end,
        'fulfillmentStatus',coalesce(
          notification.payload->>'fulfillmentStatus',fulfillment.event_status,
          case when notification.kind::text='fulfillment_meaningful_update'
            then fulfillment.current_status end
        ),
        'newLevel',notification.payload->>'currentLevel'
      ))
    ),
    claimed.attempt_count,claimed.lease_owner,claimed.lease_expires_at
  from claimed
  join public.fan_notification_channel_private private on private.channel_id=claimed.channel_id
  join public.fan_notifications notification on notification.id=claimed.notification_id
  left join public.live_events live on live.id=notification.live_event_id
    and live.publication_status='published' and live.archived_at is null
  left join public.benefits benefit on benefit.id=notification.benefit_id
  left join public.celebrities artist on artist.id=coalesce(
    notification.celebrity_id,live.celebrity_id,benefit.celebrity_id
  )
  left join public.live_event_previews preview on preview.live_event_id=live.id
    and preview.publication_status='published' and preview.archived_at is null
  left join lateral (
    select localization.title from public.live_event_localizations localization
    where localization.live_event_id=live.id
    order by (localization.locale::text=claimed.locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) live_locale on true
  left join lateral (
    select localization.title from public.benefit_localizations localization
    where localization.benefit_id=benefit.id
    order by (localization.locale::text=claimed.locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) benefit_locale on true
  left join lateral (
    select localization.name from public.celebrity_localizations localization
    where localization.celebrity_id=artist.id
    order by (localization.locale::text=claimed.locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) artist_locale on true
  left join lateral (
    select claim_window.opens_at+pg_catalog.make_interval(
      hours=>requirement.claim_window_duration_hours
    ) action_at
    from public.live_journey_completions completion
    join public.live_journey_requirement_revisions requirement
      on requirement.id=completion.requirement_revision_id
    join public.live_collectible_claim_windows claim_window
      on claim_window.live_event_id=completion.live_event_id
    where completion.app_user_id=notification.app_user_id
      and completion.live_event_id=notification.live_event_id
    order by completion.completed_at desc limit 1
  ) collectible on true
  left join lateral (
    select fulfillment.status::text current_status,event.to_status::text event_status
    from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    left join public.benefit_fulfillment_events event on notification.source_key=(
      'fulfillment_meaningful_update:'||event.fulfillment_id::text||':'||event.id::text
    )
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
    order by winner.selected_at desc limit 1
  ) fulfillment on true;
end $$;

create function public.build_external_notification_payload(
  p_notification_id uuid,p_locale text
) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title',case when p_locale='ko'
      then coalesce(notification.payload->>'title','ByUs') else 'ByUs' end,
    'detail',case when p_locale='ko'
      then coalesce(notification.payload->>'detail','새 소식을 확인해 주세요.')
      else 'You have a new update.' end,
    'deepLink',coalesce(notification.deep_link,case
      when notification.kind::text='survey_reminder' then '/live/'||live.slug||'/survey'
      when notification.live_event_id is not null then '/live/'||live.slug
      when notification.benefit_id is not null then '/benefits/'||notification.benefit_id::text
      when notification.kind::text='level_up' then '/passports'
      else '/my' end),
    'context',jsonb_strip_nulls(jsonb_build_object(
      'kind',notification.kind::text,
      'title',coalesce(live_locale.title,benefit_locale.title),
      'artist',artist_locale.name,
      'imageUrl',coalesce(preview.landscape_poster_url,live.approved_hero_url,artist.image_url),
      'startsAt',live.starts_at,
      'actionAt',case
        when notification.kind::text in ('benefit_available','benefit_unlocked') then benefit.claim_closes_at
        when notification.kind::text in ('collectible_claim_available','collectible_claim_expiring') then collectible.action_at
        else null end,
      'fulfillmentStatus',coalesce(
        notification.payload->>'fulfillmentStatus',fulfillment.event_status,
        case when notification.kind::text='fulfillment_meaningful_update'
          then fulfillment.current_status end
      ),
      'newLevel',notification.payload->>'currentLevel'
    ))
  )
  from public.fan_notifications notification
  left join public.live_events live on live.id=notification.live_event_id
    and live.publication_status='published' and live.archived_at is null
  left join public.benefits benefit on benefit.id=notification.benefit_id
  left join public.celebrities artist on artist.id=coalesce(
    notification.celebrity_id,live.celebrity_id,benefit.celebrity_id
  )
  left join public.live_event_previews preview on preview.live_event_id=live.id
    and preview.publication_status='published' and preview.archived_at is null
  left join lateral (
    select localization.title from public.live_event_localizations localization
    where localization.live_event_id=live.id
    order by (localization.locale::text=p_locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) live_locale on true
  left join lateral (
    select localization.title from public.benefit_localizations localization
    where localization.benefit_id=benefit.id
    order by (localization.locale::text=p_locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) benefit_locale on true
  left join lateral (
    select localization.name from public.celebrity_localizations localization
    where localization.celebrity_id=artist.id
    order by (localization.locale::text=p_locale) desc,
      (localization.locale::text='ko') desc limit 1
  ) artist_locale on true
  left join lateral (
    select claim_window.opens_at+pg_catalog.make_interval(
      hours=>requirement.claim_window_duration_hours
    ) action_at
    from public.live_journey_completions completion
    join public.live_journey_requirement_revisions requirement
      on requirement.id=completion.requirement_revision_id
    join public.live_collectible_claim_windows claim_window
      on claim_window.live_event_id=completion.live_event_id
    where completion.app_user_id=notification.app_user_id
      and completion.live_event_id=notification.live_event_id
    order by completion.completed_at desc limit 1
  ) collectible on true
  left join lateral (
    select fulfillment.status::text current_status,event.to_status::text event_status
    from public.benefit_draw_winners winner
    join public.benefit_fulfillments fulfillment on fulfillment.winner_id=winner.id
    left join public.benefit_fulfillment_events event on notification.source_key=(
      'fulfillment_meaningful_update:'||event.fulfillment_id::text||':'||event.id::text
    )
    where winner.app_user_id=notification.app_user_id
      and winner.benefit_id=notification.benefit_id
    order by winner.selected_at desc limit 1
  ) fulfillment on true
  where notification.id=p_notification_id
$$;

create or replace function public.claim_external_notification_deliveries(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,
  p_now timestamptz default pg_catalog.now()
) returns table(
  id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,
  template_key text,locale text,destination text,payload jsonb,attempt_count integer,
  lease_owner text,lease_expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if length(trim(p_worker_id)) not between 3 and 120
    or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID';
  end if;

  update public.external_notification_delivery_outbox delivery
  set status='failed',available_at='infinity'::timestamptz,
    last_error_code=case when notification.kind::text in ('live_24h','live_cancelled')
      then 'EMAIL_KIND_SUPPRESSED' else 'EMAIL_NOT_ELIGIBLE' end,
    lease_owner=null,lease_expires_at=null,updated_at=p_now
  from public.fan_notifications notification
  where notification.id=delivery.notification_id and delivery.channel='email'
    and delivery.attempt_count<8 and delivery.available_at<=p_now
    and notification.scheduled_for<=p_now
    and (delivery.status in ('pending','failed')
      or (delivery.status='processing' and delivery.lease_expires_at<=p_now))
    and not public.email_notification_delivery_is_eligible(
      delivery.notification_id,delivery.channel_id,p_now
    );

  return query
  with due as (
    select delivery.id
    from public.external_notification_delivery_outbox delivery
    join public.fan_notification_channels notification_channel
      on notification_channel.id=delivery.channel_id
    join public.app_users app_user on app_user.id=notification_channel.app_user_id
    where delivery.attempt_count<8 and delivery.available_at<=p_now
      and (delivery.status in ('pending','failed')
        or (delivery.status='processing' and delivery.lease_expires_at<=p_now))
      and app_user.status='active' and notification_channel.status='eligible'
      and notification_channel.consented_at is not null
      and notification_channel.consent_revoked_at is null
      and notification_channel.verified_at is not null
      and case when delivery.channel='email'
        then public.email_notification_delivery_is_eligible(
          delivery.notification_id,delivery.channel_id,p_now
        )
        else public.notification_delivery_is_eligible(delivery.notification_id,p_now)
      end
    order by delivery.available_at,delivery.id
    for update of delivery skip locked limit p_batch_size
  ), claimed as (
    update public.external_notification_delivery_outbox delivery
    set status='processing',attempt_count=delivery.attempt_count+1,
      lease_owner=p_worker_id,
      lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),
      last_error_code=null,updated_at=p_now
    from due where delivery.id=due.id returning delivery.*
  )
  select claimed.id,claimed.notification_id,claimed.plan_id,claimed.channel,
    claimed.sequence,claimed.template_key,claimed.locale,private.destination,
    case when claimed.channel='email' then
      public.build_external_notification_payload(claimed.notification_id,claimed.locale)
    else jsonb_build_object(
      'title',coalesce(notification.payload->>'title','ByUs'),
      'detail',coalesce(notification.payload->>'detail','새 소식을 확인해 주세요.'),
      'deepLink',coalesce(notification.deep_link,'/my')
    ) end,
    claimed.attempt_count,claimed.lease_owner,claimed.lease_expires_at
  from claimed
  join public.fan_notification_channel_private private on private.channel_id=claimed.channel_id
  join public.fan_notifications notification on notification.id=claimed.notification_id;
end $$;

create function public.revalidate_email_notification_delivery(
  p_delivery_id uuid,p_worker_id text,p_now timestamptz default pg_catalog.now()
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.external_notification_delivery_outbox%rowtype;
  v_kind text;
begin
  select delivery.* into v_delivery
  from public.external_notification_delivery_outbox delivery
  where delivery.id=p_delivery_id and delivery.channel='email'
  for update of delivery;
  if not found or v_delivery.status<>'processing'
    or v_delivery.lease_owner<>p_worker_id or v_delivery.lease_expires_at<=p_now then
    return false;
  end if;
  select notification.kind::text into strict v_kind
  from public.fan_notifications notification where notification.id=v_delivery.notification_id;
  if public.email_notification_delivery_is_eligible(
    v_delivery.notification_id,v_delivery.channel_id,p_now
  ) then
    return true;
  end if;

  update public.external_notification_delivery_outbox
  set status='failed',available_at='infinity'::timestamptz,
    last_error_code=case when v_kind in ('live_24h','live_cancelled')
      then 'EMAIL_KIND_SUPPRESSED' else 'EMAIL_NOT_ELIGIBLE' end,
    lease_owner=null,lease_expires_at=null,updated_at=p_now
  where id=v_delivery.id;
  update public.notification_delivery_plans
  set status='failed',updated_at=p_now where id=v_delivery.plan_id;
  return false;
end $$;

revoke all on function public.create_external_notification_plan(uuid,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.claim_email_notification_deliveries(text,integer,integer,timestamptz),
  public.claim_external_notification_deliveries(text,integer,integer,timestamptz),
  public.build_external_notification_payload(uuid,text),
  public.revalidate_email_notification_delivery(uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.create_external_notification_plan(uuid,timestamptz),
  public.fail_external_notification_delivery(uuid,text,text,boolean,timestamptz),
  public.claim_email_notification_deliveries(text,integer,integer,timestamptz),
  public.claim_external_notification_deliveries(text,integer,integer,timestamptz),
  public.build_external_notification_payload(uuid,text),
  public.revalidate_email_notification_delivery(uuid,text,timestamptz)
  to service_role;

-- Persist exact fulfillment states for new notifications; claim-time inference
-- above keeps pre-migration rows renderable.
create or replace function public.phase5_notify_fulfillment_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_winner public.benefit_draw_winners%rowtype;
begin
  select * into strict v_winner from public.benefit_draw_winners where id=new.winner_id;
  if new.status='information_required' then
    perform public.insert_action_required_notification(
      v_winner.app_user_id,'recipient_information_required',
      'recipient_information_required:'||new.winner_id::text||':'||new.revision::text,
      null,v_winner.benefit_id,'/benefits/'||v_winner.benefit_id::text,
      jsonb_build_object('title','수령 정보 필요','detail','Benefit 수령 정보를 입력해 주세요.',
        'fulfillmentStatus',new.status::text),new.created_at
    );
  elsif new.status='digital_delivered' then
    perform public.insert_action_required_notification(
      v_winner.app_user_id,'fulfillment_meaningful_update',
      'fulfillment_meaningful_update:'||new.id::text||':'||new.revision::text,
      null,v_winner.benefit_id,'/benefits/'||v_winner.benefit_id::text,
      jsonb_build_object('title','Benefit 전달 완료','detail','디지털 Benefit을 확인해 주세요.',
        'fulfillmentStatus',new.status::text),new.created_at
    );
  end if;
  return new;
end $$;

create or replace function public.phase5_notify_fulfillment_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_winner public.benefit_draw_winners%rowtype;
  v_fulfillment public.benefit_fulfillments%rowtype;
begin
  if new.to_status not in (
    'shipping_in_transit','shipping_completed','pickup_available',
    'pickup_completed','digital_delivered'
  ) then return new; end if;
  select * into strict v_fulfillment from public.benefit_fulfillments where id=new.fulfillment_id;
  select * into strict v_winner from public.benefit_draw_winners where id=v_fulfillment.winner_id;
  perform public.insert_action_required_notification(
    v_winner.app_user_id,'fulfillment_meaningful_update',
    'fulfillment_meaningful_update:'||new.fulfillment_id::text||':'||new.id::text,
    null,v_winner.benefit_id,'/benefits/'||v_winner.benefit_id::text,
    jsonb_build_object('title','Benefit 진행 상태 변경','detail','최신 수령 상태를 확인해 주세요.',
      'fulfillmentStatus',new.to_status::text),new.created_at
  );
  return new;
end $$;

create or replace function public.phase5_notify_collectible_available()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient record;
begin
  for recipient in
    select completion.app_user_id,live.slug,
      new.opens_at+pg_catalog.make_interval(hours=>requirement.claim_window_duration_hours) action_at
    from public.live_journey_completions completion
    join public.live_journey_requirement_revisions requirement
      on requirement.id=completion.requirement_revision_id
    join public.live_events live on live.id=completion.live_event_id
    where completion.live_event_id=new.live_event_id
  loop
    perform public.insert_action_required_notification(
      recipient.app_user_id,'collectible_claim_available',
      'collectible_claim_available:'||new.live_event_id::text||':'||new.schedule_revision::text,
      new.live_event_id,null,'/live/'||recipient.slug,
      jsonb_build_object('title','Collectible 수령 가능','detail','기간 안에 Collectible을 받아 주세요.',
        'actionAt',recipient.action_at),new.opens_at
    );
  end loop;
  return new;
end $$;

create or replace function public.enqueue_collectible_claim_expiry_notifications(
  p_now timestamptz default pg_catalog.now()
) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with due as (
    select completion.app_user_id,completion.live_event_id,live.slug,claim_window.schedule_revision,
      claim_window.opens_at+pg_catalog.make_interval(hours=>requirement.claim_window_duration_hours) action_at
    from public.live_journey_completions completion
    join public.live_journey_requirement_revisions requirement
      on requirement.id=completion.requirement_revision_id
    join public.live_collectible_claim_windows claim_window
      on claim_window.live_event_id=completion.live_event_id
    join public.live_events live on live.id=completion.live_event_id
    where p_now>=claim_window.opens_at+pg_catalog.make_interval(
        hours=>requirement.claim_window_duration_hours
      )-interval '6 hours'
      and p_now<claim_window.opens_at+pg_catalog.make_interval(
        hours=>requirement.claim_window_duration_hours
      )
      and not exists (
        select 1 from public.live_collectible_claims claim
        where claim.app_user_id=completion.app_user_id
          and claim.live_event_id=completion.live_event_id
      )
  ), inserted as (
    insert into public.fan_notifications(
      app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload
    )
    select app_user_id,'collectible_claim_expiring',
      'collectible_claim_expiring:'||live_event_id::text||':schedule:'||schedule_revision::text,
      live_event_id,p_now,'/live/'||slug,
      jsonb_build_object('title','Collectible 수령 마감 임박','detail','수령 기간이 곧 끝나요.',
        'actionAt',action_at)
    from due on conflict(app_user_id,source_key) do nothing returning 1
  ) select count(*) into v_count from inserted;
  return v_count;
end $$;

create function public.freeze_due_live_collectible_claim_windows(
  p_now timestamptz default pg_catalog.now()
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_live_event_id uuid;
  v_count integer:=0;
begin
  for v_live_event_id in
    select distinct completion.live_event_id
    from public.live_journey_completions completion
    join public.live_events live on live.id=completion.live_event_id
    where live.publication_status='published' and live.archived_at is null
      and public.live_effective_status_at(live.id,p_now)='ended'
      and not exists (
        select 1 from public.live_collectible_claim_windows claim_window
        where claim_window.live_event_id=completion.live_event_id
      )
    order by completion.live_event_id
  loop
    perform public.freeze_live_collectible_window(v_live_event_id,p_now);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create function public.enqueue_collectible_claim_available_notifications(
  p_now timestamptz default pg_catalog.now()
) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with due as (
    select completion.app_user_id,completion.live_event_id,live.slug,
      claim_window.schedule_revision,
      claim_window.opens_at+pg_catalog.make_interval(
        hours=>requirement.claim_window_duration_hours
      ) action_at
    from public.live_journey_completions completion
    join public.live_journey_requirement_revisions requirement
      on requirement.id=completion.requirement_revision_id
    join public.live_collectible_claim_windows claim_window
      on claim_window.live_event_id=completion.live_event_id
    join public.live_events live on live.id=completion.live_event_id
    where p_now>=claim_window.opens_at
      and p_now<claim_window.opens_at+pg_catalog.make_interval(
        hours=>requirement.claim_window_duration_hours
      )
      and not exists (
        select 1 from public.live_collectible_claims claim
        where claim.app_user_id=completion.app_user_id
          and claim.live_event_id=completion.live_event_id
      )
  ), inserted as (
    insert into public.fan_notifications(
      app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload
    )
    select app_user_id,'collectible_claim_available',
      'collectible_claim_available:'||live_event_id::text||':'||schedule_revision::text,
      live_event_id,claim_window_time,'/live/'||slug,
      jsonb_build_object('title','Collectible 수령 가능',
        'detail','기간 안에 Collectible을 받아 주세요.','actionAt',action_at)
    from (
      select due.*,p_now claim_window_time from due
    ) candidate
    on conflict(app_user_id,source_key) do nothing returning 1
  ) select count(*) into v_count from inserted;
  return v_count;
end $$;

create function public.enqueue_due_notification_maintenance(
  p_now timestamptz default pg_catalog.now()
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_scheduled integer;
  v_collectible_windows integer;
  v_collectible_available integer;
  v_collectible_expiring integer;
begin
  v_scheduled:=public.enqueue_due_fan_notifications(p_now);
  v_collectible_windows:=public.freeze_due_live_collectible_claim_windows(p_now);
  v_collectible_available:=public.enqueue_collectible_claim_available_notifications(p_now);
  v_collectible_expiring:=public.enqueue_collectible_claim_expiry_notifications(p_now);
  return jsonb_build_object(
    'scheduledNotifications',v_scheduled,
    'collectibleWindows',v_collectible_windows,
    'collectibleAvailableNotifications',v_collectible_available,
    'collectibleExpiryNotifications',v_collectible_expiring
  );
end $$;

revoke all on function public.phase5_notify_fulfillment_created(),
  public.phase5_notify_fulfillment_update(),public.phase5_notify_collectible_available()
  from public,anon,authenticated,service_role;
revoke all on function public.enqueue_collectible_claim_expiry_notifications(timestamptz),
  public.freeze_due_live_collectible_claim_windows(timestamptz),
  public.enqueue_collectible_claim_available_notifications(timestamptz),
  public.enqueue_due_notification_maintenance(timestamptz)
  from public,anon,authenticated;
grant execute on function public.enqueue_collectible_claim_expiry_notifications(timestamptz),
  public.freeze_due_live_collectible_claim_windows(timestamptz),
  public.enqueue_collectible_claim_available_notifications(timestamptz),
  public.enqueue_due_notification_maintenance(timestamptz) to service_role;

comment on function public.revalidate_email_notification_delivery(uuid,text,timestamptz) is
  'Final pre-provider email gate. Invalid leased deliveries are atomically terminal-suppressed.';
comment on function public.enqueue_due_notification_maintenance(timestamptz) is
  'Idempotently enqueues scheduled fan notifications and collectible expiry reminders in one worker call.';
