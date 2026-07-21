-- G1 private CMS content model and intentionally narrow public projection.
-- Browser code does not access Supabase directly; the public grant exists so
-- access-control can be independently proven and contains only published DTOs.

create type public.content_status as enum ('draft', 'published');
create type public.content_locale as enum ('ko', 'en');
create type public.social_platform as enum ('youtube', 'tiktok', 'instagram');

create table public.celebrities (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  status public.content_status not null default 'draft',
  image_url text not null,
  image_position text not null default 'center',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint celebrities_slug_canonical
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint celebrities_image_url_safe
    check (image_url ~ '^/[^/]' or image_url ~ '^https://'),
  constraint celebrities_image_position_not_blank
    check (length(trim(image_position)) between 1 and 100),
  constraint celebrities_publication_timestamp
    check (
      (status = 'draft' and published_at is null)
      or (status = 'published' and published_at is not null)
    )
);

create table public.celebrity_localizations (
  celebrity_id uuid not null references public.celebrities(id) on delete cascade,
  locale public.content_locale not null,
  name text not null,
  summary text not null,
  image_alt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (celebrity_id, locale),
  constraint celebrity_localizations_name_complete
    check (length(trim(name)) between 1 and 120),
  constraint celebrity_localizations_summary_complete
    check (length(trim(summary)) between 1 and 1000),
  constraint celebrity_localizations_image_alt_complete
    check (length(trim(image_alt)) between 1 and 300)
);

create table public.themes (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  status public.content_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint themes_slug_canonical
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint themes_publication_timestamp
    check (
      (status = 'draft' and published_at is null)
      or (status = 'published' and published_at is not null)
    )
);

create table public.theme_localizations (
  theme_id uuid not null references public.themes(id) on delete cascade,
  locale public.content_locale not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (theme_id, locale),
  constraint theme_localizations_name_complete
    check (length(trim(name)) between 1 and 100)
);

create table public.celebrity_themes (
  celebrity_id uuid not null references public.celebrities(id) on delete cascade,
  theme_id uuid not null references public.themes(id) on delete restrict,
  position smallint not null default 0 check (position >= 0),
  primary key (celebrity_id, theme_id),
  unique (celebrity_id, position)
);

