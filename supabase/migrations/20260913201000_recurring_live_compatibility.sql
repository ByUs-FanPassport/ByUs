-- Nullable-aware LIVE behavior. General LIVE keeps the prior implementation;
-- recurring schedules use the same audited revision and notification triggers.

alter function public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)
  rename to reschedule_admin_live_before_recurring_live;
create function public.reschedule_admin_live(
  p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,
  p_live_event_id uuid,p_expected_revision integer,p_reason text,
  p_reservation_opens_at timestamptz,p_reservation_closes_at timestamptz,
  p_starts_at timestamptz,p_ends_at timestamptz,
  p_attendance_valid_from timestamptz,p_attendance_valid_until timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare live_record public.live_events%rowtype; next_revision integer; revision_id uuid:=extensions.gen_random_uuid();
  v_now timestamptz:=pg_catalog.clock_timestamp(); normalized_reason text:=pg_catalog.btrim(p_reason);
  before_schedule jsonb; after_schedule jsonb; creator_id uuid;
begin
  select * into live_record from public.live_events where id=p_live_event_id;
  if found then
    creator_id:=live_record.celebrity_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recurring-live:creator:'||creator_id::text,0));
  end if;
  if not found or live_record.live_type='general' then
    return public.reschedule_admin_live_before_recurring_live(
      p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_live_event_id,p_expected_revision,p_reason,
      p_reservation_opens_at,p_reservation_closes_at,p_starts_at,p_ends_at,p_attendance_valid_from,p_attendance_valid_until);
  end if;
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_expected_revision is null or p_expected_revision<1
    or normalized_reason is null or length(normalized_reason) not between 1 and 1000 then
    raise exception 'invalid recurring LIVE reschedule request';
  end if;
  if p_reservation_opens_at is null or p_reservation_closes_at is null or p_starts_at is null
    or not (p_reservation_opens_at<p_reservation_closes_at and p_reservation_closes_at<=p_starts_at)
    or (p_ends_at is not null and p_starts_at>=p_ends_at)
    or ((p_attendance_valid_from is null)<>(p_attendance_valid_until is null))
    or (p_attendance_valid_from is not null and p_attendance_valid_from>=p_attendance_valid_until) then
    raise exception 'invalid recurring LIVE schedule windows';
  end if;
  select * into strict live_record from public.live_events where id=p_live_event_id for update;
  if live_record.live_type<>'recurring' or live_record.archived_at is not null
    or live_record.publication_status<>'published' then raise exception 'published recurring LIVE is required'; end if;
  if live_record.schedule_revision<>p_expected_revision then raise exception 'stale schedule revision'; end if;
  if v_now>=live_record.starts_at or v_now>=p_starts_at then raise exception 'LIVE has started'; end if;
  if public.live_effective_status_at(live_record.id,v_now)<>'scheduled' then raise exception 'LIVE is not effectively scheduled'; end if;
  if exists(select 1 from public.live_attendances where live_event_id=live_record.id)
    or exists(select 1 from public.attendance_verification_attempts where live_event_id=live_record.id) then
    raise exception 'attendance history exists';
  end if;
  if exists(select 1 from public.live_status_overrides where live_event_id=live_record.id
    and (effective_until is null or effective_until>v_now)) then raise exception 'incompatible status override'; end if;
  if p_reservation_opens_at is not distinct from live_record.reservation_opens_at
    and p_reservation_closes_at is not distinct from live_record.reservation_closes_at
    and p_starts_at is not distinct from live_record.starts_at
    and p_ends_at is not distinct from live_record.ends_at
    and p_attendance_valid_from is not distinct from live_record.attendance_valid_from
    and p_attendance_valid_until is not distinct from live_record.attendance_valid_until then
    raise exception 'LIVE schedule is unchanged';
  end if;
  next_revision:=live_record.schedule_revision+1;
  before_schedule:=jsonb_build_object('revision',live_record.schedule_revision,
    'reservationOpensAt',live_record.reservation_opens_at,'reservationClosesAt',live_record.reservation_closes_at,
    'startsAt',live_record.starts_at,'endsAt',live_record.ends_at,
    'attendanceValidFrom',live_record.attendance_valid_from,'attendanceValidUntil',live_record.attendance_valid_until);
  after_schedule:=jsonb_build_object('revision',next_revision,
    'reservationOpensAt',p_reservation_opens_at,'reservationClosesAt',p_reservation_closes_at,
    'startsAt',p_starts_at,'endsAt',p_ends_at,
    'attendanceValidFrom',p_attendance_valid_from,'attendanceValidUntil',p_attendance_valid_until);
  perform pg_catalog.set_config('byus.live_reschedule_event_id',live_record.id::text,true);
  update public.live_events set reservation_opens_at=p_reservation_opens_at,reservation_closes_at=p_reservation_closes_at,
    starts_at=p_starts_at,ends_at=p_ends_at,attendance_valid_from=p_attendance_valid_from,
    attendance_valid_until=p_attendance_valid_until,schedule_revision=next_revision where id=live_record.id;
  insert into public.live_schedule_revisions(id,live_event_id,revision,
    before_reservation_opens_at,before_reservation_closes_at,before_starts_at,before_ends_at,
    before_attendance_valid_from,before_attendance_valid_until,after_reservation_opens_at,
    after_reservation_closes_at,after_starts_at,after_ends_at,after_attendance_valid_from,
    after_attendance_valid_until,actor_app_user_id,actor_admin_allowlist_id,reason,correlation_id)
  values(revision_id,live_record.id,next_revision,live_record.reservation_opens_at,live_record.reservation_closes_at,
    live_record.starts_at,live_record.ends_at,live_record.attendance_valid_from,live_record.attendance_valid_until,
    p_reservation_opens_at,p_reservation_closes_at,p_starts_at,p_ends_at,p_attendance_valid_from,p_attendance_valid_until,
    p_actor_app_user_id,p_actor_admin_allowlist_id,normalized_reason,p_correlation_id);
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.schedule.rescheduled','live_event',live_record.id::text,
    jsonb_build_object('revisionId',revision_id,'reason',normalized_reason,'before',before_schedule,'after',after_schedule),p_correlation_id);
  return jsonb_build_object('revisionId',revision_id,'revision',next_revision);
