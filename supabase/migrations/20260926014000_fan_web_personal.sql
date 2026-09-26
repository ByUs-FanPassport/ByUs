-- Owner history and an intentionally small public activity card.
alter table public.community_stamp_share_links add column revoked_at timestamptz;
create or replace function public.reject_community_stamp_share_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='community_stamp_share_links' and tg_op='UPDATE'
    and (to_jsonb(new)-'revoked_at')=(to_jsonb(old)-'revoked_at')
    and to_jsonb(old)->>'revoked_at' is null and to_jsonb(new)->>'revoked_at' is not null then return new; end if;
  raise exception 'community stamp share evidence is immutable';
end $$;

create function public.read_shared_passport_activity(p_token text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('creator',c.slug,'issuedAt',p.issued_at,
    'tier',public.get_fan_effective_tier_for_score(p.app_user_id,p.celebrity_id,coalesce(s.score,0),
      (select policy_version from public.reward_policy_activation where singleton)),
    'score',coalesce(s.score,0),'activityCount',(select count(*) from public.fan_activities a
      where a.app_user_id=p.app_user_id and a.celebrity_id=p.celebrity_id),
    'stampCount',(select count(*) from public.stamps st where st.passport_id=p.id)
      +(select count(*) from public.first_reaction_stamps fs where fs.app_user_id=p.app_user_id and fs.celebrity_id=p.celebrity_id)
      +(select count(*) from public.community_stamps cs where cs.app_user_id=p.app_user_id and cs.celebrity_id=p.celebrity_id))
  from public.community_stamp_share_links l
  join public.app_users u on u.id=l.owner_app_user_id and u.status='active'
  join public.fan_passports p on p.id=l.fan_passport_id and p.app_user_id=u.id and p.business_status='issued'
  join public.celebrities c on c.id=l.celebrity_id and c.id=p.celebrity_id and c.status='published' and c.archived_at is null
  left join lateral(select sum(points)::integer score from public.fan_score_ledger sl
    where sl.app_user_id=u.id and sl.celebrity_id=c.id) s on true
  where l.token=p_token and p_token ~ '^[a-f0-9]{32}$' and l.revoked_at is null
$$;

-- Preserve the legacy public-creator redirect without exposing an activity
-- card or awarding evidence for stale/ineligible senders. Revocation is final.
create or replace function public.resolve_community_stamp_share_link(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare creator text;
begin
  if p_token is null or p_token<>pg_catalog.btrim(p_token) or p_token !~ '^[a-f0-9]{32}$' then
    raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023'; end if;
  select c.slug into creator from public.community_stamp_share_links l join public.celebrities c on c.id=l.celebrity_id
    where l.token=p_token and l.revoked_at is null and c.status='published' and c.archived_at is null;
  if creator is null then raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('creator',creator);
end $$;

alter function public.visit_community_stamp_share_link(uuid,text) rename to visit_community_stamp_share_link_before_fan_web;
create function public.visit_community_stamp_share_link(p_app_user_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sender uuid; owner_id uuid;
begin
  if p_app_user_id is null then raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023'; end if;
  perform public.resolve_community_stamp_share_link(p_token);
  select owner_app_user_id into sender from public.community_stamp_share_links where token=p_token;
  -- A visit may reward its sender. Lock both participants in stable order before
  -- the original link/evidence/credential locks, including reciprocal visits.
  for owner_id in select distinct id from unnest(array[p_app_user_id,sender]) id where id is not null order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fan-web-user:'||owner_id::text,0));
  end loop;
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'COMMUNITY_STAMP_NOT_FOUND' using errcode='P0002'; end if;
  perform public.resolve_community_stamp_share_link(p_token);
  return public.visit_community_stamp_share_link_before_fan_web(p_app_user_id,p_token);
end $$;

create function public.get_owned_fan_history(p_app_user_id uuid,p_kind text,p_locale public.content_locale,
  p_before timestamptz default null,p_before_id text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.app_users where id=p_app_user_id and status='active') then
    raise exception 'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED' using errcode='42501'; end if;
  if p_kind not in('applications','rewards','collection') or (p_before is null)<>(p_before_id is null)
    or length(p_before_id)>100 then raise exception 'FAN_HISTORY_INVALID' using errcode='22023'; end if;
  with history as (
    select a.id::text id,l.title,a.status::text status,a.submitted_at occurred_at,'/benefits/'||a.benefit_id href
      from public.benefit_applications a join public.benefit_localizations l on l.benefit_id=a.benefit_id and l.locale=p_locale
      where p_kind='applications' and a.app_user_id=p_app_user_id
    union all
    select r->>'rewardResultId',r->>'title',r->>'status',(r->>'updatedAt')::timestamptz,
      case when (r->>'recipientRequired')::boolean then '/my/rewards/'||(r->>'winnerId')||'/recipient' else r->>'benefitHref' end
      from jsonb_array_elements(case when p_kind='rewards' then public.get_owned_benefit_rewards(p_app_user_id,p_locale) else '[]'::jsonb end) r
    union all
    select 'passport:'||p.id,l.name||case when p_locale='ko' then ' 여권' else ' Passport' end,'collected',p.issued_at,'/passports/'||p.id
      from public.fan_passports p join public.celebrity_localizations l on l.celebrity_id=p.celebrity_id and l.locale=p_locale
      where p_kind='collection' and p.app_user_id=p_app_user_id
    union all
    select 'reaction:'||r.id,l.name||case when p_locale='ko' then ' 첫 응원 스탬프' else ' First reaction stamp' end,'collected',r.issued_at,case when r.passport_id is null then '/passports' else '/passports/'||r.passport_id end
      from public.first_reaction_stamps r join public.celebrity_localizations l on l.celebrity_id=r.celebrity_id and l.locale=p_locale
      where p_kind='collection' and r.app_user_id=p_app_user_id
    union all
    select 'stamp:'||s.id,l.name||case when p_locale='ko' then ' 스탬프' else ' Stamp' end,'collected',s.issued_at,'/passports/'||s.passport_id
      from public.stamps s join public.celebrity_localizations l on l.celebrity_id=s.celebrity_id and l.locale=p_locale
      where p_kind='collection' and s.app_user_id=p_app_user_id
    union all
    select 'collectible:'||cc.id,l.title||' Collectible','collected',cc.claimed_at,'/live/'||e.slug
      from public.live_collectible_claims cc join public.live_events e on e.id=cc.live_event_id
      join public.live_event_localizations l on l.live_event_id=e.id and l.locale=p_locale
      where p_kind='collection' and cc.app_user_id=p_app_user_id
    union all
    select 'community:'||cs.id,coalesce(cl.name,'ByUs')||' Stamp','collected',cs.issued_at,
      case when p.id is null then '/passports' else '/passports/'||p.id end
      from public.community_stamps cs left join public.celebrity_localizations cl on cl.celebrity_id=cs.celebrity_id and cl.locale=p_locale
      left join public.fan_passports p on p.app_user_id=cs.app_user_id and p.celebrity_id=cs.celebrity_id
      where p_kind='collection' and cs.app_user_id=p_app_user_id
  ), page as (select * from history where p_before is null or (occurred_at,id)<(p_before,p_before_id)
    order by occurred_at desc,id desc limit 31), visible as (select * from page order by occurred_at desc,id desc limit 30)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,
    'occurredAt',occurred_at,'href',href) order by occurred_at desc,id desc) from visible),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>30 then
      (select jsonb_build_object('at',occurred_at,'id',id) from visible order by occurred_at,id limit 1) else null end) into result;
  return result;
end $$;

revoke all on function public.read_shared_passport_activity(text),public.get_owned_fan_history(uuid,text,public.content_locale,timestamptz,text),
  public.visit_community_stamp_share_link(uuid,text),public.visit_community_stamp_share_link_before_fan_web(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_shared_passport_activity(text),public.get_owned_fan_history(uuid,text,public.content_locale,timestamptz,text),
  public.visit_community_stamp_share_link(uuid,text) to service_role;
