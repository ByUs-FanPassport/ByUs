-- Rights-gated short LIVE preview derivatives. Original source media never
-- enters public Storage; only validated silent MP4 and WebP derivatives do.

create type public.live_preview_kind as enum ('artist_teaser', 'event_highlight');

create table public.live_event_previews (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null unique references public.live_events(id) on delete restrict,
  kind public.live_preview_kind not null,
  publication_status public.content_status not null default 'draft',
  duration_ms integer not null check (duration_ms between 3000 and 5000),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  focal jsonb not null check (
    jsonb_typeof(focal) = 'object'
    and (focal->>'x')::numeric between 0 and 1
    and (focal->>'y')::numeric between 0 and 1
  ),
  square_video_path text not null,
  square_video_url text not null check (square_video_url ~ '^https://'),
  square_poster_path text not null,
  square_poster_url text not null check (square_poster_url ~ '^https://'),
  landscape_video_path text not null,
  landscape_video_url text not null check (landscape_video_url ~ '^https://'),
  landscape_poster_path text not null,
  landscape_poster_url text not null check (landscape_poster_url ~ '^https://'),
  derivative_manifest jsonb not null,
  ffmpeg_version text not null check (length(trim(ffmpeg_version)) > 0),
  rights_holder text not null check (length(trim(rights_holder)) > 0),
  rights_basis text not null check (length(trim(rights_basis)) > 0),
  source_reference text not null check (length(trim(source_reference)) > 0),
  processed_at timestamptz not null,
  published_at timestamptz,
  archived_at timestamptz,
  archive_reason text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (publication_status = 'draft' and published_at is null)
    or (publication_status = 'published' and published_at is not null)
  ),
  check (
    (archived_at is null and archive_reason is null)
    or (archived_at is not null and length(trim(archive_reason)) >= 10)
  )
);

create index live_event_previews_publication_idx
  on public.live_event_previews (publication_status, live_event_id)
  where archived_at is null;

create trigger live_event_previews_touch_updated_at
before update on public.live_event_previews
for each row execute function public.set_updated_at();

alter table public.live_event_previews enable row level security;
revoke all on public.live_event_previews from public, anon, authenticated;
grant select, insert, update on public.live_event_previews to service_role;

