-- Replace the recent-fan list with the Top 100 Fan Score leaderboard once
-- 100 active fans have either completed a like or received a Passport.
create or replace function public.read_celebrity_fanpage(
  p_slug text,p_locale public.content_locale
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select c.id
    from public.celebrities c
    join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale=p_locale
    where c.slug=p_slug and c.status='published' and c.archived_at is null
  ), members as materialized (
    select p.app_user_id,p.issued_at from public.fan_passports p
    join creator c on c.id=p.celebrity_id join public.app_users u on u.id=p.app_user_id
    where p.business_status='issued' and u.status='active'
  ), eligible_events as materialized (
    select m.app_user_id,m.issued_at occurred_at from members m
    union all
    select r.app_user_id,r.completed_at
    from public.fan_reactions r
    join creator c on c.id=r.celebrity_id
    join public.app_users u on u.id=r.app_user_id and u.status='active'
    where r.business_status='completed'
  ), fans as materialized (
    select app_user_id,max(occurred_at) occurred_at from eligible_events group by app_user_id
  ), events as (
    select m.app_user_id,'joined'::text kind,null::text tier,m.issued_at occurred_at from members m
    union all select e.app_user_id,'level_up',e.current_level,e.occurred_at
    from public.fan_level_events e join creator c on c.id=e.celebrity_id join members m on m.app_user_id=e.app_user_id
    union all select s.app_user_id,'first_certification',null,min(s.reviewed_at)
    from public.certification_submissions s join creator c on c.id=s.celebrity_id join members m on m.app_user_id=s.app_user_id
    where s.status='approved' group by s.app_user_id
  ), recent as (
    select e.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from events e
    left join public.user_profiles p on p.app_user_id=e.app_user_id
    left join public.app_user_avatars a on a.app_user_id=e.app_user_id
    order by e.occurred_at desc,e.app_user_id,e.kind limit 6
  )
  select jsonb_build_object(
    'membershipCount',(select count(*) from members),
    'fanCount',(select count(*) from fans),
    'leaderboardAvailable',(select count(*)>=100 from fans),
    'activity',coalesce((select jsonb_agg(jsonb_build_object(
      'kind',kind,'tier',tier,'nickname',nickname,'avatarUrl',avatar_url,'occurredAt',occurred_at
    ) order by occurred_at desc,app_user_id,kind) from recent),'[]'::jsonb)
  ) from creator;
$$;

create or replace function public.read_celebrity_fanpage(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.read_celebrity_fanpage(p_slug,'ko'::public.content_locale);
$$;

create or replace function public.read_celebrity_fan_leaderboard(
  p_slug text,p_app_user_id uuid,p_locale public.content_locale
) returns jsonb language sql stable security definer set search_path='' as $$
  with creator as (
    select id from public.celebrities
    where slug=p_slug and status='published' and archived_at is null
  ), passports as materialized (
    select p.app_user_id,p.issued_at
    from public.fan_passports p
    join creator c on c.id=p.celebrity_id
    join public.app_users u on u.id=p.app_user_id and u.status='active'
    where p.business_status='issued'
  ), eligible_events as materialized (
    select p.app_user_id,p.issued_at occurred_at,p.issued_at passport_issued_at from passports p
    union all
    select r.app_user_id,r.completed_at,null::timestamptz
    from public.fan_reactions r
    join creator c on c.id=r.celebrity_id
    join public.app_users u on u.id=r.app_user_id and u.status='active'
    where r.business_status='completed'
  ), fan_identities as materialized (
    select e.app_user_id,max(e.passport_issued_at) passport_issued_at,min(e.occurred_at) joined_at
    from eligible_events e
    group by e.app_user_id
  ), fans as materialized (
    select e.*,coalesce(sum(s.points),0)::integer points
    from fan_identities e
    left join creator c on true
    left join public.fan_score_ledger s on s.app_user_id=e.app_user_id and s.celebrity_id=c.id
    group by e.app_user_id,e.passport_issued_at,e.joined_at
  ), counts as (
    select (select count(*) from passports) membership_count,count(*) fan_count from fans
  ), ranked as (
    select f.*,row_number() over(order by points desc,coalesce(passport_issued_at,joined_at),app_user_id) rank
    from fans f where (select fan_count>=100 from counts)
  ), display as (
    select r.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from ranked r
    left join public.user_profiles p on p.app_user_id=r.app_user_id
    left join public.app_user_avatars a on a.app_user_id=r.app_user_id
  )
  select jsonb_build_object(
    'membershipCount',(select membership_count from counts),
    'fanCount',(select fan_count from counts),
    'available',(select fan_count>=100 from counts),
    'asOf',statement_timestamp(),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'rank',rank,'nickname',nickname,'avatarUrl',avatar_url,'points',points
    ) order by rank) from display where rank<=100),'[]'::jsonb),
    'me',(select jsonb_build_object(
      'rank',rank,'nickname',nickname,'avatarUrl',avatar_url,'points',points
    ) from display where app_user_id=p_app_user_id)
  ) from creator;
$$;

create or replace function public.read_celebrity_fan_leaderboard(
  p_slug text,p_app_user_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select public.read_celebrity_fan_leaderboard(p_slug,p_app_user_id,'ko'::public.content_locale);
$$;

revoke all on function public.read_celebrity_fanpage(text,public.content_locale),
  public.read_celebrity_fanpage(text),
  public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),
  public.read_celebrity_fan_leaderboard(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_celebrity_fanpage(text,public.content_locale),
  public.read_celebrity_fanpage(text),
  public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),
  public.read_celebrity_fan_leaderboard(text,uuid)
  to service_role;
