\set ON_ERROR_STOP on

-- Required psql variables:
--   -v from='2026-09-11T00:00:00+09:00'
--   -v to='2026-09-12T00:00:00+09:00'
-- The result contains aggregate counts only. It never returns app-user IDs or
-- anonymous-session hashes.

begin transaction read only;

select 1 / case
  when :'from'::timestamptz < :'to'::timestamptz
    and :'to'::timestamptz <= statement_timestamp()
    and :'to'::timestamptz - :'from'::timestamptz <= interval '366 days'
  then 1
  else 0
end as valid_window;

with
parameters as (
  select :'from'::timestamptz as from_at, :'to'::timestamptz as to_at
),
window_events as materialized (
  select event_name, app_user_id, anonymous_session_hash, source, occurred_at, properties
  from public.fan_product_events, parameters
  where occurred_at >= from_at and occurred_at < to_at
),
acquisitions as (
  select
    app_user_id,
    min(occurred_at) as occurred_at,
    (array_agg(
      case
        when properties->>'channel' in ('direct','search','social','email','paid','referral','internal')
          then properties->>'channel'
        else 'unknown'
      end
      order by occurred_at
    ))[1] as channel
  from window_events
  where event_name = 'creator_page_view'
    and app_user_id is not null
    and source in ('acquisition.session_landing','acquisition.identified_handoff')
  group by app_user_id
),
fan_verifications as (
  select acquisition.app_user_id, acquisition.channel, min(event.occurred_at) as occurred_at
  from acquisitions acquisition
  join window_events event
    on event.app_user_id = acquisition.app_user_id
   and event.event_name = 'passport_issued'
   and event.source = 'server.commit_projection'
   and event.occurred_at >= acquisition.occurred_at
  group by acquisition.app_user_id, acquisition.channel
),
reservations as (
  select verification.app_user_id, verification.channel, min(event.occurred_at) as occurred_at
  from fan_verifications verification
  join window_events event
    on event.app_user_id = verification.app_user_id
   and event.event_name = 'reservation_completed'
   and event.source = 'server.commit_projection'
   and event.occurred_at >= verification.occurred_at
  group by verification.app_user_id, verification.channel
),
attendances as (
  select reservation.app_user_id, reservation.channel, min(event.occurred_at) as occurred_at
  from reservations reservation
  join window_events event
    on event.app_user_id = reservation.app_user_id
   and event.event_name = 'attendance_completed'
   and event.source = 'server.commit_projection'
   and event.occurred_at >= reservation.occurred_at
  group by reservation.app_user_id, reservation.channel
),
raffle_entries as (
  select attendance.app_user_id, attendance.channel, min(event.occurred_at) as occurred_at
  from attendances attendance
  join window_events event
    on event.app_user_id = attendance.app_user_id
   and event.event_name = 'benefit_entered'
   and event.source = 'server.commit_projection'
   and event.occurred_at >= attendance.occurred_at
  group by attendance.app_user_id, attendance.channel
),
counts as (
  select
    (select count(*)::integer from acquisitions) as acquisitions,
    (select count(*)::integer from fan_verifications) as fan_verifications,
    (select count(*)::integer from reservations) as reservations,
    (select count(*)::integer from attendances) as attendances,
    (select count(*)::integer from raffle_entries) as raffle_entries,
    (select count(distinct anonymous_session_hash)::integer
       from window_events
      where event_name = 'creator_page_view'
        and app_user_id is null
        and anonymous_session_hash is not null
        and source = 'acquisition.session_landing') as anonymous_landings
),
event_availability as (
  select
    count(*) filter (where event_name = 'passport_issued' and source = 'server.commit_projection')::integer as passport_issued,
    count(*) filter (where event_name = 'reservation_completed' and source = 'server.commit_projection')::integer as reservation_completed,
    count(*) filter (where event_name = 'attendance_completed' and source = 'server.commit_projection')::integer as attendance_completed,
    count(*) filter (where event_name = 'benefit_entered' and source = 'server.commit_projection')::integer as benefit_entered,
    count(*) filter (where event_name = 'benefit_won' and source = 'server.commit_projection')::integer as benefit_won
  from window_events
),
channels as (
  select jsonb_object_agg(channel, users order by channel) as value
  from (
    select allowed.channel, count(acquisition.app_user_id)::integer as users
    from (values ('direct'),('search'),('social'),('email'),('paid'),('referral'),('internal'),('unknown')) allowed(channel)
    left join acquisitions acquisition on acquisition.channel = allowed.channel
    group by allowed.channel
  ) channel_counts
)
select jsonb_build_object(
  'window', jsonb_build_object('from', :'from'::timestamptz, 'to', :'to'::timestamptz, 'semantics', '[from,to)'),
  'population', 'identified_acquisition_cohort',
  'steps', jsonb_build_array(
    jsonb_build_object('stage','acquisition','users',counts.acquisitions,'previousStepRate',null),
    jsonb_build_object('stage','fanVerification','users',counts.fan_verifications,'previousStepRate',case when counts.acquisitions=0 then null else counts.fan_verifications::numeric/counts.acquisitions end),
    jsonb_build_object('stage','reservation','users',counts.reservations,'previousStepRate',case when counts.fan_verifications=0 then null else counts.reservations::numeric/counts.fan_verifications end),
    jsonb_build_object('stage','attendance','users',counts.attendances,'previousStepRate',case when counts.reservations=0 then null else counts.attendances::numeric/counts.reservations end),
    jsonb_build_object('stage','raffleEntry','users',counts.raffle_entries,'previousStepRate',case when counts.attendances=0 then null else counts.raffle_entries::numeric/counts.attendances end)
  ),
  'identifiedAcquisitionsByChannel', channels.value,
  'anonymousLandingSessions', counts.anonymous_landings,
  'serverCommittedEventAvailability', jsonb_build_object(
    'passportIssued', event_availability.passport_issued,
    'reservationCompleted', event_availability.reservation_completed,
    'attendanceCompleted', event_availability.attendance_completed,
    'benefitEntered', event_availability.benefit_entered,
    'benefitWon', event_availability.benefit_won
  )
) as acquisition_funnel
from counts cross join channels cross join event_availability;

rollback;
