-- Raw-code-free verification telemetry and atomic owner/live throttling.
-- Five failures in ten minutes starts a fifteen-minute lockout.

alter table public.live_events
  drop constraint live_events_fan_code_hash_complete;

alter table public.live_events
  add constraint live_events_fan_code_hash_complete
  check (
    fan_code_hash = trim(fan_code_hash)
    and fan_code_hash ~ '^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$'
  );

create table public.attendance_verification_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  idempotency_key uuid not null unique,
  category text not null check (
    category in ('invalid_format', 'invalid_code', 'rate_limited', 'success')
  ),
  attempted_at timestamptz not null default now(),
  unique (id, app_user_id, live_event_id)
);

create index attendance_verification_attempts_owner_window_idx
  on public.attendance_verification_attempts(
    app_user_id, live_event_id, attempted_at desc
  );

create table public.attendance_rate_limits (
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  failed_count smallint not null default 0 check (failed_count between 0 and 5),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (app_user_id, live_event_id),
  constraint attendance_rate_limits_block_consistent check (
    (failed_count < 5 and blocked_until is null)
    or (failed_count = 5 and blocked_until is not null)
  )
);

create function public.reject_attendance_verification_attempt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'attendance verification attempt is append-only';
end;
$$;

create trigger attendance_verification_attempts_append_only
before update or delete on public.attendance_verification_attempts
for each row execute function public.reject_attendance_verification_attempt_mutation();

