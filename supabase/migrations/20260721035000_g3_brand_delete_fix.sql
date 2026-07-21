-- Allow a brand's ON DELETE CASCADE localization cleanup to complete.
-- A missing parent produces NULL, which must be treated like a non-published
-- brand; published brands still require complete ko and en localizations.

create or replace function public.assert_brand_publishable(target_id uuid)
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

  if current_status is distinct from 'published' then return; end if;

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

revoke all on function public.assert_brand_publishable(uuid)
  from public, anon, authenticated;
grant execute on function public.assert_brand_publishable(uuid) to service_role;
