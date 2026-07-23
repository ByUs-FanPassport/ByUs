-- Add operator-managed aggregate fan counts to public celebrity discovery.
-- Draft celebrities may omit the value, but publication requires one.

alter table public.celebrities
  add column fan_count bigint
  check (fan_count is null or fan_count >= 0);

update public.celebrities
set fan_count = case slug
  when 'kara' then 12800000
  when 'elina' then 3200000
  when 'changha' then 1450000
  else fan_count
end
where slug in ('kara', 'elina', 'changha');

do $$
begin
  if exists (
    select 1
    from public.celebrities
    where status = 'published' and fan_count is null
  ) then
    raise exception 'published celebrity fan_count backfill required';
  end if;
end $$;

create or replace view public.published_celebrities
with (security_barrier = true, security_invoker = true)
as
select
  c.slug,
  l.locale,
  l.name,
  l.summary,
  c.image_url,
  l.image_alt,
  c.image_position,
  coalesce(theme_data.items, '[]'::jsonb) as themes,
  coalesce(social_data.items, '[]'::jsonb) as social_links,
  c.display_order,
  c.fan_count
from public.celebrities c
join public.celebrity_localizations l on l.celebrity_id = c.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object('slug', t.slug, 'name', tl.name)
    order by ct.position, t.slug
  ) as items
  from public.celebrity_themes ct
  join public.themes t on t.id = ct.theme_id and t.status = 'published'
  join public.theme_localizations tl
    on tl.theme_id = t.id and tl.locale = l.locale
  where ct.celebrity_id = c.id
) theme_data on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('platform', sl.platform, 'url', sl.url)
    order by sl.position, sl.platform
  ) as items
  from public.celebrity_social_links sl
  where sl.celebrity_id = c.id and sl.active
) social_data on true
where c.status = 'published'
  and c.fan_count is not null;

comment on view public.published_celebrities is
  'Published-only celebrity DTO with operator-managed aggregate fan count. Contains no private CMS identifiers or audit metadata.';

revoke all on public.published_celebrities from public;
revoke all on public.published_celebrities from anon, authenticated;
grant select on public.published_celebrities to service_role;

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
      'publishedAt', c.published_at,
      'archivedAt', c.archived_at,
      'archiveReason', c.archive_reason,
      'updatedAt', c.updated_at,
      'localizations', (
        select jsonb_object_agg(
          l.locale,
          jsonb_build_object(
            'name', l.name,
            'summary', l.summary,
            'imageAlt', l.image_alt
          )
        )
        from public.celebrity_localizations l
        where l.celebrity_id = c.id
      ),
      'themes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'slug', t.slug,
          'nameKo', ko.name,
          'nameEn', en.name,
          'position', ct.position
        ) order by ct.position)
        from public.celebrity_themes ct
        join public.themes t on t.id = ct.theme_id
        left join public.theme_localizations ko
          on ko.theme_id = t.id and ko.locale = 'ko'
        left join public.theme_localizations en
          on en.theme_id = t.id and en.locale = 'en'
        where ct.celebrity_id = c.id
      ), '[]'::jsonb),
      'socialLinks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'platform', s.platform,
          'url', s.url,
          'position', s.position,
          'active', s.active
        ) order by s.position)
        from public.celebrity_social_links s
        where s.celebrity_id = c.id
      ), '[]'::jsonb)
    ) order by c.display_order, c.created_at desc)
    from public.celebrities c
    where p_celebrity is null or c.id = p_celebrity
  ), '[]'::jsonb);
end $$;