create function public.evaluate_live_attendance_code(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_idempotency_key uuid,
  p_normalized_code text,
  p_input_format_valid boolean,
  p_fan_code_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attempt public.attendance_verification_attempts%rowtype;
  rate_state public.attendance_rate_limits%rowtype;
  attempt_category text;
  next_failed_count smallint;
  current_time timestamptz := pg_catalog.clock_timestamp();
begin
  select attempt.* into existing_attempt
  from public.attendance_verification_attempts attempt
  where attempt.idempotency_key = p_idempotency_key;
  if found then
    if existing_attempt.app_user_id <> p_app_user_id
       or existing_attempt.live_event_id <> p_live_event_id then
      raise exception 'G3_ATTENDANCE_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    return existing_attempt.category;
  end if;

  insert into public.attendance_rate_limits(app_user_id, live_event_id)
  values (p_app_user_id, p_live_event_id)
  on conflict (app_user_id, live_event_id) do nothing;

  select rate.* into strict rate_state
  from public.attendance_rate_limits rate
  where rate.app_user_id = p_app_user_id
    and rate.live_event_id = p_live_event_id
  for update;

  if rate_state.blocked_until is not null
     and current_time < rate_state.blocked_until then
    insert into public.attendance_verification_attempts(
      app_user_id, live_event_id, idempotency_key, category, attempted_at
    ) values (
      p_app_user_id, p_live_event_id, p_idempotency_key, 'rate_limited', current_time
    );
    return 'rate_limited';
  end if;

  if rate_state.blocked_until is not null
     or current_time >= rate_state.window_started_at + interval '10 minutes' then
    update public.attendance_rate_limits
    set failed_count = 0,
        window_started_at = current_time,
        blocked_until = null,
        updated_at = current_time
    where app_user_id = p_app_user_id
      and live_event_id = p_live_event_id;
    rate_state.failed_count := 0;
    rate_state.window_started_at := current_time;
  end if;

  if not p_input_format_valid then
    attempt_category := 'invalid_format';
  elsif extensions.crypt(p_normalized_code, p_fan_code_hash)
        is distinct from p_fan_code_hash then
    attempt_category := 'invalid_code';
  else
    return 'success';
  end if;

  next_failed_count := least(rate_state.failed_count + 1, 5)::smallint;
  update public.attendance_rate_limits
  set failed_count = next_failed_count,
      blocked_until = case
        when next_failed_count = 5 then current_time + interval '15 minutes'
        else null
      end,
      updated_at = current_time
  where app_user_id = p_app_user_id
    and live_event_id = p_live_event_id;

  insert into public.attendance_verification_attempts(
    app_user_id, live_event_id, idempotency_key, category, attempted_at
  ) values (
    p_app_user_id, p_live_event_id, p_idempotency_key, attempt_category, current_time
  );
  return attempt_category;
end;
$$;

create function public.record_successful_live_attendance_attempt(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_idempotency_key uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attendance_verification_attempts(
    app_user_id, live_event_id, idempotency_key, category
  ) values (
    p_app_user_id, p_live_event_id, p_idempotency_key, 'success'
  );

  insert into public.attendance_rate_limits(
    app_user_id, live_event_id, failed_count, window_started_at,
    blocked_until, updated_at
  ) values (
    p_app_user_id, p_live_event_id, 0, pg_catalog.clock_timestamp(),
    null, pg_catalog.clock_timestamp()
  ) on conflict (app_user_id, live_event_id) do update
    set failed_count = 0,
        window_started_at = excluded.window_started_at,
        blocked_until = null,
        updated_at = excluded.updated_at;
end;
$$;

create function public.attend_owned_live_event(
  p_app_user_id uuid,
  p_live_slug text,
  p_idempotency_key uuid,
  p_normalized_code text,
  p_input_format_valid boolean,
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
  verification_result text;
  result jsonb;
begin
  if p_app_user_id is null
     or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_idempotency_key is null
     or p_input_format_valid is null
     or (p_input_format_valid and p_normalized_code !~ '^[A-Z0-9]{4,32}$')
     or (not p_input_format_valid and p_normalized_code <> '') then
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
     or (attendance.app_user_id = p_app_user_id and live.slug = p_live_slug)
  order by (attendance.idempotency_key = p_idempotency_key) desc
  limit 1
  for update of attendance;
  if found then
    -- The underlying RPC validates global key reuse and returns the current
    -- resource projection; business IDs remain stable while mintStatus may advance.
    return public.attend_owned_live_event(
      p_app_user_id, p_live_slug, p_idempotency_key,
      case when p_input_format_valid then p_normalized_code else 'AAAA' end,
      p_stamp_id, p_stamp_operation_key, p_stamp_issuance_id
    );
  end if;

  perform 1 from public.app_users app_user
  where app_user.id = p_app_user_id and app_user.status = 'active'
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

  perform 1 from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = live_record.celebrity_id
    and passport.business_status = 'issued'
  for key share;
  if not found then
    raise exception 'G3_ATTENDANCE_PASSPORT_REQUIRED' using errcode = '42501';
  end if;

  verification_result := public.evaluate_live_attendance_code(
    p_app_user_id, live_record.id, p_idempotency_key, p_normalized_code,
    p_input_format_valid, live_record.fan_code_hash
  );
  if verification_result in ('invalid_format', 'invalid_code') then
    return jsonb_build_object('errorCode', 'G3_ATTENDANCE_CODE_INVALID');
  elsif verification_result = 'rate_limited' then
    return jsonb_build_object('errorCode', 'G3_ATTENDANCE_RATE_LIMITED');
  end if;

  result := public.attend_owned_live_event(
    p_app_user_id, p_live_slug, p_idempotency_key, p_normalized_code,
    p_stamp_id, p_stamp_operation_key, p_stamp_issuance_id
  );
  perform public.record_successful_live_attendance_attempt(
    p_app_user_id, live_record.id, p_idempotency_key
  );
  return result;
end;
$$;

alter table public.attendance_verification_attempts enable row level security;
alter table public.attendance_verification_attempts force row level security;
alter table public.attendance_rate_limits enable row level security;
alter table public.attendance_rate_limits force row level security;

revoke all on public.attendance_verification_attempts
  from public, anon, authenticated, service_role;
revoke all on public.attendance_rate_limits
  from public, anon, authenticated, service_role;
revoke all on function public.reject_attendance_verification_attempt_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.evaluate_live_attendance_code(uuid, uuid, uuid, text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_successful_live_attendance_attempt(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.attend_owned_live_event(uuid, text, uuid, text, uuid, text, text)
  from service_role;
revoke all on function public.attend_owned_live_event(
  uuid, text, uuid, text, boolean, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.attend_owned_live_event(
  uuid, text, uuid, text, boolean, uuid, text, text
) to service_role;

comment on table public.attendance_verification_attempts is
  'Append-only category-only Fan Code verification telemetry; raw and normalized codes are never stored.';
comment on table public.attendance_rate_limits is
  'Private owner/live fixed-window failure counter and lockout state; contains no code or PII.';
