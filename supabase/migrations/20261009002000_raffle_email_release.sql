-- Operations explicitly release a published draw without widening the LIVE rollout.
create table public.benefit_draw_email_releases (
  draw_id uuid primary key references public.benefit_draw_publications(draw_id) on delete restrict,
  released_at timestamptz not null default pg_catalog.clock_timestamp(),
  reason text not null check (char_length(btrim(reason)) between 1 and 400)
);
alter table public.benefit_draw_email_releases enable row level security;
alter table public.benefit_draw_email_releases force row level security;
revoke all on public.benefit_draw_email_releases from public,anon,authenticated,service_role;

create or replace function public.fan_notification_is_released(p_notification_id uuid,p_channel text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fan_notification_delivery_control c
    join public.fan_notifications n on n.id=p_notification_id
    where c.channel=p_channel and n.created_at>c.activated_at
      and (c.mode='enabled' or (c.mode='test' and n.app_user_id=any(c.test_user_ids)))
      and (c.allowed_kinds is null or n.kind::text=any(c.allowed_kinds)
        or (p_channel='email' and n.kind='benefit_won' and exists(
          select 1 from public.benefit_draw_email_releases release
          join public.benefit_draw_winners winner on winner.draw_id=release.draw_id
          where winner.app_user_id=n.app_user_id and winner.benefit_id=n.benefit_id
            and n.source_key='benefit_won:'||winner.id::text||':1'))))
$$;
revoke all on function public.fan_notification_is_released(uuid,text) from public,anon,authenticated,service_role;
