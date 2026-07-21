-- G3 administrator live lifecycle policy.
-- Overrides are immutable facts. The server clock remains the source of the
-- automatic scheduled/live/ended lifecycle whenever no override is active.

create extension if not exists btree_gist with schema extensions;

alter table public.live_status_overrides
  add constraint live_status_overrides_no_overlap
  exclude using gist (
    live_event_id with =,
    tstzrange(effective_from, effective_until, '[)') with &&
  );

create function public.live_effective_status_at(
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

  -- A source cancellation is terminal and has precedence, matching the public
  -- GET projection.
  if live_record.content_status = 'cancelled' then
    return 'cancelled';
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
    return 'scheduled';
  elsif target_at < live_record.ends_at then
    return 'live';
  end if;
  return 'ended';
end;
$$;

create function public.validate_live_status_override()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prior_status public.live_content_status;
  expiry_status public.live_content_status;
  actor_is_active boolean;
  live_record public.live_events%rowtype;
begin
  -- Serialize all lifecycle decisions for one live event, including concurrent
  -- requests whose intervals do not yet exist when either transaction starts.
  select * into live_record
  from public.live_events
  where id = new.live_event_id
  for update;
  if not found then
    raise exception 'live event not found';
  end if;

  select allowlist.active into actor_is_active
  from public.admin_allowlist allowlist
  where allowlist.id = new.actor_admin_allowlist_id
  for share;
  if actor_is_active is distinct from true then
    raise exception 'active administrator allowlist entry is required';
  end if;

  if new.effective_until is not null
     and new.effective_until <= new.effective_from then
    raise exception 'effective_until must be later than effective_from';
  end if;

  -- Facts are authored in lifecycle order. Backfilling an earlier fact after a
  -- successor exists could silently invalidate the successor transition.
  if exists (
    select 1
    from public.live_status_overrides successor
    where successor.live_event_id = new.live_event_id
      and successor.effective_from > new.effective_from
  ) then
    raise exception 'live status overrides must be appended chronologically';
  end if;

  prior_status := public.live_effective_status_at(
    new.live_event_id,
    new.effective_from
  );

  if prior_status in ('ended', 'cancelled') then
    raise exception 'ended and cancelled live events are terminal';
  end if;

  if exists (
    select 1
    from public.live_status_overrides existing
    where existing.live_event_id = new.live_event_id
      and tstzrange(
        existing.effective_from,
        existing.effective_until,
        '[)'
      ) && tstzrange(new.effective_from, new.effective_until, '[)')
  ) then
    raise exception 'live status override intervals must not overlap';
  end if;

  if prior_status = 'scheduled'
     and new.effective_status not in ('scheduled', 'live', 'cancelled') then
    raise exception 'invalid live status transition from scheduled';
  end if;
  if prior_status = 'live'
     and new.effective_status not in ('live', 'ended', 'cancelled') then
    raise exception 'invalid live status transition from live';
  end if;

  -- Delay and extension overrides must always be bounded. Terminal decisions
  -- are permanent facts; a later interval cannot silently revive the event.
  if new.effective_status in ('scheduled', 'live')
     and new.effective_until is null then
    raise exception 'scheduled and live overrides require effective_until';
  end if;
  if new.effective_status in ('ended', 'cancelled')
     and new.effective_until is not null then
    raise exception 'terminal overrides must not expire';
  end if;

  -- Expiry is also a lifecycle edge. A bounded override may only fall back to
  -- a clock state allowed by the same approved transition matrix.
  if new.effective_until is not null then
    if new.effective_until < live_record.starts_at then
      expiry_status := 'scheduled';
    elsif new.effective_until < live_record.ends_at then
      expiry_status := 'live';
    else
      expiry_status := 'ended';
    end if;

    if new.effective_status = 'scheduled'
       and expiry_status not in ('scheduled', 'live', 'cancelled') then
      raise exception 'scheduled override expiry would create an invalid transition';
    end if;
    if new.effective_status = 'live'
       and expiry_status not in ('live', 'ended', 'cancelled') then
      raise exception 'live override expiry would create an invalid transition';
    end if;
  end if;

  return new;
end;
$$;

create trigger live_status_overrides_validate_policy
before insert on public.live_status_overrides
for each row execute function public.validate_live_status_override();

create function public.reject_live_status_override_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'live status overrides are append-only';
end;
$$;

create trigger live_status_overrides_reject_update_delete
before update or delete on public.live_status_overrides
for each row execute function public.reject_live_status_override_mutation();

create trigger live_status_overrides_reject_truncate
before truncate on public.live_status_overrides
for each statement execute function public.reject_live_status_override_mutation();

create function public.audit_live_status_override()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  before_status public.live_content_status;
  live_record public.live_events%rowtype;
begin
  select * into strict live_record
  from public.live_events
  where id = new.live_event_id;

  if live_record.content_status = 'cancelled' then
    before_status := 'cancelled';
  else
    select override.effective_status into before_status
    from public.live_status_overrides override
    where override.live_event_id = new.live_event_id
      and override.id <> new.id
      and override.effective_from <= new.effective_from
      and (
        override.effective_until is null
        or new.effective_from < override.effective_until
      )
    order by override.effective_from desc, override.created_at desc, override.id desc
    limit 1;

    if before_status is null then
      if new.effective_from < live_record.starts_at then
        before_status := 'scheduled';
      elsif new.effective_from < live_record.ends_at then
        before_status := 'live';
      else
        before_status := 'ended';
      end if;
    end if;
  end if;

  insert into public.audit_logs (
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary
  ) values (
    new.actor_admin_allowlist_id,
    'live.status_override.created',
    'live_event',
    new.live_event_id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'effective_status', before_status
      ),
      'after', jsonb_build_object(
        'override_id', new.id,
        'effective_status', new.effective_status,
        'effective_from', new.effective_from,
        'effective_until', new.effective_until,
        'reason', new.reason
      )
    )
  );
  return new;
