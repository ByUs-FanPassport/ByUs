-- Local disposable-database contract test. All fixture writes roll back.
-- Keep the existing backend suite in the same clean replay when this file is
-- selected as the harness assertion entrypoint.
\set ON_ERROR_STOP on
\ir backend_security.sql

begin;

create function pg_temp.expect_signup_event_error(statement text, expected text)
returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'Unexpected error %, wanted %', sqlerrm, expected;
    end if;
    caught := true;
  end;
  if not caught then raise exception 'Expected error was not raised: %', expected; end if;
end;
$$;

do $$
declare
  hash text := repeat('a',64);
  guide_common jsonb := jsonb_build_object(
    'channel','direct','landing','fan_guide','guide','elina',
    'browser','safari','os','ios','locale','ko','audience','guest'
  );
  login_common jsonb := jsonb_build_object(
    'channel','direct','landing','fan_guide','guide','elina',
    'browser','safari','os','ios','locale','ko','provider','apple','trigger','provider'
  );
  observed_at timestamptz := statement_timestamp() - interval '1 minute';
  first_result jsonb;
  replay_result jsonb;
begin
  first_result := public.record_product_event_v1(
    1::smallint,'signup_guide_view',null,hash,null,null,null,null,
    'signup.guide','signup-guide:10000000-0000-4000-8000-000000000001:view',
    observed_at,guide_common
  );
  replay_result := public.record_product_event_v1(
    1::smallint,'signup_guide_view',null,hash,null,null,null,null,
    'signup.guide','signup-guide:10000000-0000-4000-8000-000000000001:view',
    observed_at,guide_common
  );
  if (first_result->>'replayed')::boolean or not (replay_result->>'replayed')::boolean
     or first_result->>'id' is distinct from replay_result->>'id' then
    raise exception 'Signup guide replay contract failed';
  end if;

  perform public.record_product_event_v1(
    1::smallint,'signup_guide_cta',null,hash,null,null,null,null,
    'signup.guide','signup-guide:10000000-0000-4000-8000-000000000002:cta',
    observed_at + interval '1 second',guide_common || '{"action":"verify","placement":"hero"}'::jsonb
  );
  perform public.record_product_event_v1(
    1::smallint,'login_started',null,hash,null,null,null,null,
    'signup.login','signup-login:20000000-0000-4000-8000-000000000001:started',
    observed_at + interval '2 seconds',login_common
  );
  perform public.record_product_event_v1(
    1::smallint,'login_result',null,hash,null,null,null,null,
    'signup.login','signup-login:20000000-0000-4000-8000-000000000001:failed',
    observed_at + interval '3 seconds',login_common || '{"outcome":"failed","stage":"oauth","reason":"timeout"}'::jsonb
  );
  perform public.record_product_event_v1(
    1::smallint,'login_result',null,hash,null,null,null,null,
    'signup.login','signup-login:20000000-0000-4000-8000-000000000001:succeeded',
    observed_at + interval '4 seconds',login_common || '{"outcome":"succeeded","stage":"session","reason":"none"}'::jsonb
  );

  if (select count(*) from public.fan_product_events
      where anonymous_session_hash=hash and event_name in
        ('signup_guide_view','signup_guide_cta','login_started','login_result')) <> 5 then
    raise exception 'Valid signup client events were not stored';
  end if;
end;
$$;

-- Fixed shapes, sources, anonymous ownership, entity absence, taxonomies, and
-- name/outcome-specific UUID-v4 keys are all enforced inside the RPC.
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'signup_guide_view',null,repeat('b',64),null,null,null,null,
    'signup.guide','signup-guide:30000000-0000-4000-8000-000000000001:view',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","audience":"guest","extra":true}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'signup_guide_view',null,repeat('b',64),null,null,null,null,
    'signup.login','signup-guide:30000000-0000-4000-8000-000000000002:view',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","audience":"guest"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'signup_guide_cta',null,repeat('b',64),gen_random_uuid(),null,null,null,
    'signup.guide','signup-guide:30000000-0000-4000-8000-000000000003:cta',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","audience":"guest","action":"verify","placement":"hero"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'login_started',null,repeat('b',64),null,null,null,null,
    'signup.login','signup-login:30000000-0000-3000-8000-000000000004:started',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"provider"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'login_result',null,repeat('b',64),null,null,null,null,
    'signup.login','signup-login:30000000-0000-4000-8000-000000000005:succeeded',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"provider","outcome":"succeeded","stage":"ready","reason":"none"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'login_result',null,repeat('b',64),null,null,null,null,
    'signup.login','signup-login:30000000-0000-4000-8000-000000000006:failed',now(),
    '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"provider","outcome":"failed","stage":"oauth","reason":"none"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'login_result',null,repeat('b',64),null,null,null,null,
    'signup.login','signup-login:30000000-0000-4000-8000-000000000007:failed',now(),
    '{"channel":7,"landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"provider","outcome":"failed","stage":"oauth","reason":"timeout"}'::jsonb)
