-- Phase 3 monthly LIVE calendar projection. Month boundaries are calculated by
-- the application in Asia/Seoul and passed as a half-open UTC interval.

create index live_events_calendar_schedule_idx
  on public.live_events (starts_at, id)
  where publication_status = 'published'
    and archived_at is null;

create function public.get_live_calendar_month(
  p_app_user_id uuid,
  p_locale public.content_locale,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz
)
returns table (
  "id" uuid,
  "slug" text,
  "startsAt" timestamptz,
  "effectiveStatus" public.live_content_status,
  "title" text,
  "celebrity" jsonb,
  "reservationState" text,
  "hasBenefit" boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_starts_at is null
     or p_ends_at is null
     or p_now is null
     or p_starts_at >= p_ends_at
     or p_ends_at > p_starts_at + interval '32 days' then
    raise exception 'invalid LIVE calendar interval';
  end if;

  return query
  select
    live.id as "id",
    live.slug as "slug",
    live.starts_at as "startsAt",
    -- live_effective_status_at owns canonical live_status_overrides precedence,
    -- retaining scheduled/live/ended/cancelled and the current override interval.
    public.live_effective_status_at(live.id, p_now) as "effectiveStatus",
    live_localization.title as "title",
    pg_catalog.jsonb_build_object(
      'name', celebrity_localization.name,
      'image', celebrity.image_url
    ) as "celebrity",
    case
      when p_app_user_id is null then null
      when exists (
        select 1
        from public.live_reservations reservation
        where reservation.live_event_id = live.id
          and reservation.app_user_id = p_app_user_id
      ) then 'reserved'
      else 'not_reserved'
    end as "reservationState",
    null::boolean as "hasBenefit"
  from public.live_events live
  join public.live_event_localizations live_localization
    on live_localization.live_event_id = live.id
   and live_localization.locale = p_locale
  join public.celebrities celebrity
    on celebrity.id = live.celebrity_id
   and celebrity.status = 'published'
  join public.celebrity_localizations celebrity_localization
    on celebrity_localization.celebrity_id = celebrity.id
   and celebrity_localization.locale = p_locale
  where live.publication_status = 'published'
    and live.archived_at is null
    and live.starts_at >= p_starts_at
    and live.starts_at < p_ends_at
  order by live.starts_at, live.slug, live.id;
end;
$$;

revoke all on function public.get_live_calendar_month(
  uuid,
  public.content_locale,
  timestamptz,
  timestamptz,
  timestamptz
) from public,anon,authenticated;

grant execute on function public.get_live_calendar_month(
  uuid,
  public.content_locale,
  timestamptz,
  timestamptz,
  timestamptz
) to service_role;
