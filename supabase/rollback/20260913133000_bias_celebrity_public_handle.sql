begin;

alter table public.celebrities
  drop constraint if exists celebrities_slug_not_reserved;

alter table public.celebrities
  add constraint celebrities_slug_not_reserved check (slug <> all (array[
    'admin','api','benefits','c','celebrities','connect','creator','guide',
    'live','login','my','notifications','onboarding','pages','passports',
    'privacy','s','settings','stamps','terms','fonts','images','share','_next',
    '.well-known'
  ]::text[]));

comment on constraint celebrities_slug_not_reserved on public.celebrities is
  'Root public handles must not collide with top-level app routes or public asset directories.';

commit;
