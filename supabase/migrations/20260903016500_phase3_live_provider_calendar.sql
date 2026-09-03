-- Phase 3 provider-neutral external LIVE targets. The legacy youtube_url
-- column and v2 writer remain available during rolling deployment; v3 is canonical.

alter table public.live_events
  add column live_provider public.social_platform not null default 'youtube',
  add column external_live_url text;

update public.live_events
set external_live_url = youtube_url
where external_live_url is null;

alter table public.live_events
  alter column external_live_url set not null,
  drop constraint live_events_youtube_url_allowlist;

create function public.is_valid_external_live_url(
  p_provider public.social_platform,
  p_url text
) returns boolean
language sql immutable set search_path = '' as $$
  select p_url = pg_catalog.btrim(p_url)
    and p_url !~ '[#[:space:]]'
    and case p_provider
      when 'youtube'::public.social_platform then
        (p_url ~ '^https://(?:www\.)?youtube\.com/watch\?[^#[:space:]]+$'
          and ('&' || pg_catalog.split_part(p_url,'?',2) || '&')
            ~ '&v=[A-Za-z0-9_-]+&')
        or p_url ~ '^https://(?:www\.)?youtube\.com/(?:live|embed)/[A-Za-z0-9_-]+(?:\?[^#[:space:]]*)?$'
        or p_url ~ '^https://youtu\.be/[A-Za-z0-9_-]+(?:\?[^#[:space:]]*)?$'
      when 'instagram'::public.social_platform then
        p_url ~ '^https://(?:www\.)?instagram\.com/[^#[:space:]]*$'
      when 'tiktok'::public.social_platform then
        p_url ~ '^https://(?:www\.)?tiktok\.com/[^#[:space:]]*$'
      else false
    end;
$$;

do $$
begin
  if not public.is_valid_external_live_url(
    'youtube'::public.social_platform,
    'https://www.youtube.com/watch?v=abc_DEF-1'
  ) or not public.is_valid_external_live_url(
    'instagram'::public.social_platform,
    'https://www.instagram.com/example/live/'
  ) or not public.is_valid_external_live_url(
    'tiktok'::public.social_platform,
    'https://www.tiktok.com/@artist/live'
  ) then
    raise exception 'external LIVE provider validation rejected a canonical URL';
  end if;
  if public.is_valid_external_live_url(
    'youtube'::public.social_platform,
    'https://youtube.com/watch?foo=bar'
  ) or public.is_valid_external_live_url(
    'youtube'::public.social_platform,
    'https://youtube.com/live/id/extra'
  ) or public.is_valid_external_live_url(
    'tiktok'::public.social_platform,
    'https://youtube.com/watch?v=x'
  ) then
    raise exception 'external LIVE provider validation accepted an invalid URL';
  end if;
end;
$$;

alter table public.live_events
  add constraint live_events_external_live_url_allowlist
    check (
      youtube_url = external_live_url
      and public.is_valid_external_live_url(live_provider, external_live_url)
    );

create function public.sync_legacy_live_external_url()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.external_live_url is null then
    new.live_provider := 'youtube'::public.social_platform;
    new.external_live_url := new.youtube_url;
  elsif tg_op = 'UPDATE'
    and new.live_provider = 'youtube'::public.social_platform
    and new.youtube_url is distinct from old.youtube_url
    and new.external_live_url is not distinct from old.external_live_url then
    new.external_live_url := new.youtube_url;
  end if;
  return new;
end;
$$;

create trigger live_events_sync_legacy_external_url
before insert or update of youtube_url on public.live_events
for each row execute function public.sync_legacy_live_external_url();

create function public.protect_published_live_provider_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ever_published_at is not null and (
    new.live_provider is distinct from old.live_provider
    or new.external_live_url is distinct from old.external_live_url
    or new.youtube_url is distinct from old.youtube_url
  ) then
    raise exception 'published live provider binding is immutable; create a new live';
  end if;
  return new;
end;
$$;

create trigger live_events_protect_published_provider_binding
before update of live_provider,external_live_url,youtube_url on public.live_events
for each row execute function public.protect_published_live_provider_binding();

