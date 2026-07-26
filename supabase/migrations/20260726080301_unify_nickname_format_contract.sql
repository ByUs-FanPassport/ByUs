-- FAN-005 / AUTH-006: align persisted nickname validation with the public
-- onboarding contract. Existing profile, Passport, Stamp, and Wallet data are
-- intentionally left unchanged.

alter table public.user_profiles
  drop constraint user_profiles_nickname_visible_characters;

alter table public.user_profiles
  add constraint user_profiles_nickname_visible_characters
  check (nickname ~ '^[A-Za-z0-9가-힣 _-]+$');

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
  v_prohibited_candidate text;
begin
  if p_app_user_id is null or p_nickname is null then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  v_nickname := btrim(normalize(p_nickname, NFKC));
  v_normalized := lower(v_nickname);
  v_prohibited_candidate := regexp_replace(v_normalized, '[ _-]+', '', 'g');

  if length(v_nickname) not between 2 and 16
     or v_nickname !~ '^[A-Za-z0-9가-힣 _-]+$' then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.prohibited_nickname_catalog c
    where c.catalog_version = 'fan-nickname-v1'
      and c.active
      and (
        (
          c.match_mode = 'exact'
          and (
            v_normalized = c.value_normalized
            or v_prohibited_candidate = c.value_normalized
          )
        )
        or (
          c.match_mode = 'contains'
          and (
            strpos(v_normalized, c.value_normalized) > 0
            or strpos(v_prohibited_candidate, c.value_normalized) > 0
          )
        )
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
      return jsonb_build_object(
        'completed',
        true,
        'nickname',
        v_existing.nickname
      );
    end if;
    raise exception 'FAN005_PROFILE_ALREADY_COMPLETED' using errcode = '23514';
  end if;

  begin
    insert into public.user_profiles (
      app_user_id,
      nickname,
      nickname_normalized,
      nickname_catalog_version
    ) values (
      p_app_user_id,
      v_nickname,
      v_normalized,
      'fan-nickname-v1'
    );
  exception when unique_violation then
    raise exception 'FAN005_NICKNAME_TAKEN' using errcode = '23505';
  end;

  return jsonb_build_object(
    'completed',
    true,
    'nickname',
    v_nickname
  );
end;
$$;

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
  v_prohibited_candidate text;
begin
  if p_app_user_id is null or p_nickname is null then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  v_nickname := btrim(normalize(p_nickname, NFKC));
  v_normalized := lower(v_nickname);
  v_prohibited_candidate := regexp_replace(v_normalized, '[ _-]+', '', 'g');

  if length(v_nickname) not between 2 and 16
     or v_nickname !~ '^[A-Za-z0-9가-힣 _-]+$' then
    raise exception 'FAN005_INVALID_NICKNAME' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.prohibited_nickname_catalog c
    where c.catalog_version = 'fan-nickname-v1'
      and c.active
      and (
        (
          c.match_mode = 'exact'
          and (
            v_normalized = c.value_normalized
            or v_prohibited_candidate = c.value_normalized
          )
        )
        or (
          c.match_mode = 'contains'
          and (
            strpos(v_normalized, c.value_normalized) > 0
            or strpos(v_prohibited_candidate, c.value_normalized) > 0
          )
        )
      )
  ) then
    raise exception 'FAN005_NICKNAME_PROHIBITED' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.app_users u
    where u.id = p_app_user_id
      and u.status = 'active'
    for update
  ) or not exists (
    select 1
    from public.user_profiles p
    where p.app_user_id = p_app_user_id
  ) then
    raise exception 'FAN005_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  begin
    update public.user_profiles
    set
      nickname = v_nickname,
      nickname_normalized = v_normalized
    where app_user_id = p_app_user_id;
  exception when unique_violation then
    raise exception 'FAN005_NICKNAME_TAKEN' using errcode = '23505';
  end;

  return jsonb_build_object(
    'completed',
    true,
    'nickname',
    v_nickname
  );
end;
$$;

revoke all on function public.set_owned_user_nickname(uuid, text)
  from public, anon, authenticated;
revoke all on function public.rename_owned_user_nickname(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_owned_user_nickname(uuid, text)
  to service_role;
grant execute on function public.rename_owned_user_nickname(uuid, text)
  to service_role;

comment on function public.set_owned_user_nickname(uuid, text) is
  'FAN-005 owner-scoped first nickname using the public 2-16 character format contract.';
comment on function public.rename_owned_user_nickname(uuid, text) is
  'AUTH-006 owner-scoped rename using the public 2-16 character format contract.';
