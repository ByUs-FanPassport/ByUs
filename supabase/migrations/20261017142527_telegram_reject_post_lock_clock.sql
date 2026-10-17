-- Check lease expiry using the time after any settings-lock wait.
create or replace function public.reject_telegram_alert_batch(p_batch_id uuid,p_chat_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg public.telegram_alert_settings; t timestamptz; n integer;
begin
  select * into cfg from public.telegram_alert_settings where singleton for update;
  t:=clock_timestamp();
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
