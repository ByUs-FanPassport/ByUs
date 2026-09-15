-- Disposable clean-replay assertions for account-wide first-use onboarding.
begin;

insert into public.app_users (id, privy_user_id, verified_email, status) values
  ('0b000000-0000-4000-8000-000000000001', 'did:privy:onboarding-owner-a', 'onboarding-a@example.invalid', 'active'),
  ('0b000000-0000-4000-8000-000000000002', 'did:privy:onboarding-owner-b', 'onboarding-b@example.invalid', 'active');

-- These fixtures isolate the read contract from unrelated issuance and LIVE
-- producer triggers. The event is both in the past and cancelled.
set local session_replication_role = replica;
insert into public.user_profiles (app_user_id, nickname, nickname_normalized) values
  ('0b000000-0000-4000-8000-000000000001', 'OnboardingA', 'onboardinga');
insert into public.fan_passports (
  id, app_user_id, celebrity_id, quiz_pass_id, blockchain_job_id
) values (
  '0b000000-0000-4000-8000-000000000011',
  '0b000000-0000-4000-8000-000000000001',
  '0b000000-0000-4000-8000-000000000021',
  '0b000000-0000-4000-8000-000000000031',
  '0b000000-0000-4000-8000-000000000032'
);
insert into public.live_events (
  id, slug, celebrity_id, brand_id, publication_status, content_status,
  starts_at, ends_at, reservation_opens_at, reservation_closes_at,
  youtube_url, external_live_url, approved_hero_url, fan_code_hash, published_at,
  attendance_valid_from, attendance_valid_until
) values (
  '0b000000-0000-4000-8000-000000000041',
  'onboarding-prior-cancelled-live',
  '0b000000-0000-4000-8000-000000000021',
  '0b000000-0000-4000-8000-000000000051',
  'published',
  'cancelled',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '2 days' + interval '1 hour',
  pg_catalog.now() - interval '3 days',
  pg_catalog.now() - interval '2 days' - interval '1 hour',
  'https://youtu.be/onboardingfixture',
  'https://youtu.be/onboardingfixture',
  '/onboarding-fixture.webp',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  pg_catalog.now() - interval '4 days',
  pg_catalog.now() - interval '2 days',
  pg_catalog.now() - interval '2 days' + interval '1 hour'
);
insert into public.live_reservations (
  id, app_user_id, live_event_id, celebrity_id, passport_id,
  idempotency_key, reserved_at
) values (
  '0b000000-0000-4000-8000-000000000061',
  '0b000000-0000-4000-8000-000000000001',
  '0b000000-0000-4000-8000-000000000041',
  '0b000000-0000-4000-8000-000000000021',
  '0b000000-0000-4000-8000-000000000011',
  '0b000000-0000-4000-8000-000000000071',
  pg_catalog.now() - interval '3 days'
);
set local session_replication_role = origin;

do $$
declare
  owner_a jsonb;
  owner_b jsonb;
begin
  owner_a := public.read_owned_onboarding_state(
    '0b000000-0000-4000-8000-000000000001'
  );
  if owner_a <> jsonb_build_object(
    'completed', jsonb_build_object(
      'profile', true,
      'verify', true,
      'reserve', true
    ),
    'dismissed', false
  ) then
    raise exception 'canonical completed state mismatch: %', owner_a;
  end if;

  owner_b := public.dismiss_owned_onboarding(
    '0b000000-0000-4000-8000-000000000002'
  );
  if owner_b->>'dismissed' <> 'true'
     or public.read_owned_onboarding_state(
       '0b000000-0000-4000-8000-000000000001'
     )->>'dismissed' <> 'false'
     or public.read_owned_onboarding_state(
       '0b000000-0000-4000-8000-000000000002'
     )->>'dismissed' <> 'true' then
    raise exception 'dismissal crossed account boundary or was not persistent';
  end if;

  if has_function_privilege(
       'anon',
       'public.read_owned_onboarding_state(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.read_owned_onboarding_state(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.dismiss_owned_onboarding(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.dismiss_owned_onboarding(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.read_owned_onboarding_state(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.dismiss_owned_onboarding(uuid)',
       'EXECUTE'
     ) then
    raise exception 'onboarding RPC privilege boundary failed';
  end if;
end;
$$;

-- Once observed, profile completion remains true even if the canonical row is
-- later absent. Account deletion still cascades the whole onboarding record.
set local session_replication_role = replica;
delete from public.user_profiles
where app_user_id = '0b000000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $$
begin
  if public.read_owned_onboarding_state(
    '0b000000-0000-4000-8000-000000000001'
  )->'completed'->>'profile' <> 'true' then
    raise exception 'profile completion regressed after being observed';
  end if;
end;
$$;

rollback;
