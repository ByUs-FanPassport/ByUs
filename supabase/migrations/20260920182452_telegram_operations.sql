-- Deploy the compatible worker first. Canonical commit-only events; no backfill.
-- Reuse FIFO, room isolation, throttling, leases and retention from the existing queue.
alter table public.telegram_alert_outbox
  add column activity_context text check(char_length(activity_context)<=160),
  add column activity_quantity integer check(activity_quantity>=0);
alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_kind_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_kind_check
  check(kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published','cs_inquiry_created','cs_user_replied','campaign_visited','raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected','fulfillment_updated','fulfillment_unclaimed','business_received','business_failed','mint_completed','mint_failed','delivery_failed','live_published','live_cancelled','live_rescheduled','campaign_outbound'));

-- This identifies terminal work needing attention, including uncertain email sends.
-- Normal policy cancellations and collateral endpoint cleanup are not incidents.
create function public.telegram_delivery_needs_attention(p_status text,p_available_at timestamptz,p_error text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_status='failed' and p_available_at='infinity'::timestamptz
    and coalesce(p_error,'') not in ('SCHEDULE_SUPERSEDED','LIVE_CANCELLED','EMAIL_KIND_SUPPRESSED',
      'EMAIL_NOT_ELIGIBLE','CURRENT_STATE_INELIGIBLE','SUBSCRIPTION_OWNER_CHANGED',
      'KAKAO_NOT_ELIGIBLE','KAKAO_STATE_CHANGED','PUSH_SUBSCRIPTION_GONE'),false);
$$;
revoke all on function public.telegram_delivery_needs_attention(text,timestamptz,text) from public,anon,authenticated,service_role;

create function public.capture_telegram_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; k text; source uuid; happened timestamptz;
  context text; quantity integer; live_id uuid; v_benefit_id uuid; creator_id uuid; delivery record;
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
      if new.to_status not in ('shipping_in_transit','shipping_completed','pickup_available','pickup_completed','digital_delivered')
        or new.to_status is not distinct from new.from_status then return new; end if;
      k:='fulfillment_updated'; happened:=new.created_at;
      context:=case new.to_status when 'shipping_in_transit' then '배송 중' when 'shipping_completed' then '배송 완료'
        when 'pickup_available' then '현장 수령 가능' when 'pickup_completed' then '현장 수령 완료' else '디지털 전달 완료' end;
    when 'benefit_fulfillments' then
      if new.claim_disposition<>'unclaimed' or old.claim_disposition='unclaimed' then return new; end if;
      k:='fulfillment_unclaimed'; source:=gen_random_uuid();
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
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity)
    values(k,source,cfg.activation_id,cfg.chat_id,happened,context,quantity) on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_ACTIVITY_CAPTURE_FAILED table=% sqlstate=%',tg_table_name,sqlstate;
  return new;
end $$;
revoke all on function public.capture_telegram_activity() from public,anon,authenticated,service_role;
create trigger benefit_ticket_entries_telegram_activity after insert on public.benefit_ticket_entries
  for each row execute function public.capture_telegram_activity();
create trigger benefit_claims_telegram_activity after insert on public.benefit_claims
  for each row execute function public.capture_telegram_activity();
create trigger fan_reactions_telegram_activity after insert on public.fan_reactions
  for each row execute function public.capture_telegram_activity();
create trigger live_survey_responses_telegram_activity after insert or update on public.live_survey_responses
  for each row execute function public.capture_telegram_activity();
create trigger live_journey_completions_telegram_activity after insert on public.live_journey_completions
  for each row execute function public.capture_telegram_activity();
create trigger live_collectible_claims_telegram_activity after insert on public.live_collectible_claims
  for each row execute function public.capture_telegram_activity();
create trigger community_stamp_invite_redemptions_telegram_activity after insert on public.community_stamp_invite_redemptions
  for each row execute function public.capture_telegram_activity();
create trigger certification_submissions_telegram_activity after update on public.certification_submissions
  for each row execute function public.capture_telegram_activity();
create trigger benefit_fulfillment_events_telegram_activity after insert on public.benefit_fulfillment_events
  for each row execute function public.capture_telegram_activity();
