-- Deploy the compatible Telegram worker before this additive migration. No event backfill.
alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_kind_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_kind_check
  check(kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published','cs_inquiry_created','cs_user_replied','campaign_visited','raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected','fulfillment_updated','fulfillment_unclaimed','business_received','business_failed','mint_completed','mint_failed','delivery_failed','live_published','live_cancelled','live_rescheduled','campaign_outbound','fan_post_created','fan_post_commented','fan_post_liked','fan_lounge_posted','notice_commented','daily_checked_in','byus_day_rsvp_received','content_report_created'));

alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_last_error_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_last_error_check
  check(last_error in ('THROTTLED','REJECTED','DELIVERY_UNKNOWN','INVALID_PAYLOAD'));

-- Preserve the whole unrenderable batch for review without a provider attempt.
create function public.reject_telegram_alert_batch(p_batch_id uuid,p_chat_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; t timestamptz:=clock_timestamp(); n integer;
begin
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not found or not cfg.enabled or cfg.chat_id is distinct from p_chat_id
    or cfg.batch_id is distinct from p_batch_id or cfg.lease_expires_at is null
    or cfg.lease_expires_at<=t then return false; end if;
  update public.telegram_alert_outbox set status='failed',last_error='INVALID_PAYLOAD',
    finished_at=t,lease_expires_at=null
    where batch_id=p_batch_id and status='claimed' and lease_expires_at>t
      and activation_id=cfg.activation_id and chat_id=cfg.chat_id;
  get diagnostics n=row_count;
  if n=0 then return false; end if;
  update public.telegram_alert_settings set batch_id=null,lease_expires_at=null where singleton;
  return true;
end $$;
revoke all on function public.reject_telegram_alert_batch(uuid,text) from public,anon,authenticated;
grant execute on function public.reject_telegram_alert_batch(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.capture_telegram_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg public.telegram_alert_settings; k text; source uuid; happened timestamptz;
  context text; quantity integer; live_id uuid; v_benefit_id uuid; creator_id uuid; delivery record; job record; benefit_title text;
begin
  select * into cfg from public.telegram_alert_settings where singleton;
  if not coalesce(cfg.enabled,false) then return new; end if;
  happened:=clock_timestamp();
  -- Namespaced immutable facts deduplicate independently even if source UUIDs coincide.
  source:=md5(tg_table_name||':'||new.id::text)::uuid;
  case tg_table_name
    when 'benefit_ticket_entries' then
      k:='raffle_entered'; happened:=new.entered_at; quantity:=new.ticket_amount; v_benefit_id:=new.benefit_id;
    when 'benefit_claims' then
      k:='benefit_claimed'; happened:=new.claimed_at; v_benefit_id:=new.benefit_id;
    when 'fan_reactions' then
      k:='reaction_completed'; happened:=new.completed_at; creator_id:=new.celebrity_id;
    when 'live_survey_responses' then
      if new.status<>'submitted' then return new; end if;
      if tg_op='UPDATE' then if old.status='submitted' then return new; end if; end if;
      k:='mission_submitted'; happened:=new.submitted_at; live_id:=new.live_event_id;
    when 'live_journey_completions' then
      k:='journey_completed'; happened:=new.completed_at; live_id:=new.live_event_id;
    when 'live_collectible_claims' then
      k:='collectible_claimed'; happened:=new.claimed_at; live_id:=new.live_event_id;
    when 'community_stamp_invite_redemptions' then
      k:='invite_redeemed'; happened:=new.redeemed_at;
    when 'certification_submissions' then
      if old.status<>'pending' or new.status not in ('approved','rejected') then return new; end if;
      k:='certification_'||new.status; happened:=new.reviewed_at; creator_id:=new.celebrity_id;
    when 'benefit_fulfillment_events' then
      if new.to_status='ready' then
        if new.from_status is distinct from 'information_required' then return new; end if;
      elsif new.to_status not in ('shipping_in_transit','shipping_completed','pickup_available','pickup_completed','digital_delivered') then
        return new;
      end if;
      if new.to_status is not distinct from new.from_status then return new; end if;
      k:='fulfillment_updated'; happened:=new.created_at;
      select left(coalesce(l.title,b.slug),120) into benefit_title
      from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id
      join public.benefits b on b.id=w.benefit_id
      left join public.benefit_localizations l on l.benefit_id=b.id and l.locale='ko'
      where f.id=new.fulfillment_id;
      context:=case new.to_status when 'ready' then '수령 정보 접수 · 전달 준비 필요'
        when 'shipping_in_transit' then '배송 중' when 'shipping_completed' then '배송 완료'
        when 'pickup_available' then '현장 수령 가능' when 'pickup_completed' then '현장 수령 완료'
        else '디지털 전달 완료' end||coalesce(' · '||benefit_title,'');
    when 'benefit_fulfillments' then
      if new.claim_disposition<>'unclaimed' or old.claim_disposition='unclaimed' then return new; end if;
      k:='fulfillment_unclaimed'; source:=gen_random_uuid();
    when 'content_reports' then
      if tg_op<>'INSERT' or new.status<>'open' then return new; end if;
      k:='content_report_created'; happened:=new.created_at;
      context:=case new.target_type when 'fan_post' then '팬 게시글' when 'fan_post_comment' then '팬 게시글 댓글'
        when 'notice' then '공지' when 'notice_comment' then '공지 댓글' when 'cheer' then '응원글'
        when 'live_submission' then 'LIVE 제출물' else '콘텐츠' end||' · 신고 '||new.id::text;
    when 'business_inquiries' then
      if tg_op='INSERT' then k:='business_received'; happened:=new.created_at;
      else
        if new.status not in ('failed','delivery_unknown') or old.status=new.status then return new; end if;
        k:='business_failed'; source:=gen_random_uuid();
        context:=case new.status when 'delivery_unknown' then '전송 결과 불명 · 중복 재발송 전 확인' else '메일 전송 거절' end;
      end if;
    when 'blockchain_job_attempt_history' then
      if new.event not in ('completed','failed') then return new; end if;
      k:=case new.event when 'completed' then 'mint_completed' else 'mint_failed' end; happened:=new.created_at;
      select entity_type into job from public.blockchain_jobs where id=new.blockchain_job_id;
      context:=case job.entity_type when 'passport' then '팬 패스' when 'stamp' then '팬 인증 스탬프'
        when 'reaction' then '팬 리액션' when 'collectible' then 'LIVE 컬렉터블'
        when 'community_stamp' then '활동 스탬프' else '발급 작업' end
        ||' · 시도 '||new.attempt_number::text||'회 · 작업 '||new.blockchain_job_id::text
        ||case when new.event='failed' then ' · 오류 '||coalesce(public.redact_blockchain_job_error_code(new.safe_error_code),'UNKNOWN_JOB_ERROR') else '' end;
    when 'notification_delivery_outbox' then
      if not public.telegram_delivery_needs_attention(new.status::text,new.available_at,new.last_error_code) then return new; end if;
      if tg_op='UPDATE' then
        if public.telegram_delivery_needs_attention(old.status::text,old.available_at,old.last_error_code) then return new; end if;
      end if;
      k:='delivery_failed'; source:=gen_random_uuid(); context:='푸시 전송 최종 실패';
    when 'notification_delivery_plans' then
      if new.status<>'failed' or old.status='failed' then return new; end if;
      select * into delivery from public.external_notification_delivery_outbox where plan_id=new.id and sequence=new.current_sequence;
      if not found or not public.telegram_delivery_needs_attention(delivery.status::text,delivery.available_at,delivery.last_error_code) then return new; end if;
      k:='delivery_failed'; source:=gen_random_uuid();
      context:=case when delivery.last_error_code='EMAIL_SEND_OUTCOME_UNKNOWN' then '이메일 전송 결과 불명 · 중복 재발송 전 확인'
        when delivery.channel='kakao' then '카카오 알림 최종 실패' else '이메일 최종 실패' end;
    when 'live_events' then
      if new.publication_status<>'published' then return new; end if;
      if tg_op='UPDATE' then if new.publication_status=old.publication_status then return new; end if; end if;
      k:='live_published'; source:=gen_random_uuid(); live_id:=new.id;
    when 'live_status_overrides' then
      if new.effective_status<>'cancelled' then return new; end if;
      k:='live_cancelled'; happened:=new.created_at; live_id:=new.live_event_id;
    when 'live_schedule_revisions' then
      if row(new.before_reservation_opens_at,new.before_reservation_closes_at,new.before_starts_at,new.before_ends_at,new.before_attendance_valid_from,new.before_attendance_valid_until)
        is not distinct from row(new.after_reservation_opens_at,new.after_reservation_closes_at,new.after_starts_at,new.after_ends_at,new.after_attendance_valid_from,new.after_attendance_valid_until) then return new; end if;
      k:='live_rescheduled'; happened:=new.created_at; live_id:=new.live_event_id;
    when 'outbound_link_visits' then
      if new.campaign<>'banksy' then return new; end if;
      k:='campaign_outbound'; happened:=new.created_at;
      context:=case new.destination when 'exhibition' then '전시 자세히 보기' else '굿즈 보기' end||' · 도착/구매 확인 아님';
    else return new;
  end case;
  if happened<cfg.activated_at then return new; end if;
  if live_id is not null then
    if k in ('live_published','live_cancelled','live_rescheduled') and not exists(
      select 1 from public.live_events where id=live_id and publication_status='published') then return new; end if;
    select left(coalesce(l.title,e.slug),160) into context from public.live_events e
      left join public.live_event_localizations l on l.live_event_id=e.id and l.locale='ko' where e.id=live_id;
  elsif v_benefit_id is not null then
    select left(coalesce(l.title,b.slug),160) into context from public.benefits b
      left join public.benefit_localizations l on l.benefit_id=b.id and l.locale='ko' where b.id=v_benefit_id;
  elsif creator_id is not null then
    select left(coalesce(l.name,c.slug),160) into context from public.celebrities c
      left join public.celebrity_localizations l on l.celebrity_id=c.id and l.locale='ko' where c.id=creator_id;
  end if;
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity,activity_source_id)
    values(k,source,cfg.activation_id,cfg.chat_id,happened,context,quantity,case when k in ('raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected') then new.id::text::uuid end) on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_ACTIVITY_CAPTURE_FAILED table=% sqlstate=%',tg_table_name,sqlstate;
  return new;
end $function$;

create trigger content_reports_telegram_activity after insert on public.content_reports
for each row execute function public.capture_telegram_activity();

CREATE OR REPLACE FUNCTION public.telegram_command_stats(p_command text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; day_start timestamptz; day_end timestamptz; from_at timestamptz; previous_at timestamptz;
begin
  if p_command='help' then return jsonb_build_object('command','help','generated_at',p_now); end if;
  if p_command='users' then
    select jsonb_build_object('command','users','generated_at',p_now,
      'total_users',count(*),'active_users',count(*) filter(where status='active'),
      'disabled_users',count(*) filter(where status='disabled'),
      'passport_users',(select count(distinct app_user_id) from public.fan_passports),
      'passport_count',(select count(*) from public.fan_passports)) into result from public.app_users;
    return result;
  end if;
  if p_command='today' then
    day_start:=date_trunc('day',p_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
    day_end:=least(day_start+interval '1 day',p_now);
    return jsonb_build_object('command','today','generated_at',p_now,'date',to_char(day_start at time zone 'Asia/Seoul','YYYY-MM-DD'),
      'signups',(select count(*) from public.app_users where created_at>=day_start and created_at<day_end),
      'fan_joins',(select count(*) from public.fan_passports where issued_at>=day_start and issued_at<day_end),
      'reservations',(select count(*) from public.live_reservations where reserved_at>=day_start and reserved_at<day_end),
      'attendances',(select count(*) from public.live_attendances where attended_at>=day_start and attended_at<day_end),
      'activity',jsonb_build_object(
        'checkins',(select count(*) from public.community_stamps where kind='daily_checkin' and issued_at>=day_start and issued_at<day_end),
        'reactions',(select count(*) from public.fan_reactions where completed_at>=day_start and completed_at<day_end),
        'fan_posts',(select count(*) from public.fan_posts where created_at>=day_start and created_at<day_end),
        'fan_comments',(select count(*) from public.fan_post_comments where created_at>=day_start and created_at<day_end)
          +(select count(*) from public.celebrity_notice_comments where created_at>=day_start and created_at<day_end),
        'cheers',(select count(*) from public.fan_lounge_messages where created_at>=day_start and created_at<day_end),
        'raffle_entries',(select count(*) from public.benefit_ticket_entries where entered_at>=day_start and entered_at<day_end),
        'raffle_tickets',(select coalesce(sum(ticket_amount),0) from public.benefit_ticket_entries where entered_at>=day_start and entered_at<day_end),
        'recipient_submissions',(select count(*) from public.benefit_fulfillment_events
          where from_status='information_required' and to_status='ready' and created_at>=day_start and created_at<day_end)));
  end if;
  if p_command='lives' then
    with eligible as (
      select l.id,l.starts_at,
        left(coalesce(ck.name,ce.name,c.slug),120) as creator_name,
        left(coalesce(lk.title,le.title,l.slug),200) as title
      from public.live_events l join public.celebrities c on c.id=l.celebrity_id
      left join public.celebrity_localizations ck on ck.celebrity_id=c.id and ck.locale='ko'
      left join public.celebrity_localizations ce on ce.celebrity_id=c.id and ce.locale='en'
      left join public.live_event_localizations lk on lk.live_event_id=l.id and lk.locale='ko'
      left join public.live_event_localizations le on le.live_event_id=l.id and le.locale='en'
      where l.publication_status='published' and c.status='published' and l.ends_at>=p_now-interval '7 days'
    ), selected as (select * from eligible order by starts_at,id limit 5)
    select jsonb_build_object('command','lives','generated_at',p_now,'total_lives',(select count(*) from eligible),
      'lives',coalesce(jsonb_agg(jsonb_build_object('creator_name',s.creator_name,'title',s.title,'starts_at',s.starts_at,
        'reservations',(select count(*) from public.live_reservations r where r.live_event_id=s.id),
        'attendances',(select count(*) from public.live_attendances a where a.live_event_id=s.id)) order by s.starts_at,s.id),'[]'::jsonb))
      into result from selected s;
    return result;
  end if;
  if p_command='ops' then
    return jsonb_build_object('command','ops','generated_at',p_now,
      'pending_cs',(select count(*) from public.cs_inquiries where status='open'),
      'pending_certifications',(select count(*) from public.certification_submissions where status='pending'),
      'failed_mints',(select count(*) from public.blockchain_jobs where status='FAILED'),
      'overdue_mints',(select count(*) from public.blockchain_jobs where status in ('PENDING','RETRYING') and next_attempt_at<p_now-interval '30 minutes'),
      'failed_deliveries',(select count(*) from public.notification_delivery_outbox where public.telegram_delivery_needs_attention(status::text,available_at,last_error_code))+
        (select count(*) from public.notification_delivery_plans p join public.external_notification_delivery_outbox o on o.plan_id=p.id and o.sequence=p.current_sequence
          where p.status='failed' and public.telegram_delivery_needs_attention(o.status::text,o.available_at,o.last_error_code)),
      'business_pending',(select count(*) from public.business_inquiries where status in ('pending','claimed','sending')),
      'business_failed',(select count(*) from public.business_inquiries where status in ('failed','delivery_unknown')),
      'telegram_pending',(select count(*) from public.telegram_alert_outbox where status in ('pending','claimed','sending')),
      'telegram_failed',(select count(*) from public.telegram_alert_outbox where status='failed'),
      'telegram_unknown',(select count(*) from public.telegram_alert_outbox where status='delivery_unknown'),
      'telegram_oldest_pending_at',(select min(created_at) from public.telegram_alert_outbox where status in ('pending','claimed','sending')),
      'telegram_invalid',(select count(*) from public.telegram_alert_outbox where status='failed' and last_error='INVALID_PAYLOAD'),
      'content_reports_pending',(select count(*) from public.content_reports where status='open'),
      'fulfillment',(select jsonb_build_object(
        'information_required',count(*) filter(where f.status='information_required'),
        'overdue',count(*) filter(where f.status='information_required' and f.recipient_deadline_at<=p_now),
        'ready',count(*) filter(where f.status='ready'),
        'oldest_information_required_at',min(f.created_at) filter(where f.status='information_required'))
        from public.benefit_fulfillments f join public.benefit_draw_winners w on w.id=f.winner_id
        join public.benefit_draw_publications publication on publication.draw_id=w.draw_id
        where f.claim_disposition='active' and f.method<>'digital'));
  end if;
  if p_command='marketing' then
    from_at:=(date_trunc('day',p_now at time zone 'Asia/Seoul')-interval '6 days') at time zone 'Asia/Seoul';
    previous_at:=from_at-(p_now-from_at);
    with sources as (
      select l.id,l.name,l.channel,count(*) visits,
        count(*) filter(where exists(select 1 from public.outbound_link_visits o where o.visit_id=v.id
          and o.campaign='banksy' and o.created_at>=v.created_at and o.created_at<p_now)) outbound_sessions
      from public.campaign_visits v join public.campaign_tracking_links l on l.id=v.first_link_id
      where v.created_at>=from_at and v.created_at<p_now
      group by l.id,l.name,l.channel order by count(*) desc,l.id limit 5
    ) select coalesce(jsonb_agg(jsonb_build_object('name',name,'channel',channel,'visits',visits,'outbound_sessions',outbound_sessions)
      order by visits desc,id),'[]'::jsonb) into result from sources;
    return jsonb_build_object('command','marketing','generated_at',p_now,'from',from_at,'previous_from',previous_at,
      'current',public.telegram_marketing_window(from_at,p_now),
      'previous',public.telegram_marketing_window(previous_at,from_at),
      'campaign_sources',result,'active_links',(select count(*) from public.campaign_tracking_links where active));
  end if;
  raise exception 'TELEGRAM_COMMAND_INVALID';
end $function$;
