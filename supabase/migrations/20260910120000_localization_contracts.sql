-- Additive KO/EN contracts. Legacy RPC signatures remain available during rolling deploys.

create function public.localized_certification_category(
  p_category text,p_locale public.content_locale
) returns text language sql immutable set search_path='' as $$
  select case
    when p_locale='ko' then p_category
    when lower(btrim(p_category)) in ('팬 인증','fan certification') then 'Fan Certification'
    when lower(btrim(p_category)) in ('공연','performance') then 'Performance'
    when lower(btrim(p_category)) in ('응원','support') then 'Support'
    when lower(btrim(p_category)) in ('기타','other') then 'Other'
    else 'Fan activity'
  end
$$;

create or replace function public.get_public_certifications(p_slug text,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
with celebrity as (select id,slug from public.celebrities where slug=p_slug and status='published' and archived_at is null), rows as (
  select q.id,'quiz'::text kind,public.localized_certification_category('팬 인증',p_locale) category,case when p_locale='ko' then 'Official Fan 인증 퀴즈' else 'Official Fan Quiz' end title,
    case when p_locale='ko' then '퀴즈를 통과하고 Fan Passport를 시작하세요.' else 'Pass the quiz to start your Fan Passport.' end description,
    'available'::text status,jsonb_build_object('scorePoints',1,'ticketAmount',1) reward,'/c/'||c.slug||'/verify?locale='||p_locale::text action
  from celebrity c join public.celebrity_quizzes q on q.celebrity_id=c.id and q.status='published'
  union all
  select m.id,'live_mission',case when p_locale='ko' then 'LIVE 미션' else 'LIVE Mission' end,ml.title,ml.description,
    case when now()<m.visible_from then 'preparing' when now()>=m.visible_until or m.lifecycle_status<>'published' then 'closed' else 'available' end,
    jsonb_build_object('scorePoints',r.mission_score,'ticketAmount',r.mission_ticket),'/live/'||l.slug||'/missions?locale='||p_locale::text
  from celebrity c join public.live_events l on l.celebrity_id=c.id and l.publication_status='published' and l.archived_at is null
  join public.live_surveys m on m.live_event_id=l.id and not m.legacy_contract
  join public.live_survey_localizations ml on ml.survey_id=m.id and ml.locale=p_locale
  left join public.live_survey_reward_setting_bindings b on b.survey_id=m.id left join public.live_reward_setting_revisions r on r.id=b.reward_setting_revision_id
  where m.ever_published_at is not null and m.lifecycle_status in ('published','closed') and m.archived_at is null
  union all
  select m.id,'manual',public.localized_certification_category(m.category,p_locale),case when p_locale='ko' then m.title_ko else m.title_en end,case when p_locale='ko' then m.description_ko else m.description_en end,
    case when m.status='closed' or now()>=m.closes_at then 'closed' when m.status='active' and now()>=m.opens_at then 'available' else 'preparing' end,
    jsonb_build_object('scorePoints',r.score_points,'ticketAmount',r.ticket_amount),'/c/'||c.slug||'/certifications/'||m.id::text||'?locale='||p_locale::text
  from celebrity c join public.certification_missions m on m.celebrity_id=c.id join lateral(select x.* from public.certification_reward_revisions x where x.mission_id=m.id order by x.revision desc limit 1) r on true
  where m.status<>'draft'
) select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'category',category,'title',title,'description',description,'status',status,'reward',reward,'actionHref',action) order by kind,title),'[]'::jsonb) from rows;
$$;

create or replace function public.get_public_certification(p_id uuid,p_locale public.content_locale) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',m.id,'kind','manual','celebrity',jsonb_build_object('slug',c.slug,'name',coalesce(cl.name,c.slug)),'category',public.localized_certification_category(m.category,p_locale),'title',case when p_locale='ko' then m.title_ko else m.title_en end,'description',case when p_locale='ko' then m.description_ko else m.description_en end,'instructions',case when p_locale='ko' then m.instructions_ko else m.instructions_en end,'status',case when m.status='closed' or now()>=m.closes_at then 'closed' when m.status='active' and now()>=m.opens_at then 'available' else 'preparing' end,'opensAt',m.opens_at,'closesAt',m.closes_at,'reward',jsonb_build_object('scorePoints',r.score_points,'ticketAmount',r.ticket_amount))
from public.certification_missions m join public.celebrities c on c.id=m.celebrity_id left join public.celebrity_localizations cl on cl.celebrity_id=c.id and cl.locale=p_locale
join lateral(select x.* from public.certification_reward_revisions x where x.mission_id=m.id order by x.revision desc limit 1) r on true
where m.id=p_id and m.status<>'draft' and c.status='published' and c.archived_at is null;
$$;

