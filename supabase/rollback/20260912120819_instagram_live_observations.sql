-- First disable INSTAGRAM_INTEGRATION_ENABLED / revert the application release.
begin;
drop function if exists public.instagram_read_live_observation(text,text);
drop function if exists public.instagram_finish_live_sync(uuid,uuid,uuid,timestamptz,jsonb);
drop function if exists public.instagram_claim_live_sync(integer);
drop trigger if exists instagram_clear_live_on_connection_change on public.instagram_connections;
drop function if exists public.instagram_clear_live_observation();
alter table public.instagram_connections drop column if exists live_observation,drop column if exists live_generation,
  drop column if exists live_next_sync_at,drop column if exists live_lease_id,drop column if exists live_lease_until;
commit;
