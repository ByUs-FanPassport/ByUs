-- Classify an existing attendance inside the same owner/LIVE lock used by the
-- canonical attendance writer. The BFF uses this bit only for user feedback;
-- the existing RPC remains the sole writer and source of the owned projection.
create function public.attend_owned_live_event_with_replay(
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
  replayed boolean;
  result jsonb;
begin
  if p_app_user_id is null
     or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_idempotency_key is null then
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

  select exists (
    select 1
    from public.live_attendances attendance
    join public.live_events live on live.id = attendance.live_event_id
    where attendance.idempotency_key = p_idempotency_key
       or (attendance.app_user_id = p_app_user_id and live.slug = p_live_slug)
  ) into replayed;

  result := public.attend_owned_live_event(
    p_app_user_id,
    p_live_slug,
    p_idempotency_key,
    p_normalized_code,
    p_input_format_valid,
    p_stamp_id,
    p_stamp_operation_key,
    p_stamp_issuance_id
  );
  if result ? 'errorCode' then
    return result;
  end if;
  return result || jsonb_build_object('replayed', replayed);
end;
$$;

revoke all on function public.attend_owned_live_event_with_replay(
  uuid, text, uuid, text, boolean, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.attend_owned_live_event_with_replay(
  uuid, text, uuid, text, boolean, uuid, text, text
) to service_role;
