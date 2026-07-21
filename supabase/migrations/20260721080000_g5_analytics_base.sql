-- G5 / ADM-008 and ADM-009 decision-independent analytics foundation.
-- Every returned value is aggregate-only. A numeric zero is a measured zero;
-- unavailable and not-applicable values are represented by a null value and an
-- explicit state so downstream UI cannot manufacture false precision.

create index if not exists fan_passports_analytics_issued_idx
  on public.fan_passports (celebrity_id, issued_at, app_user_id);
create index if not exists fan_score_ledger_analytics_snapshot_idx
  on public.fan_score_ledger (celebrity_id, created_at, app_user_id);
create index if not exists stamps_analytics_issued_idx
  on public.stamps (celebrity_id, issued_at, stamp_type, app_user_id);
create index if not exists live_reservations_analytics_scope_idx
  on public.live_reservations (celebrity_id, live_event_id, reserved_at, app_user_id);

create function public.read_admin_creator_analytics(
  p_actor_admin_allowlist_id uuid,
  p_celebrity_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_role public.admin_role;
  result jsonb;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active = true
  for share;

  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_celebrity_id is null then raise exception 'celebrity scope is required'; end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'analytics time range must be a non-empty [from,to) interval';
  end if;
  if p_as_of is null then raise exception 'analytics snapshot time is required'; end if;
  if not exists (select 1 from public.celebrities where id = p_celebrity_id) then
    raise exception 'analytics celebrity scope does not exist';
  end if;
  if p_live_event_id is not null and not exists (
    select 1 from public.live_events
    where id = p_live_event_id and celebrity_id = p_celebrity_id
  ) then
    raise exception 'analytics live scope does not belong to celebrity';
  end if;

  with target_fans as (
    select passport.app_user_id
    from public.fan_passports passport
    where passport.celebrity_id = p_celebrity_id
      and passport.issued_at <= p_as_of
      and (
        p_live_event_id is null or exists (
          select 1 from public.live_reservations reservation
          where reservation.app_user_id = passport.app_user_id
            and reservation.celebrity_id = p_celebrity_id
            and reservation.live_event_id = p_live_event_id
            and reservation.reserved_at <= p_as_of
        )
      )
  ), scores as (
    select target.app_user_id, coalesce(sum(ledger.points), 0)::integer as points
    from target_fans target
    left join public.fan_score_ledger ledger
      on ledger.app_user_id = target.app_user_id
     and ledger.celebrity_id = p_celebrity_id
     and ledger.created_at <= p_as_of
    group by target.app_user_id
  ), values_ as (
    select
      (select count(distinct reservation.app_user_id)::integer
       from public.live_reservations reservation
       where reservation.celebrity_id = p_celebrity_id
         and (p_live_event_id is null or reservation.live_event_id = p_live_event_id)
         and reservation.reserved_at >= p_from and reservation.reserved_at < p_to) as reservations,
      (select count(*)::integer from public.fan_passports passport
       where passport.celebrity_id = p_celebrity_id
         and passport.issued_at >= p_from and passport.issued_at < p_to) as passports,
      (select jsonb_build_object(
        'bronze', count(*) filter (where points between 0 and 4)::integer,
        'silver', count(*) filter (where points between 5 and 9)::integer,
        'gold', count(*) filter (where points between 10 and 19)::integer,
        'platinum', count(*) filter (where points between 20 and 34)::integer,
        'diamond', count(*) filter (where points >= 35)::integer,
        'total', count(*)::integer
       ) from scores) as levels,
      (select jsonb_build_object(
        'knowledge', count(*) filter (where stamp.stamp_type = 'knowledge')::integer,
        'reservation', count(*) filter (where stamp.stamp_type = 'reservation')::integer,
        'attendance', count(*) filter (where stamp.stamp_type = 'attendance')::integer,
        'survey', count(*) filter (where stamp.stamp_type = 'survey')::integer,
        'total', count(*)::integer
       )
       from public.stamps stamp
       where stamp.celebrity_id = p_celebrity_id
         and stamp.issued_at >= p_from and stamp.issued_at < p_to
         and (p_live_event_id is null or stamp.app_user_id in (select app_user_id from target_fans))) as stamp_counts
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('celebrityId', p_celebrity_id, 'liveEventId', p_live_event_id),
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'semantics', '[from,to)', 'asOf', p_as_of),
    'metrics', jsonb_build_object(
      'reservationUsers', jsonb_build_object('state', 'available', 'value', reservations, 'reason', null, 'source', 'live_reservations'),
      'passportsIssued', jsonb_build_object('state', 'available', 'value', passports, 'reason', null, 'source', 'fan_passports'),
      'levelDistribution', jsonb_build_object('state', 'available', 'value', levels, 'reason', null, 'source', 'fan_score_ledger', 'snapshotAt', p_as_of,
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'stampTypeCounts', jsonb_build_object('state', 'available', 'value', stamp_counts, 'reason', null, 'source', 'stamps',
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'attendanceUsers', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'ATTENDANCE_SOURCE_NOT_IMPLEMENTED', 'source', null),
      'surveyResponses', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'SURVEY_SOURCE_NOT_IMPLEMENTED', 'source', null)
    )
  ) into result from values_;
  return result;
end;
$$;

create function public.read_admin_brand_analytics(
  p_actor_admin_allowlist_id uuid,
  p_brand_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_role public.admin_role;
  reservation_users integer;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active = true
  for share;

  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_brand_id is null then raise exception 'brand scope is required'; end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'analytics time range must be a non-empty [from,to) interval';
  end if;
  if p_as_of is null then raise exception 'analytics snapshot time is required'; end if;
  if not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception 'analytics brand scope does not exist';
  end if;
  if p_live_event_id is not null and not exists (
    select 1 from public.live_events where id = p_live_event_id and brand_id = p_brand_id
  ) then
    raise exception 'analytics live scope does not belong to brand';
  end if;

  select count(distinct reservation.app_user_id)::integer into reservation_users
  from public.live_reservations reservation
  join public.live_events live on live.id = reservation.live_event_id
  where live.brand_id = p_brand_id
    and (p_live_event_id is null or live.id = p_live_event_id)
    and reservation.reserved_at >= p_from and reservation.reserved_at < p_to;

  return jsonb_build_object(
    'scope', jsonb_build_object('brandId', p_brand_id, 'liveEventId', p_live_event_id),
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'semantics', '[from,to)', 'asOf', p_as_of),
    'funnel', jsonb_build_object(
      'reservationUsers', jsonb_build_object('state', 'available', 'value', reservation_users, 'reason', null, 'source', 'live_reservations'),
      'attendanceUsers', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'ATTENDANCE_SOURCE_NOT_IMPLEMENTED', 'source', null),
      'surveyResponses', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'SURVEY_SOURCE_NOT_IMPLEMENTED', 'source', null),
      'manualCommerce', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'MANUAL_COMMERCE_SOURCE_NOT_IMPLEMENTED', 'source', null)
    )
  );
end;
$$;

revoke all on function public.read_admin_creator_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.read_admin_brand_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_admin_creator_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz)
  to service_role;
grant execute on function public.read_admin_brand_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz)
  to service_role;

comment on function public.read_admin_creator_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz) is
  'ADM-008 aggregate-only creator analytics with [from,to), as-of score snapshots, active-admin recheck, and explicit availability states.';
comment on function public.read_admin_brand_analytics(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz) is
  'ADM-009 aggregate-only brand reservation stage; unimplemented attendance, survey, and manual stages remain unavailable rather than zero.';
