-- Public fan thumbnails and top-level cheers derived from the persisted lounge.
create function public.read_celebrity_fan_community(
  p_slug text,p_locale public.content_locale default 'ko'
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
  ), completed as materialized (
    select r.app_user_id,r.completed_at
    from public.fan_reactions r
    join creator c on c.id=r.celebrity_id
    join public.app_users u on u.id=r.app_user_id and u.status='active'
    where r.business_status='completed'
  ), eligible_events as materialized (
    select r.app_user_id,r.completed_at occurred_at from completed r
    union all
    select p.app_user_id,p.issued_at
    from public.fan_passports p
    join creator c on c.id=p.celebrity_id
    join public.app_users u on u.id=p.app_user_id and u.status='active'
    where p.business_status='issued'
  ), eligible as materialized (
    select app_user_id,max(occurred_at) occurred_at
    from eligible_events
    group by app_user_id
  ), public_eligible as materialized (
    select e.*
    from eligible e
    join public.fan_activity_visibility visibility on visibility.app_user_id=e.app_user_id and visibility.enabled
  ), selected as (
    select e.app_user_id,e.occurred_at,
      coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from public_eligible e
    left join public.user_profiles p on p.app_user_id=e.app_user_id
    left join public.app_user_avatars a on a.app_user_id=e.app_user_id
    order by e.occurred_at desc,e.app_user_id
    limit 24
  )
  select jsonb_build_object(
    'likeCount',(select count(distinct app_user_id) from completed),
    'fanCount',(select count(*) from eligible),
    'publicFanCount',(select count(*) from public_eligible),
    'fans',coalesce((select jsonb_agg(jsonb_build_object(
      'nickname',nickname,'avatarUrl',avatar_url
    ) order by occurred_at desc,app_user_id) from selected),'[]'::jsonb)
  ) from creator;
$$;

create function public.read_celebrity_cheers(
  p_slug text,p_app_user_id uuid default null,p_before timestamptz default null,
  p_before_id uuid default null,p_limit integer default 6,
  p_locale public.content_locale default 'ko'
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
  ), visible as materialized (
    select m.*
    from public.fan_lounge_messages m
    join creator c on c.id=m.celebrity_id
    join public.app_users u on u.id=m.app_user_id and u.status='active'
    where m.reply_to_id is null and m.removed_at is null
  ), page as (
    select v.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from visible v
    left join public.user_profiles p on p.app_user_id=v.app_user_id
    left join public.app_user_avatars a on a.app_user_id=v.app_user_id
    where p_before is null or (v.created_at,v.id)<(p_before,p_before_id)
    order by v.created_at desc,v.id desc
    limit least(greatest(p_limit,1),21)
  )
  select jsonb_build_object(
    'total',(select count(*) from visible),
    'comments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'body',body,'nickname',nickname,'avatarUrl',avatar_url,
      'createdAt',created_at,'isOwner',coalesce(app_user_id=p_app_user_id,false)
    ) order by created_at desc,id desc) from page),'[]'::jsonb)
  ) from creator;
$$;

create function public.post_celebrity_cheer(
  p_app_user_id uuid,p_slug text,p_body text,p_idempotency_key uuid,
  p_locale public.content_locale default 'ko'
) returns jsonb language sql volatile security definer set search_path='' as $$
  select public.post_celebrity_lounge_message(
    p_app_user_id,p_slug,p_body,p_idempotency_key,null,p_locale
  );
$$;

revoke all on function public.read_celebrity_fan_community(text,public.content_locale),
  public.read_celebrity_cheers(text,uuid,timestamptz,uuid,integer,public.content_locale),
  public.post_celebrity_cheer(uuid,text,text,uuid,public.content_locale)
  from public,anon,authenticated,service_role;
grant execute on function public.read_celebrity_fan_community(text,public.content_locale),
  public.read_celebrity_cheers(text,uuid,timestamptz,uuid,integer,public.content_locale),
  public.post_celebrity_cheer(uuid,text,text,uuid,public.content_locale)
  to service_role;
