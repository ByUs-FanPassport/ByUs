-- One visibility-filtered database stream for official and fan-authored feed items.
create function public.read_unified_creator_feed(
  p_app_user_id uuid,
  p_slug text,
  p_source text default 'all',
  p_news text default null,
  p_before_rank integer default null,
  p_before_at timestamptz default null,
  p_before_kind text default null,
  p_before_id uuid default null,
  p_limit integer default 20,
  p_locale public.content_locale default 'ko'
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
      and p_source in ('all','official','fans')
      and (p_news is null or p_news in ('notice','artist_post','chzzk'))
  ), visible as materialized (
    select case when n.pinned and n.notice_kind='standard' then 2 when n.pinned then 1 else 0 end pin_rank,
      n.published_at occurred_at,'notice'::text item_kind,n.id,
      jsonb_build_object(
        'kind','notice','id',n.id,'slug',n.slug,'title',l.title,'body',l.body_json,
        'pinned',n.pinned,'noticeKind',n.notice_kind,'postType',n.post_type,
        'visibility',n.visibility,'revision',n.revision,'publishedAt',n.published_at,
        'commentCount',(select count(*) from public.celebrity_notice_comments x
          where x.notice_id=n.id and public.fan_web_content_target(p_app_user_id,'notice_comment',x.id,p_locale) is not null)
      ) item
    from public.celebrity_notices n
    join creator c on c.id=n.celebrity_id
    join public.celebrity_notice_localizations l on l.notice_id=n.id and l.locale=p_locale
    where p_source in ('all','official')
      and (p_news is null or p_news=n.post_type)
      and public.fan_web_content_target(p_app_user_id,'notice',n.id,p_locale) is not null
    union all
    select 0,p.created_at,'fan_post',p.id,
      public.fan_web_post_json(p_app_user_id,p.id,p_locale)||jsonb_build_object('kind','fan_post')
    from public.fan_posts p join creator c on c.id=p.celebrity_id
    where p_source in ('all','fans')
      and public.fan_web_content_target(p_app_user_id,'fan_post',p.id,p_locale) is not null
    union all
    select 0,m.created_at,'cheer',m.id,
      jsonb_build_object(
        'kind','cheer','id',m.id,'body',m.body,
        'nickname',coalesce(nullif(btrim(pr.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end),
        'avatarUrl','/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp',
        'createdAt',m.created_at,'isOwner',coalesce(m.app_user_id=p_app_user_id,false)
      )
    from public.fan_lounge_messages m
    join creator c on c.id=m.celebrity_id
    left join public.user_profiles pr on pr.app_user_id=m.app_user_id
    left join public.app_user_avatars a on a.app_user_id=m.app_user_id
    where p_source in ('all','fans') and m.reply_to_id is null
      and public.fan_web_content_target(p_app_user_id,'cheer',m.id,p_locale) is not null
  ), candidates as materialized (
    select * from visible
    where p_before_at is null
      or (pin_rank,occurred_at,item_kind,id)<(p_before_rank,p_before_at,p_before_kind,p_before_id)
    order by pin_rank desc,occurred_at desc,item_kind desc,id desc
    limit least(greatest(p_limit,1),51)+1
  ), page as (
    select * from candidates
    order by pin_rank desc,occurred_at desc,item_kind desc,id desc
    limit least(greatest(p_limit,1),51)
  )
  select jsonb_build_object(
    'entries',coalesce((select jsonb_agg(jsonb_build_object('pinRank',pin_rank,'item',item)
      order by pin_rank desc,occurred_at desc,item_kind desc,id desc) from page),'[]'::jsonb),
    'hasMore',(select count(*)>least(greatest(p_limit,1),51) from candidates)
  ) from creator;
$$;

revoke all on function public.read_unified_creator_feed(
  uuid,text,text,text,integer,timestamptz,text,uuid,integer,public.content_locale
) from public,anon,authenticated,service_role;
grant execute on function public.read_unified_creator_feed(
  uuid,text,text,text,integer,timestamptz,text,uuid,integer,public.content_locale
) to service_role;