create function public.register_live_preview_draft(
  p_live_event_id uuid,
  p_kind public.live_preview_kind,
  p_duration_ms integer,
  p_source_sha256 text,
  p_focal jsonb,
  p_square_video_path text,
  p_square_video_url text,
  p_square_poster_path text,
  p_square_poster_url text,
  p_landscape_video_path text,
  p_landscape_video_url text,
  p_landscape_poster_path text,
  p_landscape_poster_url text,
  p_derivative_manifest jsonb,
  p_ffmpeg_version text,
  p_rights_holder text,
  p_rights_basis text,
  p_source_reference text,
  p_processed_at timestamptz,
  p_correlation_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  prefix text := 'live-previews/' || p_live_event_id::text || '/' || p_source_sha256 || '/';
begin
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform 1 from public.live_events
    where id = p_live_event_id and archived_at is null for share;
  if not found then raise exception 'active live event not found'; end if;
  if p_duration_ms not between 3000 and 5000 then
    raise exception 'preview duration must be between 3000 and 5000 milliseconds';
  end if;
  if p_source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid source sha256'; end if;
  if p_focal is null
     or (p_focal->>'x')::numeric not between 0 and 1
     or (p_focal->>'y')::numeric not between 0 and 1 then
    raise exception 'invalid focal point';
  end if;
  if p_square_video_path <> prefix || 'square.mp4'
     or p_square_poster_path <> prefix || 'square-poster.webp'
     or p_landscape_video_path <> prefix || 'landscape.mp4'
     or p_landscape_poster_path <> prefix || 'landscape-poster.webp' then
    raise exception 'preview storage paths are not content addressed';
  end if;
  if trim(p_rights_holder) = '' or trim(p_rights_basis) = ''
     or trim(p_source_reference) = '' then
    raise exception 'complete rights metadata is required';
  end if;
  if not (
    coalesce(p_derivative_manifest #>> '{square,video,mime}', '') = 'video/mp4'
    and coalesce(p_derivative_manifest #>> '{square,poster,mime}', '') = 'image/webp'
    and (p_derivative_manifest #>> '{square,video,width}')::integer = 720
    and (p_derivative_manifest #>> '{square,video,height}')::integer = 720
    and (p_derivative_manifest #>> '{square,poster,width}')::integer = 720
    and (p_derivative_manifest #>> '{square,poster,height}')::integer = 720
    and coalesce(p_derivative_manifest #>> '{landscape,video,mime}', '') = 'video/mp4'
    and coalesce(p_derivative_manifest #>> '{landscape,poster,mime}', '') = 'image/webp'
    and (p_derivative_manifest #>> '{landscape,video,width}')::integer = 1280
    and (p_derivative_manifest #>> '{landscape,video,height}')::integer = 640
    and (p_derivative_manifest #>> '{landscape,poster,width}')::integer = 1280
    and (p_derivative_manifest #>> '{landscape,poster,height}')::integer = 640
    and (p_derivative_manifest #>> '{square,video,bytes}')::integer between 1 and 1000000
    and (p_derivative_manifest #>> '{square,poster,bytes}')::integer between 1 and 150000
    and (p_derivative_manifest #>> '{landscape,video,bytes}')::integer between 1 and 1800000
    and (p_derivative_manifest #>> '{landscape,poster,bytes}')::integer between 1 and 150000
    and coalesce(p_derivative_manifest #>> '{square,video,sha256}', '') ~ '^[a-f0-9]{64}$'
    and coalesce(p_derivative_manifest #>> '{square,poster,sha256}', '') ~ '^[a-f0-9]{64}$'
    and coalesce(p_derivative_manifest #>> '{landscape,video,sha256}', '') ~ '^[a-f0-9]{64}$'
    and coalesce(p_derivative_manifest #>> '{landscape,poster,sha256}', '') ~ '^[a-f0-9]{64}$'
  ) then raise exception 'invalid derivative manifest'; end if;

  insert into public.live_event_previews (
    live_event_id, kind, duration_ms, source_sha256, focal,
    square_video_path, square_video_url, square_poster_path, square_poster_url,
    landscape_video_path, landscape_video_url,
    landscape_poster_path, landscape_poster_url,
    derivative_manifest, ffmpeg_version, rights_holder, rights_basis,
    source_reference, processed_at
  ) values (
    p_live_event_id, p_kind, p_duration_ms, p_source_sha256, p_focal,
    p_square_video_path, p_square_video_url, p_square_poster_path, p_square_poster_url,
    p_landscape_video_path, p_landscape_video_url,
    p_landscape_poster_path, p_landscape_poster_url,
    p_derivative_manifest, trim(p_ffmpeg_version), trim(p_rights_holder),
    trim(p_rights_basis), trim(p_source_reference), p_processed_at
  )
  on conflict (live_event_id) do update set
    kind = excluded.kind,
    publication_status = 'draft',
    duration_ms = excluded.duration_ms,
    source_sha256 = excluded.source_sha256,
    focal = excluded.focal,
    square_video_path = excluded.square_video_path,
    square_video_url = excluded.square_video_url,
    square_poster_path = excluded.square_poster_path,
    square_poster_url = excluded.square_poster_url,
    landscape_video_path = excluded.landscape_video_path,
    landscape_video_url = excluded.landscape_video_url,
    landscape_poster_path = excluded.landscape_poster_path,
    landscape_poster_url = excluded.landscape_poster_url,
    derivative_manifest = excluded.derivative_manifest,
    ffmpeg_version = excluded.ffmpeg_version,
    rights_holder = excluded.rights_holder,
    rights_basis = excluded.rights_basis,
    source_reference = excluded.source_reference,
    processed_at = excluded.processed_at,
    published_at = null,
    archived_at = null,
    archive_reason = null,
    revision = public.live_event_previews.revision + 1
  where public.live_event_previews.publication_status = 'draft'
    and public.live_event_previews.archived_at is null
  returning id into target_id;

  if target_id is null then raise exception 'published preview is immutable'; end if;
  insert into public.audit_logs (
    action, entity_type, entity_id, correlation_id, before_after_summary
  ) values (
    'live_preview.draft.registered', 'live_event_preview', target_id::text,
    p_correlation_id,
    jsonb_build_object(
      'liveEventId', p_live_event_id,
      'kind', p_kind,
      'durationMs', p_duration_ms,
      'sourceSha256', p_source_sha256
    )
  );
  return target_id;
end;
$$;

create function public.set_admin_live_preview_status(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_live_event_id uuid,
  p_action text,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  preview public.live_event_previews%rowtype;
  missing_objects integer;
begin
  perform public.require_live_manager_actor(
    p_actor_app_user_id, p_actor_admin_allowlist_id, true
  );
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  select * into preview from public.live_event_previews
    where live_event_id = p_live_event_id for update;
  if not found then raise exception 'live preview not found'; end if;

  if p_action = 'publish' then
    if preview.archived_at is not null then raise exception 'archived preview is immutable'; end if;
    select 4 - count(*) into missing_objects
    from storage.objects object
    where object.bucket_id = 'cms-assets'
      and (
        (object.name = preview.square_video_path
          and object.metadata->>'mimetype' = 'video/mp4'
          and (object.metadata->>'size')::integer = (preview.derivative_manifest #>> '{square,video,bytes}')::integer
          and object.user_metadata->>'sha256' = preview.derivative_manifest #>> '{square,video,sha256}')
        or (object.name = preview.square_poster_path
          and object.metadata->>'mimetype' = 'image/webp'
          and (object.metadata->>'size')::integer = (preview.derivative_manifest #>> '{square,poster,bytes}')::integer
          and object.user_metadata->>'sha256' = preview.derivative_manifest #>> '{square,poster,sha256}')
        or (object.name = preview.landscape_video_path
          and object.metadata->>'mimetype' = 'video/mp4'
          and (object.metadata->>'size')::integer = (preview.derivative_manifest #>> '{landscape,video,bytes}')::integer
          and object.user_metadata->>'sha256' = preview.derivative_manifest #>> '{landscape,video,sha256}')
        or (object.name = preview.landscape_poster_path
          and object.metadata->>'mimetype' = 'image/webp'
          and (object.metadata->>'size')::integer = (preview.derivative_manifest #>> '{landscape,poster,bytes}')::integer
          and object.user_metadata->>'sha256' = preview.derivative_manifest #>> '{landscape,poster,sha256}')
      );
    if missing_objects <> 0 then raise exception 'preview derivatives are missing'; end if;
    update public.live_event_previews set
      publication_status = 'published', published_at = now(),
      revision = revision + 1 where id = preview.id;
  elsif p_action = 'unpublish' then
    if preview.archived_at is not null then raise exception 'archived preview is immutable'; end if;
    update public.live_event_previews set
      publication_status = 'draft', published_at = null,
      revision = revision + 1 where id = preview.id;
  elsif p_action = 'archive' then
    if coalesce(length(trim(p_reason)), 0) < 10 then
      raise exception 'archive reason must be at least 10 characters';
    end if;
    update public.live_event_previews set
      publication_status = 'draft', published_at = null,
      archived_at = now(), archive_reason = trim(p_reason),
      revision = revision + 1 where id = preview.id;
  else
    raise exception 'unsupported preview action';
  end if;

  insert into public.audit_logs (
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    entity_id, correlation_id, before_after_summary
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id,
    'live_preview.' || p_action, 'live_event_preview', preview.id::text,
    p_correlation_id,
    jsonb_build_object(
      'liveEventId', p_live_event_id,
      'from', preview.publication_status,
      'reason', p_reason
    )
  );
end;
$$;

drop view if exists public.published_celebrity_live_summaries;
create view public.published_celebrity_live_summaries
with (security_barrier = true, security_invoker = false)
as
select
  live.slug,
  celebrity.slug as celebrity_slug,
  localization.locale,
  localization.title,
  live.starts_at,
  effective.status as effective_status,
  preview.kind as preview_kind,
  preview.duration_ms as preview_duration_ms,
  preview.square_video_url as preview_square_video_url,
  preview.square_poster_url as preview_square_poster_url
from public.live_events live
join public.celebrities celebrity
  on celebrity.id = live.celebrity_id and celebrity.status = 'published'
join public.brands brand
  on brand.id = live.brand_id and brand.status = 'published'
join public.live_event_localizations localization
  on localization.live_event_id = live.id
left join public.live_event_previews preview
  on preview.live_event_id = live.id
  and preview.publication_status = 'published'
  and preview.archived_at is null
cross join lateral (
  select public.live_effective_status_at(live.id, pg_catalog.now()) as status
) effective
where live.publication_status = 'published'
  and live.archived_at is null
  and effective.status in ('scheduled', 'live');

revoke all on public.published_celebrity_live_summaries from public, anon, authenticated;
grant select on public.published_celebrity_live_summaries to service_role;

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
      'startsAt', l.starts_at, 'endsAt', l.ends_at,
      'reservationOpensAt', l.reservation_opens_at,
      'reservationClosesAt', l.reservation_closes_at,
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

revoke all on function public.register_live_preview_draft(
  uuid,public.live_preview_kind,integer,text,jsonb,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,timestamptz,uuid
) from public,anon,authenticated;
grant execute on function public.register_live_preview_draft(
  uuid,public.live_preview_kind,integer,text,jsonb,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,timestamptz,uuid
) to service_role;
revoke all on function public.set_admin_live_preview_status(
  uuid,uuid,uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.set_admin_live_preview_status(
  uuid,uuid,uuid,uuid,text,text
) to service_role;
