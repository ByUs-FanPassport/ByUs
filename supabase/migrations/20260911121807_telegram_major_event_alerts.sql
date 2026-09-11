-- Operator-room alerts are separate from fan messaging and analytics consent.
-- Only new committed business facts are captured; activation never backfills.
create table public.telegram_alert_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  chat_id text check (chat_id ~ '^-[0-9]{1,19}$'),
  activation_id uuid not null default gen_random_uuid(),
  activated_at timestamptz not null default clock_timestamp(),
  next_send_at timestamptz not null default '-infinity',
  batch_id uuid,
  lease_expires_at timestamptz,
  check (not enabled or chat_id is not null)
);
insert into public.telegram_alert_settings(singleton) values(true);

create table public.telegram_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published')),
  source_id uuid not null,
  activation_id uuid not null,
  chat_id text not null check (chat_id ~ '^-[0-9]{1,19}$'),
  creator_name text check (char_length(creator_name)<=120),
  live_title text check (char_length(live_title)<=200),
  winner_count integer check (winner_count>0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending','claimed','sending','sent','failed','delivery_unknown','skipped')),
  batch_id uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  provider_message_id bigint,
  last_error text check (last_error in ('THROTTLED','REJECTED','DELIVERY_UNKNOWN')),
  finished_at timestamptz,
  unique(kind,source_id)
);
create index telegram_alert_outbox_pending_idx on public.telegram_alert_outbox(available_at,created_at,id) where status='pending';
create index telegram_alert_outbox_batch_idx on public.telegram_alert_outbox(batch_id) where batch_id is not null;
alter table public.telegram_alert_settings enable row level security;
alter table public.telegram_alert_settings force row level security;
alter table public.telegram_alert_outbox enable row level security;
alter table public.telegram_alert_outbox force row level security;
revoke all on public.telegram_alert_settings,public.telegram_alert_outbox from public,anon,authenticated,service_role;

create function public.configure_telegram_alerts(p_chat_id text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings;
begin
  if p_enabled is null or (p_enabled and (p_chat_id is null or p_chat_id !~ '^-[0-9]{1,19}$')) then
    raise exception 'TELEGRAM_CONFIG_INVALID';
  end if;
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if cfg.enabled=p_enabled and cfg.chat_id is not distinct from p_chat_id then return; end if;
  -- A request that has already entered sending may still arrive. Keep its
  -- uncertain state and room throttle; never reassign it to a different room.
  update public.telegram_alert_outbox set status='skipped',finished_at=clock_timestamp(),lease_expires_at=null
    where status in ('pending','claimed');
  update public.telegram_alert_settings set enabled=p_enabled,chat_id=p_chat_id,
    activation_id=gen_random_uuid(),activated_at=clock_timestamp(),batch_id=null,lease_expires_at=null
    where singleton;
end $$;

create function public.capture_telegram_major_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  cfg public.telegram_alert_settings;
  event_kind text; event_id uuid; event_time timestamptz;
  creator uuid; live_id uuid; creator_label text; live_label text; winners integer;
begin
  -- No network calls or blocking room locks on the business transaction path.
  select * into cfg from public.telegram_alert_settings where singleton;
  if not coalesce(cfg.enabled,false) then return new; end if;
  if tg_table_name='app_users' then
    if new.status::text<>'active' then return new; end if;
    event_kind:='member_joined';event_id:=new.id;event_time:=new.created_at;
  elsif tg_table_name='fan_passports' then
    event_kind:='fan_joined';event_id:=new.id;event_time:=new.issued_at;creator:=new.celebrity_id;
  elsif tg_table_name='live_reservations' then
    event_kind:='live_reserved';event_id:=new.id;event_time:=new.reserved_at;creator:=new.celebrity_id;live_id:=new.live_event_id;
  elsif tg_table_name='live_attendances' then
    event_kind:='live_attended';event_id:=new.id;event_time:=new.attended_at;creator:=new.celebrity_id;live_id:=new.live_event_id;
  elsif tg_table_name='benefit_draw_publications' then
    event_kind:='draw_published';event_id:=new.draw_id;event_time:=new.published_at;
    select c.live_event_id,l.celebrity_id into live_id,creator
      from public.live_benefit_campaigns c join public.live_events l on l.id=c.live_event_id where c.id=new.campaign_id;
    select count(distinct w.app_user_id)::integer into winners from public.benefit_draw_winners w where w.draw_id=new.draw_id;
    if winners=0 then return new; end if;
  else return new;
  end if;
  if event_time<cfg.activated_at then return new; end if;
  if creator is not null then
    select left(coalesce(k.name,e.name,c.slug),120) into creator_label
      from public.celebrities c
      left join public.celebrity_localizations k on k.celebrity_id=c.id and k.locale='ko'
      left join public.celebrity_localizations e on e.celebrity_id=c.id and e.locale='en'
      where c.id=creator and c.status='published';
    if not found then return new; end if;
  end if;
  if live_id is not null then
    select left(coalesce(k.title,e.title,l.slug),200) into live_label
      from public.live_events l
      left join public.live_event_localizations k on k.live_event_id=l.id and k.locale='ko'
      left join public.live_event_localizations e on e.live_event_id=l.id and e.locale='en'
      where l.id=live_id and l.publication_status='published';
    if not found then return new; end if;
  end if;
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,creator_name,live_title,winner_count,occurred_at)
    values(event_kind,event_id,cfg.activation_id,cfg.chat_id,creator_label,live_label,winners,event_time)
    on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  -- A secondary operator alert must never fail signup/reservation/attendance.
  -- SQLSTATE is safe; SQLERRM/DETAIL may include private values and are omitted.
  raise log 'TELEGRAM_ALERT_CAPTURE_FAILED sqlstate=%',sqlstate;
  return new;
