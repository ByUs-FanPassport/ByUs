-- AUTH-006: owner-scoped nickname changes. Issued credentials remain immutable:
-- nickname is profile-only data and is never copied into token metadata.

drop trigger if exists user_profiles_immutable on public.user_profiles;
drop function if exists public.prevent_user_profile_mutation();

create or replace function public.protect_user_profile_identity()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.app_user_id <> old.app_user_id
     or new.created_at <> old.created_at
     or new.nickname_catalog_version <> old.nickname_catalog_version then
    raise exception 'FAN020_PROFILE_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger user_profiles_identity_immutable
before update or delete on public.user_profiles
for each row execute function public.protect_user_profile_identity();

create or replace function public.rename_owned_user_nickname(
  p_app_user_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nickname text;
  v_normalized text;
begin
  if p_app_user_id is null or p_nickname is null then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  v_nickname := normalize(btrim(p_nickname), NFKC);
  v_normalized := lower(v_nickname);

  if length(v_nickname) not between 2 and 16
     or v_nickname !~ '^[A-Za-z0-9가-힣]+$' then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.prohibited_nickname_catalog c
    where c.catalog_version = 'fan-nickname-v1' and c.active
      and ((c.match_mode = 'exact' and v_normalized = c.value_normalized)
        or (c.match_mode = 'contains' and strpos(v_normalized, c.value_normalized) > 0))
  ) then
    raise exception 'FAN005_NICKNAME_PROHIBITED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.app_users u
    where u.id = p_app_user_id and u.status = 'active'
    for update
  ) or not exists (
    select 1 from public.user_profiles p where p.app_user_id = p_app_user_id
  ) then
    raise exception 'FAN005_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  begin
    update public.user_profiles
    set nickname = v_nickname, nickname_normalized = v_normalized
    where app_user_id = p_app_user_id;
  exception when unique_violation then
    raise exception 'FAN005_NICKNAME_TAKEN' using errcode = '23505';
  end;

  return jsonb_build_object('completed', true, 'nickname', v_nickname);
end;
$$;

revoke all on function public.rename_owned_user_nickname(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_owned_user_nickname(uuid, text) to service_role;

comment on function public.rename_owned_user_nickname(uuid, text) is
  'AUTH-006 owner-scoped profile rename. Credential metadata and wallet ownership are not mutated.';
comment on table public.user_profiles is
  'Private fan profile. Creation and owner-scoped rename are available only through security-definer RPCs.';
