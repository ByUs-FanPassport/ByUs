-- Run against the disposable latest-chain database; all fixtures roll back.
begin;

do $$
declare
  owner uuid := 'a1300000-0000-4000-8000-000000000001';
  new_owner uuid := 'a1300000-0000-4000-8000-000000000002';
  profile jsonb;
  denied boolean := false;
begin
  if not exists (
    select 1 from public.prohibited_nickname_catalog
    where catalog_version = 'fan-nickname-v1'
      and value_normalized = 'kyaa'
      and match_mode = 'contains'
      and reason_code = 'impersonation'
      and active
  ) then
    raise exception 'active kyaa nickname protection is missing';
  end if;

  insert into public.app_users(id, privy_user_id, verified_email) values
    (owner, 'did:privy:kyaa-nickname-existing', 'kyaa-nickname-existing@example.invalid'),
    (new_owner, 'did:privy:kyaa-nickname-new', 'kyaa-nickname-new@example.invalid');
  insert into public.user_profiles(app_user_id, nickname, nickname_normalized)
  values(owner, 'KyaaLegacy', 'kyaalegacy');

  profile := public.get_owned_user_profile(owner);
  if profile->>'nickname' <> 'KyaaLegacy' then
    raise exception 'existing kyaa nickname was not readable: %', profile;
  end if;

  begin
    perform public.set_owned_user_nickname(new_owner, 'KyaaTeam');
  exception when sqlstate '22023' then
    denied := sqlerrm = 'FAN005_NICKNAME_PROHIBITED';
  end;
  if not denied then
    raise exception 'new kyaa nickname was not rejected';
  end if;
end;
$$;

rollback;
select 'Kyaa nickname protection and existing profile read PASS' as result;
