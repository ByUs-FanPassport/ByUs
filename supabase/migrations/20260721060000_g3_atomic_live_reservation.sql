-- G3 reservation issuance is a single service-only transaction. The public
-- product interval is [reservation_opens_at, reservation_closes_at).

create function public.build_owned_live_reservation_result(
  p_app_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reservationId', reservation.id,
    'liveEventId', reservation.live_event_id,
    'passportId', reservation.passport_id,
    'activityId', activity.id,
    'stampId', stamp.id,
    'reservedAt', reservation.reserved_at,
    'scorePoints', score.points,
    'stampMintStatus', stamp.mint_status
  )
  from public.live_reservations reservation
  join public.fan_activities activity
    on activity.app_user_id = reservation.app_user_id
   and activity.celebrity_id = reservation.celebrity_id
   and activity.activity_type = 'reservation'
   and activity.source_type = 'live_reservation'
   and activity.source_id = reservation.id
  join public.fan_score_ledger score
    on score.activity_id = activity.id
   and score.app_user_id = reservation.app_user_id
   and score.celebrity_id = reservation.celebrity_id
  join public.stamps stamp
    on stamp.passport_id = reservation.passport_id
   and stamp.activity_id = activity.id
   and stamp.app_user_id = reservation.app_user_id
   and stamp.celebrity_id = reservation.celebrity_id
   and stamp.stamp_type = 'reservation'
  where reservation.id = p_reservation_id
    and reservation.app_user_id = p_app_user_id;
$$;