create trigger benefit_fulfillments_telegram_activity after update on public.benefit_fulfillments
  for each row execute function public.capture_telegram_activity();
create trigger business_inquiries_telegram_activity after insert or update on public.business_inquiries
  for each row execute function public.capture_telegram_activity();
create trigger blockchain_job_attempt_history_telegram_activity after insert on public.blockchain_job_attempt_history
  for each row execute function public.capture_telegram_activity();
create trigger notification_delivery_outbox_telegram_activity after insert or update on public.notification_delivery_outbox
  for each row execute function public.capture_telegram_activity();
create trigger notification_delivery_plans_telegram_activity after update on public.notification_delivery_plans
  for each row execute function public.capture_telegram_activity();
create trigger live_events_telegram_activity after insert or update on public.live_events
  for each row execute function public.capture_telegram_activity();
create trigger live_status_overrides_telegram_activity after insert on public.live_status_overrides
  for each row execute function public.capture_telegram_activity();
create trigger live_schedule_revisions_telegram_activity after insert on public.live_schedule_revisions
  for each row execute function public.capture_telegram_activity();
create trigger outbound_link_visits_telegram_activity after insert on public.outbound_link_visits
  for each row execute function public.capture_telegram_activity();

create or replace function public.claim_telegram_alert_batch_with_cs_content(p_chat_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; token uuid:=gen_random_uuid(); result jsonb; t timestamptz:=clock_timestamp();
begin
  perform public.maintain_telegram_alerts();
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.next_send_at>t
    or (cfg.lease_expires_at is not null and cfg.lease_expires_at>t) then return null; end if;
  with candidates as (
    select id from public.telegram_alert_outbox where status='pending' and available_at<=t
      and activation_id=cfg.activation_id and chat_id=cfg.chat_id and attempt_count<3
      order by created_at,id for update skip locked limit 5
  ), claimed as (
    update public.telegram_alert_outbox o set status='claimed',batch_id=token,lease_expires_at=t+interval '60 seconds'
      from candidates c where o.id=c.id returning o.*
  ) select jsonb_build_object('batch_id',token,'alerts',jsonb_agg(jsonb_build_object(
      'kind',c.kind,'creator_name',c.creator_name,'live_title',c.live_title,
      'winner_count',c.winner_count,'occurred_at',c.occurred_at,
      'actor_name',p.nickname,'actor_email',u.verified_email
    ) || case when c.kind in ('cs_inquiry_created','cs_user_replied')
      then jsonb_build_object('inquiry_id',m.inquiry_id,'message_body',m.body)
      when c.kind='campaign_visited' then jsonb_build_object('campaign_name',l.name,'campaign_channel',l.channel)
      when c.kind in ('raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected','fulfillment_updated','fulfillment_unclaimed','business_received','business_failed','mint_completed','mint_failed','delivery_failed','live_published','live_cancelled','live_rescheduled','campaign_outbound') then jsonb_build_object('activity_context',c.activity_context,'activity_quantity',c.activity_quantity)
      else '{}'::jsonb end order by c.created_at,c.id)) into result
    from claimed c
    left join public.campaign_visits v on c.kind='campaign_visited' and v.id=c.source_id
    left join public.campaign_tracking_links l on l.id=v.first_link_id
    left join public.cs_messages m on c.kind in ('cs_inquiry_created','cs_user_replied') and m.id=c.source_id
    left join public.fan_passports f on c.kind='fan_joined' and f.id=c.source_id
    left join public.live_reservations r on c.kind='live_reserved' and r.id=c.source_id
    left join public.live_attendances a on c.kind='live_attended' and a.id=c.source_id
    left join public.app_users u on u.id=case when c.kind='member_joined' then c.source_id
      else coalesce(f.app_user_id,r.app_user_id,a.app_user_id) end
    left join public.user_profiles p on p.app_user_id=u.id
    having count(*)>0;
  if result is null then return null; end if;
  update public.telegram_alert_settings set batch_id=token,lease_expires_at=t+interval '60 seconds' where singleton;
  return result;
end $$;

revoke all on function public.claim_telegram_alert_batch_with_cs_content(text) from public,anon,authenticated;
grant execute on function public.claim_telegram_alert_batch_with_cs_content(text) to service_role;

-- Internal aggregate projections; only the existing chat-scoped receipt RPC exposes these.
create function public.telegram_marketing_window(p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
  with accounts as (select id from public.app_users where created_at>=p_from and created_at<p_to),
  visits as (select v.*,exists(select 1 from public.outbound_link_visits o where o.visit_id=v.id
      and o.campaign='banksy' and o.created_at>=v.created_at and o.created_at<p_to) moved
    from public.campaign_visits v where v.created_at>=p_from and v.created_at<p_to)
  select jsonb_build_object(
    'accounts',(select count(*) from accounts),
    'profile_accounts',(select count(*) from accounts a where exists(select 1 from public.user_profiles p where p.app_user_id=a.id and p.created_at<p_to)),
    'passport_accounts',(select count(*) from accounts a where exists(select 1 from public.fan_passports p where p.app_user_id=a.id and p.issued_at<p_to)),
    'reactions',(select count(*) from public.fan_reactions where completed_at>=p_from and completed_at<p_to),
    'missions',(select count(*) from public.live_survey_responses where status='submitted' and submitted_at>=p_from and submitted_at<p_to),
    'raffle_entries',(select count(*) from public.benefit_ticket_entries where entered_at>=p_from and entered_at<p_to),
    'raffle_tickets',(select coalesce(sum(ticket_amount),0) from public.benefit_ticket_entries where entered_at>=p_from and entered_at<p_to),
    'invite_redemptions',(select count(*) from public.community_stamp_invite_redemptions where redeemed_at>=p_from and redeemed_at<p_to),
    'tracked_visits',(select count(*) from visits where first_link_id is not null),
    'direct_visits',(select count(*) from visits where first_link_id is null),
    'outbound_sessions',(select count(*) from visits where first_link_id is not null and moved));
$$;
revoke all on function public.telegram_marketing_window(timestamptz,timestamptz) from public,anon,authenticated,service_role;
create or replace function public.telegram_command_stats(p_command text,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
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
    day_end:=day_start+interval '1 day';
    return jsonb_build_object('command','today','generated_at',p_now,'date',to_char(day_start at time zone 'Asia/Seoul','YYYY-MM-DD'),
      'signups',(select count(*) from public.app_users where created_at>=day_start and created_at<day_end),
      'fan_joins',(select count(*) from public.fan_passports where issued_at>=day_start and issued_at<day_end),
      'reservations',(select count(*) from public.live_reservations where reserved_at>=day_start and reserved_at<day_end),
      'attendances',(select count(*) from public.live_attendances where attended_at>=day_start and attended_at<day_end));
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
      'telegram_oldest_pending_at',(select min(created_at) from public.telegram_alert_outbox where status in ('pending','claimed','sending')));
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
end $$;

alter table public.telegram_command_receipts drop constraint telegram_command_receipts_command_check;
alter table public.telegram_command_receipts add constraint telegram_command_receipts_command_check check(command in ('users','today','lives','ops','marketing','help'));
create or replace function public.begin_telegram_command_reply(p_chat_id text,p_update_id bigint,p_command text,p_message_date bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.telegram_command_settings; n integer; t timestamptz:=clock_timestamp();
begin
  select * into s from public.telegram_command_settings where singleton for update;
  if not s.enabled or p_update_id is null or p_update_id<=s.last_update_id or p_message_date is null
    or p_command is null or p_command not in ('users','today','lives','ops','marketing','help')
    or not exists(select 1 from public.telegram_alert_settings where singleton and chat_id=p_chat_id)
    or p_message_date<extract(epoch from date_trunc('second',s.activated_at))
    or p_message_date<extract(epoch from t-interval '10 minutes')
    or p_message_date>extract(epoch from t+interval '30 seconds') then return null; end if;
  insert into public.telegram_command_receipts(update_id,chat_id,command)
    values(p_update_id,p_chat_id,p_command) on conflict(update_id) do nothing;
  get diagnostics n=row_count;
  if n=0 then return null; end if;
  return public.telegram_command_stats(p_command,t);
end $$;