revoke all on function public.localized_certification_category(text,public.content_locale) from public,anon,authenticated;
grant execute on function public.localized_certification_category(text,public.content_locale) to service_role;

create function public.read_celebrity_fanpage(p_slug text,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path = '' as $$
  with creator as (
    select id from public.celebrities where slug=p_slug and status='published' and archived_at is null
  ), members as (
    select p.app_user_id,p.issued_at from public.fan_passports p
    join creator c on c.id=p.celebrity_id join public.app_users u on u.id=p.app_user_id
    where p.business_status='issued' and u.status='active'
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
    from events e join public.fan_activity_visibility visibility on visibility.app_user_id=e.app_user_id and visibility.enabled
    left join public.user_profiles p on p.app_user_id=e.app_user_id left join public.app_user_avatars a on a.app_user_id=e.app_user_id
    order by e.occurred_at desc,e.app_user_id,e.kind limit 6
  )
  select jsonb_build_object('membershipCount',(select count(*) from members),'leaderboardAvailable',(select count(*)>500 from members),
    'activity',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'tier',tier,'nickname',nickname,'avatarUrl',avatar_url,'occurredAt',occurred_at) order by occurred_at desc,app_user_id,kind) from recent),'[]'::jsonb)) from creator;
$$;

create function public.read_celebrity_fan_leaderboard(p_slug text,p_app_user_id uuid,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path = '' as $$
  with creator as (select id from public.celebrities where slug=p_slug and status='published' and archived_at is null), members as materialized (
    select p.app_user_id,p.issued_at,coalesce(sum(s.points),0)::integer points from public.fan_passports p join creator c on c.id=p.celebrity_id
    join public.app_users u on u.id=p.app_user_id and u.status='active' left join public.fan_score_ledger s on s.app_user_id=p.app_user_id and s.celebrity_id=p.celebrity_id
    where p.business_status='issued' group by p.app_user_id,p.issued_at
  ), counts as (select count(*) total from members), ranked as (
    select m.*,row_number() over(order by points desc,issued_at,app_user_id) rank from members m where (select total>500 from counts)
  ), display as (
    select r.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from ranked r left join public.user_profiles p on p.app_user_id=r.app_user_id left join public.app_user_avatars a on a.app_user_id=r.app_user_id
  )
  select jsonb_build_object('membershipCount',(select total from counts),'available',(select total>500 from counts),'asOf',statement_timestamp(),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('rank',rank,'nickname',nickname,'avatarUrl',avatar_url,'points',points) order by rank) from display where rank<=100),'[]'::jsonb),
    'me',(select jsonb_build_object('rank',rank,'nickname',nickname,'avatarUrl',avatar_url,'points',points) from display where app_user_id=p_app_user_id)) from creator;
$$;

