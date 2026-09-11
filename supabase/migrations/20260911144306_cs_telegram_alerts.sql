-- CS metadata only: never copy inquiry subject/body or requester identity.
-- Legacy claim functions skip CS so rolling deployment and rollback stay safe.
alter table public.telegram_alert_outbox drop constraint telegram_alert_outbox_kind_check;
alter table public.telegram_alert_outbox add constraint telegram_alert_outbox_kind_check
  check(kind in ('member_joined','fan_joined','live_reserved','live_attended','draw_published','cs_inquiry_created','cs_user_replied'));

create function public.capture_telegram_cs_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; event_kind text;
begin
  if new.actor_admin_allowlist_id is not null then return new; end if;
  select * into cfg from public.telegram_alert_settings where singleton;
  if not coalesce(cfg.enabled,false) or new.created_at<cfg.activated_at then return new; end if;
  event_kind:=case when new.operation='create' then 'cs_inquiry_created' else 'cs_user_replied' end;
  insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at)
    values(event_kind,new.id,cfg.activation_id,cfg.chat_id,new.created_at)
    on conflict(kind,source_id) do nothing;
  return new;
exception when others then
  raise log 'TELEGRAM_CS_CAPTURE_FAILED sqlstate=%',sqlstate;
  return new;
end $$;
revoke all on function public.capture_telegram_cs_message() from public,anon,authenticated,service_role;
create trigger cs_messages_telegram_alert after insert on public.cs_messages
  for each row execute function public.capture_telegram_cs_message();

create or replace function public.claim_telegram_alert_batch(p_chat_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; token uuid:=gen_random_uuid(); result jsonb; t timestamptz:=clock_timestamp();
begin
  perform public.maintain_telegram_alerts();
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.next_send_at>t
    or (cfg.lease_expires_at is not null and cfg.lease_expires_at>t) then return null; end if;
  with candidates as (
    select id from public.telegram_alert_outbox where status='pending' and available_at<=t
      and kind not in ('cs_inquiry_created','cs_user_replied')
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


create or replace function public.claim_telegram_alert_batch_with_identity(p_chat_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; token uuid:=gen_random_uuid(); result jsonb; t timestamptz:=clock_timestamp();
begin
  perform public.maintain_telegram_alerts();
  select * into cfg from public.telegram_alert_settings where singleton for update;
  if not cfg.enabled or cfg.chat_id is distinct from p_chat_id or cfg.next_send_at>t
    or (cfg.lease_expires_at is not null and cfg.lease_expires_at>t) then return null; end if;
  with candidates as (
    select id from public.telegram_alert_outbox where status='pending' and available_at<=t
      and kind not in ('cs_inquiry_created','cs_user_replied')
      and activation_id=cfg.activation_id and chat_id=cfg.chat_id and attempt_count<3
      order by created_at,id for update skip locked limit 5
  ), claimed as (
    update public.telegram_alert_outbox o set status='claimed',batch_id=token,lease_expires_at=t+interval '60 seconds'
      from candidates c where o.id=c.id returning o.*
  ) select jsonb_build_object('batch_id',token,'alerts',jsonb_agg(jsonb_build_object(
      'kind',c.kind,'creator_name',c.creator_name,'live_title',c.live_title,
      'winner_count',c.winner_count,'occurred_at',c.occurred_at,
      'actor_name',p.nickname,'actor_email',u.verified_email
    ) order by c.created_at,c.id)) into result
    from claimed c
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

create function public.claim_telegram_alert_batch_with_cs(p_chat_id text) returns jsonb
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
      then jsonb_build_object('inquiry_id',m.inquiry_id) else '{}'::jsonb end order by c.created_at,c.id)) into result
    from claimed c
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

revoke all on function public.claim_telegram_alert_batch_with_cs(text) from public,anon,authenticated;
grant execute on function public.claim_telegram_alert_batch_with_cs(text) to service_role;