$sql$,'PRODUCT_EVENT_INVALID');

-- The pre-existing contract and replay/conflict behavior remain available.
do $$
declare
  hash text := repeat('c',64);
  at_time timestamptz := statement_timestamp() - interval '2 minutes';
begin
  perform public.record_product_event_v1(
    1::smallint,'creator_page_view',null,hash,null,null,null,null,
    'legacy.contract','legacy-contract-key',at_time,'{}'::jsonb
  );
  perform public.record_product_event_v1(
    1::smallint,'creator_page_view',null,hash,null,null,null,null,
    'legacy.contract','legacy-contract-key',at_time,'{}'::jsonb
  );
end;
$$;
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'creator_page_view',null,repeat('c',64),null,null,null,null,
    'legacy.contract','legacy-contract-key',now(),'{}'::jsonb)
$sql$,'PRODUCT_EVENT_IDEMPOTENCY_CONFLICT');

do $$
declare
  account_id uuid := '40000000-0000-4000-8000-000000000001';
  event_row public.fan_product_events%rowtype;
  event_count integer;
begin
  insert into public.app_users(id,privy_user_id,verified_email,created_at)
  values(account_id,'did:privy:signup-measurement-account','signup-measurement-account@example.invalid',statement_timestamp()-interval '5 minutes');

  select * into strict event_row from public.fan_product_events
  where event_name='account_created' and app_user_id=account_id;
  if event_row.source <> 'server.commit_projection'
     or event_row.anonymous_session_hash is not null
     or event_row.celebrity_id is not null or event_row.live_event_id is not null
     or event_row.mission_id is not null or event_row.benefit_id is not null
     or event_row.properties <> '{}'::jsonb
     or event_row.idempotency_key <> 'commit:app_users:'||account_id::text||':account_created'
     or event_row.occurred_at <> (select created_at from public.app_users where id=account_id) then
    raise exception 'Account projection is not canonical';
  end if;

  insert into public.user_profiles(app_user_id,nickname,nickname_normalized,created_at)
  values(account_id,'가입측정','가입측정',statement_timestamp()-interval '4 minutes');
  select * into strict event_row from public.fan_product_events
  where event_name='profile_completed' and app_user_id=account_id;
  if event_row.source <> 'server.commit_projection'
     or event_row.properties <> '{}'::jsonb
     or event_row.idempotency_key <> 'commit:user_profiles:'||account_id::text||':profile_completed'
     or event_row.occurred_at <> (select created_at from public.user_profiles where app_user_id=account_id) then
    raise exception 'Profile projection is not canonical';
  end if;

  select count(*) into event_count from public.fan_product_events
  where event_name='account_created' and app_user_id=account_id;
  update public.app_users set last_authenticated_at=statement_timestamp() where id=account_id;
  if (select count(*) from public.fan_product_events
      where event_name='account_created' and app_user_id=account_id) <> event_count then
    raise exception 'Account UPDATE emitted an INSERT-only projection';
  end if;
end;
$$;

select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'account_created','40000000-0000-4000-8000-000000000001',null,null,null,null,null,
    'server.commit_projection','commit:app_users:40000000-0000-4000-8000-000000000001:account_created',
    now(),'{}'::jsonb)
$sql$,'PRODUCT_EVENT_COMMIT_SOURCE_INVALID');
select pg_temp.expect_signup_event_error($sql$
  select public.record_product_event_v1(
    1::smallint,'profile_completed','40000000-0000-4000-8000-000000000099',null,null,null,null,null,
    'server.commit_projection','commit:user_profiles:40000000-0000-4000-8000-000000000099:profile_completed',
    now(),'{}'::jsonb)
$sql$,'PRODUCT_EVENT_COMMIT_SOURCE_INVALID');