create function public.read_celebrity_notice_comments(
  p_slug text,p_notice_slug text,p_app_user_id uuid,p_before timestamptz,p_before_id uuid,p_limit integer,p_locale public.content_locale
) returns jsonb language sql stable security definer set search_path='' as $$
  with notice as (
    select n.id from public.celebrity_notices n join public.celebrities c on c.id=n.celebrity_id
    where c.slug=p_slug and c.status='published' and c.archived_at is null and n.slug=p_notice_slug and n.publication_status='published' and n.archived_at is null
  ), visible as (
    select x.* from public.celebrity_notice_comments x join notice n on n.id=x.notice_id join public.app_users u on u.id=x.app_user_id and u.status='active' where x.removed_at is null
  ), page as (
    select v.*,coalesce(nullif(btrim(p.nickname),''),case when p_locale='ko' then '팬' else 'Fan' end) nickname,
      '/images/avatars/'||coalesce(a.selected_character_id,'star-pink')||'.webp' avatar_url
    from visible v left join public.user_profiles p on p.app_user_id=v.app_user_id left join public.app_user_avatars a on a.app_user_id=v.app_user_id
    where p_before is null or (v.created_at,v.id)<(p_before,p_before_id) order by v.created_at desc,v.id desc limit least(greatest(p_limit,1),50)
  )
  select jsonb_build_object('total',(select count(*) from visible),'comments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'body',body,'nickname',nickname,'avatarUrl',avatar_url,'createdAt',created_at,'isOwner',coalesce(app_user_id=p_app_user_id,false)) order by created_at desc,id desc) from page),'[]'::jsonb)) from notice;
$$;

revoke all on function public.read_celebrity_fanpage(text,public.content_locale),public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer,public.content_locale) from public,anon,authenticated;
grant execute on function public.read_celebrity_fanpage(text,public.content_locale),public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale),public.read_celebrity_notice_comments(text,text,uuid,timestamptz,uuid,integer,public.content_locale) to service_role;

create function public.get_owned_benefit_rewards(p_app_user_id uuid,p_locale public.content_locale)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rewardResultId',dc.id,'winnerId',w.id,'benefitId',dc.benefit_id,
    'title',case when p_locale='ko' then coalesce(ko.title,en.title,b.slug) else coalesce(en.title,ko.title,b.slug) end,
    'campaignId',dc.campaign_id,'result',dc.result,'method',case when w.id is null then null else f.method end,
    'status',case when w.id is null then 'not_selected' else f.status::text end,'enteredTickets',coalesce(entries.total,0),
    'recipientRequired',coalesce(w.id is not null and f.method in ('physical_shipping','on_site_pickup') and f.status='information_required',false),
    'updatedAt',case when w.id is null then dc.created_at else f.updated_at end,'benefitHref','/benefits/'||dc.benefit_id::text)
    order by (case when w.id is null then dc.created_at else f.updated_at end) desc,dc.id desc),'[]'::jsonb)
  from public.benefit_draw_candidates dc join public.benefit_draw_publications publication on publication.draw_id=dc.draw_id
  join public.benefits b on b.id=dc.benefit_id left join public.benefit_localizations ko on ko.benefit_id=b.id and ko.locale='ko'
  left join public.benefit_localizations en on en.benefit_id=b.id and en.locale='en'
  left join public.benefit_draw_winners w on w.candidate_id=dc.id left join public.benefit_fulfillments f on f.winner_id=w.id
  left join lateral(select sum(e.ticket_amount)::integer total from public.benefit_ticket_entries e where e.campaign_id=dc.campaign_id and e.benefit_id=dc.benefit_id and e.app_user_id=dc.app_user_id) entries on true
  where dc.app_user_id=p_app_user_id;
$$;
revoke all on function public.get_owned_benefit_rewards(uuid,public.content_locale) from public,anon,authenticated;
grant execute on function public.get_owned_benefit_rewards(uuid,public.content_locale) to service_role;

alter table public.instagram_connection_flows add column locale public.content_locale not null default 'ko';

create function public.instagram_issue_localized_invite(p_celebrity_id uuid,p_secret_hash text,p_username text,p_user_id text,p_locale public.content_locale)
returns void language plpgsql security invoker set search_path='' as $$
begin
  insert into public.instagram_connections(celebrity_id) values(p_celebrity_id) on conflict do nothing;
  perform 1 from public.instagram_connections where celebrity_id=p_celebrity_id for update;
  update public.instagram_connections set generation=extensions.gen_random_uuid(),lease_id=null,lease_until=null where celebrity_id=p_celebrity_id;
  delete from public.instagram_connection_flows where celebrity_id=p_celebrity_id;
  insert into public.instagram_connection_flows(secret_hash,celebrity_id,generation,stage,expected_username,expected_user_id,locale,expires_at)
  select p_secret_hash,celebrity_id,generation,'invite',p_username,p_user_id,p_locale,now()+interval '24 hours' from public.instagram_connections where celebrity_id=p_celebrity_id;
end $$;