end $$;

alter function public.notification_delivery_is_eligible(uuid,timestamptz)
  rename to notification_delivery_is_eligible_before_recurring_live;
create function public.notification_delivery_is_eligible(p_notification_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.notification_delivery_is_eligible_before_recurring_live(p_notification_id,p_at)
    and case when notification.kind::text in('live_24h','live_10m','live_reserved','live_changed')
      then live.starts_at is not null and p_at<live.starts_at else true end
  from public.fan_notifications notification
  left join public.live_events live on live.id=notification.live_event_id
  where notification.id=p_notification_id
$$;

alter function public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz)
  rename to email_notification_delivery_is_eligible_before_recurring_live;
create function public.email_notification_delivery_is_eligible(p_notification_id uuid,p_channel_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.email_notification_delivery_is_eligible_before_recurring_live(p_notification_id,p_channel_id,p_at)
    and case when notification.kind::text in('live_24h','live_10m','live_reserved','live_changed')
      then live.starts_at is not null and p_at<live.starts_at else true end
  from public.fan_notifications notification left join public.live_events live on live.id=notification.live_event_id
  where notification.id=p_notification_id
$$;

alter function public.kakao_notification_delivery_is_eligible(uuid,timestamptz)
  rename to kakao_notification_delivery_is_eligible_before_recurring_live;
create function public.kakao_notification_delivery_is_eligible(p_delivery_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.kakao_notification_delivery_is_eligible_before_recurring_live(p_delivery_id,p_at)
    and case when notification.kind::text in('live_24h','live_10m','live_reserved','live_changed')
      then live.starts_at is not null and p_at<live.starts_at else true end
  from public.external_notification_delivery_outbox delivery
  join public.fan_notifications notification on notification.id=delivery.notification_id
  left join public.live_events live on live.id=notification.live_event_id
  where delivery.id=p_delivery_id
$$;

alter function public.get_admin_live_manager(uuid,uuid,uuid) rename to get_admin_live_manager_before_recurring_live;
create function public.get_admin_live_manager(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_live_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; lives jsonb;
begin
  base:=public.get_admin_live_manager_before_recurring_live(p_actor_app_user_id,p_actor_admin_allowlist_id,p_live_event_id);
  select coalesce(jsonb_agg(item.value||jsonb_build_object(
    'liveType',live.live_type,'endsAt',live.ends_at,'brandId',live.brand_id,
    'attendanceValidFrom',live.attendance_valid_from,'attendanceValidUntil',live.attendance_valid_until,
    'fanCodeConfigured',live.fan_code_hash is not null
  ) order by item.ordinality),'[]'::jsonb) into lives
  from jsonb_array_elements(base->'lives') with ordinality item
  join public.live_events live on live.id=(item.value->>'id')::uuid;
  return jsonb_set(base,'{lives}',lives);
end $$;

revoke all on function public.reschedule_admin_live_before_recurring_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz),
  public.notification_delivery_is_eligible_before_recurring_live(uuid,timestamptz),
  public.email_notification_delivery_is_eligible_before_recurring_live(uuid,uuid,timestamptz),
  public.kakao_notification_delivery_is_eligible_before_recurring_live(uuid,timestamptz),
  public.get_admin_live_manager_before_recurring_live(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz),
  public.notification_delivery_is_eligible(uuid,timestamptz),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz),
  public.kakao_notification_delivery_is_eligible(uuid,timestamptz),public.get_admin_live_manager(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz),
  public.notification_delivery_is_eligible(uuid,timestamptz),
  public.email_notification_delivery_is_eligible(uuid,uuid,timestamptz),
  public.kakao_notification_delivery_is_eligible(uuid,timestamptz),public.get_admin_live_manager(uuid,uuid,uuid)
to service_role;
