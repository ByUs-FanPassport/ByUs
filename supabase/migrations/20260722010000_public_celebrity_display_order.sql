-- Public discovery keeps the explicit administrator order without exposing
-- private CMS identifiers, timestamps, status, or audit metadata.

create or replace view public.published_celebrities
with (security_barrier = true, security_invoker = false)
as
select
  c.slug,
  l.locale,
  l.name,
  l.summary,
  c.image_url,
  l.image_alt,
  c.image_position,
  coalesce(theme_data.items, '[]'::jsonb) as themes,
  coalesce(social_data.items, '[]'::jsonb) as social_links,
  c.display_order
from public.celebrities c
join public.celebrity_localizations l on l.celebrity_id = c.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object('slug', t.slug, 'name', tl.name)
    order by ct.position, t.slug
  ) as items
  from public.celebrity_themes ct
  join public.themes t on t.id = ct.theme_id and t.status = 'published'
  join public.theme_localizations tl
    on tl.theme_id = t.id and tl.locale = l.locale
  where ct.celebrity_id = c.id
) theme_data on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('platform', sl.platform, 'url', sl.url)
    order by sl.position, sl.platform
  ) as items
  from public.celebrity_social_links sl
  where sl.celebrity_id = c.id and sl.active
) social_data on true
where c.status = 'published';

comment on view public.published_celebrities is
  'Published-only DTO ordered by the administrator display order. Contains no UUIDs, draft status, timestamps, audit fields, or private CMS metadata.';

revoke all on public.published_celebrities from public;
grant select on public.published_celebrities to anon, authenticated, service_role;

create view public.published_celebrity_live_summaries
with (security_barrier = true, security_invoker = false)
as
select
  live.slug,
  celebrity.slug as celebrity_slug,
  localization.locale,
  localization.title,
  live.starts_at,
  effective.status as effective_status
from public.live_events live
join public.celebrities celebrity
  on celebrity.id = live.celebrity_id and celebrity.status = 'published'
join public.brands brand
  on brand.id = live.brand_id and brand.status = 'published'
join public.live_event_localizations localization
  on localization.live_event_id = live.id
cross join lateral (
  select public.live_effective_status_at(live.id, pg_catalog.now()) as status
) effective
where live.publication_status = 'published'
  and live.archived_at is null
  and effective.status in ('scheduled', 'live');

comment on view public.published_celebrity_live_summaries is
  'Published current/upcoming LIVE summaries for public celebrity discovery. Excludes ended and cancelled effective states.';

revoke all on public.published_celebrity_live_summaries from public;
grant select on public.published_celebrity_live_summaries
  to anon, authenticated, service_role;