end $$;

create trigger app_users_telegram_alert after insert on public.app_users for each row execute function public.capture_telegram_major_event();
create trigger fan_passports_telegram_alert after insert on public.fan_passports for each row execute function public.capture_telegram_major_event();
create trigger live_reservations_telegram_alert after insert on public.live_reservations for each row execute function public.capture_telegram_major_event();
create trigger live_attendances_telegram_alert after insert on public.live_attendances for each row execute function public.capture_telegram_major_event();
create trigger benefit_draw_publications_telegram_alert after insert on public.benefit_draw_publications for each row execute function public.capture_telegram_major_event();

create function public.maintain_telegram_alerts() returns void
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; t timestamptz:=clock_timestamp();
begin
  -- All queue/control mutations use this lock order: settings, then outbox.
  select * into cfg from public.telegram_alert_settings where singleton for update;
  update public.telegram_alert_outbox set status='delivery_unknown',last_error='DELIVERY_UNKNOWN',finished_at=t,lease_expires_at=null
    where status='sending' and lease_expires_at<=t;
  update public.telegram_alert_outbox set status='pending',batch_id=null,lease_expires_at=null
    where status='claimed' and lease_expires_at<=t;
  update public.telegram_alert_outbox set status='skipped',finished_at=t,lease_expires_at=null
    where status in ('pending','claimed') and
      (not cfg.enabled or activation_id<>cfg.activation_id or chat_id is distinct from cfg.chat_id or created_at<t-interval '1 day');
  update public.telegram_alert_settings set batch_id=null,lease_expires_at=null
    where singleton and lease_expires_at<=t;
  delete from public.telegram_alert_outbox where finished_at<t-interval '30 days';
end $$;

create function public.claim_telegram_alert_batch(p_chat_id text) returns jsonb
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
      order by created_at,id for update skip locked limit 20
  ), claimed as (
    update public.telegram_alert_outbox o set status='claimed',batch_id=token,lease_expires_at=t+interval '60 seconds'
      from candidates c where o.id=c.id returning o.*
  ) select jsonb_build_object('batch_id',token,'alerts',jsonb_agg(jsonb_build_object(
      'kind',kind,'creator_name',creator_name,'live_title',live_title,'winner_count',winner_count,'occurred_at',occurred_at
    ) order by created_at,id)) into result from claimed having count(*)>0;
  if result is null then return null; end if;
  update public.telegram_alert_settings set batch_id=token,lease_expires_at=t+interval '60 seconds' where singleton;
  return result;
end $$;

