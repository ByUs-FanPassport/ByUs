\set ON_ERROR_STOP on

begin;

do $$
declare
  v_provider "char";
  v_deterministic boolean;
begin
  select collprovider, collisdeterministic
  into v_provider, v_deterministic
  from pg_collation
  where oid = 'public.nickname_unicode'::regcollation;

  if v_provider <> 'i' or not v_deterministic then
    raise exception 'nickname_unicode must be a deterministic ICU collation';
  end if;

  if has_function_privilege('anon', 'public.set_owned_user_nickname(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_owned_user_nickname(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.rename_owned_user_nickname(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.rename_owned_user_nickname(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.set_owned_user_nickname(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.rename_owned_user_nickname(uuid,text)', 'execute') then
    raise exception 'nickname mutation RPC ACL drifted';
  end if;

  if has_function_privilege('anon', 'public.nickname_is_db_safe(text)', 'execute')
     or has_function_privilege('authenticated', 'public.nickname_is_db_safe(text)', 'execute')
     or has_function_privilege('service_role', 'public.nickname_is_db_safe(text)', 'execute') then
    raise exception 'nickname storage-safety helper must remain private';
  end if;

  if has_table_privilege('anon', 'public.user_profiles', 'insert,update,delete')
     or has_table_privilege('authenticated', 'public.user_profiles', 'insert,update,delete')
     or has_table_privilege('service_role', 'public.user_profiles', 'insert,update,delete') then
    raise exception 'user_profiles direct writes must remain revoked';
  end if;
end;
$$;

create function pg_temp.expect_set_error(
  p_label text,
  p_nickname text,
  p_expected text
)
returns void
language plpgsql
as $$
declare
  v_user_id uuid := extensions.gen_random_uuid();
begin
  insert into public.app_users (id, privy_user_id, verified_email)
  values (
    v_user_id,
    'did:privy:global-nickname-error:' || v_user_id::text,
    replace(v_user_id::text, '-', '') || '@example.com'
  );

  begin
    perform public.set_owned_user_nickname(v_user_id, p_nickname);
  exception when others then
    if sqlerrm = p_expected then
      return;
    end if;
    raise exception '% returned %, expected %', p_label, sqlerrm, p_expected;
  end;

  raise exception '% unexpectedly succeeded', p_label;
end;
$$;

create function pg_temp.set_fixture(p_label text, p_nickname text)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  insert into public.app_users (id, privy_user_id, verified_email)
  values (
    v_user_id,
    'did:privy:global-nickname-ok:' || p_label || ':' || v_user_id::text,
    replace(v_user_id::text, '-', '') || '@example.com'
  );
  v_result := public.set_owned_user_nickname(v_user_id, p_nickname);
  if not (v_result->>'completed')::boolean then
    raise exception '% did not complete', p_label;
  end if;
  return v_user_id;
end;
$$;

do $$
declare
  v_id uuid;
  v_second uuid;
  v_hidden text;
  v_pair text[];
