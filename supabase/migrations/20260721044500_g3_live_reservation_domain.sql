-- G3 private live CMS and reservation ownership foundation.
-- Availability endpoint semantics, override transition rules, public projections,
-- and reservation issuance RPCs intentionally belong to later migrations.

create type public.live_content_status as enum ('scheduled', 'live', 'ended', 'cancelled');

create table public.live_events (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  brand_id uuid not null references public.brands(id) on delete restrict,
  publication_status public.content_status not null default 'draft',
  content_status public.live_content_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reservation_opens_at timestamptz not null,
  reservation_closes_at timestamptz not null,
  youtube_url text not null,
  approved_hero_url text not null,
  fan_code_hash text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, celebrity_id),
  constraint live_events_slug_canonical
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint live_events_schedule_ordered
    check (
      reservation_opens_at < reservation_closes_at
      and reservation_closes_at <= starts_at
      and starts_at < ends_at
    ),
  constraint live_events_youtube_url_allowlist
    check (
      youtube_url = trim(youtube_url)
      and youtube_url !~ '[@[:space:]]'
      and youtube_url ~ '^https://(?:(?:www\.)?youtube\.com/(?:watch\?|live/|embed/)|youtu\.be/)[A-Za-z0-9_?&=%+.,~:/#-]+$'
    ),
  constraint live_events_approved_hero_url_safe
    check (
      approved_hero_url = trim(approved_hero_url)
      and approved_hero_url !~ '[@[:space:]]'
      and (
        approved_hero_url ~ '^/[^/[:space:]][^[:space:]]*$'
        or approved_hero_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/[^[:space:]]+$'
      )
    ),
  constraint live_events_fan_code_hash_complete
    check (
      fan_code_hash = trim(fan_code_hash)
      and length(fan_code_hash) between 32 and 500
    ),
  constraint live_events_publication_timestamp
    check (
      (publication_status = 'draft' and published_at is null)
      or (publication_status = 'published' and published_at is not null)
    )
);

create table public.live_event_localizations (
  live_event_id uuid not null references public.live_events(id) on delete cascade,
  locale public.content_locale not null,
  title text not null,
  summary text not null,
  hero_alt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (live_event_id, locale),
  constraint live_event_localizations_title_complete
    check (length(trim(title)) between 1 and 160),
  constraint live_event_localizations_summary_complete
    check (length(trim(summary)) between 1 and 1200),
  constraint live_event_localizations_hero_alt_complete
    check (length(trim(hero_alt)) between 1 and 300)
);

create table public.live_status_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  effective_status public.live_content_status not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  reason text not null,
  actor_admin_allowlist_id uuid not null
    references public.admin_allowlist(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint live_status_overrides_effective_interval
    check (effective_until is null or effective_from < effective_until),
  constraint live_status_overrides_reason_complete
    check (length(trim(reason)) between 1 and 1000)
);

create table public.live_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  passport_id uuid not null,
  idempotency_key uuid not null unique,
  reserved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (app_user_id, live_event_id),
  constraint live_reservations_live_celebrity_fk
    foreign key (live_event_id, celebrity_id)
    references public.live_events (id, celebrity_id) on delete restrict,
  constraint live_reservations_passport_owner_fk
    foreign key (passport_id, app_user_id, celebrity_id)
    references public.fan_passports (id, app_user_id, celebrity_id) on delete restrict
);

create index live_events_celebrity_schedule_idx
  on public.live_events (celebrity_id, starts_at desc);
create index live_events_brand_schedule_idx
  on public.live_events (brand_id, starts_at desc);
create index live_events_published_schedule_idx
  on public.live_events (content_status, starts_at)
  where publication_status = 'published';
create index live_status_overrides_event_effective_idx
  on public.live_status_overrides (live_event_id, effective_from desc, created_at desc);
create index live_reservations_event_reserved_idx
  on public.live_reservations (live_event_id, reserved_at desc);
create index live_reservations_owner_reserved_idx
  on public.live_reservations (app_user_id, reserved_at desc);

create trigger live_events_set_updated_at
before update on public.live_events
for each row execute function public.set_updated_at();

create trigger live_event_localizations_set_updated_at
before update on public.live_event_localizations
for each row execute function public.set_updated_at();

create function public.prepare_live_event_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.publication_status = 'published'
     and old.publication_status = 'draft' then
    new.published_at := now();
  elsif new.publication_status = 'draft' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger live_events_prepare_publication
before update of publication_status on public.live_events
for each row execute function public.prepare_live_event_publication();

