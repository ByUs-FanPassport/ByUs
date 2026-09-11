-- Local disposable-database fixture for proving migration-time backfill.
-- Load after resetting through 20260911130228 and before migration up.
begin;

insert into public.celebrities (
  id, slug, status, image_url, published_at, ever_published_at, roles, primary_role
) values (
  'a9132406-0000-4000-8000-000000000001',
  'welcome-upgrade-fixture',
  'published',
  '/fixture.webp',
  now(),
  now(),
  '{creator}',
  'creator'
);

insert into public.celebrity_localizations (
  celebrity_id, locale, name, summary, image_alt
) values
  ('a9132406-0000-4000-8000-000000000001', 'ko', '기존 셀럽', '업그레이드 검증', '기존 셀럽'),
  ('a9132406-0000-4000-8000-000000000001', 'en', 'Existing Creator', 'Upgrade verification', 'Existing Creator');

set constraints all immediate;
commit;
