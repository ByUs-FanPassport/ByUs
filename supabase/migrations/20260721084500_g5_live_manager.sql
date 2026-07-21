-- ADM-005 Live Manager. All writes cross audited commands; fan-code plaintext
-- exists only as an RPC argument and is immediately converted to bcrypt.

alter table public.live_status_overrides
  add column correlation_id uuid not null default extensions.gen_random_uuid();

create function public.reject_archived_live_override()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.live_events l
  where l.id=new.live_event_id and l.archived_at is null for update;
  if not found then raise exception 'active live event not found'; end if;
  return new;
end;
$$;
create trigger live_status_overrides_reject_archived
before insert on public.live_status_overrides for each row
execute function public.reject_archived_live_override();

create or replace function public.audit_live_status_override()
returns trigger language plpgsql set search_path = '' as $$
declare before_status public.live_content_status; live_record public.live_events%rowtype;
begin
  select * into strict live_record from public.live_events where id=new.live_event_id;
  if live_record.content_status = 'cancelled' then before_status := 'cancelled';
  else
    select o.effective_status into before_status from public.live_status_overrides o
    where o.live_event_id=new.live_event_id and o.id<>new.id
      and o.effective_from<=new.effective_from
      and (o.effective_until is null or new.effective_from<o.effective_until)
    order by o.effective_from desc,o.created_at desc,o.id desc limit 1;
    if before_status is null then
      before_status := case when new.effective_from<live_record.starts_at then 'scheduled'::public.live_content_status
        when new.effective_from<live_record.ends_at then 'live'::public.live_content_status
        else 'ended'::public.live_content_status end;
    end if;
  end if;
  insert into public.audit_logs (
    actor_admin_allowlist_id, action, entity_type, entity_id,
    before_after_summary, correlation_id
  ) values (
    new.actor_admin_allowlist_id, 'live.status_override.created', 'live_event',
    new.live_event_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('effective_status', before_status),
      'after', jsonb_build_object(
        'override_id', new.id, 'effective_status', new.effective_status,
        'effective_from', new.effective_from, 'effective_until', new.effective_until,
        'reason', new.reason
      )
    ), new.correlation_id
  );
  return new;
end;
$$;

create function public.require_live_manager_actor(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_mutation boolean default false
) returns public.admin_allowlist
language plpgsql security definer set search_path = '' as $$
declare actor public.admin_allowlist%rowtype;
begin
  if not exists (
    select 1 from public.app_users u
    where u.id = p_actor_app_user_id and u.status = 'active'
  ) then raise exception 'active administrator is required'; end if;
  select * into actor from public.admin_allowlist a
  where a.id = p_actor_admin_allowlist_id and a.active
    and (not p_mutation or a.role in ('admin', 'operator'))
  for share;
  if not found then raise exception 'authorized live manager is required'; end if;
  return actor;
end;
$$;

