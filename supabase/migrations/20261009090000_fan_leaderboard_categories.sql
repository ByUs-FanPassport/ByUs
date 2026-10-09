create or replace function public.read_celebrity_fan_leaderboard(
  p_slug text,p_app_user_id uuid,p_locale public.content_locale,p_category text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_category is null or p_category not in ('all','knowledge','live','mission','certification') then
    raise exception 'invalid leaderboard category' using errcode='22023';
  end if;

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
    select e.*,coalesce(sum(s.points) filter (where
      p_category='all'
      or p_category='knowledge' and a.activity_type='knowledge'
      or p_category='live' and a.activity_type in ('reservation','attendance')
      or p_category='mission' and a.activity_type='survey'
      or p_category='certification' and s.manual_submission_id is not null
    ),0)::integer points
    from fan_identities e
    left join creator c on true
    left join public.fan_score_ledger s on s.app_user_id=e.app_user_id and s.celebrity_id=c.id
    left join public.fan_activities a on a.id=s.activity_id
      and a.app_user_id=s.app_user_id and a.celebrity_id=s.celebrity_id
    group by e.app_user_id,e.passport_issued_at,e.joined_at
  ), counts as (
    select (select count(*) from passports) membership_count,count(*) fan_count from fans
  ), category_fans as (
    select * from fans where p_category='all' or points>0
  ), ranked as (
    select f.*,row_number() over(order by points desc,coalesce(passport_issued_at,joined_at),app_user_id) rank
    from category_fans f where (select fan_count>=100 from counts)
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
  ) into result from creator;
  return result;
end;
$$;

create or replace function public.read_celebrity_fan_leaderboard(
  p_slug text,p_app_user_id uuid,p_locale public.content_locale
) returns jsonb language sql stable security definer set search_path='' as $$
  select public.read_celebrity_fan_leaderboard(p_slug,p_app_user_id,p_locale,'all');
$$;

revoke all on function public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text),
  public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),
  public.read_celebrity_fan_leaderboard(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text),
  public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),
  public.read_celebrity_fan_leaderboard(text,uuid)
  to service_role;
