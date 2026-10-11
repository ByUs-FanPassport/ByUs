do $$
begin
  if not exists (
    select 1 from public.app_user_avatars
    where app_user_id='a3000000-0000-4000-8000-000000000001'
      and initial_character_id='ghost-lavender'
      and selected_character_id='heart-pink'
      and source='upload'
      and object_path='a3000000-0000-4000-8000-000000000001/7-a3000000-0000-4000-8000-000000000002.webp'
      and revision=7
      and public_image_id is not null
  ) then
    raise exception 'existing avatar state was not preserved during upgrade';
  end if;
end $$;

create temporary table public_fan_avatar_upgrade_identity as
select public_image_id
from public.app_user_avatars
where app_user_id='a3000000-0000-4000-8000-000000000001';

\ir ../../migrations/20261011120000_public_fan_avatars.sql

do $$
begin
  if (select count(*) from public.app_user_avatars where app_user_id='a3000000-0000-4000-8000-000000000001') <> 1
    or (select public_image_id from public.app_user_avatars where app_user_id='a3000000-0000-4000-8000-000000000001')
      is distinct from (select public_image_id from public_fan_avatar_upgrade_identity) then
    raise exception 'public avatar migration is not identity-preserving when reapplied';
  end if;
end $$;