-- Projection failures are telemetry-only and do not block their source row.
insert into public.app_users(id,privy_user_id,verified_email,created_at)
values('40000000-0000-4000-8000-000000000002','did:privy:signup-measurement-future','signup-measurement-future@example.invalid',statement_timestamp()+interval '10 minutes');
do $$ begin
  if not exists(select 1 from public.app_users where id='40000000-0000-4000-8000-000000000002')
     or exists(select 1 from public.fan_product_events where app_user_id='40000000-0000-4000-8000-000000000002') then
    raise exception 'Projection failure blocked source insert or fabricated an event';
  end if;
end $$;

-- Source and projection share transaction fate.
savepoint signup_projection_rollback;
insert into public.app_users(id,privy_user_id,verified_email)
values('40000000-0000-4000-8000-000000000003','did:privy:signup-measurement-rollback','signup-measurement-rollback@example.invalid');
do $$ begin
  if not exists(select 1 from public.fan_product_events where app_user_id='40000000-0000-4000-8000-000000000003') then
    raise exception 'Projection missing before rollback';
  end if;
end $$;
rollback to savepoint signup_projection_rollback;
do $$ begin
  if exists(select 1 from public.app_users where id='40000000-0000-4000-8000-000000000003')
     or exists(select 1 from public.fan_product_events where app_user_id='40000000-0000-4000-8000-000000000003') then
    raise exception 'Source or projection survived rollback';
  end if;
end $$;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if has_function_privilege(role_name,
      'public.record_product_event_v1(smallint,text,uuid,text,uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb)','execute') then
      raise exception '% can call private product-event RPC', role_name;
    end if;
  end loop;
  if not has_function_privilege('service_role',
      'public.record_product_event_v1(smallint,text,uuid,text,uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb)','execute') then
    raise exception 'service_role lost product-event RPC access';
  end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,'public.project_signup_commit_event_v1()','execute') then
      raise exception '% can directly call signup projection', role_name;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid in
        ('public.app_users'::regclass,'public.user_profiles'::regclass)
      and tgname in ('app_users_signup_commit_event','user_profiles_signup_commit_event')
      and not tgisinternal and pg_get_triggerdef(oid) like '% AFTER INSERT %') <> 2 then
    raise exception 'Signup projection triggers are missing or not INSERT-only';
  end if;
  if (select count(*) from pg_trigger where tgname in (
      'fan_passports_product_event','fan_reactions_product_event','live_reservations_product_event',
      'live_attendances_product_event','live_survey_responses_product_event_insert',
      'live_survey_responses_product_event_update','fan_ticket_ledger_product_event',
      'live_journey_completions_product_event','live_collectible_claims_product_event',
      'benefit_claims_product_event','benefit_ticket_entries_product_event',
      'benefit_draw_winners_product_event','benefit_fulfillment_events_product_event'
    ) and not tgisinternal and tgenabled <> 'D') <> 13 then
    raise exception 'A pre-existing committed-event projection is missing';
  end if;
end;
$$;

-- Exercise the aggregate-only report against an empty window first. This
-- proves denominator-zero rates stay null rather than becoming zero or errors.
\set signup_report_embedded true
select (statement_timestamp()-interval '23 hours')::text as fixture_from,
       (statement_timestamp()-interval '22 hours')::text as fixture_to
