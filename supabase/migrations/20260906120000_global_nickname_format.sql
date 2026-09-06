-- Global display names are validated strictly by the trusted API with
-- Intl.Segmenter (1-32 graphemes). The database keeps a deliberately broader
-- storage-safety boundary so Unicode segmentation does not drift between the
-- JavaScript and PostgreSQL/ICU runtimes.

begin;

create collation public.nickname_unicode (
  provider = icu,
  locale = 'und',
  deterministic = true
);

create or replace function public.nickname_is_db_safe(p_nickname text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
  select
    char_length(p_nickname) between 1 and 512
    and octet_length(p_nickname) <= 2048
    and p_nickname !~ U&'[\0001-\001F\007F-\009F\2028-\2029]'
    and p_nickname !~ U&'[\00AD\034F\061C\115F\1160\17B4\17B5\180E\200B\200E\200F\202A-\202E\2060-\206F\3164\FEFF\FFA0\FFF9-\FFFB]'
    and p_nickname collate public.nickname_unicode !~ '^[[:space:]]*$';
$$;

revoke all on function public.nickname_is_db_safe(text)
  from public, anon, authenticated, service_role;

comment on function public.nickname_is_db_safe(text) is
  'Private storage-safety predicate: nonblank, 1-512 code points, 2048 bytes, no hidden controls. The trusted API enforces a visible letter/number/punctuation/symbol and the exact 1-32 grapheme product contract. Deliberately no ICU assigned-symbol catalogue, which can lag browser Unicode versions.';

alter table public.user_profiles
  drop constraint user_profiles_nickname_length,
  drop constraint user_profiles_nickname_visible_characters,
  drop constraint user_profiles_nickname_normalized_canonical;

alter table public.user_profiles
  add constraint user_profiles_nickname_length
    check (
      char_length(nickname) between 1 and 512
      and char_length(nickname_normalized) between 1 and 512
      and octet_length(nickname) <= 2048
      and octet_length(nickname_normalized) <= 2048
    ),
  add constraint user_profiles_nickname_visible_characters
    check (
      public.nickname_is_db_safe(nickname)
      and public.nickname_is_db_safe(nickname_normalized)
    ),
  add constraint user_profiles_nickname_normalized_canonical
    check (
      nickname = btrim(normalize(nickname, NFKC))
      and nickname_normalized = lower(nickname collate public.nickname_unicode)
      and nickname_catalog_version = 'fan-nickname-v1'
    );

update public.prohibited_nickname_catalog
set match_mode = 'exact'
where catalog_version = 'fan-nickname-v1'
  and match_mode = 'contains'
  and value_normalized in ('kara', '카라', 'katseye', '캣츠아이');

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
  v_normalized := lower(v_nickname collate public.nickname_unicode);
  v_prohibited_candidate := regexp_replace(
    v_normalized collate public.nickname_unicode,
    '[^[:alnum:]]',
    '',
    'g'
  );

  if not public.nickname_is_db_safe(v_nickname)
     or not public.nickname_is_db_safe(v_normalized) then
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
        'completed', true,
        'nickname', v_existing.nickname
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
    'completed', true,
    'nickname', v_nickname
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
  v_normalized := lower(v_nickname collate public.nickname_unicode);
  v_prohibited_candidate := regexp_replace(
    v_normalized collate public.nickname_unicode,
    '[^[:alnum:]]',
    '',
    'g'
  );

  if not public.nickname_is_db_safe(v_nickname)
     or not public.nickname_is_db_safe(v_normalized) then
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
    'completed', true,
    'nickname', v_nickname
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
  'FAN-005 owner-scoped first display name. The trusted API enforces the exact 1-32 grapheme product contract; this RPC enforces Unicode normalization, uniqueness, prohibited names, and broad storage safety.';
comment on function public.rename_owned_user_nickname(uuid, text) is
  'AUTH-006 owner-scoped display-name rename. The trusted API enforces the exact 1-32 grapheme product contract; this RPC enforces Unicode normalization, uniqueness, prohibited names, and broad storage safety.';

commit;
