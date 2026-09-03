create function public.read_admin_platform_analytics(
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
    select day::date as day from generate_series((p_from at time zone 'Asia/Seoul')::date,(p_to at time zone 'Asia/Seoul')::date-1,interval '1 day') day
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
    'trend',jsonb_build_object('state','available','value',coalesce((select jsonb_agg(jsonb_build_object('date',day,'newFans',(select count(*)::integer from public.app_users where (created_at at time zone 'Asia/Seoul')::date=days.day),'passports',(select count(*)::integer from public.fan_passports where (issued_at at time zone 'Asia/Seoul')::date=days.day),'reactions',(select count(*)::integer from public.fan_reactions where (completed_at at time zone 'Asia/Seoul')::date=days.day),'reservations',(select count(*)::integer from public.live_reservations where (reserved_at at time zone 'Asia/Seoul')::date=days.day),'attendances',(select count(*)::integer from public.live_attendances where (attended_at at time zone 'Asia/Seoul')::date=days.day),'transactions',(select count(*)::integer from job_facts where (created_at at time zone 'Asia/Seoul')::date=days.day)) order by day) from days),'[]'::jsonb),'reason',null,'source','canonical operational facts by Asia/Seoul date'),
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

