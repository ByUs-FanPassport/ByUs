-- Keep attendance replay byte-stable after later score-bearing activities.
-- Fresh databases already receive this definition from 073000; this explicit
-- replacement also upgrades development databases that ran the first draft.

alter table public.live_events
  drop constraint live_events_fan_code_hash_complete;

alter table public.live_events
  add constraint live_events_fan_code_hash_complete
  check (
    fan_code_hash = trim(fan_code_hash)
    and fan_code_hash ~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
  );

create or replace function public.build_owned_live_attendance_result(
  p_app_user_id uuid,
  p_attendance_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attendanceId', attendance.id,
    'liveEventId', attendance.live_event_id,
    'passportId', attendance.passport_id,
    'activityId', activity.id,
    'stampId', stamp.id,
    'attendedAt', attendance.attended_at,
    'scorePoints', score.points,
    'stampMintStatus', stamp.mint_status
  )
  from public.live_attendances attendance
  join public.fan_activities activity
    on activity.app_user_id = attendance.app_user_id
   and activity.celebrity_id = attendance.celebrity_id
   and activity.activity_type = 'attendance'
   and activity.source_type = 'live_attendance'
   and activity.source_id = attendance.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = attendance.app_user_id
   and score.celebrity_id = attendance.celebrity_id
  join public.stamps stamp
    on stamp.passport_id = attendance.passport_id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = attendance.app_user_id
   and stamp.celebrity_id = attendance.celebrity_id
   and stamp.stamp_type = 'attendance'
  where attendance.id = p_attendance_id
    and attendance.app_user_id = p_app_user_id;
$$;

revoke all on function public.build_owned_live_attendance_result(uuid, uuid)
  from public, anon, authenticated, service_role;