create or replace function public.instagram_transition(p_operation text,p_secret_hash text,p_browser_hash text default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.instagram_connection_flows;slot public.instagram_connections;result jsonb;
begin
  select * into f from public.instagram_connection_flows where secret_hash=p_secret_hash;
  if not found then raise exception 'Instagram flow unavailable'; end if;
  if p_operation in ('pending','confirm') then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(case when p_operation='pending' then p_payload->'identity'->>'id' else f.payload->'identity'->>'id' end,8092026)); end if;
  select * into slot from public.instagram_connections where celebrity_id=f.celebrity_id for update;
  select * into f from public.instagram_connection_flows where secret_hash=p_secret_hash for update;
  if not found or f.expires_at<=now() or f.generation<>slot.generation then raise exception 'Instagram flow unavailable'; end if;
  result:=to_jsonb(f)-'secret_hash'-'browser_hash';
  result:=result||jsonb_build_object('celebrity_slug',(select slug from public.celebrities where id=f.celebrity_id),'celebrity_name',coalesce((select name from public.celebrity_localizations where celebrity_id=f.celebrity_id and locale=f.locale),''));
  if p_operation='peek_invite' and f.stage='invite' then return result; end if;
  if p_operation='start' and f.stage='invite' and p_browser_hash is not null then update public.instagram_connection_flows set secret_hash=p_payload->>'next_hash',stage='state',browser_hash=p_browser_hash,authorization_started_at=now(),expires_at=now()+interval '10 minutes' where secret_hash=p_secret_hash;return result;end if;
  if p_browser_hash is null or f.browser_hash is distinct from p_browser_hash then raise exception 'Instagram browser mismatch'; end if;
  if p_operation='peek_state' and f.stage='state' then return result; end if;
  if p_operation='consume' and f.stage='state' then update public.instagram_connection_flows set stage='exchanging' where secret_hash=p_secret_hash;return result;
  elsif p_operation='pending' and f.stage='exchanging' then
    if lower(p_payload->'identity'->>'username') is distinct from f.expected_username or(f.expected_user_id is not null and p_payload->'identity'->>'user_id' is distinct from f.expected_user_id)then raise exception 'Instagram account mismatch';end if;
    if exists(select 1 from public.instagram_revocations where subject_hash=encode(extensions.digest(p_payload->'identity'->>'id','sha256'),'hex')and issued_at+interval '1 second'>=f.authorization_started_at)then raise exception 'Instagram authorization revoked';end if;
    update public.instagram_connection_flows set secret_hash=p_payload->>'next_hash',stage='pending',payload=p_payload-'next_hash',expires_at=now()+interval '10 minutes' where secret_hash=p_secret_hash;return result;
  elsif p_operation='peek_pending' and f.stage='pending' then return result-'payload'||jsonb_build_object('payload',jsonb_build_object('identity',f.payload->'identity'));
  elsif p_operation='confirm' and f.stage='pending' then
    if lower(f.payload->'identity'->>'username') is distinct from f.expected_username or(f.expected_user_id is not null and f.payload->'identity'->>'user_id' is distinct from f.expected_user_id)then raise exception 'Instagram account mismatch';end if;
    if exists(select 1 from public.instagram_revocations where subject_hash=encode(extensions.digest(f.payload->'identity'->>'id','sha256'),'hex')and issued_at+interval '1 second'>=f.authorization_started_at)then raise exception 'Instagram authorization revoked';end if;
    update public.instagram_connections set identity=f.payload->'identity',ig_user_id=f.payload->'identity'->>'user_id',ig_scoped_id=f.payload->'identity'->>'id',token_ciphertext=f.payload->>'token_ciphertext',token_issued_at=(f.payload->>'token_issued_at')::timestamptz,token_expires_at=(f.payload->>'token_expires_at')::timestamptz,authorization_started_at=f.authorization_started_at,connected_at=now(),media='[]'::jsonb,media_fetched_at=null,next_sync_at=now(),last_error=null,lease_id=null,lease_until=null,generation=extensions.gen_random_uuid() where celebrity_id=f.celebrity_id;
    delete from public.instagram_connection_flows where celebrity_id=f.celebrity_id;return result-'payload';
  elsif p_operation='cancel' then delete from public.instagram_connection_flows where secret_hash=p_secret_hash;return '{}'::jsonb;end if;
  raise exception 'Instagram flow unavailable';
