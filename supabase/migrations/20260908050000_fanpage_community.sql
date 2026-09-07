-- Fan membership is an issued ByUs Passport, not the curated social follower count.
-- Public projections contain display names and bundled character assets only.
create table public.fan_activity_visibility (
  app_user_id uuid primary key references public.app_users(id) on delete restrict,
  enabled boolean not null default false,
  changed_at timestamptz not null default now()
);
alter table public.fan_activity_visibility enable row level security;
alter table public.fan_activity_visibility force row level security;
revoke all on public.fan_activity_visibility from public,anon,authenticated,service_role;
create function public.read_owned_fan_activity_visibility(p_app_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then raise exception 'FANPAGE_FORBIDDEN'; end if;
  return jsonb_build_object('enabled',coalesce((select enabled from public.fan_activity_visibility where app_user_id=p_app_user_id),false));
end $$;
create function public.set_owned_fan_activity_visibility(p_app_user_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_enabled is null then raise exception 'FANPAGE_INVALID_REQUEST'; end if;
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then raise exception 'FANPAGE_FORBIDDEN'; end if;
  insert into public.fan_activity_visibility(app_user_id,enabled) values(p_app_user_id,p_enabled)
  on conflict(app_user_id) do update set enabled=excluded.enabled,changed_at=now();
  return jsonb_build_object('enabled',p_enabled);
end $$;
revoke all on function public.read_owned_fan_activity_visibility(uuid),public.set_owned_fan_activity_visibility(uuid,boolean) from public,anon,authenticated;
grant execute on function public.read_owned_fan_activity_visibility(uuid),public.set_owned_fan_activity_visibility(uuid,boolean) to service_role;
create function public.read_celebrity_fanpage(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with creator as (
    select id from public.celebrities where slug=p_slug and status='published' and archived_at is null
  ), members as (
    select p.app_user_id,p.issued_at from public.fan_passports p
    join creator c on c.id=p.celebrity_id join public.app_users u on u.id=p.app_user_id
    where p.business_status='issued' and u.status='active'
  ), events as (
    select m.app_user_id,'joined'::text kind,null::text tier,m.issued_at occurred_at from members m
    union all
    select e.app_user_id,'level_up',e.current_level,e.occurred_at
    from public.fan_level_events e join creator c on c.id=e.celebrity_id
    join members m on m.app_user_id=e.app_user_id
    union all
    select s.app_user_id,'first_certification',null,min(s.reviewed_at)
    from public.certification_submissions s join creator c on c.id=s.celebrity_id
    join members m on m.app_user_id=s.app_user_id where s.status='approved' group by s.app_user_id
  ), recent as (
    select e.*,coalesce(p.nickname,'팬') nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from events e join public.fan_activity_visibility visibility on visibility.app_user_id=e.app_user_id and visibility.enabled
    left join public.user_profiles p on p.app_user_id=e.app_user_id
    left join public.app_user_avatars a on a.app_user_id=e.app_user_id
    order by e.occurred_at desc,e.app_user_id,e.kind limit 6
  )
  select jsonb_build_object('membershipCount',(select count(*) from members),
    'leaderboardAvailable',(select count(*)>500 from members),
    'activity',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'tier',tier,
      'nickname',nickname,'avatarUrl',avatar_url,'occurredAt',occurred_at)
      order by occurred_at desc,app_user_id,kind) from recent),'[]'::jsonb))
  from creator;
$$;

create function public.read_celebrity_fan_leaderboard(p_slug text,p_app_user_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with creator as (
    select id from public.celebrities where slug=p_slug and status='published' and archived_at is null
  ), members as materialized (
    select p.app_user_id,p.issued_at,coalesce(sum(s.points),0)::integer points
    from public.fan_passports p join creator c on c.id=p.celebrity_id
    join public.app_users u on u.id=p.app_user_id and u.status='active'
    left join public.fan_score_ledger s on s.app_user_id=p.app_user_id and s.celebrity_id=p.celebrity_id
    where p.business_status='issued' group by p.app_user_id,p.issued_at
  ), counts as (select count(*) total from members), ranked as (
    select m.*,row_number() over(order by points desc,issued_at,app_user_id) rank from members m
    where (select total>500 from counts)
  ), display as (
    select r.*,coalesce(p.nickname,'팬') nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from ranked r left join public.user_profiles p on p.app_user_id=r.app_user_id
    left join public.app_user_avatars a on a.app_user_id=r.app_user_id
  )
  select jsonb_build_object('membershipCount',(select total from counts),
    'available',(select total>500 from counts),'asOf',statement_timestamp(),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('rank',rank,'nickname',nickname,
      'avatarUrl',avatar_url,'points',points) order by rank) from display where rank<=100),'[]'::jsonb),
    'me',(select jsonb_build_object('rank',rank,'nickname',nickname,'avatarUrl',avatar_url,'points',points)
      from display where app_user_id=p_app_user_id)) from creator;
$$;

create table public.celebrity_notice_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  notice_id uuid not null references public.celebrity_notices(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 1000),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_admin_id uuid references public.admin_allowlist(id) on delete restrict,
  removal_reason text,
  unique(app_user_id,idempotency_key)
);
create index celebrity_notice_comments_visible_idx on public.celebrity_notice_comments(notice_id,created_at desc,id desc) where removed_at is null;
create index celebrity_notice_comments_rate_idx on public.celebrity_notice_comments(app_user_id,created_at desc);
alter table public.celebrity_notice_comments enable row level security;
alter table public.celebrity_notice_comments force row level security;
revoke all on public.celebrity_notice_comments from public,anon,authenticated,service_role;