create table public.celebrity_social_links (
  celebrity_id uuid not null references public.celebrities(id) on delete cascade,
  platform public.social_platform not null,
  url text not null,
  position smallint not null default 0 check (position >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (celebrity_id, platform),
  unique (celebrity_id, position),
  constraint celebrity_social_links_https_only check (url ~ '^https://')
);

create index celebrities_published_slug_idx
  on public.celebrities (slug) where status = 'published';
create index themes_published_slug_idx
  on public.themes (slug) where status = 'published';
create index celebrity_themes_theme_id_idx on public.celebrity_themes (theme_id);

create trigger celebrities_set_updated_at
before update on public.celebrities
for each row execute function public.set_updated_at();
create trigger celebrity_localizations_set_updated_at
before update on public.celebrity_localizations
for each row execute function public.set_updated_at();
create trigger themes_set_updated_at
before update on public.themes
for each row execute function public.set_updated_at();
create trigger theme_localizations_set_updated_at
before update on public.theme_localizations
for each row execute function public.set_updated_at();
create trigger celebrity_social_links_set_updated_at
before update on public.celebrity_social_links
for each row execute function public.set_updated_at();

create function public.prepare_content_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status = 'draft' then
    new.published_at := now();
  elsif new.status = 'draft' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger celebrities_prepare_publication
before update of status on public.celebrities
for each row execute function public.prepare_content_publication();
create trigger themes_prepare_publication
before update of status on public.themes
for each row execute function public.prepare_content_publication();

create function public.assert_celebrity_publishable(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.content_status;
begin
  select status into current_status from public.celebrities where id = target_id;
  if current_status <> 'published' then return; end if;

  if (select count(*) from public.celebrity_localizations where celebrity_id = target_id) <> 2
     or exists (
       select 1 from unnest(enum_range(null::public.content_locale)) required(locale)
       where not exists (
         select 1 from public.celebrity_localizations l
         where l.celebrity_id = target_id and l.locale = required.locale
       )
     ) then
    raise exception 'published celebrity requires complete ko and en localizations';
  end if;

  if exists (
    select 1 from public.celebrity_themes ct
    join public.themes t on t.id = ct.theme_id
    where ct.celebrity_id = target_id and t.status <> 'published'
  ) then
    raise exception 'published celebrity cannot reference a draft theme';
  end if;
end;
$$;

create function public.assert_theme_publishable(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.content_status;
begin
  select status into current_status from public.themes where id = target_id;
  if current_status <> 'published' then return; end if;

  if (select count(*) from public.theme_localizations where theme_id = target_id) <> 2
     or exists (
       select 1 from unnest(enum_range(null::public.content_locale)) required(locale)
       where not exists (
         select 1 from public.theme_localizations l
         where l.theme_id = target_id and l.locale = required.locale
       )
     ) then
    raise exception 'published theme requires complete ko and en localizations';
  end if;
end;
$$;

create function public.validate_celebrity_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.assert_celebrity_publishable(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create function public.validate_celebrity_child_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.assert_celebrity_publishable(
    coalesce(new.celebrity_id, old.celebrity_id)
  );
  return coalesce(new, old);
end;
$$;

create function public.validate_theme_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.assert_theme_publishable(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create function public.validate_theme_child_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.assert_theme_publishable(coalesce(new.theme_id, old.theme_id));
  return coalesce(new, old);
end;
$$;

create constraint trigger celebrities_validate_publication
after insert or update on public.celebrities
deferrable initially deferred for each row
execute function public.validate_celebrity_publication_trigger();
create constraint trigger celebrity_localizations_validate_publication
after insert or update or delete on public.celebrity_localizations
deferrable initially deferred for each row
execute function public.validate_celebrity_child_trigger();
create constraint trigger celebrity_themes_validate_publication
after insert or update or delete on public.celebrity_themes
deferrable initially deferred for each row
execute function public.validate_celebrity_child_trigger();
create constraint trigger themes_validate_publication
after insert or update on public.themes
deferrable initially deferred for each row
execute function public.validate_theme_publication_trigger();
create constraint trigger theme_localizations_validate_publication
after insert or update or delete on public.theme_localizations
deferrable initially deferred for each row
execute function public.validate_theme_child_trigger();

alter table public.celebrities enable row level security;
alter table public.celebrity_localizations enable row level security;
alter table public.themes enable row level security;
alter table public.theme_localizations enable row level security;
alter table public.celebrity_themes enable row level security;
alter table public.celebrity_social_links enable row level security;

revoke all on public.celebrities from public, anon, authenticated;
revoke all on public.celebrity_localizations from public, anon, authenticated;
revoke all on public.themes from public, anon, authenticated;
revoke all on public.theme_localizations from public, anon, authenticated;
revoke all on public.celebrity_themes from public, anon, authenticated;
revoke all on public.celebrity_social_links from public, anon, authenticated;

grant select, insert, update, delete on public.celebrities to service_role;
grant select, insert, update, delete on public.celebrity_localizations to service_role;
grant select, insert, update, delete on public.themes to service_role;
grant select, insert, update, delete on public.theme_localizations to service_role;
grant select, insert, update, delete on public.celebrity_themes to service_role;
grant select, insert, update, delete on public.celebrity_social_links to service_role;

create view public.published_celebrities
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
  coalesce(social_data.items, '[]'::jsonb) as social_links
from public.celebrities c
join public.celebrity_localizations l on l.celebrity_id = c.id
left join lateral (
  select jsonb_agg(
    jsonb_build_object('slug', t.slug, 'name', tl.name)
    order by ct.position, t.slug
  ) as items
  from public.celebrity_themes ct
  join public.themes t on t.id = ct.theme_id and t.status = 'published'
  join public.theme_localizations tl on tl.theme_id = t.id and tl.locale = l.locale
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
  'Intentionally safe published-only DTO. Contains no UUIDs, draft status, audit fields, or private CMS metadata.';

revoke all on public.published_celebrities from public;
grant select on public.published_celebrities to anon, authenticated, service_role;

revoke all on function public.prepare_content_publication() from public, anon, authenticated;
revoke all on function public.assert_celebrity_publishable(uuid) from public, anon, authenticated;
revoke all on function public.assert_theme_publishable(uuid) from public, anon, authenticated;
revoke all on function public.validate_celebrity_publication_trigger() from public, anon, authenticated;
revoke all on function public.validate_celebrity_child_trigger() from public, anon, authenticated;
revoke all on function public.validate_theme_publication_trigger() from public, anon, authenticated;
revoke all on function public.validate_theme_child_trigger() from public, anon, authenticated;

comment on table public.celebrities is 'Private CMS celebrities; server service-role only.';
comment on table public.celebrity_localizations is 'Private localized CMS copy; server service-role only.';
comment on table public.themes is 'Private CMS themes; server service-role only.';
comment on table public.theme_localizations is 'Private localized theme copy; server service-role only.';
comment on table public.celebrity_social_links is 'Private CMS social-link source; only safe active links are projected.';
