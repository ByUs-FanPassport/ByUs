-- G6 release gate: resolve the remaining plpgsql_check warnings without
-- changing business behavior or function privileges.

do $$
declare
  definition text;
  corrected text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.attend_owned_live_event(uuid,text,uuid,text,boolean,uuid,text,text)'::regprocedure
  ) into definition;
  corrected := pg_catalog.replace(
    definition,
    E'  existing_attendance public.live_attendances%rowtype;\n',
    ''
  );
  corrected := pg_catalog.replace(
    corrected,
    E'  select attendance.* into existing_attendance\n  from public.live_attendances attendance\n  join public.live_events live on live.id = attendance.live_event_id\n  where attendance.idempotency_key = p_idempotency_key\n     or (attendance.app_user_id = p_app_user_id and live.slug = p_live_slug)\n  order by (attendance.idempotency_key = p_idempotency_key) desc\n  limit 1\n  for update of attendance;\n',
    E'  perform 1\n  from public.live_attendances attendance\n  join public.live_events live on live.id = attendance.live_event_id\n  where attendance.idempotency_key = p_idempotency_key\n     or (attendance.app_user_id = p_app_user_id and live.slug = p_live_slug)\n  order by (attendance.idempotency_key = p_idempotency_key) desc\n  limit 1\n  for update of attendance;\n'
  );
  if corrected = definition
     or pg_catalog.strpos(corrected, 'existing_attendance public.live_attendances%rowtype') > 0
     or pg_catalog.strpos(corrected, 'into existing_attendance') > 0 then
    raise exception 'attend_owned_live_event wrapper definition does not match the expected release baseline';
  end if;
  execute corrected;
end;
$$;

-- plpgsql_check reports stamp_record as unread in the reservation and core
-- attendance functions, but both variables are intentional SELECT INTO STRICT
-- targets. Keeping them preserves exact-one validation and function validity.

create or replace function public.live_effective_status_at(
  target_live_event_id uuid,
  target_at timestamptz
)
returns public.live_content_status
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  live_record public.live_events%rowtype;
  override_status public.live_content_status;
begin
  select * into live_record
  from public.live_events
  where id = target_live_event_id;

  if not found then
    raise exception 'live event not found';
  end if;

  if live_record.content_status = 'cancelled' then
    return 'cancelled'::public.live_content_status;
  end if;

  select override.effective_status into override_status
  from public.live_status_overrides override
  where override.live_event_id = target_live_event_id
    and override.effective_from <= target_at
    and (override.effective_until is null or target_at < override.effective_until)
  order by override.effective_from desc, override.created_at desc, override.id desc
  limit 1;

  if override_status is not null then
    return override_status;
  end if;

  if target_at < live_record.starts_at then
    return 'scheduled'::public.live_content_status;
  elsif target_at < live_record.ends_at then
    return 'live'::public.live_content_status;
  end if;
  return 'ended'::public.live_content_status;
end;
$$;

-- The actor assertion reads transaction-stable identity and allowlist rows only.
alter function public.admin_assert_active_survey_actor(uuid,uuid,boolean) stable;

-- Recursive JSON traversal uses catalog JSON functions classified STABLE.
alter function public.redact_audit_summary(jsonb) stable;
