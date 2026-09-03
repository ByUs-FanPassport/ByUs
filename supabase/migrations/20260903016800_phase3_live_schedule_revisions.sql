-- Phase 3 audited LIVE schedule revisions. Published LIVE identity and
-- reservations remain stable while a pre-start schedule is changed.

alter table public.live_events
  add column schedule_revision integer not null default 1,
  add constraint live_events_schedule_revision_positive
    check (schedule_revision > 0);

create table public.live_schedule_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  revision integer not null check (revision > 1),
  before_reservation_opens_at timestamptz not null,
  before_reservation_closes_at timestamptz not null,
  before_starts_at timestamptz not null,
  before_ends_at timestamptz not null,
  before_attendance_valid_from timestamptz not null,
  before_attendance_valid_until timestamptz not null,
  after_reservation_opens_at timestamptz not null,
  after_reservation_closes_at timestamptz not null,
  after_starts_at timestamptz not null,
  after_ends_at timestamptz not null,
  after_attendance_valid_from timestamptz not null,
  after_attendance_valid_until timestamptz not null,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  reason text not null check (length(pg_catalog.btrim(reason)) between 1 and 1000),
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (live_event_id, revision),
  constraint live_schedule_revisions_before_ordered check (
    before_reservation_opens_at < before_reservation_closes_at
    and before_reservation_closes_at <= before_starts_at
    and before_starts_at < before_ends_at
    and before_attendance_valid_from < before_attendance_valid_until
  ),
  constraint live_schedule_revisions_after_ordered check (
    after_reservation_opens_at < after_reservation_closes_at
    and after_reservation_closes_at <= after_starts_at
    and after_starts_at < after_ends_at
    and after_attendance_valid_from < after_attendance_valid_until
  )
);

create index attendance_verification_attempts_event_idx
  on public.attendance_verification_attempts (live_event_id);

create function public.reject_live_schedule_revision_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'live schedule revisions are append-only';
end;
$$;

create trigger live_schedule_revisions_append_only
before update or delete on public.live_schedule_revisions
for each row execute function public.reject_live_schedule_revision_mutation();

create trigger live_schedule_revisions_reject_truncate
before truncate on public.live_schedule_revisions
for each statement execute function public.reject_live_schedule_revision_mutation();

alter table public.live_schedule_revisions enable row level security;
alter table public.live_schedule_revisions force row level security;
revoke all on table public.live_schedule_revisions from public, anon, authenticated, service_role;
revoke all on function public.reject_live_schedule_revision_mutation() from public, anon, authenticated, service_role;

-- Preserve the existing published schedule guard while permitting only the
-- audited RPC below to advance starts_at/ends_at and its optimistic revision.
create or replace function public.protect_live_lifecycle_source()
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
     and old.ever_published_at is not null
     and (
       new.reservation_opens_at is distinct from old.reservation_opens_at
       or new.reservation_closes_at is distinct from old.reservation_closes_at
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.attendance_valid_from is distinct from old.attendance_valid_from
       or new.attendance_valid_until is distinct from old.attendance_valid_until
       or new.schedule_revision is distinct from old.schedule_revision
     )
     and not (
       current_user = pg_catalog.pg_get_userbyid((
         select routine.proowner
         from pg_catalog.pg_proc routine
         where routine.oid = 'public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)'::regprocedure
       ))
       and pg_catalog.current_setting('byus.live_reschedule_event_id', true) = old.id::text
       and new.schedule_revision = old.schedule_revision + 1
     ) then
    raise exception 'published live schedule is immutable; use the audited reschedule command';
  end if;
  return new;
end;
$$;

