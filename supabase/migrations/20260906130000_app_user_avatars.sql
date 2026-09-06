-- Private, owner-scoped avatar state. Browser roles cannot read the table or
-- storage bucket; the BFF service role may use only the RPC surface below.

create type public.app_user_avatar_source as enum (
  'default', 'google', 'upload', 'character', 'removed'
);

create table public.app_user_avatars (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  initial_character_id text not null,
  selected_character_id text not null,
  source public.app_user_avatar_source not null default 'default',
  object_path text unique,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_avatars_initial_character check (initial_character_id in (
    'star-cream','star-pink','star-lavender',
    'heart-cream','heart-pink','heart-lavender',
    'fairy-cream','fairy-pink','fairy-lavender',
    'ghost-cream','ghost-pink','ghost-lavender'
  )),
  constraint app_user_avatars_selected_character check (selected_character_id in (
    'star-cream','star-pink','star-lavender',
    'heart-cream','heart-pink','heart-lavender',
    'fairy-cream','fairy-pink','fairy-lavender',
    'ghost-cream','ghost-pink','ghost-lavender'
  )),
  constraint app_user_avatars_image_consistency check (
    (source in ('google','upload') and object_path is not null)
    or (source in ('default','character','removed') and object_path is null)
  ),
  constraint app_user_avatars_object_path check (
    object_path is null
    or object_path ~ '^[0-9a-f-]{36}/[0-9]+-[0-9a-f-]{36}\.webp$'
  )
);

create trigger app_user_avatars_set_updated_at
before update on public.app_user_avatars
for each row execute function public.set_updated_at();

create or replace function public.reject_initial_avatar_character_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.initial_character_id is distinct from old.initial_character_id then
    raise exception 'AVATAR_INITIAL_CHARACTER_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger app_user_avatars_initial_character_immutable
before update on public.app_user_avatars
for each row execute function public.reject_initial_avatar_character_mutation();

create or replace function public.avatar_state_json(
  p_avatar public.app_user_avatars,
  p_previous_object_path text default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'initialCharacterId', p_avatar.initial_character_id,
    'characterId', p_avatar.selected_character_id,
    'source', p_avatar.source,
    'hasImage', p_avatar.object_path is not null,
    'revision', p_avatar.revision,
    'objectPath', p_avatar.object_path,
    'previousObjectPath', p_previous_object_path
  );
$$;

create or replace function public.ensure_owned_avatar(p_app_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_character text;
  v_avatar public.app_user_avatars;
begin
  if not exists (
    select 1 from public.app_users
    where id = p_app_user_id and status = 'active'
  ) then
    raise exception 'AVATAR_USER_UNAVAILABLE';
  end if;

  v_character := (array[
    'star-cream','star-pink','star-lavender',
    'heart-cream','heart-pink','heart-lavender',
    'fairy-cream','fairy-pink','fairy-lavender',
    'ghost-cream','ghost-pink','ghost-lavender'
  ])[1 + floor(random() * 12)::integer];

  insert into public.app_user_avatars (
    app_user_id, initial_character_id, selected_character_id
  ) values (p_app_user_id, v_character, v_character)
  on conflict (app_user_id) do nothing;

  select * into strict v_avatar
  from public.app_user_avatars
  where app_user_id = p_app_user_id;

  return public.avatar_state_json(v_avatar);
end;
$$;

create or replace function public.set_owned_avatar_character(
  p_app_user_id uuid,
  p_character_id text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_avatar public.app_user_avatars;
  v_previous_object_path text;
begin
  perform public.ensure_owned_avatar(p_app_user_id);
  if p_character_id not in (
    'star-cream','star-pink','star-lavender',
    'heart-cream','heart-pink','heart-lavender',
    'fairy-cream','fairy-pink','fairy-lavender',
    'ghost-cream','ghost-pink','ghost-lavender'
  ) then
    raise exception 'AVATAR_INVALID_CHARACTER';
  end if;

  select object_path into v_previous_object_path
  from public.app_user_avatars
  where app_user_id = p_app_user_id and revision = p_expected_revision
  for update;
  if not found then raise exception 'AVATAR_STALE_REVISION'; end if;

  update public.app_user_avatars
  set selected_character_id = p_character_id,
      source = 'character', object_path = null, revision = revision + 1
  where app_user_id = p_app_user_id
  returning * into strict v_avatar;
  return public.avatar_state_json(v_avatar, v_previous_object_path);
end;
$$;

create or replace function public.set_owned_avatar_image(
  p_app_user_id uuid,
  p_source public.app_user_avatar_source,
  p_object_path text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_avatar public.app_user_avatars;
  v_previous_object_path text;
  v_current_source public.app_user_avatar_source;
begin
  perform public.ensure_owned_avatar(p_app_user_id);
  if p_source not in ('google','upload') or p_object_path is null then
    raise exception 'AVATAR_INVALID_IMAGE_SOURCE';
  end if;
  if position(p_app_user_id::text || '/' in p_object_path) <> 1 then
    raise exception 'AVATAR_INVALID_OBJECT_OWNER';
  end if;

  select object_path, source into v_previous_object_path, v_current_source
  from public.app_user_avatars
  where app_user_id = p_app_user_id and revision = p_expected_revision
  for update;
  if not found then raise exception 'AVATAR_STALE_REVISION'; end if;
  if p_source = 'google' and v_current_source <> 'default' then
    raise exception 'AVATAR_GOOGLE_IMPORT_NOT_DEFAULT';
  end if;

  update public.app_user_avatars
  set source = p_source, object_path = p_object_path, revision = revision + 1
  where app_user_id = p_app_user_id
  returning * into strict v_avatar;
  return public.avatar_state_json(v_avatar, v_previous_object_path);
end;
$$;

create or replace function public.remove_owned_avatar(
  p_app_user_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_avatar public.app_user_avatars;
  v_previous_object_path text;
begin
  perform public.ensure_owned_avatar(p_app_user_id);
  select object_path into v_previous_object_path
  from public.app_user_avatars
  where app_user_id = p_app_user_id and revision = p_expected_revision
  for update;
  if not found then raise exception 'AVATAR_STALE_REVISION'; end if;

  update public.app_user_avatars
  set selected_character_id = initial_character_id,
      source = 'removed', object_path = null, revision = revision + 1
  where app_user_id = p_app_user_id
  returning * into strict v_avatar;
  return public.avatar_state_json(v_avatar, v_previous_object_path);
end;
$$;

alter table public.app_user_avatars enable row level security;
revoke all on table public.app_user_avatars from public, anon, authenticated, service_role;
revoke all on function public.reject_initial_avatar_character_mutation() from public, anon, authenticated, service_role;
revoke all on function public.avatar_state_json(public.app_user_avatars,text) from public, anon, authenticated, service_role;
revoke all on function public.ensure_owned_avatar(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_owned_avatar_character(uuid,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.set_owned_avatar_image(uuid,public.app_user_avatar_source,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.remove_owned_avatar(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.ensure_owned_avatar(uuid) to service_role;
grant execute on function public.set_owned_avatar_character(uuid,text,integer) to service_role;
grant execute on function public.set_owned_avatar_image(uuid,public.app_user_avatar_source,text,integer) to service_role;
grant execute on function public.remove_owned_avatar(uuid,integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fan-avatars', 'fan-avatars', false, 4194304, array['image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Service role manages private fan avatars"
on storage.objects for all
to service_role
using (bucket_id = 'fan-avatars')
with check (bucket_id = 'fan-avatars');
