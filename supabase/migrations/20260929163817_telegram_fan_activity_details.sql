-- Deploy the backward-compatible worker before this migration. No backfill.
-- References only: identities and user content are resolved at claim time.
alter table public.telegram_alert_outbox
  add column activity_source_id uuid,
  add column activity_actor_id uuid;
alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_kind_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_kind_check
  check(kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published','cs_inquiry_created','cs_user_replied','campaign_visited','raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected','fulfillment_updated','fulfillment_unclaimed','business_received','business_failed','mint_completed','mint_failed','delivery_failed','live_published','live_cancelled','live_rescheduled','campaign_outbound','fan_post_created','fan_post_commented','fan_post_liked','fan_lounge_posted','notice_commented','daily_checked_in'));

create or replace function public.capture_telegram_activity() returns trigger
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
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity,activity_source_id)
    values(k,source,cfg.activation_id,cfg.chat_id,happened,context,quantity,case when k in ('raffle_entered','benefit_claimed','reaction_completed','mission_submitted','journey_completed','collectible_claimed','invite_redeemed','certification_approved','certification_rejected') then new.id::text::uuid end) on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_ACTIVITY_CAPTURE_FAILED table=% sqlstate=%',tg_table_name,sqlstate;
  return new;
end $$;
revoke all on function public.capture_telegram_activity() from public,anon,authenticated,service_role;
create function public.capture_telegram_fan_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; k text; source uuid; record_id uuid; happened timestamptz;
begin
  select * into cfg from public.telegram_alert_settings where singleton;
  if not coalesce(cfg.enabled,false) then return new; end if;
  case tg_table_name
    when 'fan_posts' then
      if new.deleted_at is not null or new.hidden_at is not null then return new; end if;
      k:='fan_post_created'; record_id:=new.id; happened:=new.created_at;
    when 'fan_post_comments' then
      if new.deleted_at is not null or new.hidden_at is not null then return new; end if;
      k:='fan_post_commented'; record_id:=new.id; happened:=new.created_at;
    when 'fan_post_likes' then
      k:='fan_post_liked'; record_id:=new.post_id; happened:=new.created_at;
      source:=md5('fan_post_likes:'||new.post_id::text||':'||new.app_user_id::text||':'||extract(epoch from happened)::text)::uuid;
    when 'fan_lounge_messages' then
      if new.removed_at is not null then return new; end if;
      k:='fan_lounge_posted'; record_id:=new.id; happened:=new.created_at;
    when 'celebrity_notice_comments' then
      if new.removed_at is not null then return new; end if;
      k:='notice_commented'; record_id:=new.id; happened:=new.created_at;
    when 'community_stamps' then
      if new.kind<>'daily_checkin' then return new; end if;
      k:='daily_checked_in'; record_id:=new.id; happened:=new.issued_at;
    else return new;
  end case;
  if happened<cfg.activated_at then return new; end if;
  source:=coalesce(source,md5(tg_table_name||':'||record_id::text)::uuid);
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_source_id,activity_actor_id)
    values(k,source,cfg.activation_id,cfg.chat_id,happened,record_id,new.app_user_id)
    on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_FAN_ACTIVITY_CAPTURE_FAILED table=% sqlstate=%',tg_table_name,sqlstate;
  return new;
end $$;
revoke all on function public.capture_telegram_fan_activity() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['fan_posts','fan_post_comments','fan_post_likes','fan_lounge_messages','celebrity_notice_comments','community_stamps'] loop
    execute format('create trigger %I after insert on public.%I for each row execute function public.capture_telegram_fan_activity()',t||'_telegram_activity',t);
  end loop;
end $$;

-- Internal projection: never callable by API clients. NULL means the referenced
-- activity is no longer eligible; the caller retires it without sending content.
create function public.telegram_fan_activity_detail(o public.telegram_alert_outbox) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid; recipient uuid; creator uuid; live_id uuid; v_benefit_id uuid; r record; parent record;
  target jsonb; v_source_id uuid:=coalesce(o.activity_source_id,o.source_id); body text; context text;
  path text; result text; is_reply boolean:=false; creator_slug text; creator_name text;
  actor_name text; actor_email text; recipient_name text; v_locale public.content_locale;
  telegram_actor_id text; telegram_username text;
  ancestor uuid; seen uuid[]:='{}';
