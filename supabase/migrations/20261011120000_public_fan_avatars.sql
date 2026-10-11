begin;

alter table public.app_user_avatars
  add column if not exists public_image_id uuid not null default extensions.gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.app_user_avatars'::regclass
      and conname = 'app_user_avatars_public_image_id_key'
  ) then
    alter table public.app_user_avatars
      add constraint app_user_avatars_public_image_id_key unique (public_image_id);
  end if;
end $$;

create or replace function public.public_fan_avatar_url(p_app_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when u.status <> 'active' then '/images/avatars/star-pink.webp'
      when a.source in ('google','upload') and a.object_path is not null then
        '/api/fan-avatars/' || a.public_image_id || '?revision=' || a.revision
      else '/images/avatars/' || coalesce(a.selected_character_id,'star-pink') || '.webp'
    end
    from public.app_users u
    left join public.app_user_avatars a on a.app_user_id = u.id
    where u.id = p_app_user_id
  ), '/images/avatars/star-pink.webp');
$$;

create or replace function public.read_public_avatar_image(
  p_public_image_id uuid,
  p_revision integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('objectPath', a.object_path)
  from public.app_user_avatars a
  join public.app_users u on u.id = a.app_user_id and u.status = 'active'
  where a.public_image_id = p_public_image_id
    and a.revision = p_revision
    and a.source in ('google','upload')
    and a.object_path is not null;
$$;

revoke all on function public.public_fan_avatar_url(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_public_avatar_image(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.public_fan_avatar_url(uuid) to service_role;
grant execute on function public.read_public_avatar_image(uuid,integer) to service_role;

do $$
declare
  v_patch record;
  v_definition text;
  v_old_count integer;
  v_new_count integer;
  v_remaining text;
begin
  for v_patch in
    select * from (values
      ('public.read_celebrity_fan_community(text,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(e.app_user_id)$new$),
      ('public.read_celebrity_fanpage(text,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(e.app_user_id)$new$),
      ('public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(r.app_user_id)$new$),
      ('public.fan_web_post_json(uuid,uuid,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(p.app_user_id)$new$),
      ('public.read_fan_post_comments(uuid,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(x.app_user_id)$new$),
      ('public.read_content_blocks(uuid,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||case when u.status='active' then coalesce(a.selected_character_id,'star-pink') else 'star-pink' end||'.webp'$old$,
        $new$public.public_fan_avatar_url(u.id)$new$),
      ('public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(v.app_user_id)$new$),
      ('public.read_celebrity_cheers(text,uuid,timestamptz,uuid,integer,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(v.app_user_id)$new$),
      ('public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(ua.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(p.app_user_id)$new$),
      ('public.read_unified_creator_feed(uuid,text,text,text,integer,timestamptz,text,uuid,integer,public.content_locale)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(m.app_user_id)$new$),
      ('public.fan_web_list_live_submissions(uuid,text,public.content_locale,timestamptz,uuid,integer)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(r.app_user_id)$new$),
      ('public.fan_web_admin_review_live_submission(uuid,uuid,uuid,uuid,integer,text,text)'::regprocedure,
        $old$coalesce((select '/images/avatars/'||selected_character_id||'.webp' from public.app_user_avatars where app_user_id=r.app_user_id),'/images/avatars/star-pink.webp')$old$,
        $new$public.public_fan_avatar_url(r.app_user_id)$new$),
      ('public.fan_web_admin_list_live_submissions(uuid,uuid,uuid,uuid,text,timestamptz,uuid,integer)'::regprocedure,
        $old$'/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp'$old$,
        $new$public.public_fan_avatar_url(r.app_user_id)$new$)
    ) as patches(signature, old_source, new_source)
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_patch.signature);
    v_old_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_patch.old_source,'')))
      / pg_catalog.length(v_patch.old_source);
    v_new_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition,v_patch.new_source,'')))
      / pg_catalog.length(v_patch.new_source);

    if v_old_count = 1 and v_new_count = 0 then
      execute pg_catalog.replace(v_definition,v_patch.old_source,v_patch.new_source);
    elsif v_old_count <> 0 or v_new_count <> 1 then
      raise exception 'PUBLIC_FAN_AVATAR_PROJECTION_SHAPE_CHANGED: %', v_patch.signature;
    end if;
  end loop;

  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_remaining
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname <> 'public_fan_avatar_url'
      and p.prosrc like '%/images/avatars/%'
      and p.prosrc like '%selected_character_id%';
  if v_remaining is not null then
    raise exception 'PUBLIC_FAN_AVATAR_CHARACTER_ONLY_PROJECTION_REMAINS: %', v_remaining;
  end if;
end $$;

commit;