create function public.begin_telegram_alert_send(p_batch_id uuid,p_chat_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; t timestamptz:=clock_timestamp(); n integer;
begin
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.batch_id is distinct from p_batch_id
    or cfg.lease_expires_at is null or cfg.lease_expires_at<=t or cfg.next_send_at>t then return false; end if;
  update public.telegram_alert_outbox set status='sending',attempt_count=attempt_count+1,lease_expires_at=t+interval '120 seconds'
    where batch_id=p_batch_id and status='claimed' and lease_expires_at>t
      and activation_id=cfg.activation_id and chat_id=cfg.chat_id and attempt_count<3;
  get diagnostics n=row_count;
  if n=0 then return false; end if;
  update public.telegram_alert_settings set next_send_at=t+interval '60 seconds',lease_expires_at=t+interval '120 seconds' where singleton;
  return true;
end $$;

create function public.finish_telegram_alert_batch(p_batch_id uuid,p_outcome text,p_provider_message_id bigint default null,p_retry_after integer default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; t timestamptz:=clock_timestamp(); delay_seconds integer; n integer; destination text;
begin
  if p_outcome is null or p_outcome not in ('sent','throttled','rejected','unknown')
    or (p_outcome='sent' and (p_provider_message_id is null or p_provider_message_id<=0)) then raise exception 'TELEGRAM_OUTCOME_INVALID'; end if;
  delay_seconds:=greatest(60,least(coalesce(p_retry_after,60),86400));
  select * into cfg from public.telegram_alert_settings where singleton for update;
  select chat_id into destination from public.telegram_alert_outbox where batch_id=p_batch_id and status='sending' limit 1;
  update public.telegram_alert_outbox set
    status=case when p_outcome='sent' then 'sent' when p_outcome='throttled' and attempt_count<3 then 'pending' when p_outcome='unknown' then 'delivery_unknown' else 'failed' end,
    last_error=case p_outcome when 'throttled' then 'THROTTLED' when 'rejected' then 'REJECTED' when 'unknown' then 'DELIVERY_UNKNOWN' else null end,
    provider_message_id=case when p_outcome='sent' then p_provider_message_id else null end,
    available_at=case when p_outcome='throttled' then t+make_interval(secs=>delay_seconds) else available_at end,
    lease_expires_at=null,
    finished_at=case when p_outcome='throttled' and attempt_count<3 then null else t end
    where batch_id=p_batch_id and status='sending' and lease_expires_at>t;
  get diagnostics n=row_count;
  if n=0 then return false; end if;
  if p_outcome='throttled' and destination=cfg.chat_id then
    update public.telegram_alert_settings set next_send_at=greatest(next_send_at,t+make_interval(secs=>delay_seconds)) where singleton;
  end if;
  update public.telegram_alert_settings set batch_id=null,lease_expires_at=null where singleton and batch_id=p_batch_id;
  return true;
end $$;

create function public.telegram_alert_health() returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object('enabled',s.enabled,'chat_id',s.chat_id,'activated_at',s.activated_at,'next_send_at',s.next_send_at,
  'pending',(select count(*) from public.telegram_alert_outbox where status in ('pending','claimed','sending')),
  'sent',(select count(*) from public.telegram_alert_outbox where status='sent'),
  'failed',(select count(*) from public.telegram_alert_outbox where status='failed'),
  'delivery_unknown',(select count(*) from public.telegram_alert_outbox where status='delivery_unknown'))
from public.telegram_alert_settings s where singleton;
$$;

revoke all on function public.capture_telegram_major_event(),public.configure_telegram_alerts(text,boolean),public.maintain_telegram_alerts(),public.claim_telegram_alert_batch(text),public.begin_telegram_alert_send(uuid,text),public.finish_telegram_alert_batch(uuid,text,bigint,integer),public.telegram_alert_health() from public,anon,authenticated;
grant execute on function public.configure_telegram_alerts(text,boolean),public.maintain_telegram_alerts(),public.claim_telegram_alert_batch(text),public.begin_telegram_alert_send(uuid,text),public.finish_telegram_alert_batch(uuid,text,bigint,integer),public.telegram_alert_health() to service_role;
select cron.schedule('telegram-alert-retention','23 * * * *','select public.maintain_telegram_alerts()');
