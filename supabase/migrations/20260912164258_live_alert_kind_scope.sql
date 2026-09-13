-- Operations-only scope; NULL preserves existing unrestricted control behavior.
-- Set a LIVE allowlist while paused before opening a fresh release window.
alter table public.fan_notification_delivery_control add column allowed_kinds text[];
alter table public.fan_notification_delivery_control add constraint fan_delivery_allowed_kinds_valid
  check(allowed_kinds is null or (
    array_ndims(allowed_kinds)=1 and cardinality(allowed_kinds) between 1 and 5
    and array_position(allowed_kinds,null) is null
    and allowed_kinds <@ array['live_reserved','live_24h','live_10m','live_changed','live_cancelled']::text[]
  ));

create or replace function public.fan_notification_is_released(p_notification_id uuid,p_channel text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fan_notification_delivery_control c
    join public.fan_notifications n on n.id=p_notification_id
    where c.channel=p_channel and n.created_at>c.activated_at
      and (c.allowed_kinds is null or n.kind::text=any(c.allowed_kinds))
      and (c.mode='enabled' or (c.mode='test' and n.app_user_id=any(c.test_user_ids))))
$$;
revoke all on function public.fan_notification_is_released(uuid,text) from public,anon,authenticated,service_role;