begin
  case o.kind
    when 'member_joined' then
      actor:=o.source_id; path:='/admin/fans'; result:='회원 가입 완료';
    when 'fan_joined' then
      select * into r from public.fan_passports where id=o.source_id and business_status='issued';
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; result:='팬 가입 완료';
    when 'live_reserved' then
      select * into r from public.live_reservations where id=o.source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; live_id:=r.live_event_id; result:='예약 완료';
    when 'live_attended' then
      select * into r from public.live_attendances where id=o.source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; live_id:=r.live_event_id; result:='LIVE 출석 완료';
    when 'fan_post_created' then
      select * into r from public.fan_posts where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; target:=public.fan_web_content_target(actor,'fan_post',r.id);
      if target is null then return null; end if;
      creator:=r.celebrity_id; body:=r.body; path:=target->>'deepLink'; context:='팬 이야기';
    when 'fan_post_commented' then
      select * into r from public.fan_post_comments where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; target:=public.fan_web_content_target(actor,'fan_post_comment',r.id);
      if target is null then return null; end if;
      creator:=(target->>'celebrityId')::uuid; body:=r.body; path:=target->>'deepLink'; is_reply:=r.parent_id is not null;
      if is_reply then
        select p.app_user_id,left(p.body,120) into recipient,context from public.fan_post_comments p where p.id=r.parent_id;
      else
        select p.app_user_id,left(p.body,120) into recipient,context from public.fan_posts p where p.id=r.post_id;
      end if;
      context:=case when is_reply then '답글 대상: ' else '원글: ' end||context;
    when 'fan_post_liked' then
      select * into r from public.fan_post_likes where post_id=v_source_id and app_user_id=o.activity_actor_id
        and md5('fan_post_likes:'||post_id::text||':'||app_user_id::text||':'||extract(epoch from created_at)::text)::uuid=o.source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; target:=public.fan_web_content_target(actor,'fan_post',r.post_id);
      if target is null then return null; end if;
      creator:=(target->>'celebrityId')::uuid; recipient:=(target->>'appUserId')::uuid;
      body:=target->>'body'; path:=target->>'deepLink'; result:='게시글 좋아요';
    when 'fan_lounge_posted' then
      select * into r from public.fan_lounge_messages where id=v_source_id and removed_at is null;
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; body:=r.body; is_reply:=r.reply_to_id is not null;
      ancestor:=r.reply_to_id;
      while ancestor is not null loop
        if ancestor=any(seen) then return null; end if;
        seen:=array_append(seen,ancestor);
        select * into parent from public.fan_lounge_messages where id=ancestor and celebrity_id=creator and removed_at is null;
        if not found or not exists(select 1 from public.app_users where id=parent.app_user_id and status='active')
          or public.fan_web_blocked(actor,parent.app_user_id) then return null; end if;
        if recipient is null then recipient:=parent.app_user_id; context:='답글 대상: '||left(parent.body,120); end if;
        ancestor:=parent.reply_to_id;
      end loop;
      path:='#cheers';
    when 'notice_commented' then
      select * into r from public.celebrity_notice_comments where id=v_source_id and removed_at is null;
      if not found then return null; end if;
      select l.locale into v_locale from public.celebrity_notice_localizations l where l.notice_id=r.notice_id
        order by (l.locale='ko') desc,l.locale limit 1;
      if v_locale is null then return null; end if;
      actor:=r.app_user_id; target:=public.fan_web_content_target(actor,'notice_comment',r.id,v_locale);
      if target is null then return null; end if;
      creator:=(target->>'celebrityId')::uuid; body:=r.body; path:=target->>'deepLink';
      select left(l.title,160) into context from public.celebrity_notice_localizations l where l.notice_id=r.notice_id and l.locale=v_locale;
    when 'daily_checked_in' then
      select * into r from public.community_stamps where id=v_source_id and kind='daily_checkin';
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; path:='#daily-checkin';
      result:=to_char(r.issued_at at time zone 'Asia/Seoul','YYYY-MM-DD')||' 일일 출석 완료';
    when 'raffle_entered' then
      select * into r from public.benefit_ticket_entries where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; v_benefit_id:=r.benefit_id; result:='사용 응모권 '||r.ticket_amount::text||'장';
    when 'benefit_claimed' then
      select * into r from public.benefit_claims where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; v_benefit_id:=r.benefit_id; result:='혜택 수령 완료';
    when 'reaction_completed' then
      select * into r from public.fan_reactions where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; creator:=r.celebrity_id; result:='팬 리액션 완료';
    when 'mission_submitted' then
      select * into r from public.live_survey_responses where id=v_source_id and status='submitted';
      if not found then return null; end if;
      actor:=r.app_user_id; live_id:=r.live_event_id; result:='미션 제출 완료';
    when 'journey_completed' then
      select * into r from public.live_journey_completions where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; live_id:=r.live_event_id; result:='LIVE 여정 완료';
    when 'collectible_claimed' then
      select * into r from public.live_collectible_claims where id=v_source_id;
      if not found then return null; end if;
      actor:=r.app_user_id; live_id:=r.live_event_id; result:='컬렉터블 수령 완료';
    when 'invite_redeemed' then
      select * into r from public.community_stamp_invite_redemptions where id=v_source_id;
      if not found then return null; end if;
      actor:=r.invitee_app_user_id; recipient:=r.inviter_app_user_id; path:='/community'; result:='초대를 통한 커뮤니티 참여';
    when 'certification_approved','certification_rejected' then
      select * into r from public.certification_submissions where id=v_source_id and 'certification_'||status::text=o.kind;
      if not found then return null; end if;
      actor:=r.reviewed_by_app_user_id; recipient:=r.app_user_id; creator:=r.celebrity_id;
      if r.review_source='telegram' then
        telegram_actor_id:=r.reviewed_by_telegram_user_id::text;
        telegram_username:=r.reviewed_by_telegram_username; actor_name:=r.reviewed_by_telegram_name;
      end if;
      result:=case when o.kind='certification_approved' then '팬 인증 승인' else '팬 인증 반려' end;
      body:=r.rejection_reason; path:='/admin/certifications';
    else return null;
  end case;
  if telegram_actor_id is null and not exists(select 1 from public.app_users where id=actor and status='active') then return null; end if;
  if recipient is not null and not exists(select 1 from public.app_users where id=recipient and status='active') then return null; end if;
  if live_id is not null then
    select e.celebrity_id,'/live/'||e.slug,left(coalesce(l.title,e.slug),160) into creator,path,context
      from public.live_events e left join public.live_event_localizations l on l.live_event_id=e.id and l.locale='ko'
      where e.id=live_id and e.publication_status='published';
    if not found then return null; end if;
  elsif v_benefit_id is not null then
    select b.celebrity_id,'/benefits/'||b.id::text,left(coalesce(l.title,b.slug),160) into creator,path,context
      from public.benefits b left join public.benefit_localizations l on l.benefit_id=b.id and l.locale='ko' where b.id=v_benefit_id;
    if not found then return null; end if;
  end if;
  if creator is not null then
    select c.slug,left(coalesce(k.name,e.name,c.slug),120) into creator_slug,creator_name from public.celebrities c
      left join public.celebrity_localizations k on k.celebrity_id=c.id and k.locale='ko'
      left join public.celebrity_localizations e on e.celebrity_id=c.id and e.locale='en'
      where c.id=creator and (c.status='published' or o.kind in ('certification_approved','certification_rejected')) and c.archived_at is null;
    if not found then return null; end if;
    if path is null or left(path,1)='#' then path:='/'||creator_slug||coalesce(path,''); end if;
  end if;
  if actor is not null then
    select p.nickname,u.verified_email into actor_name,actor_email from public.app_users u
      left join public.user_profiles p on p.app_user_id=u.id where u.id=actor;
  end if;
  select nickname into recipient_name from public.user_profiles where app_user_id=recipient;
  return jsonb_build_object('actor_name',actor_name,'actor_email',actor_email,'detail',jsonb_build_object(
    'actor_id',actor,'recipient_id',recipient,'recipient_name',recipient_name,'creator_name',creator_name,
    'context',left(context,160),'body',left(body,5000),'path',coalesce(path,'/admin'),
    'result',left(result,160),'is_reply',is_reply)||case when telegram_actor_id is not null
      then jsonb_build_object('telegram_actor_id',telegram_actor_id,'telegram_username',telegram_username) else '{}'::jsonb end);
