-- G3 FAN-015: fixed Fan Code attendance. The code verifier remains private;
-- successful attendance is an append-only, owner/live-unique business fact.

alter table public.live_events
  drop constraint live_events_fan_code_hash_complete;

alter table public.live_events
  add constraint live_events_fan_code_hash_complete
  check (
    fan_code_hash = trim(fan_code_hash)
    and fan_code_hash ~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
  );

create table public.live_attendances (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  passport_id uuid not null,
  idempotency_key uuid not null unique,
  attended_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (app_user_id, live_event_id),
  unique (id, app_user_id, celebrity_id),
  constraint live_attendances_live_celebrity_fk
    foreign key (live_event_id, celebrity_id)
    references public.live_events (id, celebrity_id) on delete restrict,
  constraint live_attendances_passport_owner_fk
    foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports (id, app_user_id, celebrity_id) on delete restrict
);

create index live_attendances_event_attended_idx
  on public.live_attendances (live_event_id, attended_at desc);
create index live_attendances_owner_attended_idx
  on public.live_attendances (app_user_id, celebrity_id, attended_at desc);

create function public.reject_live_attendance_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'live attendance is append-only';
end;
$$;

create trigger live_attendances_append_only
before update or delete on public.live_attendances
for each row execute function public.reject_live_attendance_mutation();

create or replace function public.validate_fan_activity_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.activity_type = 'knowledge'
     and (
       new.source_type <> 'quiz_pass'
       or not exists (
         select 1 from public.quiz_passes
         where id = new.source_id
           and app_user_id = new.app_user_id
           and celebrity_id = new.celebrity_id
       )
     ) then
    raise exception 'knowledge activity must reference an owned quiz pass';
  elsif new.activity_type = 'reservation'
        and (
          new.source_type <> 'live_reservation'
          or not exists (
            select 1
            from public.live_reservations reservation
            join public.live_events live
              on live.id = reservation.live_event_id
             and live.celebrity_id = reservation.celebrity_id
            where reservation.id = new.source_id
              and reservation.app_user_id = new.app_user_id
              and reservation.celebrity_id = new.celebrity_id
          )
        ) then
    raise exception 'reservation activity must reference an owned live reservation for the same celebrity';
  elsif new.activity_type = 'attendance'
        and (
          new.source_type <> 'live_attendance'
          or not exists (
            select 1
            from public.live_attendances attendance
            where attendance.id = new.source_id
              and attendance.app_user_id = new.app_user_id
              and attendance.celebrity_id = new.celebrity_id
          )
        ) then
    raise exception 'attendance activity must reference an owned live attendance for the same celebrity';
  end if;
  return new;
end;
$$;