end $$;
revoke all on function public.instagram_issue_localized_invite(uuid,text,text,text,public.content_locale) from public,anon,authenticated;
grant execute on function public.instagram_issue_localized_invite(uuid,text,text,text,public.content_locale) to service_role;

create function public.claim_localized_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)
returns table(id uuid,notification_id uuid,kind public.notification_kind,locale text,endpoint text,p256dh text,auth_secret text,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if length(trim(p_worker_id)) not between 3 and 120 or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'invalid notification worker claim'; end if;
  update public.notification_delivery_outbox delivery set status='failed',available_at='infinity'::timestamptz,last_error_code='CURRENT_STATE_INELIGIBLE',lease_owner=null,lease_expires_at=null
  where(delivery.status in('pending','failed')or(delivery.status='processing'and delivery.lease_expires_at<=now()))and delivery.available_at<=now()and not public.notification_delivery_is_eligible(delivery.notification_id,now());
  return query with due as(
    select delivery.id from public.notification_delivery_outbox delivery where delivery.attempt_count<8 and delivery.available_at<=now()
      and(delivery.status in('pending','failed')or(delivery.status='processing'and delivery.lease_expires_at<=now()))
      and exists(select 1 from public.push_subscriptions subscription where subscription.id=delivery.subscription_id and subscription.disabled_at is null)
      and public.notification_delivery_is_eligible(delivery.notification_id,now()) order by delivery.available_at,delivery.id for update skip locked limit p_batch_size
  ),claimed as(
    update public.notification_delivery_outbox delivery set status='processing',attempt_count=delivery.attempt_count+1,lease_owner=p_worker_id,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),last_error_code=null from due where delivery.id=due.id returning delivery.*
  )
  select claimed.id,claimed.notification_id,notification.kind,coalesce(app_user.preferred_locale,'ko'),subscription.endpoint,subscription.p256dh,subscription.auth_secret,claimed.attempt_count,claimed.lease_owner,claimed.lease_expires_at
  from claimed join public.fan_notifications notification on notification.id=claimed.notification_id join public.app_users app_user on app_user.id=notification.app_user_id
  join public.push_subscriptions subscription on subscription.id=claimed.subscription_id where subscription.disabled_at is null;
