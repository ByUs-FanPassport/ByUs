-- Split the Elina and Changha LIVE events from the KARA-specific NUALEAF
-- partnership while preserving their stable event IDs and fan activity data.

begin;

insert into public.brands (
  id,
  slug,
  status,
  logo_url,
  logo_alt,
  website_url,
  published_at
) values (
  '42595553-0000-4000-8000-000000000001',
  'byus',
  'draft',
  '/images/guest-home/byus-wordmark.svg',
  'ByUs',
  'https://byus.kr',
  null
);

insert into public.brand_localizations (
  brand_id,
  locale,
  name,
  description
) values
  (
    '42595553-0000-4000-8000-000000000001',
    'ko',
    'ByUs',
    '팬과 셀럽의 LIVE 순간을 연결하는 ByUs 공식 브랜드입니다.'
  ),
  (
    '42595553-0000-4000-8000-000000000001',
    'en',
    'ByUs',
    'The official ByUs brand connecting fans with celebrity LIVE moments.'
  );

update public.brands
set status = 'published'
where id = '42595553-0000-4000-8000-000000000001';

do $$
declare
  affected integer;
begin
  update public.live_events
  set
    slug = 'elina-byus-live',
    brand_id = '42595553-0000-4000-8000-000000000001'
  where id = '287acc82-fb93-4492-8f27-15886f199d1e'
    and slug = 'elina-nualeaf-live'
    and brand_id = '4e55414c-4541-4600-8000-000000000001';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Elina unexpected production live record';
  end if;

  update public.live_event_localizations
  set
    title = case locale
      when 'ko' then 'Elina × ByUs LIVE'
      when 'en' then 'Elina × ByUs LIVE'
    end,
    summary = case locale
      when 'ko' then 'Elina와 ByUs가 함께하는 예정 LIVE를 만나보세요.'
      when 'en' then 'Join the upcoming Elina × ByUs LIVE.'
    end
  where live_event_id = '287acc82-fb93-4492-8f27-15886f199d1e'
    and locale in ('ko', 'en');

  get diagnostics affected = row_count;
  if affected <> 2 then
    raise exception 'Elina unexpected production localization count';
  end if;
end;
$$;

do $$
declare
  affected integer;
begin
  update public.live_events
  set
    slug = 'changha-byus-live',
    brand_id = '42595553-0000-4000-8000-000000000001'
  where id = '091e2c9c-3599-4571-934e-019b59875731'
    and slug = 'changha-nualeaf-live'
    and brand_id = '4e55414c-4541-4600-8000-000000000001';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Changha unexpected production live record';
  end if;

  update public.live_event_localizations
  set
    title = case locale
      when 'ko' then 'Changha × ByUs LIVE'
      when 'en' then 'Changha × ByUs LIVE'
    end,
    summary = case locale
      when 'ko' then 'Changha와 ByUs가 함께하는 예정 LIVE를 만나보세요.'
      when 'en' then 'Join the upcoming Changha × ByUs LIVE.'
    end
  where live_event_id = '091e2c9c-3599-4571-934e-019b59875731'
    and locale in ('ko', 'en');

  get diagnostics affected = row_count;
  if affected <> 2 then
    raise exception 'Changha unexpected production localization count';
  end if;
end;
$$;

commit;
