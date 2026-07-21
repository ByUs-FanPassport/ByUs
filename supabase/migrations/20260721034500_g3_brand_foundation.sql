-- G3 private brand CMS foundation.
-- Brand projection and live relationships intentionally land with the live
-- slice; this migration establishes only the reusable, bilingual CMS source.

create table public.brands (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  status public.content_status not null default 'draft',
  logo_url text not null,
  logo_alt text not null,
  website_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_slug_canonical
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint brands_logo_url_safe
    check (
      logo_url = trim(logo_url)
      and logo_url !~ '[@[:space:]]'
      and (
        logo_url ~ '^/[^/[:space:]][^[:space:]]*$'
        or logo_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/[^[:space:]]+$'
      )
    ),
  constraint brands_logo_alt_complete
    check (length(trim(logo_alt)) between 1 and 300),
  constraint brands_website_url_canonical_https
    check (
      website_url is null
      or (
        website_url = trim(website_url)
        and website_url !~ '[@[:space:]]'
        and website_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(/[^[:space:]]*)?$'
      )
    ),
  constraint brands_publication_timestamp
    check (
      (status = 'draft' and published_at is null)
      or (status = 'published' and published_at is not null)
    )
);

create table public.brand_localizations (
  brand_id uuid not null references public.brands(id) on delete cascade,
  locale public.content_locale not null,
  name text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, locale),
  constraint brand_localizations_name_complete
    check (length(trim(name)) between 1 and 120),
  constraint brand_localizations_description_complete
    check (length(trim(description)) between 1 and 1000)
);

create index brands_published_slug_idx
  on public.brands (slug) where status = 'published';

create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

create trigger brand_localizations_set_updated_at
before update on public.brand_localizations
for each row execute function public.set_updated_at();

create trigger brands_prepare_publication
before update of status on public.brands
for each row execute function public.prepare_content_publication();

create function public.assert_brand_publishable(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.content_status;
begin
  select status into current_status
  from public.brands
  where id = target_id;

  if current_status <> 'published' then return; end if;

  if (select count(*) from public.brand_localizations where brand_id = target_id) <> 2
     or exists (
       select 1
       from unnest(enum_range(null::public.content_locale)) required(locale)
       where not exists (
         select 1
         from public.brand_localizations localization
         where localization.brand_id = target_id
           and localization.locale = required.locale
       )
     ) then
    raise exception 'published brand requires complete ko and en localizations';
  end if;
end;
$$;

create function public.validate_brand_publication_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_brand_publishable(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

create function public.validate_brand_localization_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.brand_id is distinct from new.brand_id then
    perform public.assert_brand_publishable(old.brand_id);
    perform public.assert_brand_publishable(new.brand_id);
  else
    perform public.assert_brand_publishable(
      coalesce(new.brand_id, old.brand_id)
    );
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger brands_validate_publication
after insert or update on public.brands
deferrable initially deferred for each row
execute function public.validate_brand_publication_trigger();

create constraint trigger brand_localizations_validate_publication
after insert or update or delete on public.brand_localizations
deferrable initially deferred for each row
execute function public.validate_brand_localization_trigger();

alter table public.brands enable row level security;
alter table public.brand_localizations enable row level security;

revoke all on public.brands from public, anon, authenticated;
revoke all on public.brand_localizations from public, anon, authenticated;

grant select, insert, update, delete on public.brands to service_role;
grant select, insert, update, delete on public.brand_localizations to service_role;
grant execute on function public.assert_brand_publishable(uuid) to service_role;

revoke all on function public.assert_brand_publishable(uuid)
  from public, anon, authenticated;
revoke all on function public.validate_brand_publication_trigger()
  from public, anon, authenticated;
revoke all on function public.validate_brand_localization_trigger()
  from public, anon, authenticated;

comment on table public.brands is
  'Private CMS brands; server service-role only until a live-safe projection is introduced.';
comment on table public.brand_localizations is
  'Private bilingual brand copy; published brands require complete ko and en rows.';