create function public.save_admin_live_draft_v3(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_slug text,
  p_celebrity_id uuid, p_brand_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_reservation_opens_at timestamptz, p_reservation_closes_at timestamptz,
  p_live_provider public.social_platform, p_external_live_url text, p_hero_url text,
  p_title_ko text, p_summary_ko text, p_hero_alt_ko text,
  p_title_en text, p_summary_en text, p_hero_alt_en text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_id uuid; before_safe jsonb; after_safe jsonb; generated_code text;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  if not public.is_valid_external_live_url(p_live_provider,p_external_live_url) then
    raise exception 'provider URL mismatch';
  end if;

  if p_live_event_id is null then
    generated_code := public.generate_attendance_code_value();
    insert into public.live_events (
      slug,celebrity_id,brand_id,starts_at,ends_at,
      reservation_opens_at,reservation_closes_at,live_provider,external_live_url,
      youtube_url,approved_hero_url,fan_code_hash
    ) values (
      pg_catalog.btrim(p_slug),p_celebrity_id,p_brand_id,p_starts_at,p_ends_at,
      p_reservation_opens_at,p_reservation_closes_at,p_live_provider,
      pg_catalog.btrim(p_external_live_url),pg_catalog.btrim(p_external_live_url),
      pg_catalog.btrim(p_hero_url),extensions.crypt(generated_code,extensions.gen_salt('bf',12))
    ) returning id into target_id;
  else
    select jsonb_build_object(
      'slug',l.slug,'celebrityId',l.celebrity_id,'brandId',l.brand_id,
      'startsAt',l.starts_at,'endsAt',l.ends_at,'liveProvider',l.live_provider,
      'externalLiveUrl',l.external_live_url
    ) into before_safe
    from public.live_events l
    where l.id=p_live_event_id and l.publication_status='draft'
      and l.ever_published_at is null and l.archived_at is null
    for update;
    if before_safe is null then raise exception 'editable live draft not found'; end if;
    update public.live_events set
      slug=pg_catalog.btrim(p_slug),celebrity_id=p_celebrity_id,brand_id=p_brand_id,
      starts_at=p_starts_at,ends_at=p_ends_at,
      reservation_opens_at=p_reservation_opens_at,
      reservation_closes_at=p_reservation_closes_at,
      live_provider=p_live_provider,
      external_live_url=pg_catalog.btrim(p_external_live_url),
      youtube_url=pg_catalog.btrim(p_external_live_url),
      approved_hero_url=pg_catalog.btrim(p_hero_url)
    where id=p_live_event_id returning id into target_id;
  end if;

  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
  values
    (target_id,'ko',pg_catalog.btrim(p_title_ko),pg_catalog.btrim(p_summary_ko),pg_catalog.btrim(p_hero_alt_ko)),
    (target_id,'en',pg_catalog.btrim(p_title_en),pg_catalog.btrim(p_summary_en),pg_catalog.btrim(p_hero_alt_en))
  on conflict (live_event_id,locale) do update set
    title=excluded.title,summary=excluded.summary,hero_alt=excluded.hero_alt;

  select jsonb_build_object(
    'slug',l.slug,'celebrityId',l.celebrity_id,'brandId',l.brand_id,
    'startsAt',l.starts_at,'endsAt',l.ends_at,'liveProvider',l.live_provider,
    'externalLiveUrl',l.external_live_url
  ) into after_safe from public.live_events l where l.id=target_id;

  insert into public.audit_logs(
    actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,
    before_after_summary,correlation_id
  ) values (
    p_actor_app_user_id,p_actor_admin_allowlist_id,
    case when p_live_event_id is null then 'live.draft.created' else 'live.draft.updated' end,
    'live_event',target_id::text,
    jsonb_build_object('before',before_safe,'after',after_safe),p_correlation_id
  );
  return jsonb_strip_nulls(jsonb_build_object('id',target_id,'fanCode',generated_code));
end;
$$;

revoke all on function public.is_valid_external_live_url(public.social_platform,text) from public,anon,authenticated,service_role;
revoke all on function public.sync_legacy_live_external_url() from public,anon,authenticated,service_role;
revoke all on function public.protect_published_live_provider_binding() from public,anon,authenticated,service_role;
revoke all on function public.save_admin_live_draft_v3(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,public.social_platform,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_admin_live_draft_v3(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,public.social_platform,text,text,text,text,text,text,text,text) to service_role;

create or replace function public.save_admin_live_draft_v2(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_slug text,
  p_celebrity_id uuid, p_brand_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_reservation_opens_at timestamptz, p_reservation_closes_at timestamptz,
  p_youtube_url text, p_hero_url text,
  p_title_ko text, p_summary_ko text, p_hero_alt_ko text,
  p_title_en text, p_summary_en text, p_hero_alt_en text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; generated_code text;
begin
  if p_live_event_id is not null then
    perform 1 from public.live_events
    where id=p_live_event_id and publication_status='draft'
      and ever_published_at is null and archived_at is null
    for update;
    if not found then raise exception 'editable live draft not found'; end if;
  else
    generated_code := public.generate_attendance_code_value();
  end if;
  target_id := public.save_admin_live_draft(
    p_actor_app_user_id,p_actor_admin_allowlist_id,p_correlation_id,p_live_event_id,p_slug,
    p_celebrity_id,p_brand_id,p_starts_at,p_ends_at,p_reservation_opens_at,
    p_reservation_closes_at,p_youtube_url,p_hero_url,generated_code,
    p_title_ko,p_summary_ko,p_hero_alt_ko,p_title_en,p_summary_en,p_hero_alt_en
  );
  return jsonb_strip_nulls(jsonb_build_object('id',target_id,'fanCode',generated_code));
end $$;

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
