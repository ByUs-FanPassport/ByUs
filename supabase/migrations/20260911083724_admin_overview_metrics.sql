-- Read-only business overview. Additive, service-role-only; no operational writes.
create index if not exists app_users_created_at_overview_idx on public.app_users(created_at);
create index if not exists fan_product_events_member_occurred_overview_idx
  on public.fan_product_events(occurred_at, app_user_id) where app_user_id is not null;

create or replace function public.read_admin_overview(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_days integer default 30,
  p_as_of timestamptz default statement_timestamp()
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today timestamptz;
  v_from timestamptz;
  v_previous_from timestamptz;
  v_week timestamptz;
  v_month timestamptz;
  v_result jsonb;
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id, p_actor_admin_allowlist_id, false);
  if p_days is null or p_days not in (7,30,90) or p_as_of is null
     or not isfinite(p_as_of) or p_as_of > statement_timestamp() + interval '1 minute' then
    raise exception 'invalid overview window' using errcode = '22023';
  end if;
  v_today := date_trunc('day', p_as_of at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_from := v_today - make_interval(days => p_days - 1);
  v_previous_from := v_from - (p_as_of - v_from);
  v_week := v_today - interval '6 days';
  v_month := v_today - interval '29 days';

  with daily as (
    select (u.created_at at time zone 'Asia/Seoul')::date as bucket_date, count(*)::integer n
    from public.app_users u where u.created_at >= v_from and u.created_at < p_as_of group by 1
  ), days as (
    select d::date as bucket_date from generate_series(
      (v_from at time zone 'Asia/Seoul')::date,
      (p_as_of at time zone 'Asia/Seoul')::date, interval '1 day') d
  ), member_events as materialized (
    select app_user_id, occurred_at from public.fan_product_events
    where app_user_id is not null and occurred_at >= v_month and occurred_at < p_as_of and created_at <= p_as_of
      and event_name in ('creator_page_view','live_page_view','live_cta_click','benefit_page_view',
        'reaction_completed','passport_issued','reservation_completed','attendance_completed',
        'mission_completed','journey_completed','collectible_claimed','benefit_entered')
  ), visible_lives as materialized (
    select e.*, public.live_effective_status_at(e.id,p_as_of)::text effective_status
    from public.live_events e join public.celebrities c on c.id=e.celebrity_id
    where e.publication_status='published' and e.archived_at is null
      and c.status='published' and c.archived_at is null and e.created_at < p_as_of
  ), failures as (
    select status,available_at,last_error_code from public.notification_delivery_outbox
    union all select status,available_at,last_error_code from public.external_notification_delivery_outbox
  )
  select jsonb_build_object(
    'asOf',p_as_of,'from',v_from,'previousFrom',v_previous_from,'days',p_days,
    'members',jsonb_build_object(
      'total',(select count(*) from public.app_users where created_at < p_as_of),
      'signups',jsonb_build_object(
        'current',(select count(*) from public.app_users where created_at >= v_from and created_at < p_as_of),
        'previous',(select count(*) from public.app_users where created_at >= v_previous_from and created_at < v_from)),
      'week',jsonb_build_object(
        'current',(select count(*) from public.app_users where created_at >= v_week and created_at < p_as_of),
        'previous',(select count(*) from public.app_users where created_at >= v_week-(p_as_of-v_week) and created_at < v_week)),
      'month',jsonb_build_object(
        'current',(select count(*) from public.app_users where created_at >= v_month and created_at < p_as_of),
        'previous',(select count(*) from public.app_users where created_at >= v_month-(p_as_of-v_month) and created_at < v_month))
    ),
    'activity',jsonb_build_object(
      'daily',(select count(distinct app_user_id) from member_events where occurred_at >= v_today),
      'monthly',(select count(distinct app_user_id) from member_events),
      'measuredSince',(select min(created_at) from public.fan_product_events)
    ),
    'trend',(select coalesce(jsonb_agg(jsonb_build_object('date',days.bucket_date,'signups',coalesce(daily.n,0)) order by days.bucket_date),'[]'::jsonb) from days left join daily using(bucket_date)),
    'usage',jsonb_build_object(
      'passports',(select count(*) from public.fan_passports where issued_at >= v_from and issued_at < p_as_of),
      'reactions',(select count(*) from public.fan_reactions where completed_at >= v_from and completed_at < p_as_of),
      'reservations',(select count(*) from public.live_reservations where reserved_at >= v_from and reserved_at < p_as_of),
      'attendances',(select count(*) from public.live_attendances where attended_at >= v_from and attended_at < p_as_of),
      'entries',(select count(*) from public.benefit_ticket_entries where entered_at >= v_from and entered_at < p_as_of)
    ),
    'content',jsonb_build_object(
      'creators',(select count(*) from public.celebrities where status='published' and archived_at is null),
      'scheduled',(select count(*) from visible_lives where effective_status='scheduled'),
      'live',(select count(*) from visible_lives where effective_status='live'),
      'ended',(select count(*) from visible_lives where effective_status='ended'),
      'cancelled',(select count(*) from visible_lives where effective_status='cancelled'),
      'drafts',(select count(*) from public.live_events where publication_status='draft' and archived_at is null)
    ),
    'issues',jsonb_build_object(
      'certifications',(select count(*) from public.certification_submissions where status='pending'),
      'failedJobs',(select count(*) from public.blockchain_jobs where status='FAILED'),
      'failedNotifications',(select count(*) from failures where status='failed' and available_at='infinity'::timestamptz
        and coalesce(last_error_code,'') not in ('SCHEDULE_SUPERSEDED','LIVE_CANCELLED','EMAIL_KIND_SUPPRESSED','EMAIL_NOT_ELIGIBLE','CURRENT_STATE_INELIGIBLE'))
    ),
    'upcoming',coalesce((select jsonb_agg(to_jsonb(item) order by (item.status='live') desc,item."startsAt",item.id) from (
      select e.id,coalesce(ko.title,e.slug) title,coalesce(en.title,ko.title,e.slug) "titleEn",coalesce(c.name,'') creator,
        e.starts_at "startsAt",e.effective_status status,
        (select count(*) from public.live_reservations r where r.live_event_id=e.id and r.reserved_at<p_as_of) reservations
      from visible_lives e left join public.live_event_localizations ko on ko.live_event_id=e.id and ko.locale='ko'
        left join public.live_event_localizations en on en.live_event_id=e.id and en.locale='en'
        left join public.celebrity_localizations c on c.celebrity_id=e.celebrity_id and c.locale='ko'
      where e.effective_status in ('scheduled','live')
      order by (e.effective_status='live') desc,e.starts_at,e.id limit 5
    ) item),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.read_admin_overview(uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.read_admin_overview(uuid,uuid,integer,timestamptz) to service_role;
comment on function public.read_admin_overview(uuid,uuid,integer,timestamptz) is
  'Admin-only counts; KST calendar dates including partial today; comparison is preceding equal duration. Activity is distinct authenticated owners of tracked user actions, not total site traffic. Current content/queue state is observed at read time.';

-- Correct the existing detailed trend: include the final partial KST date and
-- clip every daily fact to the exact requested half-open interval. Other
-- aggregate definitions and the public response contract remain unchanged.
create or replace function public.read_admin_platform_analytics(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  fan_count integer;
  wallet_count integer;
  result jsonb;
begin
  perform public.assert_blockchain_job_admin_actor(p_actor_app_user_id,p_actor_admin_allowlist_id,false);
  perform public.validate_admin_analytics_window(p_from,p_to,p_as_of);
  select count(*)::integer into fan_count from public.app_users u where u.created_at<=p_as_of;
  select count(distinct w.app_user_id)::integer into wallet_count from public.user_wallets w
    where w.wallet_type='embedded' and w.created_at<=p_as_of;

  with job_facts as (
    select j.id,j.entity_type,j.status,j.created_at,p.app_user_id,p.celebrity_id,null::uuid live_event_id from public.blockchain_jobs j join public.fan_passports p on j.entity_type='passport' and p.id=j.entity_id
    union all select j.id,j.entity_type,j.status,j.created_at,r.app_user_id,r.celebrity_id,null::uuid from public.blockchain_jobs j join public.fan_reactions r on j.entity_type='reaction' and r.id=j.entity_id
    union all select j.id,j.entity_type,j.status,j.created_at,s.app_user_id,s.celebrity_id,coalesce(lr.live_event_id,la.live_event_id,ls.live_event_id) from public.blockchain_jobs j join public.stamps s on j.entity_type='stamp' and s.id=j.entity_id join public.fan_activities fa on fa.id=s.activity_id left join public.live_reservations lr on fa.source_type='live_reservation' and lr.id=fa.source_id left join public.live_attendances la on fa.source_type='live_attendance' and la.id=fa.source_id left join public.live_survey_responses sr on fa.source_type='live_survey_response' and sr.id=fa.source_id left join public.live_surveys ls on ls.id=sr.survey_id
    union all select j.id,j.entity_type,j.status,j.created_at,c.app_user_id,e.celebrity_id,c.live_event_id from public.blockchain_jobs j join public.live_collectible_claims c on j.entity_type='collectible' and c.id=j.entity_id join public.live_events e on e.id=c.live_event_id
  ), active_creator_ids as (
    select celebrity_id from public.fan_passports where issued_at>=p_from and issued_at<p_to
    union select celebrity_id from public.fan_reactions where completed_at>=p_from and completed_at<p_to
    union select celebrity_id from public.live_reservations where reserved_at>=p_from and reserved_at<p_to
    union select celebrity_id from public.live_attendances where attended_at>=p_from and attended_at<p_to
    union select celebrity_id from public.fan_ticket_ledger where created_at>=p_from and created_at<p_to
    union select e.celebrity_id from public.live_journey_completions c join public.live_events e on e.id=c.live_event_id where c.completed_at>=p_from and c.completed_at<p_to
    union select e.celebrity_id from public.live_collectible_claims c join public.live_events e on e.id=c.live_event_id where c.claimed_at>=p_from and c.claimed_at<p_to
    union select e.celebrity_id from public.benefit_ticket_entries b join public.live_benefit_campaigns c on c.id=b.campaign_id join public.live_events e on e.id=c.live_event_id where b.entered_at>=p_from and b.entered_at<p_to
  ), days as (
    select day::date as day from generate_series((p_from at time zone 'Asia/Seoul')::date,((p_to - interval '1 microsecond') at time zone 'Asia/Seoul')::date,interval '1 day') day
  )
  select jsonb_build_object(
    'window',jsonb_build_object('from',p_from,'to',p_to,'semantics','[from,to)','asOf',p_as_of,'timeZone','Asia/Seoul'),
    'totals',jsonb_build_object(
      'fansAndWallets',case when fan_count=wallet_count then jsonb_build_object('state','available','value',fan_count,'reason',null,'source','app_users/user_wallets') else jsonb_build_object('state','unavailable','value',null,'reason','WALLET_INVARIANT_FAILED','source',null) end,
      'passports',jsonb_build_object('state','available','value',(select count(*)::integer from public.fan_passports where issued_at>=p_from and issued_at<p_to),'reason',null,'source','fan_passports'),
      'activeCreators',jsonb_build_object('state','available','value',(select count(*)::integer from active_creator_ids),'reason',null,'source','canonical operational facts'),
      'firstReactions',jsonb_build_object('state','available','value',(select count(*)::integer from public.fan_reactions where completed_at>=p_from and completed_at<p_to),'reason',null,'source','fan_reactions'),
      'reservations',jsonb_build_object('state','available','value',(select count(distinct app_user_id)::integer from public.live_reservations where reserved_at>=p_from and reserved_at<p_to),'reason',null,'source','live_reservations'),
      'attendances',jsonb_build_object('state','available','value',(select count(distinct app_user_id)::integer from public.live_attendances where attended_at>=p_from and attended_at<p_to),'reason',null,'source','live_attendances'),
      'onchainActions',jsonb_build_object('state','available','value',(select count(*)::integer from job_facts where created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs')
    ),
    'trend',jsonb_build_object('state','available','value',coalesce((select jsonb_agg(jsonb_build_object('date',day,'newFans',(select count(*)::integer from public.app_users where created_at>=p_from and created_at<p_to and (created_at at time zone 'Asia/Seoul')::date=days.day),'passports',(select count(*)::integer from public.fan_passports where issued_at>=p_from and issued_at<p_to and (issued_at at time zone 'Asia/Seoul')::date=days.day),'reactions',(select count(*)::integer from public.fan_reactions where completed_at>=p_from and completed_at<p_to and (completed_at at time zone 'Asia/Seoul')::date=days.day),'reservations',(select count(*)::integer from public.live_reservations where reserved_at>=p_from and reserved_at<p_to and (reserved_at at time zone 'Asia/Seoul')::date=days.day),'attendances',(select count(*)::integer from public.live_attendances where attended_at>=p_from and attended_at<p_to and (attended_at at time zone 'Asia/Seoul')::date=days.day),'transactions',(select count(*)::integer from job_facts where created_at>=p_from and created_at<p_to and (created_at at time zone 'Asia/Seoul')::date=days.day)) order by day) from days),'[]'::jsonb),'reason',null,'source','canonical operational facts by Asia/Seoul date'),
    'creators',jsonb_build_object('state','available','value',coalesce((select jsonb_agg(jsonb_build_object('celebrityId',c.id,'name',coalesce(l.name,c.slug),'fans',(select count(distinct x.app_user_id)::integer from (select app_user_id from public.fan_passports where celebrity_id=c.id union select app_user_id from public.fan_reactions where celebrity_id=c.id union select app_user_id from public.live_reservations where celebrity_id=c.id) x),'passports',(select count(*)::integer from public.fan_passports where celebrity_id=c.id and issued_at>=p_from and issued_at<p_to),'reactions',(select count(*)::integer from public.fan_reactions where celebrity_id=c.id and completed_at>=p_from and completed_at<p_to),'reservations',(select count(*)::integer from public.live_reservations where celebrity_id=c.id and reserved_at>=p_from and reserved_at<p_to),'attendances',(select count(*)::integer from public.live_attendances where celebrity_id=c.id and attended_at>=p_from and attended_at<p_to),'transactions',(select count(*)::integer from job_facts where celebrity_id=c.id and created_at>=p_from and created_at<p_to)) order by coalesce(l.name,c.slug)) from public.celebrities c left join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale='ko' where c.id in(select celebrity_id from active_creator_ids)),'[]'::jsonb),'reason',null,'source','canonical operational facts grouped by celebrities'),
    'lives',jsonb_build_object('state','available','value',coalesce((select jsonb_agg(jsonb_build_object('liveEventId',e.id,'title',coalesce(l.title,e.slug),'startsAt',e.starts_at,'reservations',(select count(*)::integer from public.live_reservations where live_event_id=e.id and reserved_at>=p_from and reserved_at<p_to),'attendances',(select count(*)::integer from public.live_attendances where live_event_id=e.id and attended_at>=p_from and attended_at<p_to),'transactions',(select count(*)::integer from job_facts where live_event_id=e.id and created_at>=p_from and created_at<p_to)) order by e.starts_at desc) from public.live_events e left join public.live_event_localizations l on l.live_event_id=e.id and l.locale='ko' where e.starts_at>=p_from and e.starts_at<p_to or exists(select 1 from public.live_reservations r where r.live_event_id=e.id and r.reserved_at>=p_from and r.reserved_at<p_to) or exists(select 1 from public.live_attendances a where a.live_event_id=e.id and a.attended_at>=p_from and a.attended_at<p_to)),'[]'::jsonb),'reason',null,'source','live_events/canonical operational facts'),
    'chain',jsonb_build_object(
      'total',jsonb_build_object('state','available','value',(select count(*)::integer from job_facts where created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs'),
      'uniqueFans',jsonb_build_object('state','available','value',(select count(distinct app_user_id)::integer from job_facts where created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs linked operational owners'),
      'successful',jsonb_build_object('state','available','value',(select count(*)::integer from job_facts where status='COMPLETED' and created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs(status=COMPLETED)'),
      'pending',jsonb_build_object('state','available','value',(select count(*)::integer from job_facts where status in('PENDING','PROCESSING','RETRYING') and created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs(status=PENDING|PROCESSING|RETRYING)'),
      'failed',jsonb_build_object('state','available','value',(select count(*)::integer from job_facts where status='FAILED' and created_at>=p_from and created_at<p_to),'reason',null,'source','blockchain_jobs(status=FAILED)'),
      'breakdown',jsonb_build_object('state','available','value',jsonb_build_object('passport',(select count(*)::integer from job_facts where entity_type='passport' and created_at>=p_from and created_at<p_to),'reaction',(select count(*)::integer from job_facts where entity_type='reaction' and created_at>=p_from and created_at<p_to),'stamp',(select count(*)::integer from job_facts where entity_type='stamp' and created_at>=p_from and created_at<p_to),'collectible',(select count(*)::integer from job_facts where entity_type='collectible' and created_at>=p_from and created_at<p_to)),'reason',null,'source','blockchain_jobs.entity_type')
    )
  ) into result;
  return result;
end $$;

revoke all on function public.read_admin_platform_analytics(uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.read_admin_platform_analytics(uuid,uuid,timestamptz,timestamptz,timestamptz) to service_role;