begin
  -- One-character, multilingual, accented, punctuation/symbol and joined emoji
  -- fixtures exercise the broad database boundary. The API owns 1-32 graphemes.
  perform pg_temp.set_fixture('one-character', '光');
  perform pg_temp.set_fixture('japanese', 'さくら');
  perform pg_temp.set_fixture('arabic', 'ليلى');
  perform pg_temp.set_fixture('thai', 'แฟน');
  perform pg_temp.set_fixture('accented', 'Élodie');
  perform pg_temp.set_fixture('family-emoji', '👨‍👩‍👧‍👦');
  perform pg_temp.set_fixture('thai-baht-symbol', '฿');
  perform pg_temp.set_fixture('musical-clef-symbol', '𝄞');
  perform pg_temp.set_fixture('newer-emoji', '🫩');
  perform pg_temp.set_fixture('punctuation', '화이팅!');
  perform pg_temp.set_fixture('zwnj', U&'می\200Cنا');
  perform pg_temp.set_fixture('combining', U&'Cafe\0301');
  perform pg_temp.set_fixture('thirty-two', repeat('a', 32));
  perform pg_temp.set_fixture('db-boundary-over-api-limit', repeat('b', 33));

  -- Ordinary U+0020 edge spaces are removed after NFKC. Inner spaces remain.
  v_id := pg_temp.set_fixture('nfkc-and-spaces', '  Ａｌｉｃｅ Fan  ');
  if (select nickname from public.user_profiles where app_user_id = v_id) <> 'Alice Fan'
     or (select nickname_normalized from public.user_profiles where app_user_id = v_id) <> 'alice fan' then
    raise exception 'NFKC or ordinary edge-space normalization drifted';
  end if;

  -- NFKC plus deterministic ICU lowercasing is the unique-name key.
  foreach v_pair slice 1 in array array[
    array['ＦｕｌｌＷｉｄｔｈ', 'fullwidth'],
    array['É', 'é'],
    array[U&'\0130', U&'i\0307'],
    array[U&'\039F\03A3', U&'\03BF\03C2'],
    array[U&'\1E9E', U&'\00DF']
  ] loop
    perform pg_temp.set_fixture('canonical-first-' || extensions.gen_random_uuid()::text, v_pair[1]);
    perform pg_temp.expect_set_error(
      'canonical duplicate ' || v_pair[2],
      v_pair[2],
      'FAN005_NICKNAME_TAKEN'
    );
  end loop;

  -- Creator names remain available inside fan expressions, while exact or
  -- punctuation-obfuscated creator names remain protected.
  perform pg_temp.set_fixture('kara-fan', 'KARA Fan');
  perform pg_temp.set_fixture('kara-fan-ko', '카라팬');
  perform pg_temp.set_fixture('katseye-fan', 'KATSEYE Fan');
  perform pg_temp.set_fixture('katseye-fan-ko', '캣츠아이팬');

  foreach v_hidden in array array['KARA', '카라', 'KATSEYE', '캣츠아이'] loop
    perform pg_temp.expect_set_error(
      'exact creator ' || v_hidden,
      v_hidden,
      'FAN005_NICKNAME_PROHIBITED'
    );
  end loop;

  perform pg_temp.expect_set_error(
    'punctuation reserved-name bypass',
    'a.d.m.i.n',
    'FAN005_NICKNAME_PROHIBITED'
  );
  perform pg_temp.expect_set_error(
    'joiner reserved-name bypass',
    U&'a\200Ddmin',
    'FAN005_NICKNAME_PROHIBITED'
  );

  foreach v_hidden in array array[
    U&'\0001', U&'\001F', U&'\007F', U&'\0085', U&'\00AD',
    U&'\034F', U&'\061C', U&'\115F', U&'\1160', U&'\17B4',
    U&'\17B5', U&'\180E', U&'\200B', U&'\200E', U&'\200F',
    U&'\2028', U&'\2029', U&'\202A', U&'\202E', U&'\2060',
    U&'\206F', U&'\3164', U&'\FEFF', U&'\FFA0', U&'\FFF9', U&'\FFFB'
  ] loop
    perform pg_temp.expect_set_error(
      'hidden/control U+' || upper(to_hex(ascii(v_hidden))),
      'fan' || v_hidden || 'name',
      'FAN005_INVALID_NICKNAME'
    );
  end loop;

  -- Like the exact grapheme count, the visible-base rule belongs to the API.
  -- DB safety must be a superset so newer Unicode symbols never fail at save.
  perform pg_temp.set_fixture('db-only-combining-superset', U&'\0301\0308');
  perform pg_temp.expect_set_error('blank display name', '   ', 'FAN005_INVALID_NICKNAME');
  perform pg_temp.expect_set_error(
    'code-point storage bound',
    repeat('x', 513),
    'FAN005_INVALID_NICKNAME'
  );
  perform pg_temp.expect_set_error(
    'raw byte storage bound',
    repeat('界', 683),
    'FAN005_INVALID_NICKNAME'
  );
  perform pg_temp.expect_set_error(
    'normalized byte storage bound',
    repeat(U&'\337F', 171),
    'FAN005_INVALID_NICKNAME'
  );

  -- Rename retains the same normalization and uniqueness path.
  v_id := pg_temp.set_fixture('rename-source', 'Initial Name');
  perform public.rename_owned_user_nickname(v_id, '새 이름💜');
  if (select nickname from public.user_profiles where app_user_id = v_id) <> '새 이름💜' then
    raise exception 'global nickname rename did not persist normalized input';
  end if;

  v_second := pg_temp.set_fixture('rename-duplicate-source', 'Another Name');
  begin
    perform public.rename_owned_user_nickname(v_second, '새 이름💜');
    raise exception 'rename uniqueness unexpectedly succeeded';
  exception when unique_violation then
    if sqlerrm <> 'FAN005_NICKNAME_TAKEN' then
      raise;
    end if;
  end;

  if (
    select count(*)
    from public.prohibited_nickname_catalog
    where catalog_version = 'fan-nickname-v1'
      and value_normalized in ('kara', '카라', 'katseye', '캣츠아이')
      and match_mode = 'exact'
      and active
  ) <> 4 then
    raise exception 'creator nickname catalog did not migrate to exact matching';
  end if;

  if not exists (
    select 1 from public.prohibited_nickname_catalog
    where catalog_version = 'fan-nickname-v1'
      and value_normalized = 'admin'
      and match_mode = 'contains'
      and active
  ) then
    raise exception 'non-creator prohibited matching changed';
  end if;
end;
$$;

select jsonb_build_object(
  'collation', 'public.nickname_unicode',
  'multilingualFixtures', 'passed',
  'normalizationAndUniqueness', 'passed',
  'prohibitedNameEvasion', 'passed',
  'aclBoundary', 'passed'
) as global_nickname_verification;

rollback;
