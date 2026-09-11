-- Explicitly authorized operator-room identity. Resolve from source facts at
-- claim time instead of duplicating email/nickname in retained outbox records.
-- Keep the previous claim RPC available during rolling deployment/rollback;
-- both versions share the same room lock, leases and send fence.
create function public.claim_telegram_alert_batch_with_identity(p_chat_id text) returns jsonb
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
revoke all on function public.claim_telegram_alert_batch_with_identity(text) from public,anon,authenticated;
grant execute on function public.claim_telegram_alert_batch_with_identity(text) to service_role;