create function public.read_celebrity_notice_comments(
  p_slug text,p_notice_slug text,p_app_user_id uuid default null,p_before timestamptz default null,
  p_before_id uuid default null,p_limit integer default 20
) returns jsonb language sql stable security definer set search_path='' as $$
  with notice as (
    select n.id from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    where c.slug=p_slug and c.status='published' and c.archived_at is null
      and n.slug=p_notice_slug and n.publication_status='published' and n.archived_at is null
  ), visible as (
    select x.* from public.celebrity_notice_comments x join notice n on n.id=x.notice_id
    join public.app_users u on u.id=x.app_user_id and u.status='active' where x.removed_at is null
  ), page as (
    select v.*,coalesce(p.nickname,'팬') nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from visible v left join public.user_profiles p on p.app_user_id=v.app_user_id
    left join public.app_user_avatars a on a.app_user_id=v.app_user_id
    where p_before is null or (v.created_at,v.id)<(p_before,p_before_id)
    order by v.created_at desc,v.id desc limit least(greatest(p_limit,1),50)
  )
  select jsonb_build_object('total',(select count(*) from visible),
    'comments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'body',body,'nickname',nickname,
      'avatarUrl',avatar_url,'createdAt',created_at,'isOwner',coalesce(app_user_id=p_app_user_id,false))
      order by created_at desc,id desc) from page),'[]'::jsonb)) from notice;
$$;

create function public.post_celebrity_notice_comment(p_app_user_id uuid,p_slug text,p_notice_slug text,p_body text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_notice uuid;v_existing public.celebrity_notice_comments%rowtype;v_id uuid;v_body text:=btrim(p_body);
begin
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501'; end if;
  if p_idempotency_key is null or v_body is null or length(v_body) not between 1 and 1000 then
    raise exception 'FANPAGE_INVALID_REQUEST' using errcode='22023'; end if;
  select n.id into v_notice from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    where c.slug=p_slug and c.status='published' and c.archived_at is null and n.slug=p_notice_slug
      and n.publication_status='published' and n.archived_at is null for share of n,c;
  if v_notice is null then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fanpage:comment:'||p_app_user_id::text,0));
  select * into v_existing from public.celebrity_notice_comments where app_user_id=p_app_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.notice_id<>v_notice or v_existing.body<>v_body then
      raise exception 'FANPAGE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('id',v_existing.id,'replayed',true);
  end if;
  if (select count(*) from public.celebrity_notice_comments where app_user_id=p_app_user_id and created_at>now()-interval '1 minute')>=5 then
    raise exception 'FANPAGE_RATE_LIMITED' using errcode='P0001'; end if;
  insert into public.celebrity_notice_comments(notice_id,app_user_id,body,idempotency_key)
    values(v_notice,p_app_user_id,v_body,p_idempotency_key) returning id into v_id;
  return jsonb_build_object('id',v_id,'replayed',false);
end $$;

create function public.remove_owned_notice_comment(p_app_user_id uuid,p_comment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'FANPAGE_FORBIDDEN' using errcode='42501'; end if;
  update public.celebrity_notice_comments set removed_at=coalesce(removed_at,now())
    where id=p_comment_id and app_user_id=p_app_user_id;
  if not found then raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002'; end if;
end $$;

create function public.hide_admin_notice_comment(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_correlation_id uuid,p_comment_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,true);
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'FANPAGE_INVALID_REQUEST'; end if;
  update public.celebrity_notice_comments set removed_at=now(),removed_by_admin_id=p_actor_admin_allowlist_id,removal_reason=btrim(p_reason)
    where id=p_comment_id and removed_at is null;
  if found then
    insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
    values(p_actor_app_user_id,p_actor_admin_allowlist_id,'notice.comment.hide','notice_comment',p_comment_id::text,p_correlation_id,jsonb_build_object('reason',btrim(p_reason)));
  elsif not exists(select 1 from public.celebrity_notice_comments where id=p_comment_id) then
    raise exception 'FANPAGE_NOT_FOUND' using errcode='P0002';
  end if;
end $$;

revoke all on function public.read_celebrity_fanpage(text),public.read_celebrity_fan_leaderboard(text,uuid),
  public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer),
  public.post_celebrity_notice_comment(uuid,text,text,text,uuid),public.remove_owned_notice_comment(uuid,uuid),
  public.hide_admin_notice_comment(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_celebrity_fanpage(text),public.read_celebrity_fan_leaderboard(text,uuid),
  public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer),
  public.post_celebrity_notice_comment(uuid,text,text,text,uuid),public.remove_owned_notice_comment(uuid,uuid),
  public.hide_admin_notice_comment(uuid,uuid,uuid,uuid,text) to service_role;

create function public.read_admin_notice_comments(p_actor_app_user_id uuid,p_actor_admin_allowlist_id uuid,p_slug text default null,p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform public.assert_active_admin(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  select jsonb_build_object('comments',coalesce(jsonb_agg(row.body order by row.created_at desc,row.id desc),'[]'::jsonb)) into v_result from (
    select cm.created_at,cm.id,jsonb_build_object('id',cm.id,'body',cm.body,'nickname',coalesce(p.nickname,'팬'),
      'celebritySlug',c.slug,'noticeSlug',n.slug,'createdAt',cm.created_at) body
    from public.celebrity_notice_comments cm join public.celebrity_notices n on n.id=cm.notice_id
    join public.celebrities c on c.id=n.celebrity_id left join public.user_profiles p on p.app_user_id=cm.app_user_id
    where cm.removed_at is null and (p_slug is null or c.slug=p_slug) and (p_before is null or cm.created_at<p_before)
    order by cm.created_at desc,cm.id desc limit 50
  ) row;
  return v_result;
end $$;
revoke all on function public.read_admin_notice_comments(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.read_admin_notice_comments(uuid,uuid,text,timestamptz) to service_role;