end;
$$;

create trigger live_status_overrides_write_audit
after insert on public.live_status_overrides
for each row execute function public.audit_live_status_override();

create function public.protect_live_lifecycle_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.content_status <> 'scheduled' then
    raise exception 'new live events must start scheduled';
  end if;
  if tg_op = 'UPDATE'
     and new.content_status is distinct from old.content_status then
    raise exception 'live lifecycle changes require an append-only override';
  end if;
  if tg_op = 'UPDATE'
     and old.publication_status = 'published'
     and (
       new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
     ) then
    raise exception 'published live schedule is immutable; use a bounded override';
  end if;
  return new;
end;
$$;

create trigger live_events_protect_lifecycle_source
before insert or update on public.live_events
for each row execute function public.protect_live_lifecycle_source();

create function public.create_live_status_override(
  target_live_event_id uuid,
  target_effective_status public.live_content_status,
  target_effective_from timestamptz,
  target_effective_until timestamptz,
  target_reason text,
  target_verified_admin_email text
)
returns public.live_status_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_override public.live_status_overrides;
  verified_actor_admin_allowlist_id uuid;
begin
  if target_live_event_id is null
     or target_effective_status is null
     or target_effective_from is null
     or target_reason is null
     or target_verified_admin_email is null then
    raise exception 'complete live status override input is required';
  end if;

  select allowlist.id into verified_actor_admin_allowlist_id
  from public.admin_allowlist allowlist
  where allowlist.email = lower(trim(target_verified_admin_email))
    and allowlist.active
  for share;
  if verified_actor_admin_allowlist_id is null then
    raise exception 'verified administrator is not actively allowlisted';
  end if;

  insert into public.live_status_overrides (
    live_event_id,
    effective_status,
    effective_from,
    effective_until,
    reason,
    actor_admin_allowlist_id
  ) values (
    target_live_event_id,
    target_effective_status,
    target_effective_from,
    target_effective_until,
    trim(target_reason),
    verified_actor_admin_allowlist_id
  )
  returning * into created_override;

  return created_override;
end;
$$;

-- All lifecycle writes now cross the validated RPC. Browser roles cannot read
-- or invoke it, and the service role cannot bypass it with a direct insert.
revoke insert on public.live_status_overrides from service_role;
revoke insert, update, delete, truncate on public.live_status_overrides
  from public, anon, authenticated, service_role;
revoke all on function public.live_effective_status_at(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.validate_live_status_override()
  from public, anon, authenticated;
revoke all on function public.reject_live_status_override_mutation()
  from public, anon, authenticated;
revoke all on function public.audit_live_status_override()
  from public, anon, authenticated;
revoke all on function public.protect_live_lifecycle_source()
  from public, anon, authenticated;
revoke all on function public.create_live_status_override(
  uuid,
  public.live_content_status,
  timestamptz,
  timestamptz,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.create_live_status_override(
  uuid,
  public.live_content_status,
  timestamptz,
  timestamptz,
  text,
  text
) to service_role;

comment on table public.live_status_overrides is
  'Immutable administrator-authored lifecycle intervals with serialized transition, overlap, terminal-state, and audit enforcement.';
comment on function public.create_live_status_override(
  uuid,
  public.live_content_status,
  timestamptz,
  timestamptz,
  text,
  text
) is 'The only service-role boundary for an active allowlisted administrator to append a live lifecycle decision.';
