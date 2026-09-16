-- Keep the existing reward for every other LIVE. This event has no attendance
-- yet; historical credits and replay/idempotency keys remain untouched.
alter table public.live_events
  add column attendance_ticket_amount integer not null default 2
  check (attendance_ticket_amount between 1 and 1000);

update public.live_events l
set attendance_ticket_amount = 10
from public.celebrities c
where l.celebrity_id = c.id
  and c.slug = 'elina'
  and l.slug = 'elina-banksy-instagram-20260918'
  and l.archived_at is null;

create or replace function public.reward_live_attendance_ticket()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy_version integer; ticket_amount integer;
begin
  select l.attendance_ticket_amount into strict ticket_amount
  from public.live_events l where l.id = new.live_event_id;
  select a.policy_version into strict policy_version
  from public.reward_policy_activation a where a.singleton=true;
  perform public.post_fan_ticket_entry(new.app_user_id,new.celebrity_id,'credit',ticket_amount,
    'live_attendance',new.id,new.id,policy_version,null,null);
  return new;
end $$;

-- Preserve the trigger-only execution boundary from the original migration.
revoke all on function public.reward_live_attendance_ticket() from public,anon,authenticated,service_role;

comment on column public.live_events.attendance_ticket_amount is
  'Raffle tickets granted once by the canonical attendance insert trigger. Default 2; Elina Banksy 2026-09-18 grants 10.';
