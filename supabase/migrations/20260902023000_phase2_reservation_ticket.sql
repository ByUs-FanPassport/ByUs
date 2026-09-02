-- Phase 2: Reservation Ticket is part of the canonical reservation transaction.
-- Existing historical reservations are not retroactively rewarded.

create function public.reward_live_reservation_ticket()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy_version integer;
begin
  select a.policy_version into strict policy_version from public.reward_policy_activation a where a.singleton=true;
  perform public.post_fan_ticket_entry(new.app_user_id,new.celebrity_id,'credit',1,
    'live_reservation',new.id,new.id,policy_version,null,null);
  return new;
end $$;
create trigger live_reservations_reward_ticket after insert on public.live_reservations
for each row execute function public.reward_live_reservation_ticket();

revoke all on function public.reward_live_reservation_ticket() from public,anon,authenticated,service_role;