end $$;
revoke all on function public.telegram_fan_activity_detail(public.telegram_alert_outbox) from public,anon,authenticated,service_role;

create or replace function public.claim_telegram_alert_batch_with_cs_content(p_chat_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; token uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
  c public.telegram_alert_outbox; payload jsonb; detail jsonb; alerts jsonb:='[]'; used integer:=0; cost integer;
begin
  perform public.maintain_telegram_alerts();
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.next_send_at>t
    or (cfg.lease_expires_at is not null and cfg.lease_expires_at>t) then return null; end if;
  for c in select * from public.telegram_alert_outbox where status='pending' and available_at<=t
    and activation_id=cfg.activation_id and chat_id=cfg.chat_id and attempt_count<3
    order by created_at,id for update skip locked limit 5 loop
    select jsonb_build_object('kind',c.kind,'creator_name',c.creator_name,'live_title',c.live_title,
      'winner_count',c.winner_count,'occurred_at',c.occurred_at,'actor_name',p.nickname,'actor_email',u.verified_email)
      || case when c.kind in ('cs_inquiry_created','cs_user_replied')
        then jsonb_build_object('inquiry_id',m.inquiry_id,'message_body',m.body)
        when c.kind='campaign_visited' then jsonb_build_object('campaign_name',l.name,'campaign_channel',l.channel)
        when c.kind not in ('member_joined','fan_joined','live_reserved','live_attended','draw_published')
        then jsonb_build_object('activity_context',c.activity_context,'activity_quantity',c.activity_quantity)
        else '{}'::jsonb end into payload
      from (select 1) base
      left join public.campaign_visits v on c.kind='campaign_visited' and v.id=c.source_id
      left join public.campaign_tracking_links l on l.id=v.first_link_id
      left join public.cs_messages m on c.kind in ('cs_inquiry_created','cs_user_replied') and m.id=c.source_id
      left join public.fan_passports f on c.kind='fan_joined' and f.id=c.source_id
      left join public.live_reservations r on c.kind='live_reserved' and r.id=c.source_id
      left join public.live_attendances a on c.kind='live_attended' and a.id=c.source_id
      left join public.app_users u on u.id=case when c.kind='member_joined' then c.source_id else coalesce(f.app_user_id,r.app_user_id,a.app_user_id) end
      left join public.user_profiles p on p.app_user_id=u.id;
    -- Pre-migration generic rows have no reference; preserve their legacy payload.
    if c.kind in ('member_joined','fan_joined','live_reserved','live_attended') or c.activity_source_id is not null then
      detail:=public.telegram_fan_activity_detail(c);
      if detail is null then
        update public.telegram_alert_outbox set status='skipped',finished_at=t where id=c.id;
        continue;
      end if;
      payload:=payload||detail;
    end if;
    -- JSON escaping plus 2x code points bounds UTF-16 text and quote prefixes.
    -- An oversized first post is rendered as an explicit linked preview by worker.
    cost:=case when payload ? 'detail' then 2*char_length(payload::text)+300
      when c.kind in ('cs_inquiry_created','cs_user_replied') then 800
      when c.kind in ('member_joined','fan_joined','live_reserved','live_attended') then 650 else 500 end;
    if jsonb_array_length(alerts)>0 and used+cost>3600 then exit; end if;
    update public.telegram_alert_outbox set status='claimed',batch_id=token,lease_expires_at=t+interval '60 seconds' where id=c.id;
    alerts:=alerts||jsonb_build_array(payload); used:=used+cost;
  end loop;
  if jsonb_array_length(alerts)=0 then return null; end if;
  update public.telegram_alert_settings set batch_id=token,lease_expires_at=t+interval '60 seconds' where singleton;
  return jsonb_build_object('batch_id',token,'alerts',alerts);
end $$;
revoke all on function public.claim_telegram_alert_batch_with_cs_content(text) from public,anon,authenticated;
grant execute on function public.claim_telegram_alert_batch_with_cs_content(text) to service_role;