create function public.assert_live_event_publishable(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_publication_status public.content_status;
  current_celebrity_status public.content_status;
  current_brand_status public.content_status;
begin
  select
    live_event.publication_status,
    celebrity.status,
    brand.status
  into
    current_publication_status,
    current_celebrity_status,
    current_brand_status
  from public.live_events live_event
  join public.celebrities celebrity on celebrity.id = live_event.celebrity_id
  join public.brands brand on brand.id = live_event.brand_id
  where live_event.id = target_id;

  if current_publication_status is distinct from 'published' then return; end if;

  if current_celebrity_status is distinct from 'published' then
    raise exception 'published live event requires a published celebrity';
  end if;

  if current_brand_status is distinct from 'published' then
    raise exception 'published live event requires a published brand';
  end if;

  if (
    select count(*)
    from public.live_event_localizations
    where live_event_id = target_id
  ) <> 2
  or exists (
    select 1
    from unnest(enum_range(null::public.content_locale)) required(locale)
    where not exists (
      select 1
      from public.live_event_localizations localization
      where localization.live_event_id = target_id
        and localization.locale = required.locale
    )
  ) then
    raise exception 'published live event requires complete ko and en localizations';
  end if;
end;
$$;

create function public.validate_live_event_publication_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_live_event_publishable(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create function public.validate_live_event_localization_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.live_event_id is distinct from new.live_event_id then
    perform public.assert_live_event_publishable(old.live_event_id);
    perform public.assert_live_event_publishable(new.live_event_id);
  else
    perform public.assert_live_event_publishable(
      coalesce(new.live_event_id, old.live_event_id)
    );
  end if;
  return coalesce(new, old);
end;
$$;

create function public.validate_live_events_for_celebrity_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live_event_id uuid;
begin
  for live_event_id in
    select id
    from public.live_events
    where celebrity_id = new.id
      and publication_status = 'published'
  loop
    perform public.assert_live_event_publishable(live_event_id);
  end loop;
  return new;
end;
$$;

create function public.validate_live_events_for_brand_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live_event_id uuid;
begin
  for live_event_id in
    select id
    from public.live_events
    where brand_id = new.id
      and publication_status = 'published'
  loop
    perform public.assert_live_event_publishable(live_event_id);
  end loop;
  return new;
end;
$$;

create constraint trigger live_events_validate_publication
after insert or update on public.live_events
deferrable initially deferred for each row
execute function public.validate_live_event_publication_trigger();

create constraint trigger live_event_localizations_validate_publication
after insert or update or delete on public.live_event_localizations
deferrable initially deferred for each row
execute function public.validate_live_event_localization_trigger();

create constraint trigger celebrities_validate_published_live_events
after update of status on public.celebrities
deferrable initially deferred for each row
execute function public.validate_live_events_for_celebrity_trigger();

create constraint trigger brands_validate_published_live_events
after update of status on public.brands
deferrable initially deferred for each row
execute function public.validate_live_events_for_brand_trigger();

alter table public.live_events enable row level security;
alter table public.live_event_localizations enable row level security;
alter table public.live_status_overrides enable row level security;
alter table public.live_reservations enable row level security;

revoke all on public.live_events from public, anon, authenticated;
revoke all on public.live_event_localizations from public, anon, authenticated;
revoke all on public.live_status_overrides from public, anon, authenticated;
revoke all on public.live_reservations from public, anon, authenticated;

grant select, insert, update, delete on public.live_events to service_role;
grant select, insert, update, delete on public.live_event_localizations to service_role;
grant select, insert on public.live_status_overrides to service_role;
grant select, insert on public.live_reservations to service_role;
grant execute on function public.assert_live_event_publishable(uuid) to service_role;

revoke all on function public.prepare_live_event_publication()
  from public, anon, authenticated;
revoke all on function public.assert_live_event_publishable(uuid)
  from public, anon, authenticated;
revoke all on function public.validate_live_event_publication_trigger()
  from public, anon, authenticated;
revoke all on function public.validate_live_event_localization_trigger()
  from public, anon, authenticated;
revoke all on function public.validate_live_events_for_celebrity_trigger()
  from public, anon, authenticated;
revoke all on function public.validate_live_events_for_brand_trigger()
  from public, anon, authenticated;

comment on table public.live_events is
  'Private bilingual live CMS source with distinct publication and lifecycle status; no browser grants.';
comment on column public.live_events.fan_code_hash is
  'Private verifier hash only; plaintext Fan Codes must never be persisted.';
comment on table public.live_event_localizations is
  'Private KO/EN live copy; published events require exactly one row per supported locale.';
comment on table public.live_status_overrides is
  'Append-only administrator-authored effective status facts; transition policy is enforced by a later server boundary.';
comment on table public.live_reservations is
  'Append-only idempotent reservation ownership facts; cancellation is outside MVP scope.';