\gset
\set from :fixture_from
\set to :fixture_to
\ir ../../scripts/report-signup-conversion-funnel.sql
select set_config('byus.signup_report_fixture', :'signup_report_signup_conversion_funnel', true);
do $$
declare report jsonb := current_setting('byus.signup_report_fixture')::jsonb;
begin
  if (report#>>'{anonymousGuideEngagement,views}')::integer <> 0
     or report#>'{anonymousGuideEngagement,anyCtaRate}' <> 'null'::jsonb
     or (report#>>'{loginAttempts,attempts}')::integer <> 0
     or report#>'{canonicalSignupProgress,profileRate}' <> 'null'::jsonb then
    raise exception 'Empty-window report semantics changed: %',report;
  end if;
end;
$$;

-- Ordered, missing, retry, pending, and same-attempt recovery fixtures.
do $$
declare
  base_time timestamptz := statement_timestamp()-interval '12 hours';
  hash_recovered text := repeat('d',64);
  hash_retry text := repeat('e',64);
  hash_unknown text := repeat('f',64);
  hash_missing text := repeat('1',64);
  hash_pending text := repeat('2',64);
  hash_unknown_to_guest text := repeat('3',64);
  hash_guest_to_member text := repeat('4',64);
  hash_guest_cta_only text := repeat('5',64);
  hash_unknown_cta text := repeat('6',64);
  guide_guest jsonb := '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","audience":"guest"}'::jsonb;
  guide_unknown jsonb := '{"channel":"social","landing":"fan_guide","guide":"ifew","browser":"instagram","os":"android","locale":"en","audience":"unknown"}'::jsonb;
  login_provider jsonb := '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"provider"}'::jsonb;
  login_retry jsonb := '{"channel":"direct","landing":"fan_guide","guide":"elina","browser":"safari","os":"ios","locale":"ko","provider":"apple","trigger":"retry"}'::jsonb;
  login_restore jsonb := '{"channel":"search","landing":"home","guide":"none","browser":"chrome","os":"other","locale":"ko","provider":"google","trigger":"session_restore"}'::jsonb;
begin
  -- Guest path whose failed observation later succeeds for the same attempt.
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_recovered,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000001:view',base_time,guide_guest);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_recovered,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000002:cta',base_time+interval '1 minute',guide_guest||'{"action":"verify","placement":"hero"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'login_started',null,hash_recovered,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000001:started',base_time+interval '2 minutes',login_provider);
  perform public.record_product_event_v1(1::smallint,'login_result',null,hash_recovered,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000001:failed',base_time+interval '3 minutes',login_provider||'{"outcome":"failed","stage":"oauth","reason":"timeout"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'login_result',null,hash_recovered,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000001:succeeded',base_time+interval '4 minutes',login_provider||'{"outcome":"succeeded","stage":"session","reason":"none"}'::jsonb);

  -- The first provider attempt fails; a fresh retry succeeds. The guest funnel
  -- must not attribute the second attempt's success to the first attempt.
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_retry,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000003:view',base_time+interval '10 minutes',guide_guest);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_retry,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000004:cta',base_time+interval '11 minutes',guide_guest||'{"action":"verify","placement":"closing"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'login_started',null,hash_retry,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000002:started',base_time+interval '12 minutes',login_provider);
  perform public.record_product_event_v1(1::smallint,'login_result',null,hash_retry,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000002:failed',base_time+interval '13 minutes',login_provider||'{"outcome":"failed","stage":"oauth","reason":"provider_error"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'login_started',null,hash_retry,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000003:started',base_time+interval '14 minutes',login_retry);
  perform public.record_product_event_v1(1::smallint,'login_result',null,hash_retry,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000003:succeeded',base_time+interval '15 minutes',login_retry||'{"outcome":"succeeded","stage":"session","reason":"none"}'::jsonb);

  -- Unknown membership remains in all-guide engagement, but never enters the
  -- guest verify/login cohort. The final guest view deliberately has no CTA.
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_unknown,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000005:view',base_time+interval '20 minutes',guide_unknown);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_unknown,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000006:cta',base_time+interval '21 minutes',guide_unknown||'{"action":"live","placement":"step"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_missing,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000007:view',base_time+interval '30 minutes',guide_guest);
  perform public.record_product_event_v1(1::smallint,'login_started',null,hash_pending,null,null,null,null,'signup.login','signup-login:51000000-0000-4000-8000-000000000004:started',base_time+interval '40 minutes',login_restore);

  -- CTA audience defines the guest cohort independently from view audience.
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_unknown_to_guest,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000008:view',base_time+interval '50 minutes',guide_unknown);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_unknown_to_guest,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000009:cta',base_time+interval '51 minutes',guide_unknown||'{"audience":"guest","action":"verify","placement":"hero"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,hash_guest_to_member,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000010:view',base_time+interval '52 minutes',guide_guest);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_guest_to_member,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000011:cta',base_time+interval '53 minutes',guide_guest||'{"audience":"member","action":"verify","placement":"hero"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_guest_cta_only,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000012:cta',base_time+interval '54 minutes',guide_guest||'{"action":"verify","placement":"closing"}'::jsonb);
  perform public.record_product_event_v1(1::smallint,'signup_guide_cta',null,hash_unknown_cta,null,null,null,null,'signup.guide','signup-guide:50000000-0000-4000-8000-000000000013:cta',base_time+interval '55 minutes',guide_unknown||'{"action":"verify","placement":"closing"}'::jsonb);
end;
$$;

insert into public.app_users(id,privy_user_id,verified_email,created_at) values
  ('52000000-0000-4000-8000-000000000001','did:privy:report-account-profile','report-profile@example.invalid',statement_timestamp()-interval '11 hours'),
  ('52000000-0000-4000-8000-000000000002','did:privy:report-account-missing','report-missing@example.invalid',statement_timestamp()-interval '10 hours');
insert into public.user_profiles(app_user_id,nickname,nickname_normalized,created_at)
values('52000000-0000-4000-8000-000000000001','리포트팬','리포트팬',statement_timestamp()-interval '10 hours 30 minutes');
insert into public.admin_allowlist(id,email,role,active)
values('52000000-0000-4000-8000-000000000003','report-missing@example.invalid','viewer',true);

select (statement_timestamp()-interval '13 hours')::text as fixture_from,
       (statement_timestamp()-interval '6 hours')::text as fixture_to
\gset
\set from :fixture_from
\set to :fixture_to
\ir ../../scripts/report-signup-conversion-funnel.sql
select set_config('byus.signup_report_fixture', :'signup_report_signup_conversion_funnel', true);
do $$
declare report jsonb := current_setting('byus.signup_report_fixture')::jsonb;
begin
  if (report#>>'{anonymousGuideEngagement,views}')::integer <> 6
     or (report#>>'{anonymousGuideEngagement,anyCta}')::integer <> 5
     or (report#>>'{anonymousGuideEngagement,verifyCta}')::integer <> 4
     or (report#>>'{anonymousGuideEngagement,unknownAudienceViews}')::integer <> 2 then
    raise exception 'Guide engagement fixture mismatch: %',report->'anonymousGuideEngagement';
  end if;
  if (report#>>'{guestVerifyToLogin,verifyCtaSessions}')::integer <> 4
     or (report#>>'{guestVerifyToLogin,unknownAudienceVerifyCtaSessions}')::integer <> 1
     or (report#>>'{guestVerifyToLogin,loginStarted}')::integer <> 2
     or (report#>>'{guestVerifyToLogin,loginSucceeded}')::integer <> 1 then
    raise exception 'Guest first-attempt funnel conflated attempts: %',report->'guestVerifyToLogin';
  end if;
  if (report#>>'{loginAttempts,attempts}')::integer <> 4
     or (report#>>'{loginAttempts,succeeded}')::integer <> 2
     or (report#>>'{loginAttempts,failedWithoutSuccess}')::integer <> 1
     or (report#>>'{loginAttempts,pending}')::integer <> 1
     or (report#>>'{loginAttempts,recovered}')::integer <> 1
     or (report#>>'{loginAttempts,byTrigger,retry,attempts}')::integer <> 1
     or (report#>>'{loginAttempts,byTrigger,session_restore,pending}')::integer <> 1 then
    raise exception 'Login attempt classification mismatch: %',report->'loginAttempts';
  end if;
  if (report#>>'{canonicalSignupProgress,accounts}')::integer <> 2
     or (report#>>'{canonicalSignupProgress,profiles}')::integer <> 1
     or (report#>>'{canonicalSignupProgress,fanPassports}')::integer <> 0
     or (report#>>'{canonicalSignupProgress,adminAllowlistedAccounts}')::integer <> 1
     or (report#>>'{projectionCoverage,accountCreated,projectedRows}')::integer <> 2
     or (report#>>'{projectionCoverage,profileCompleted,projectedRows}')::integer <> 1 then
    raise exception 'Canonical/projection fixture mismatch: %',report;
  end if;
  if report::text like '%52000000-0000-4000-8000-000000000001%'
     or report::text like '%'||repeat('d',64)||'%' then
    raise exception 'Aggregate report leaked an identifier';
  end if;
end;
$$;

select jsonb_build_object(
  'status','PASS','syntheticOnly',true,'newClientEvents',4,
  'newServerEvents',2,'sourceProjections',2
) as signup_funnel_measurement_result;

rollback;