end $$;
revoke all on function public.claim_localized_notification_deliveries(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_localized_notification_deliveries(text,integer,integer) to service_role;

create or replace function public.create_external_notification_plan(p_notification_id uuid,p_now timestamptz default pg_catalog.now()) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_notification public.fan_notifications%rowtype;v_locale text;v_primary public.fan_notification_channels%rowtype;v_fallback public.fan_notification_channels%rowtype;v_plan uuid;
begin
  select notification.* into v_notification from public.fan_notifications notification join public.app_users app_user on app_user.id=notification.app_user_id and app_user.status='active' where notification.id=p_notification_id;
  if not found then return null;end if;
  select coalesce(app_user.preferred_locale,'ko')into strict v_locale from public.app_users app_user where app_user.id=v_notification.app_user_id;
  select channel.* into v_primary from public.fan_notification_channels channel where channel.app_user_id=v_notification.app_user_id and channel.status='eligible'and channel.consented_at is not null and channel.consent_revoked_at is null and channel.verified_at is not null and(v_notification.kind::text not in('live_24h','live_cancelled')or channel.kind='kakao')order by case channel.kind when'kakao'then 1 else 2 end,channel.priority,channel.id limit 1;
  if not found then return null;end if;
  if v_primary.kind='kakao'and v_notification.kind::text not in('live_24h','live_cancelled')then select channel.* into v_fallback from public.fan_notification_channels channel where channel.app_user_id=v_notification.app_user_id and channel.kind='email'and channel.status='eligible'and channel.consented_at is not null and channel.consent_revoked_at is null and channel.verified_at is not null limit 1;end if;
  insert into public.notification_delivery_plans(notification_id,primary_channel_id,fallback_channel_id,email_locale,created_at,updated_at)values(p_notification_id,v_primary.id,v_fallback.id,v_locale,p_now,p_now)on conflict(notification_id)do update set notification_id=excluded.notification_id returning id into v_plan;
  insert into public.external_notification_delivery_outbox(plan_id,notification_id,channel_id,channel,sequence,template_key,locale,available_at)values(v_plan,p_notification_id,v_primary.id,v_primary.kind,1,v_notification.kind::text,v_locale,greatest(v_notification.scheduled_for,p_now))on conflict(plan_id,sequence)do nothing;
  return v_plan;
end $$;

-- Repair only unsent Kakao jobs created by the previous KO-forcing planner.
update public.external_notification_delivery_outbox delivery
set locale=plan.email_locale,updated_at=pg_catalog.now()
from public.notification_delivery_plans plan
where plan.id=delivery.plan_id and delivery.channel='kakao'
  and delivery.status in('pending','failed');

do $$
begin
  if exists(
    select 1 from public.external_notification_delivery_outbox delivery
    join public.notification_delivery_plans plan on plan.id=delivery.plan_id
    where delivery.channel='kakao' and delivery.status in('pending','failed')
      and delivery.locale<>plan.email_locale
  ) then raise exception 'unsent Kakao locale must match the delivery plan snapshot'; end if;
end $$;

-- Kakao and email now share the locale-aware payload builder already used by email claims.
create or replace function public.claim_external_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_now timestamptz default pg_catalog.now())
returns table(id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,template_key text,locale text,destination text,payload jsonb,attempt_count integer,lease_owner text,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if length(trim(p_worker_id))not between 3 and 120 or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then raise exception 'PHASE5_EXTERNAL_CLAIM_INVALID';end if;
  update public.external_notification_delivery_outbox delivery set status='failed',available_at='infinity'::timestamptz,last_error_code=case when notification.kind::text in('live_24h','live_cancelled')then'EMAIL_KIND_SUPPRESSED'else'EMAIL_NOT_ELIGIBLE'end,lease_owner=null,lease_expires_at=null,updated_at=p_now from public.fan_notifications notification where notification.id=delivery.notification_id and delivery.channel='email'and delivery.attempt_count<8 and delivery.available_at<=p_now and notification.scheduled_for<=p_now and(delivery.status in('pending','failed')or(delivery.status='processing'and delivery.lease_expires_at<=p_now))and not public.email_notification_delivery_is_eligible(delivery.notification_id,delivery.channel_id,p_now);
  return query with due as(
    select delivery.id from public.external_notification_delivery_outbox delivery join public.fan_notification_channels notification_channel on notification_channel.id=delivery.channel_id join public.app_users app_user on app_user.id=notification_channel.app_user_id
    where delivery.attempt_count<8 and delivery.available_at<=p_now and(delivery.status in('pending','failed')or(delivery.status='processing'and delivery.lease_expires_at<=p_now))and app_user.status='active'and notification_channel.status='eligible'and notification_channel.consented_at is not null and notification_channel.consent_revoked_at is null and notification_channel.verified_at is not null
      and case when delivery.channel='email'then public.email_notification_delivery_is_eligible(delivery.notification_id,delivery.channel_id,p_now)else public.notification_delivery_is_eligible(delivery.notification_id,p_now)end
    order by delivery.available_at,delivery.id for update of delivery skip locked limit p_batch_size
  ),claimed as(
    update public.external_notification_delivery_outbox delivery set status='processing',attempt_count=delivery.attempt_count+1,lease_owner=p_worker_id,lease_expires_at=p_now+pg_catalog.make_interval(secs=>p_lease_seconds),last_error_code=null,updated_at=p_now from due where delivery.id=due.id returning delivery.*
  )
  select claimed.id,claimed.notification_id,claimed.plan_id,claimed.channel,claimed.sequence,claimed.template_key,claimed.locale,private.destination,public.build_external_notification_payload(claimed.notification_id,claimed.locale),claimed.attempt_count,claimed.lease_owner,claimed.lease_expires_at
  from claimed join public.fan_notification_channel_private private on private.channel_id=claimed.channel_id;
end $$;

revoke all on function public.create_external_notification_plan(uuid,timestamptz),public.claim_external_notification_deliveries(text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.create_external_notification_plan(uuid,timestamptz),public.claim_external_notification_deliveries(text,integer,integer,timestamptz) to service_role;