create function public.get_admin_live_manager(
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

create function public.save_admin_live_draft(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_slug text,
  p_celebrity_id uuid, p_brand_id uuid,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_reservation_opens_at timestamptz, p_reservation_closes_at timestamptz,
  p_youtube_url text, p_hero_url text, p_fan_code_plaintext text,
  p_title_ko text, p_summary_ko text, p_hero_alt_ko text,
  p_title_en text, p_summary_en text, p_hero_alt_en text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid; before_safe jsonb; after_safe jsonb; code_hash text;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id, p_actor_admin_allowlist_id, true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  if p_fan_code_plaintext is not null then
    if length(p_fan_code_plaintext) not between 4 and 72 then
      raise exception 'fan code must be between 4 and 72 characters';
    end if;
    code_hash := extensions.crypt(p_fan_code_plaintext, extensions.gen_salt('bf', 12));
  end if;
  if p_live_event_id is null then
    if code_hash is null then raise exception 'fan code is required for a new live'; end if;
    insert into public.live_events (
      slug, celebrity_id, brand_id, starts_at, ends_at,
      reservation_opens_at, reservation_closes_at, youtube_url,
      approved_hero_url, fan_code_hash
    ) values (
      trim(p_slug), p_celebrity_id, p_brand_id, p_starts_at, p_ends_at,
      p_reservation_opens_at, p_reservation_closes_at, trim(p_youtube_url),
      trim(p_hero_url), code_hash
    ) returning id into target_id;
  else
    select jsonb_build_object('slug', l.slug, 'celebrityId', l.celebrity_id,
      'brandId', l.brand_id, 'startsAt', l.starts_at, 'endsAt', l.ends_at)
      into before_safe from public.live_events l
      where l.id=p_live_event_id and l.publication_status='draft' and l.archived_at is null
      for update;
    if before_safe is null then raise exception 'editable live draft not found'; end if;
    update public.live_events set slug=trim(p_slug), celebrity_id=p_celebrity_id,
      brand_id=p_brand_id, starts_at=p_starts_at, ends_at=p_ends_at,
      reservation_opens_at=p_reservation_opens_at,
      reservation_closes_at=p_reservation_closes_at,
      youtube_url=trim(p_youtube_url), approved_hero_url=trim(p_hero_url),
      fan_code_hash=coalesce(code_hash, fan_code_hash)
      where id=p_live_event_id returning id into target_id;
  end if;
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
  values (target_id,'ko',trim(p_title_ko),trim(p_summary_ko),trim(p_hero_alt_ko)),
         (target_id,'en',trim(p_title_en),trim(p_summary_en),trim(p_hero_alt_en))
  on conflict (live_event_id,locale) do update set title=excluded.title,
    summary=excluded.summary, hero_alt=excluded.hero_alt;
  select jsonb_build_object('slug',l.slug,'celebrityId',l.celebrity_id,
    'brandId',l.brand_id,'startsAt',l.starts_at,'endsAt',l.ends_at)
    into after_safe from public.live_events l where l.id=target_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,
    entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,
    case when p_live_event_id is null then 'live.draft.created' else 'live.draft.updated' end,
    'live_event',target_id::text,jsonb_build_object('before',before_safe,'after',after_safe),p_correlation_id);
  return target_id;
end;
$$;

create function public.set_admin_live_publication(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_published boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare before_status public.content_status; after_status public.content_status;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  select publication_status into before_status from public.live_events
    where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'live event not found'; end if;
  after_status := case when p_published then 'published'::public.content_status else 'draft'::public.content_status end;
  update public.live_events set publication_status=after_status where id=p_live_event_id;
  insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,
    entity_type,entity_id,before_after_summary,correlation_id)
  values(p_actor_app_user_id,p_actor_admin_allowlist_id,
    case when p_published then 'live.published' else 'live.unpublished' end,
    'live_event',p_live_event_id::text,jsonb_build_object('beforeStatus',before_status,'afterStatus',after_status),p_correlation_id);
end;
$$;

create function public.create_admin_live_status_override(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid, p_correlation_id uuid,
  p_live_event_id uuid, p_effective_status public.live_content_status,
  p_effective_from timestamptz, p_effective_until timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  perform 1 from public.live_events where id=p_live_event_id and archived_at is null for update;
  if not found then raise exception 'active live event not found'; end if;
  insert into public.live_status_overrides(live_event_id,effective_status,effective_from,
    effective_until,reason,actor_admin_allowlist_id,correlation_id)
  values(p_live_event_id,p_effective_status,p_effective_from,p_effective_until,
    trim(p_reason),p_actor_admin_allowlist_id,p_correlation_id) returning id into target_id;
  return target_id;
end;
$$;

create function public.archive_admin_live(
  p_actor_app_user_id uuid, p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid, p_live_event_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_live_manager_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  -- Keep the generic command's complete row inside PostgreSQL so fan_code_hash
  -- never crosses into the web process as an RPC result.
  perform public.archive_admin_content('live_event',p_live_event_id,
    p_actor_admin_allowlist_id,p_reason,p_correlation_id);
end;
$$;

revoke all on function public.require_live_manager_actor(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.reject_archived_live_override() from public,anon,authenticated;
revoke all on function public.get_admin_live_manager(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_admin_live_draft(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.set_admin_live_publication(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.create_admin_live_status_override(uuid,uuid,uuid,uuid,public.live_content_status,timestamptz,timestamptz,text) from public,anon,authenticated;
revoke all on function public.archive_admin_live(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_admin_live_manager(uuid,uuid,uuid) to service_role;
grant execute on function public.save_admin_live_draft(uuid,uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.set_admin_live_publication(uuid,uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.create_admin_live_status_override(uuid,uuid,uuid,uuid,public.live_content_status,timestamptz,timestamptz,text) to service_role;
grant execute on function public.archive_admin_live(uuid,uuid,uuid,uuid,text) to service_role;
