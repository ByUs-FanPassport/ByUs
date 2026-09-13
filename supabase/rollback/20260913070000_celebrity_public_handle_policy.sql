begin;

alter table public.celebrities
  drop constraint if exists celebrities_slug_not_reserved;

create or replace function public.prevent_referenced_celebrity_slug_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug = old.slug then
    return new;
  end if;

  if exists (select 1 from public.quiz_attempts where celebrity_id = old.id)
     or exists (select 1 from public.fan_passports where celebrity_id = old.id)
     or exists (select 1 from public.fan_activities where celebrity_id = old.id)
     or exists (
       select 1 from public.blockchain_jobs
       where payload ->> 'celebritySlug' = old.slug
     ) then
    raise exception 'celebrity slug is immutable after it is referenced';
  end if;
  return new;
end;
$$;

create or replace function public.read_admin_celebrity_cms(
  p_actor uuid,
  p_celebrity uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_content_editor(p_actor, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'status', c.status,
      'imageUrl', c.image_url,
      'imagePosition', c.image_position,
      'displayOrder', c.display_order,
      'fanCount', c.fan_count,
      'roles', to_jsonb(c.roles),
      'primaryRole', c.primary_role,
      'publishedAt', c.published_at,
      'archivedAt', c.archived_at,
      'archiveReason', c.archive_reason,
      'updatedAt', c.updated_at,
      'localizations', (
        select jsonb_object_agg(l.locale, jsonb_build_object(
          'name', l.name, 'summary', l.summary, 'imageAlt', l.image_alt
        )) from public.celebrity_localizations l where l.celebrity_id = c.id
      ),
      'themes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'slug', t.slug, 'nameKo', ko.name,
          'nameEn', en.name, 'position', ct.position
        ) order by ct.position)
        from public.celebrity_themes ct
        join public.themes t on t.id = ct.theme_id
        left join public.theme_localizations ko on ko.theme_id = t.id and ko.locale = 'ko'
        left join public.theme_localizations en on en.theme_id = t.id and en.locale = 'en'
        where ct.celebrity_id = c.id
      ), '[]'::jsonb),
      'socialLinks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'platform', s.platform, 'url', s.url,
          'position', s.position, 'active', s.active
        ) order by s.position)
        from public.celebrity_social_links s where s.celebrity_id = c.id
      ), '[]'::jsonb)
    ) order by c.display_order, c.created_at desc)
    from public.celebrities c
    where p_celebrity is null or c.id = p_celebrity
  ), '[]'::jsonb);
end $$;

commit;