create function public.reserve_owned_live_event(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_idempotency_key uuid,
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
  existing_reservation public.live_reservations%rowtype;
  passport_record public.fan_passports%rowtype;
  effective_status public.live_content_status;
  celebrity_slug text;
  recipient text;
  expected_stamp_operation_key text;
  expected_payload jsonb;
  v_reservation_id uuid := extensions.gen_random_uuid();
  v_activity_id uuid := extensions.gen_random_uuid();
  v_stamp_job_id uuid := extensions.gen_random_uuid();
  job_record public.blockchain_jobs%rowtype;
  stamp_record public.stamps%rowtype;
  result jsonb;
begin
  if p_app_user_id is null
     or p_live_event_id is null
     or p_idempotency_key is null then
    raise exception 'G3_RESERVATION_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Serialize both global key reuse and the owner/event uniqueness race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g3:reservation:key:' || p_idempotency_key::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g3:reservation:target:' || p_app_user_id::text || ':' || p_live_event_id::text,
      0
    )
  );

  select reservation.* into existing_reservation
  from public.live_reservations reservation
  where reservation.idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_reservation.app_user_id <> p_app_user_id
       or existing_reservation.live_event_id <> p_live_event_id then
      raise exception 'G3_IDEMPOTENCY_KEY_CONFLICT' using errcode = '23514';
    end if;
    result := public.build_owned_live_reservation_result(
      p_app_user_id, existing_reservation.id
    );
    if result is null then
      raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  -- A retry with a fresh transport key still observes the already-issued
  -- business result and never evaluates expired availability again.
  select reservation.* into existing_reservation
  from public.live_reservations reservation
  where reservation.app_user_id = p_app_user_id
    and reservation.live_event_id = p_live_event_id
  for update;
  if found then
    result := public.build_owned_live_reservation_result(
      p_app_user_id, existing_reservation.id
    );
    if result is null then
      raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
    end if;
    return result;
  end if;

  perform 1
  from public.app_users app_user
  where app_user.id = p_app_user_id
    and app_user.status = 'active'
  for update;
  if not found then
    raise exception 'G3_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select live.* into live_record
  from public.live_events live
  where live.id = p_live_event_id
  for update;
  if not found then
    raise exception 'G3_LIVE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select override.effective_status into effective_status
  from public.live_status_overrides override
  where override.live_event_id = live_record.id
    and override.effective_from <= pg_catalog.now()
    and (override.effective_until is null or pg_catalog.now() < override.effective_until)
  order by override.effective_from desc, override.created_at desc, override.id desc
  limit 1;
  effective_status := coalesce(effective_status, live_record.content_status);

  if live_record.publication_status <> 'published'
     or effective_status <> 'scheduled' then
    raise exception 'G3_RESERVATION_UNAVAILABLE' using errcode = '55000';
  end if;
  if pg_catalog.now() < live_record.reservation_opens_at
     or pg_catalog.now() >= live_record.reservation_closes_at then
    raise exception 'G3_RESERVATION_WINDOW_CLOSED' using errcode = '55000';
  end if;

  select passport.* into passport_record
  from public.fan_passports passport
  where passport.app_user_id = p_app_user_id
    and passport.celebrity_id = live_record.celebrity_id
    and passport.business_status = 'issued'
  for key share;
  if not found then
    raise exception 'G3_PASSPORT_REQUIRED' using errcode = '42501';
  end if;

  select wallet.address into recipient
  from public.user_wallets wallet
  where wallet.app_user_id = p_app_user_id
    and wallet.chain_id = 91342
    and wallet.provider = 'privy'
    and wallet.wallet_type = 'embedded'
  for key share;
  if not found then
    raise exception 'G3_WALLET_NOT_READY' using errcode = '55000';
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
    raise exception 'G3_ISSUANCE_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.live_reservations(
    id, app_user_id, live_event_id, celebrity_id, passport_id, idempotency_key
  ) values (
    v_reservation_id, p_app_user_id, live_record.id, live_record.celebrity_id,
    passport_record.id, p_idempotency_key
  );

  insert into public.fan_activities(
    id, app_user_id, celebrity_id, activity_type, source_type, source_id
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id,
    'reservation', 'live_reservation', v_reservation_id
  );

  insert into public.fan_score_ledger(
    activity_id, app_user_id, celebrity_id, points
  ) values (
    v_activity_id, p_app_user_id, live_record.celebrity_id, 1
  );

  expected_payload := jsonb_build_object(
    'recipient', recipient,
    'celebritySlug', celebrity_slug,
    'issuanceId', p_stamp_issuance_id,
    'stampType', 'Reservation'
  );
  insert into public.blockchain_jobs(
    id, entity_type, entity_id, operation_key, payload_version, payload
  ) values (
    v_stamp_job_id, 'stamp', p_stamp_id,
    p_stamp_operation_key, 1, expected_payload
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
    raise exception 'G3_ISSUANCE_CONFLICT' using errcode = '23514';
  end if;

  insert into public.stamps(
    id, app_user_id, celebrity_id, passport_id, activity_id,
    stamp_type, blockchain_job_id
  ) values (
    p_stamp_id, p_app_user_id, live_record.celebrity_id,
    passport_record.id, v_activity_id, 'reservation', v_stamp_job_id
  );

  select stamp.* into strict stamp_record
  from public.stamps stamp
  where stamp.id = p_stamp_id
    and stamp.app_user_id = p_app_user_id
    and stamp.celebrity_id = live_record.celebrity_id
    and stamp.passport_id = passport_record.id
    and stamp.activity_id = v_activity_id
    and stamp.stamp_type = 'reservation'
    and stamp.blockchain_job_id = v_stamp_job_id
    and stamp.mint_status = 'queued';

  result := public.build_owned_live_reservation_result(
    p_app_user_id, v_reservation_id
  );
  if result is null then
    raise exception 'G3_RESERVATION_INTEGRITY_ERROR' using errcode = '23514';
  end if;
  return result;
end;
$$;

revoke all on function public.build_owned_live_reservation_result(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_owned_live_event(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.reserve_owned_live_event(
  uuid, uuid, uuid, uuid, text, text
) to service_role;

-- Reservation and issuance writes are now possible only inside the atomic RPC.
revoke insert on public.live_reservations from service_role;

comment on function public.reserve_owned_live_event(uuid, uuid, uuid, uuid, text, text) is
  'Atomically reserves a published scheduled live during [opens, closes), awards +1, issues a Reservation Stamp, and queues its mint exactly once.';
