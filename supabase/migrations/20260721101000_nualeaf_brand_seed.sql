-- Canonical NUALEAF brand master required by the KARA live MVP journey.

begin;

insert into public.brands (
  id, slug, status, logo_url, logo_alt, website_url, published_at
) values (
  '4e55414c-4541-4600-8000-000000000001',
  'nualeaf',
  'draft',
  '/images/brands/nualeaf-wordmark.svg',
  'NUALEAF',
  null,
  null
);

insert into public.brand_localizations (
  brand_id, locale, name, description
) values
  (
    '4e55414c-4541-4600-8000-000000000001',
    'ko',
    'NUALEAF',
    'KARA 팬과 함께하는 라이브 파트너 브랜드입니다.'
  ),
  (
    '4e55414c-4541-4600-8000-000000000001',
    'en',
    'NUALEAF',
    'The live partner brand joining KARA fans.'
  );

update public.brands
set status = 'published'
where id = '4e55414c-4541-4600-8000-000000000001';

commit;