create function public.reschedule_admin_live(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_live_event_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_reservation_opens_at timestamptz,
  p_reservation_closes_at timestamptz,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_attendance_valid_from timestamptz,
  p_attendance_valid_until timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_record public.live_events%rowtype;
  revision_id uuid := extensions.gen_random_uuid();
  next_revision integer;
  v_current_time timestamptz;
  effective_status public.live_content_status;
  normalized_reason text := pg_catalog.btrim(p_reason);
  before_schedule jsonb;
  after_schedule jsonb;
begin
  perform public.require_live_manager_actor(
    p_actor_app_user_id,
    p_actor_admin_allowlist_id,
    true
  );

  if p_correlation_id is null then
    raise exception 'correlation id is required';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'expected schedule revision is required';
  end if;
  if normalized_reason is null or length(normalized_reason) not between 1 and 1000 then
    raise exception 'reschedule reason is required';
  end if;
  if p_reservation_opens_at is null
     or p_reservation_closes_at is null
     or p_starts_at is null
     or p_ends_at is null
     or p_attendance_valid_from is null
     or p_attendance_valid_until is null
     or not (
       p_reservation_opens_at < p_reservation_closes_at
       and p_reservation_closes_at <= p_starts_at
       and p_starts_at < p_ends_at
       and p_attendance_valid_from < p_attendance_valid_until
     ) then
    raise exception 'invalid live schedule windows';
  end if;

  select live.* into live_record
  from public.live_events live
  where live.id = p_live_event_id
  for update;

  if not found then raise exception 'LIVE not found'; end if;
  v_current_time := pg_catalog.clock_timestamp();
  if v_current_time >= p_starts_at then raise exception 'new LIVE schedule has started'; end if;
  if live_record.archived_at is not null then raise exception 'LIVE is archived'; end if;
  if live_record.publication_status <> 'published' then
    raise exception 'published LIVE is required for reschedule';
  end if;
  if live_record.schedule_revision <> p_expected_revision then
    raise exception 'stale schedule revision';
  end if;
  if v_current_time >= live_record.starts_at then raise exception 'LIVE has started'; end if;
  effective_status := public.live_effective_status_at(live_record.id, v_current_time);
  if effective_status = 'ended' then
    raise exception 'LIVE has ended';
  end if;
  if effective_status = 'cancelled' then
    raise exception 'LIVE is cancelled';
  end if;
  if effective_status <> 'scheduled' then
    raise exception 'LIVE is not effectively scheduled';
  end if;

  if exists (
    select 1 from public.live_attendances attendance
    where attendance.live_event_id = live_record.id
  ) or exists (
    select 1 from public.attendance_verification_attempts attempt
    where attempt.live_event_id = live_record.id
  ) then
    raise exception 'attendance history exists';
  end if;

  -- Expired overrides are historical facts. Any active or future override has
  -- wall-clock meaning that a schedule rewrite would silently reinterpret.
  if exists (
    select 1 from public.live_status_overrides status_overrides
    where status_overrides.live_event_id = live_record.id
      and (
        status_overrides.effective_until is null
        or status_overrides.effective_until > v_current_time
      )
  ) then
    raise exception 'incompatible status override';
  end if;

  if p_reservation_opens_at = live_record.reservation_opens_at
     and p_reservation_closes_at = live_record.reservation_closes_at
     and p_starts_at = live_record.starts_at
     and p_ends_at = live_record.ends_at
     and p_attendance_valid_from = live_record.attendance_valid_from
     and p_attendance_valid_until = live_record.attendance_valid_until then
    raise exception 'LIVE schedule is unchanged';
  end if;

  next_revision := live_record.schedule_revision + 1;
  before_schedule := jsonb_build_object(
    'revision', live_record.schedule_revision,
    'reservationOpensAt', live_record.reservation_opens_at,
    'reservationClosesAt', live_record.reservation_closes_at,
    'startsAt', live_record.starts_at,
    'endsAt', live_record.ends_at,
    'attendanceValidFrom', live_record.attendance_valid_from,
    'attendanceValidUntil', live_record.attendance_valid_until
  );
  after_schedule := jsonb_build_object(
    'revision', next_revision,
    'reservationOpensAt', p_reservation_opens_at,
    'reservationClosesAt', p_reservation_closes_at,
    'startsAt', p_starts_at,
    'endsAt', p_ends_at,
    'attendanceValidFrom', p_attendance_valid_from,
    'attendanceValidUntil', p_attendance_valid_until
  );

  perform pg_catalog.set_config(
    'byus.live_reschedule_event_id',
    live_record.id::text,
    true
  );
  update public.live_events set
    reservation_opens_at = p_reservation_opens_at,
    reservation_closes_at = p_reservation_closes_at,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    attendance_valid_from = p_attendance_valid_from,
    attendance_valid_until = p_attendance_valid_until,
    schedule_revision = next_revision
  where id = live_record.id;

  insert into public.live_schedule_revisions (
    id, live_event_id, revision,
    before_reservation_opens_at, before_reservation_closes_at,
    before_starts_at, before_ends_at,
    before_attendance_valid_from, before_attendance_valid_until,
    after_reservation_opens_at, after_reservation_closes_at,
    after_starts_at, after_ends_at,
    after_attendance_valid_from, after_attendance_valid_until,
    actor_app_user_id, actor_admin_allowlist_id, reason, correlation_id
  ) values (
    revision_id, live_record.id, next_revision,
    live_record.reservation_opens_at, live_record.reservation_closes_at,
    live_record.starts_at, live_record.ends_at,
    live_record.attendance_valid_from, live_record.attendance_valid_until,
    p_reservation_opens_at, p_reservation_closes_at,
    p_starts_at, p_ends_at,
    p_attendance_valid_from, p_attendance_valid_until,
    p_actor_app_user_id, p_actor_admin_allowlist_id, normalized_reason,
    p_correlation_id
  );

  insert into public.audit_logs (
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    entity_id, before_after_summary, correlation_id
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id,
    'live.schedule.rescheduled', 'live_event', live_record.id::text,
    jsonb_build_object(
      'revisionId', revision_id,
      'reason', normalized_reason,
      'before', before_schedule,
      'after', after_schedule
    ),
    p_correlation_id
  );

  return jsonb_build_object('revisionId', revision_id, 'revision', next_revision);
end;
$$;

revoke all on function public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_admin_live(uuid,uuid,uuid,uuid,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;

-- The v1 writer predated ever-published immutability and must not remain an
-- alternate service-role mutation path. v2/v3 already reject such updates.
revoke execute on function public.save_admin_live_draft(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,text,text,text,text,text) from service_role;

-- Code rotation is still allowed after publication, but its fixed attendance
-- window can then change only through reschedule_admin_live.
create or replace function public.generate_admin_live_attendance_code(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid,
  p_valid_from timestamptz, p_valid_until timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare generated_code text; before_safe jsonb; live_record public.live_events%rowtype;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null or p_valid_from is null or p_valid_until is null
     or p_valid_from >= p_valid_until then
    raise exception 'invalid attendance code window';
  end if;
  select * into live_record from public.live_events
  where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'active live event not found'; end if;
  if live_record.ever_published_at is not null and (
    p_valid_from is distinct from live_record.attendance_valid_from
    or p_valid_until is distinct from live_record.attendance_valid_until
  ) then
    raise exception 'published attendance window requires audited reschedule';
  end if;
  before_safe := jsonb_build_object(
    'validFrom',live_record.attendance_valid_from,
    'validUntil',live_record.attendance_valid_until,
    'codeConfigured',live_record.fan_code_hash is not null
  );
  generated_code := public.generate_attendance_code_value();
  update public.live_events set
    fan_code_hash=extensions.crypt(generated_code,extensions.gen_salt('bf',12)),
    attendance_valid_from=p_valid_from,attendance_valid_until=p_valid_until
  where id=p_live_event_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,
    entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,'live.attendance_code.generated',
    'live_event',p_live_event_id::text,jsonb_build_object('before',before_safe,'after',
      jsonb_build_object('validFrom',p_valid_from,'validUntil',p_valid_until,'codeConfigured',true)),p_correlation_id);
  return jsonb_build_object('fanCode',generated_code,'validFrom',p_valid_from,'validUntil',p_valid_until);
end $$;

-- Retain every provider, preview, localization, lifecycle, and reward-compatible
-- manager field from the provider migration while exposing optimistic revision.
create or replace function public.get_admin_live_manager(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_live_event_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id, p_actor_admin_allowlist_id, false);
  select jsonb_build_object(
    'lives', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'slug', l.slug, 'celebrityId', l.celebrity_id,
      'brandId', l.brand_id, 'publicationStatus', l.publication_status,
      'effectiveStatus', public.live_effective_status_at(l.id, now()),
      'scheduleRevision', l.schedule_revision,
      'startsAt', l.starts_at, 'endsAt', l.ends_at,
      'reservationOpensAt', l.reservation_opens_at,
      'reservationClosesAt', l.reservation_closes_at,
      'liveProvider', l.live_provider, 'externalLiveUrl', l.external_live_url,
      'youtubeUrl', l.youtube_url, 'heroUrl', l.approved_hero_url,
      'fanCodeConfigured', l.fan_code_hash ~ '^\$2[aby]\$(1[0-4]|0?[4-9])\$',
      'publishedAt', l.published_at, 'everPublishedAt', l.ever_published_at,
      'archivedAt', l.archived_at, 'archiveReason', l.archive_reason,
      'createdAt', l.created_at, 'updatedAt', l.updated_at,
      'preview', (select jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'publicationStatus', p.publication_status,
        'durationMs', p.duration_ms, 'sourceSha256', p.source_sha256,
        'focal', p.focal, 'squareVideoUrl', p.square_video_url,
        'squarePosterUrl', p.square_poster_url,
        'landscapeVideoUrl', p.landscape_video_url,
        'landscapePosterUrl', p.landscape_poster_url,
        'rightsHolder', p.rights_holder, 'rightsBasis', p.rights_basis,
        'sourceReference', p.source_reference, 'processedAt', p.processed_at,
        'archivedAt', p.archived_at, 'archiveReason', p.archive_reason,
        'revision', p.revision
      ) from public.live_event_previews p where p.live_event_id = l.id),
      'localizations', (select jsonb_object_agg(x.locale, jsonb_build_object(
        'title', x.title, 'summary', x.summary, 'heroAlt', x.hero_alt
      )) from public.live_event_localizations x where x.live_event_id = l.id),
      'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'status', o.effective_status, 'effectiveFrom', o.effective_from,
        'effectiveUntil', o.effective_until, 'reason', o.reason, 'createdAt', o.created_at
      ) order by o.effective_from desc) from public.live_status_overrides o
        where o.live_event_id = l.id), '[]'::jsonb)
    ) order by l.created_at desc) from public.live_events l
      where p_live_event_id is null or l.id = p_live_event_id), '[]'::jsonb),
    'celebrities', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'status', c.status,
      'nameKo', ko.name, 'nameEn', en.name
    ) order by ko.name) from public.celebrities c
      join public.celebrity_localizations ko on ko.celebrity_id=c.id and ko.locale='ko'
      join public.celebrity_localizations en on en.celebrity_id=c.id and en.locale='en'
      where c.archived_at is null), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'status', b.status,
      'nameKo', ko.name, 'nameEn', en.name
    ) order by ko.name) from public.brands b
      join public.brand_localizations ko on ko.brand_id=b.id and ko.locale='ko'
      join public.brand_localizations en on en.brand_id=b.id and en.locale='en'
      where b.archived_at is null), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_admin_live_manager(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_admin_live_manager(uuid,uuid,uuid) to service_role;
