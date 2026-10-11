insert into public.app_users(id,privy_user_id,verified_email,status)
values(
  'a3000000-0000-4000-8000-000000000001',
  'did:privy:public-avatar-upgrade',
  'public-avatar-upgrade@byus.test',
  'active'
);

insert into public.app_user_avatars(
  app_user_id,initial_character_id,selected_character_id,source,object_path,revision
) values(
  'a3000000-0000-4000-8000-000000000001',
  'ghost-lavender',
  'heart-pink',
  'upload',
  'a3000000-0000-4000-8000-000000000001/7-a3000000-0000-4000-8000-000000000002.webp',
  7
);