create function public.build_owned_live_attendance_result(
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

create function public.attend_owned_live_event(
  p_app_user_id uuid,
  p_live_slug text,
  p_idempotency_key uuid,
  p_normalized_code text,
  p_stamp_id uuid,
  p_stamp_operation_key text,
  p_stamp_issuance_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_record public.live_events%rowtype;
  existing_attendance public.live_attendances%rowtype;
  passport_record public.fan_passports%rowtype;
  celebrity_slug text;
  recipient text;
  expected_stamp_operation_key text;
  expected_payload jsonb;
  v_attendance_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  v_stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  stamp_record public.stamps%rowtype;
  result jsonb;
begin
  if p_app_user_id is null
     or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_idempotency_key is null
     or p_normalized_code is null
     or p_normalized_code !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'G3_ATTENDANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g3:attendance:key:' || p_idempotency_key::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g3:attendance:target:' || p_app_user_id::text || ':' || p_live_slug,
      0
    )
  );

  select attendance.* into existing_attendance
  from public.live_attendances attendance
  join public.live_events live on live.id = attendance.live_event_id
  where attendance.idempotency_key = p_idempotency_key
  for update of attendance;
  if found then
    if existing_attendance.app_user_id <> p_app_user_id
       or not exists (
         select 1 from public.live_events live
         where live.id = existing_attendance.live_event_id
           and live.slug = p_live_slug
       ) then
      raise exception 'G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    result := public.build_owned_live_attendance_result(p_app_user_id, existing_attendance.id);
    if result is null then
      raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  select attendance.* into existing_attendance
  from public.live_attendances attendance
  join public.live_events live on live.id = attendance.live_event_id
  where attendance.app_user_id = p_app_user_id
    and live.slug = p_live_slug
  for update of attendance;
  if found then
    result := public.build_owned_live_attendance_result(p_app_user_id, existing_attendance.id);
    if result is null then
      raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  perform 1
  from public.app_users app_user
  where app_user.id = p_app_user_id
    and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G3_ATTENDANCE_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select live.* into live_record
  from public.live_events live
  where live.slug = p_live_slug
    and live.publication_status = 'published'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_LIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select passport.* into passport_record
  from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = live_record.celebrity_id
    and passport.business_status = 'issued'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_PASSPORT_REQUIRED' using errcode = '42501';
  end if;

  -- Deliberately independent of reservation, current clock, and live lifecycle.
  -- crypt() performs a salted verifier comparison without persisting plaintext.
  if live_record.fan_code_hash !~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
     or extensions.crypt(p_normalized_code, live_record.fan_code_hash)
        is distinct from live_record.fan_code_hash then
    raise exception 'G3_ATTENDANCE_CODE_INVALID' using errcode = '22023';
  end if;

  select wallet.address into recipient
  from public.user_wallets wallet
  where wallet.app_user_id = p_app_user_id
    and wallet.chain_id = 91342
    and wallet.provider = 'privy'
    and wallet.wallet_type = 'embedded'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_WALLET_NOT_READY' using errcode = '55000';
  end if;

  select celebrity.slug into strict celebrity_slug
  from public.celebrities celebrity
  where celebrity.id = live_record.celebrity_id
  for key share;

  expected_stamp_operation_key := 'byus:stamp:v1:' || p_stamp_id::text;
  if p_stamp_id is null
     or p_stamp_operation_key is distinct from expected_stamp_operation_key
     or p_stamp_issuance_id is null
     or p_stamp_issuance_id !~ '^0x[0-9a-f]{64}$' then
    raise exception 'G3_ATTENDANCE_ISSUANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.live_attendances(
    id, app_user_id, live_event_id, celebrity_id, passport_id, idempotency_key
  ) values (
    v_attendance_id, p_app_user_id, live_record.id, live_record.celebrity_id,
    passport_record.id, p_idempotency_key
  );

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id,
    'attendance', 'live_attendance', v_attendance_id
  );

  insert into public.fan_score_ledger(activity_id, app_user_id, celebrity_id, points)
  values (v_activity_id, p_app_user_id, live_record.celebrity_id, 3);

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'issuanceId', p_stamp_issuance_id,
    'stampType', 'Attendance'
  );
  insert into public.blockchain_jobs(
    id, entity_type, entity_id, operation_key, payload_version, payload
  ) values (
    v_stamp_job_id, 'stamp', p_stamp_id, p_stamp_operation_key, 1, expected_payload
  ) on conflict (operation_key) do nothing;

  select job.* into job_record
  from public.blockchain_jobs job
  where job.operation_key = p_stamp_operation_key
  for update;
  if not found
     or job_record.id <> v_stamp_job_id
     or job_record.entity_type <> 'stamp'
     or job_record.entity_id <> p_stamp_id
     or job_record.payload_version <> 1
     or job_record.payload <> expected_payload
     or job_record.status <> 'PENDING' then
    raise exception 'G3_ATTENDANCE_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  insert into public.stamps(
    id, app_user_id, celebrity_id, passport_id, activity_id,
    stamp_type, blockchain_job_id
  ) values (
    p_stamp_id, p_app_user_id, live_record.celebrity_id, passport_record.id,
    v_activity_id, 'attendance', v_stamp_job_id
  );

  select stamp.* into strict stamp_record
  from public.stamps stamp
  where stamp.id = p_stamp_id
    and stamp.app_user_id = p_app_user_id
    and stamp.celebrity_id = live_record.celebrity_id
    and stamp.passport_id = passport_record.id
    and stamp.activity_id = v_activity_id
    and stamp.stamp_type = 'attendance'
    and stamp.blockchain_job_id = v_stamp_job_id
    and stamp.mint_status = 'queued';

  result := public.build_owned_live_attendance_result(p_app_user_id, v_attendance_id);
  if result is null then
    raise exception 'G3_ATTENDANCE_INTEGRITY_ERROR' using errcode = '23514';
  end if;
  return result;
end;
$$;

alter table public.live_attendances enable row level security;
alter table public.live_attendances force row level security;

revoke all on public.live_attendances from public, anon, authenticated, service_role;
revoke all on function public.reject_live_attendance_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.build_owned_live_attendance_result(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.attend_owned_live_event(
  uuid, text, uuid, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.attend_owned_live_event(
  uuid, text, uuid, text, uuid, text, text
) to service_role;

comment on table public.live_attendances is
  'Append-only completed Fan Code attendance; no pending state and no plaintext code or attempt value.';
comment on function public.attend_owned_live_event(uuid, text, uuid, text, uuid, text, text) is
  'Atomically records owner/live-unique attendance, +3, Attendance Stamp, and mint job; reservation, lifecycle status, and current time are intentionally irrelevant.';