create or replace function public.save_admin_celebrity(
  p_actor uuid,
  p_correlation uuid,
  p_celebrity uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(p_celebrity, extensions.gen_random_uuid());
  before_row jsonb;
  result jsonb;
  theme_item jsonb;
  social_item jsonb;
  v_theme_id uuid;
  requested_fan_count bigint;
begin
  perform public.require_content_editor(p_actor, true);
  if p_correlation is null then
    raise exception 'correlation id is required';
  end if;
  if p_celebrity is not null then
    perform 1
    from public.celebrities c
    where id = p_celebrity and archived_at is null
    for update;
    if not found then raise exception 'content not found'; end if;
    before_row := public.read_admin_celebrity_cms(p_actor, p_celebrity)->0;
  end if;
  if coalesce(p_payload->>'slug', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid celebrity slug';
  end if;

  requested_fan_count := case
    when p_payload->'fanCount' is null
      or jsonb_typeof(p_payload->'fanCount') = 'null'
      then null
    else (p_payload->>'fanCount')::bigint
  end;
  if requested_fan_count is not null and requested_fan_count < 0 then
    raise exception 'invalid celebrity fan count';
  end if;

  if p_celebrity is null then
    insert into public.celebrities(
      id, slug, image_url, image_position, display_order, fan_count
    ) values (
      target,
      p_payload->>'slug',
      p_payload->>'imageUrl',
      coalesce(nullif(p_payload->>'imagePosition', ''), 'center'),
      coalesce((p_payload->>'displayOrder')::int, 0),
      requested_fan_count
    );
  else
    update public.celebrities
    set slug = p_payload->>'slug',
        image_url = p_payload->>'imageUrl',
        image_position = coalesce(
          nullif(p_payload->>'imagePosition', ''),
          'center'
        ),
        display_order = coalesce((p_payload->>'displayOrder')::int, 0),
        fan_count = requested_fan_count
    where id = target;
  end if;

  insert into public.celebrity_localizations(
    celebrity_id, locale, name, summary, image_alt
  )
  select
    target,
    x.locale::public.content_locale,
    x.value->>'name',
    x.value->>'summary',
    x.value->>'imageAlt'
  from jsonb_each(p_payload->'localizations') x(locale, value)
  on conflict (celebrity_id, locale) do update
  set name = excluded.name,
      summary = excluded.summary,
      image_alt = excluded.image_alt;

  delete from public.celebrity_social_links where celebrity_id = target;
  for social_item in
    select value
    from jsonb_array_elements(coalesce(p_payload->'socialLinks', '[]'))
  loop
    insert into public.celebrity_social_links(
      celebrity_id, platform, url, position, active
    ) values (
      target,
      (social_item->>'platform')::public.social_platform,
      social_item->>'url',
      (social_item->>'position')::smallint,
      coalesce((social_item->>'active')::boolean, true)
    );
  end loop;

  delete from public.celebrity_themes where celebrity_id = target;
  for theme_item in
    select value
    from jsonb_array_elements(coalesce(p_payload->'themes', '[]'))
  loop
    v_theme_id := null;
    select theme.id into v_theme_id
    from public.themes
    where theme.slug = theme_item->>'slug'
    for update;
    if v_theme_id is null then
      insert into public.themes(slug)
      values (theme_item->>'slug')
      returning id into v_theme_id;
      insert into public.theme_localizations(theme_id, locale, name)
      values
        (v_theme_id, 'ko', theme_item->>'nameKo'),
        (v_theme_id, 'en', theme_item->>'nameEn');
      update public.themes set status = 'published' where id = v_theme_id;
    else
      insert into public.theme_localizations(theme_id, locale, name)
      values
        (v_theme_id, 'ko', theme_item->>'nameKo'),
        (v_theme_id, 'en', theme_item->>'nameEn')
      on conflict (theme_id, locale) do update set name = excluded.name;
      if exists (
        select 1
        from public.themes
        where id = v_theme_id and status = 'draft'
      ) then
        update public.themes set status = 'published' where id = v_theme_id;
      end if;
    end if;
    insert into public.celebrity_themes(celebrity_id, theme_id, position)
    values (target, v_theme_id, (theme_item->>'position')::smallint);
  end loop;

  select public.read_admin_celebrity_cms(p_actor, target)->0 into result;
  insert into public.audit_logs(
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary,
    correlation_id
  ) values (
    p_actor,
    case
      when p_celebrity is null then 'celebrity.created'
      else 'celebrity.updated'
    end,
    'celebrity',
    target::text,
    jsonb_build_object('before', before_row, 'after', result),
    p_correlation
  );
  return result;
end $$;

create or replace function public.set_admin_celebrity_publication(
  p_actor uuid,
  p_correlation uuid,
  p_celebrity uuid,
  p_publish boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb;
  result jsonb;
begin
  perform public.require_content_editor(p_actor, true);
  perform 1
  from public.celebrities c
  where id = p_celebrity and archived_at is null
  for update;
  before_row := public.read_admin_celebrity_cms(p_actor, p_celebrity)->0;
  if before_row is null then raise exception 'content not found'; end if;
  if p_publish then
    if (select fan_count from public.celebrities where id = p_celebrity) is null then
      raise exception 'celebrity publication requires fan count';
    end if;
    if (
      select count(*)
      from public.celebrity_quizzes q
      where q.celebrity_id = p_celebrity and q.status = 'published'
    ) <> 1 then
      raise exception 'celebrity publication requires exactly one published quiz';
    end if;
    if exists (
      select 1
      from public.celebrity_quizzes q
      where q.celebrity_id = p_celebrity
        and q.status = 'published'
        and (
          (
            select count(*)
            from public.celebrity_quiz_questions x
            where x.quiz_id = q.id and x.active
          ) < 3
          or exists (
            select 1
            from public.celebrity_quiz_questions x
            where x.quiz_id = q.id
              and x.active
              and (
                (
                  select count(*)
                  from public.celebrity_quiz_options o
                  where o.question_id = x.id and o.active
                ) <> 4
                or (
                  select count(*)
                  from public.celebrity_quiz_options o
                  where o.question_id = x.id
                    and o.active
                    and o.is_correct
                ) <> 1
              )
          )
        )
    ) then
      raise exception 'celebrity publication requires a complete published quiz';
    end if;
  end if;
  update public.celebrities
  set status = case
    when p_publish then 'published'::public.content_status
    else 'draft'::public.content_status
  end
  where id = p_celebrity;
  select public.read_admin_celebrity_cms(p_actor, p_celebrity)->0 into result;
  insert into public.audit_logs(
    actor_admin_allowlist_id,
    action,
    entity_type,
    entity_id,
    before_after_summary,
    correlation_id
  ) values (
    p_actor,
    case when p_publish then 'celebrity.published' else 'celebrity.unpublished' end,
    'celebrity',
    p_celebrity::text,
    jsonb_build_object('before', before_row, 'after', result),
    p_correlation
  );
  return result;
end $$;
