-- Deploy the backward-compatible Telegram worker before applying this migration.
-- Resolve only affiliation and occupation from the RSVP reference at claim time.
-- Legacy rows without a reference retain their existing names/count payload.

create or replace function public.submit_byus_day_rsvp(
  p_id uuid,p_locale text,p_korean_name text,p_english_name text,p_phone_e164 text,
  p_affiliation text,p_occupation text,p_email text,p_nationality text,p_resident_registration_number_encrypted text,p_consent boolean,
  p_ip_hash text,p_payload_hash text
) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_hash text; cfg public.telegram_alert_settings; total integer; now_at timestamptz:=public.byus_day_rsvp_now();
begin
  if now_at>='2026-10-13 00:00:00+09'::timestamptz then raise exception 'RSVP_CLOSED'; end if;
  if p_id is null or p_locale is null or p_locale not in ('ko','en') or p_consent is distinct from true
    or p_korean_name is null or char_length(btrim(p_korean_name)) not between 1 and 80 or p_korean_name ~ '[[:cntrl:]]'
    or p_english_name is null or char_length(btrim(p_english_name)) not between 1 and 80 or p_english_name ~ '[[:cntrl:]]'
    or p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
    or p_affiliation is null or char_length(btrim(p_affiliation)) not between 1 and 120 or p_affiliation ~ '[[:cntrl:]]'
    or p_occupation is null or char_length(btrim(p_occupation)) not between 1 and 120 or p_occupation ~ '[[:cntrl:]]'
    or p_email is null or p_email<>lower(p_email) or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email ~ '[[:cntrl:]]'
    or p_nationality is null or p_nationality !~ '^[A-Z]{2}$'
    or p_resident_registration_number_encrypted is null or p_resident_registration_number_encrypted !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{18}$'
    or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'RSVP_INVALID'; end if;

  -- ponytail: one event-wide lock is sufficient for this bounded RSVP volume; shard only if measured contention appears.
  perform pg_advisory_xact_lock(10222026,1830);
  select payload_hash into old_hash from public.byus_day_rsvp_idempotency where id=p_id;
  if found then
    if old_hash<>p_payload_hash then raise exception 'RSVP_IDEMPOTENCY_CONFLICT'; end if;
    return true;
  end if;

  -- Every new idempotency key spends the same durable request budget before
  -- contact lookup, so accepted-vs-existing contacts cannot be enumerated.
  insert into public.byus_day_rsvp_rate_limits(ip_hash,window_started_at,submission_count)
  values(p_ip_hash,now_at,1)
  on conflict(ip_hash) do update set
    window_started_at=case when public.byus_day_rsvp_rate_limits.window_started_at<=now_at-interval '1 hour' then now_at else public.byus_day_rsvp_rate_limits.window_started_at end,
    submission_count=case when public.byus_day_rsvp_rate_limits.window_started_at<=now_at-interval '1 hour' then 1 else public.byus_day_rsvp_rate_limits.submission_count+1 end;
  select submission_count into total from public.byus_day_rsvp_rate_limits where ip_hash=p_ip_hash;
  if total>3 then raise exception 'RSVP_RATE_LIMITED'; end if;
  insert into public.byus_day_rsvp_idempotency(id,payload_hash) values(p_id,p_payload_hash);
  if exists(select 1 from public.byus_day_rsvps where email_normalized=p_email and phone_e164=p_phone_e164) then return true; end if;

  insert into public.byus_day_rsvps(id,locale,korean_name,english_name,phone_e164,affiliation,occupation,email_normalized,nationality,resident_registration_number_encrypted,ip_hash,payload_hash)
  values(p_id,p_locale,btrim(p_korean_name),btrim(p_english_name),p_phone_e164,btrim(p_affiliation),btrim(p_occupation),p_email,p_nationality,p_resident_registration_number_encrypted,p_ip_hash,p_payload_hash);

  -- Shared Telegram queue order is always settings, then outbox.
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if coalesce(cfg.enabled,false) then
    select count(*)::integer into total from public.byus_day_rsvps;
    insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at,activity_context,activity_quantity)
    values('byus_day_rsvp_received',p_id,cfg.activation_id,cfg.chat_id,now_at,btrim(p_korean_name)||' · '||btrim(p_english_name),total);
  end if;
  return true;
end $$;

revoke all on function public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,text,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_byus_day_rsvp(uuid,text,text,text,text,text,text,text,text,text,boolean,text,text) to service_role;

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
        else '{}'::jsonb end
      || case when rsvp.id is not null then jsonb_build_object('rsvp',jsonb_build_object(
        'affiliation',rsvp.affiliation,'occupation',rsvp.occupation)) else '{}'::jsonb end into payload
      from (select 1) base
      left join public.byus_day_rsvps rsvp on c.kind='byus_day_rsvp_received' and rsvp.id=c.source_id
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
      when c.kind='byus_day_rsvp_received' then 700
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
