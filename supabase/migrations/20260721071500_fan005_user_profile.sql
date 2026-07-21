-- FAN-005 first-set fan profile. Nicknames are private owner data and may only
-- be read or created through the service-role RPC boundary.

create table public.prohibited_nickname_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  catalog_version text not null,
  value_normalized text not null,
  match_mode text not null check (match_mode in ('exact', 'contains')),
  reason_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint prohibited_nickname_catalog_value_canonical
    check (
      catalog_version = 'fan-nickname-v1'
      and value_normalized = lower(normalize(value_normalized, NFKC))
      and value_normalized ~ '^[A-Za-z0-9가-힣]+$'
    ),
  constraint prohibited_nickname_catalog_unique
    unique (catalog_version, value_normalized, match_mode)
);

insert into public.prohibited_nickname_catalog
  (catalog_version, value_normalized, match_mode, reason_code)
values
  ('fan-nickname-v1', 'admin', 'contains', 'reserved'),
  ('fan-nickname-v1', 'administrator', 'contains', 'reserved'),
  ('fan-nickname-v1', 'system', 'contains', 'reserved'),
  ('fan-nickname-v1', 'operator', 'contains', 'reserved'),
  ('fan-nickname-v1', 'official', 'contains', 'reserved'),
  ('fan-nickname-v1', '관리자', 'contains', 'reserved'),
  ('fan-nickname-v1', '운영자', 'contains', 'reserved'),
  ('fan-nickname-v1', '공식', 'contains', 'reserved'),
  ('fan-nickname-v1', 'byus', 'contains', 'impersonation'),
  ('fan-nickname-v1', '바이어스', 'contains', 'impersonation'),
  ('fan-nickname-v1', 'kara', 'contains', 'impersonation'),
  ('fan-nickname-v1', '카라', 'contains', 'impersonation'),
  ('fan-nickname-v1', 'fuck', 'contains', 'abusive'),
  ('fan-nickname-v1', 'shit', 'contains', 'abusive'),
  ('fan-nickname-v1', 'bitch', 'contains', 'abusive'),
  ('fan-nickname-v1', '시발', 'contains', 'abusive'),
  ('fan-nickname-v1', '씨발', 'contains', 'abusive'),
  ('fan-nickname-v1', '병신', 'contains', 'abusive');

create table public.user_profiles (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  nickname text not null,
  nickname_normalized text not null,
  nickname_catalog_version text not null default 'fan-nickname-v1',
  created_at timestamptz not null default now(),
  constraint user_profiles_nickname_length
    check (length(nickname) between 2 and 16),
  constraint user_profiles_nickname_visible_characters
    check (nickname ~ '^[A-Za-z0-9가-힣]+$'),
  constraint user_profiles_nickname_normalized_canonical
    check (
      nickname = normalize(btrim(nickname), NFKC)
      and nickname_normalized = lower(nickname)
      and nickname_catalog_version = 'fan-nickname-v1'
    ),
  constraint user_profiles_nickname_normalized_unique unique (nickname_normalized)
);

create or replace function public.prevent_user_profile_mutation()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  raise exception 'FAN005_PROFILE_IMMUTABLE' using errcode = '23514';
end;
$$;

create trigger user_profiles_immutable
before update or delete on public.user_profiles
for each row execute function public.prevent_user_profile_mutation();

create or replace function public.get_owned_user_profile(p_app_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.user_profiles%rowtype;
begin
  if p_app_user_id is null then
    raise exception 'FAN005_USER_UNAVAILABLE' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.app_users u
    where u.id = p_app_user_id and u.status = 'active'
  ) then
    raise exception 'FAN005_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select p.* into v_profile
  from public.user_profiles p
  where p.app_user_id = p_app_user_id;

  return jsonb_build_object(
    'completed', found,
    'nickname', case when found then v_profile.nickname else null end
  );
end;
$$;

create or replace function public.set_owned_user_nickname(
  p_app_user_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_existing public.user_profiles%rowtype;
  v_nickname text;
  v_normalized text;
begin
  if p_app_user_id is null or p_nickname is null then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  -- NFKC is applied before validation so compatibility characters cannot
  -- evade uniqueness or the prohibited-name catalog.
  v_nickname := normalize(btrim(p_nickname), NFKC);
  v_normalized := lower(v_nickname);

  if length(v_nickname) not between 2 and 16
     or v_nickname !~ '^[A-Za-z0-9가-힣]+$' then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.prohibited_nickname_catalog c
    where c.catalog_version = 'fan-nickname-v1'
      and c.active
      and (
        (c.match_mode = 'exact' and v_normalized = c.value_normalized)
        or (c.match_mode = 'contains' and strpos(v_normalized, c.value_normalized) > 0)
      )
  ) then
    raise exception 'FAN005_NICKNAME_PROHIBITED' using errcode = '22023';
  end if;

  select * into v_user
  from public.app_users u
  where u.id = p_app_user_id
  for update;
  if not found or v_user.status <> 'active' then
    raise exception 'FAN005_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select * into v_existing
  from public.user_profiles p
  where p.app_user_id = p_app_user_id;
  if found then
    if v_existing.nickname_normalized = v_normalized then
      return jsonb_build_object('completed', true, 'nickname', v_existing.nickname);
    end if;
    raise exception 'FAN005_PROFILE_ALREADY_COMPLETED' using errcode = '23514';
  end if;

  begin
    insert into public.user_profiles (
      app_user_id, nickname, nickname_normalized, nickname_catalog_version
    ) values (
      p_app_user_id, v_nickname, v_normalized, 'fan-nickname-v1'
    );
  exception when unique_violation then
    raise exception 'FAN005_NICKNAME_TAKEN' using errcode = '23505';
  end;

  return jsonb_build_object('completed', true, 'nickname', v_nickname);
end;
$$;

alter table public.prohibited_nickname_catalog enable row level security;
alter table public.user_profiles enable row level security;

revoke all on public.prohibited_nickname_catalog from public, anon, authenticated, service_role;
revoke all on public.user_profiles from public, anon, authenticated, service_role;
grant select on public.prohibited_nickname_catalog to service_role;
grant select on public.user_profiles to service_role;

revoke all on function public.get_owned_user_profile(uuid) from public, anon, authenticated;
revoke all on function public.set_owned_user_nickname(uuid, text) from public, anon, authenticated;
grant execute on function public.get_owned_user_profile(uuid) to service_role;
grant execute on function public.set_owned_user_nickname(uuid, text) to service_role;

comment on table public.user_profiles is
  'Private immutable FAN-005 profile; nickname may be set once through the owner-scoped service RPC.';
comment on table public.prohibited_nickname_catalog is
  'Versioned server-side reserved, impersonation, and abusive nickname catalog.';
