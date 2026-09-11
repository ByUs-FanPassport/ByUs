create table public.telegram_command_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  activated_at timestamptz not null default clock_timestamp(),
  last_update_id bigint not null default 0 check(last_update_id>=0)
);
insert into public.telegram_command_settings(singleton) values(true);
create table public.telegram_command_receipts (
  update_id bigint primary key check(update_id>0),
  chat_id text not null,
  command text not null check(command in ('users','today','lives','help')),
  status text not null default 'sending' check(status in ('sending','sent','failed','delivery_unknown')),
  provider_message_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
alter table public.telegram_command_settings enable row level security;
alter table public.telegram_command_settings force row level security;
alter table public.telegram_command_receipts enable row level security;
alter table public.telegram_command_receipts force row level security;
revoke all on public.telegram_command_settings,public.telegram_command_receipts from public,anon,authenticated,service_role;

-- Internal aggregate projection, with a clock parameter for exact KST boundary tests.
create function public.telegram_command_stats(p_command text,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; day_start timestamptz; day_end timestamptz;
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
  raise exception 'TELEGRAM_COMMAND_INVALID';
end $$;

create function public.configure_telegram_commands(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_enabled is null then raise exception 'TELEGRAM_COMMAND_CONFIG_INVALID'; end if;
  update public.telegram_command_settings set enabled=p_enabled,
    activated_at=case when p_enabled then clock_timestamp() else activated_at end
    where singleton and enabled is distinct from p_enabled;
end $$;

create function public.read_telegram_command_state(p_chat_id text) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('last_update_id',s.last_update_id,'activated_at',s.activated_at)
  from public.telegram_command_settings s cross join public.telegram_alert_settings a
  where s.singleton and a.singleton and s.enabled and a.chat_id=p_chat_id;
$$;

-- Receipt and aggregate snapshot commit before external send. A duplicate receipt
-- never permits another send, including a previous ambiguous/unfinished request.
create function public.begin_telegram_command_reply(p_chat_id text,p_update_id bigint,p_command text,p_message_date bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.telegram_command_settings; n integer; t timestamptz:=clock_timestamp();
begin
  select * into s from public.telegram_command_settings where singleton for update;
  if not s.enabled or p_update_id is null or p_update_id<=s.last_update_id or p_message_date is null
    or p_command is null or p_command not in ('users','today','lives','help')
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

create function public.finish_telegram_command_reply(p_chat_id text,p_update_id bigint,p_outcome text,p_provider_message_id bigint default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_outcome is null or p_outcome not in ('sent','failed','delivery_unknown')
    or (p_outcome='sent' and (p_provider_message_id is null or p_provider_message_id<=0)) then raise exception 'TELEGRAM_COMMAND_OUTCOME_INVALID'; end if;
  update public.telegram_command_receipts set status=p_outcome,provider_message_id=p_provider_message_id,finished_at=clock_timestamp()
    where update_id=p_update_id and chat_id=p_chat_id and status='sending';
  get diagnostics n=row_count;
  return n=1;
end $$;

create function public.acknowledge_telegram_command_updates(p_chat_id text,p_update_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_update_id is null or p_update_id<0 then raise exception 'TELEGRAM_COMMAND_CURSOR_INVALID'; end if;
  update public.telegram_command_settings set last_update_id=greatest(last_update_id,p_update_id)
    where singleton and enabled and exists(select 1 from public.telegram_alert_settings where singleton and chat_id=p_chat_id);
  get diagnostics n=row_count;
  return n=1;
end $$;

create function public.maintain_telegram_command_receipts() returns void
language sql security definer set search_path='' as $$
  update public.telegram_command_receipts set status='delivery_unknown',finished_at=clock_timestamp()
    where status='sending' and created_at<clock_timestamp()-interval '2 minutes';
  delete from public.telegram_command_receipts where finished_at<clock_timestamp()-interval '30 days';
$$;
revoke all on function public.telegram_command_stats(text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.configure_telegram_commands(boolean),public.read_telegram_command_state(text),public.begin_telegram_command_reply(text,bigint,text,bigint),public.finish_telegram_command_reply(text,bigint,text,bigint),public.acknowledge_telegram_command_updates(text,bigint),public.maintain_telegram_command_receipts() from public,anon,authenticated;
grant execute on function public.configure_telegram_commands(boolean),public.read_telegram_command_state(text),public.begin_telegram_command_reply(text,bigint,text,bigint),public.finish_telegram_command_reply(text,bigint,text,bigint),public.acknowledge_telegram_command_updates(text,bigint),public.maintain_telegram_command_receipts() to service_role;
select cron.schedule('telegram-command-retention','27 * * * *','select public.maintain_telegram_command_receipts()');
