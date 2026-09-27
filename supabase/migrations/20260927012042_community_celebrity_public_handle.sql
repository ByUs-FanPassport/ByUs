-- Reserve the community hub without renaming or modifying any creator.
begin;
set local lock_timeout = '5s';
do $$
begin
  if exists (select 1 from public.celebrities where slug = 'community') then
    raise exception 'reserved celebrity handle conflicts: community' using errcode = '23514';
  end if;
end $$;
alter table public.celebrities drop constraint celebrities_slug_not_reserved;
alter table public.celebrities add constraint celebrities_slug_not_reserved check (slug <> all (array[
  'admin','api','benefits','bias','c','celebrities','community','connect','creator','go','guide',
  'live','login','my','notifications','o','onboarding','pages','passports',
  'privacy','s','settings','stamps','t','terms','fonts','images','share','_next',
  '.well-known'
]::text[]));
comment on constraint celebrities_slug_not_reserved on public.celebrities is
  'Root public handles must not collide with top-level app routes or public asset directories.';
commit;
