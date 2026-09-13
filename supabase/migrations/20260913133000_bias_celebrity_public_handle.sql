-- Reserve /bias for the shared promotion page without changing any celebrity
-- identifiers or publication state. Existing collisions stop the migration.
begin;

do $$
begin
  if exists (select 1 from public.celebrities where slug = 'bias') then
    raise exception 'reserved celebrity handle conflicts: bias'
      using errcode = '23514';
  end if;
end $$;

alter table public.celebrities
  drop constraint celebrities_slug_not_reserved;

alter table public.celebrities
  add constraint celebrities_slug_not_reserved check (slug <> all (array[
    'admin','api','benefits','bias','c','celebrities','connect','creator','guide',
    'live','login','my','notifications','onboarding','pages','passports',
    'privacy','s','settings','stamps','terms','fonts','images','share','_next',
    '.well-known'
  ]::text[]));

comment on constraint celebrities_slug_not_reserved on public.celebrities is
  'Root public handles must not collide with top-level app routes or public asset directories.';

commit;
