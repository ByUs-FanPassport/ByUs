\set ON_ERROR_STOP on

-- Required psql variables:
--   -v from='2026-09-11T00:00:00+09:00'
--   -v to='2026-09-12T00:00:00+09:00'
-- The report returns aggregate JSON only. It does not emit canonical account
-- IDs, anonymous-session hashes, or login-attempt nonces.

\if :{?signup_report_embedded}
\else
begin transaction read only;
\endif

select 1 / case
  when :'from'::timestamptz < :'to'::timestamptz
    and :'to'::timestamptz <= statement_timestamp()
    and :'to'::timestamptz - :'from'::timestamptz <= interval '366 days'
  then 1
  else 0
end as valid_window;

with
parameters as (
  select :'from'::timestamptz as from_at, :'to'::timestamptz as to_at
),
signup_events as materialized (
  select event_name, app_user_id, anonymous_session_hash, source,
         idempotency_key, occurred_at, properties
  from public.fan_product_events, parameters
  where occurred_at >= from_at and occurred_at < to_at
    and event_name in (
      'signup_guide_view','signup_guide_cta','login_started','login_result',
      'account_created','profile_completed'
    )
),
ranked_guide_views as (
  select event.*,
    row_number() over (
      partition by anonymous_session_hash, properties->>'guide'
      order by occurred_at, idempotency_key
    ) as observation_rank
  from signup_events event
  where event_name='signup_guide_view' and source='signup.guide'
),
guide_cohorts as (
  select view_event.*,
    exists (
      select 1 from signup_events cta
      where cta.event_name='signup_guide_cta' and cta.source='signup.guide'
        and cta.anonymous_session_hash=view_event.anonymous_session_hash
        and cta.properties->>'guide'=view_event.properties->>'guide'
        and cta.occurred_at>=view_event.occurred_at
    ) as reached_any_cta,
    exists (
      select 1 from signup_events cta
      where cta.event_name='signup_guide_cta' and cta.source='signup.guide'
        and cta.anonymous_session_hash=view_event.anonymous_session_hash
        and cta.properties->>'guide'=view_event.properties->>'guide'
        and cta.properties->>'action'='verify'
        and cta.occurred_at>=view_event.occurred_at
    ) as reached_verify_cta
  from ranked_guide_views view_event
  where observation_rank=1
),
guide_metrics as (
  select count(*)::integer as views,
    count(*) filter(where reached_any_cta)::integer as any_cta,
    count(*) filter(where reached_verify_cta)::integer as verify_cta,
    count(*) filter(where properties->>'audience'='unknown')::integer as unknown_audience
  from guide_cohorts
),
guide_dimension_rows as (
  select dimension, dimension_value,
    count(*)::integer as views,
    count(*) filter(where reached_any_cta)::integer as any_cta,
    count(*) filter(where reached_verify_cta)::integer as verify_cta
  from guide_cohorts
  cross join lateral (values
    ('channel',properties->>'channel'),('landing',properties->>'landing'),
    ('guide',properties->>'guide'),('browser',properties->>'browser'),
    ('os',properties->>'os'),('locale',properties->>'locale'),
    ('audience',properties->>'audience')
  ) dimension_values(dimension,dimension_value)
  group by dimension,dimension_value
),
guide_dimension_arrays as (
  select dimension,jsonb_agg(jsonb_build_object(
    'value',dimension_value,'views',views,'anyCta',any_cta,
    'anyCtaRate',case when views=0 then null else any_cta::numeric/views end,
    'verifyCta',verify_cta,
    'verifyCtaRate',case when views=0 then null else verify_cta::numeric/views end
  ) order by dimension_value) as values_json
  from guide_dimension_rows group by dimension
),
guide_dimensions as (
  select coalesce(jsonb_object_agg(dimension,values_json order by dimension),'{}'::jsonb) as value
  from guide_dimension_arrays
),
ranked_verify_ctas as (
  select cta.*,
    row_number() over (
      partition by anonymous_session_hash,properties->>'guide'
      order by occurred_at,idempotency_key
    ) as observation_rank
  from signup_events cta
  where cta.event_name='signup_guide_cta' and cta.source='signup.guide'
    and cta.properties->>'action'='verify'
),
verify_cta_metrics as (
  select count(*) filter(where properties->>'audience'='unknown')::integer as unknown_audience
  from ranked_verify_ctas where observation_rank=1
),
guest_verify_ctas as (
  select cta.anonymous_session_hash,cta.properties->>'guide' as guide,
         cta.occurred_at as cta_at
  from ranked_verify_ctas cta
  where cta.observation_rank=1 and cta.properties->>'audience'='guest'
),
guest_first_provider_attempts as (
  select guest.*,attempt.occurred_at as started_at,
         attempt.properties,attempt.attempt_nonce
  from guest_verify_ctas guest
  left join lateral (
    select started.occurred_at,started.anonymous_session_hash,started.properties,
      substring(started.idempotency_key from
        '^signup-login:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):started$') as attempt_nonce
    from signup_events started
    where started.event_name='login_started' and started.source='signup.login'
      and started.anonymous_session_hash=guest.anonymous_session_hash
      and started.properties->>'guide'=guest.guide
      and started.properties->>'trigger'='provider'
      and started.occurred_at>=guest.cta_at
    order by started.occurred_at,started.idempotency_key limit 1
  ) attempt on true
),
guest_signup_funnel as (
  select count(*)::integer as verify_cta_sessions,
    count(*) filter(where started_at is not null)::integer as login_started,
    count(*) filter(where started_at is not null and exists(
      select 1 from signup_events result
      where result.event_name='login_result' and result.source='signup.login'
        and result.anonymous_session_hash=guest_first_provider_attempts.anonymous_session_hash
        and result.properties->>'guide'=guest_first_provider_attempts.guide
        and result.properties->>'provider'=guest_first_provider_attempts.properties->>'provider'
        and result.properties->>'trigger'=guest_first_provider_attempts.properties->>'trigger'
        and result.properties->>'outcome'='succeeded'
        and result.idempotency_key='signup-login:'||attempt_nonce||':succeeded'
        and result.occurred_at>=started_at
    ))::integer as login_succeeded
  from guest_first_provider_attempts
),
login_attempts as (
  select event.anonymous_session_hash,event.occurred_at as started_at,event.properties,
    substring(event.idempotency_key from
      '^signup-login:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):started$') as attempt_nonce
  from signup_events event
  where event.event_name='login_started' and event.source='signup.login'
),
attempt_status as (
  select attempt.*,
    coalesce(result.has_failure,false) as has_failure,
    coalesce(result.has_success,false) as has_success
  from login_attempts attempt
  left join lateral (
    select bool_or(outcome='failed') as has_failure,
           bool_or(outcome='succeeded') as has_success
    from (
      select result.properties->>'outcome' as outcome
      from signup_events result
      where result.event_name='login_result' and result.source='signup.login'
        and result.anonymous_session_hash=attempt.anonymous_session_hash
        and result.properties->>'guide'=attempt.properties->>'guide'
        and result.properties->>'provider'=attempt.properties->>'provider'
        and result.properties->>'trigger'=attempt.properties->>'trigger'
        and result.idempotency_key in (
          'signup-login:'||attempt.attempt_nonce||':failed',
          'signup-login:'||attempt.attempt_nonce||':succeeded'
        )
        and result.occurred_at>=attempt.started_at
    ) matched_results
  ) result on true
),
attempt_metrics as (
  select count(*)::integer as attempts,
    count(*) filter(where has_success)::integer as succeeded,
    count(*) filter(where has_failure and not has_success)::integer as failed_without_success,
    count(*) filter(where not has_failure and not has_success)::integer as pending,
    count(*) filter(where has_failure and has_success)::integer as recovered
  from attempt_status
),
attempt_trigger_rows as (
  select allowed.trigger_name,count(status.attempt_nonce)::integer as attempts,
    count(status.attempt_nonce) filter(where has_success)::integer as succeeded,
    count(status.attempt_nonce) filter(where has_failure and not has_success)::integer as failed_without_success,
    count(status.attempt_nonce) filter(where not has_failure and not has_success)::integer as pending,
    count(status.attempt_nonce) filter(where has_failure and has_success)::integer as recovered
  from (values('provider'),('session_restore'),('retry'),('reauth')) allowed(trigger_name)
  left join attempt_status status on status.properties->>'trigger'=allowed.trigger_name
  group by allowed.trigger_name
),
attempt_triggers as (
  select jsonb_object_agg(trigger_name,jsonb_build_object(
    'attempts',attempts,'succeeded',succeeded,'failedWithoutSuccess',failed_without_success,
    'pending',pending,'recovered',recovered
  ) order by trigger_name) as value from attempt_trigger_rows
),
matched_failure_rows as (
  select result.properties->>'browser' as browser,
         result.properties->>'provider' as provider,
         result.properties->>'stage' as stage,
         result.properties->>'reason' as reason
  from login_attempts attempt
  join signup_events result
    on result.event_name='login_result' and result.source='signup.login'
   and result.anonymous_session_hash=attempt.anonymous_session_hash
   and result.properties->>'guide'=attempt.properties->>'guide'
   and result.properties->>'provider'=attempt.properties->>'provider'
   and result.properties->>'trigger'=attempt.properties->>'trigger'
   and result.properties->>'outcome'='failed'
   and result.idempotency_key='signup-login:'||attempt.attempt_nonce||':failed'
   and result.occurred_at>=attempt.started_at
),
failure_breakdown as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'browser',browser,'provider',provider,'stage',stage,'reason',reason,'failures',failures
  ) order by browser,provider,stage,reason),'[]'::jsonb) as value
  from (
    select browser,provider,stage,reason,count(*)::integer as failures
    from matched_failure_rows group by browser,provider,stage,reason
  ) grouped_failures
),
inconsistent_results as (
  select count(*)::integer as observations
  from signup_events result
  where result.event_name='login_result' and result.source='signup.login'
    and not exists (
      select 1 from login_attempts attempt
      where result.anonymous_session_hash=attempt.anonymous_session_hash
        and result.properties->>'guide'=attempt.properties->>'guide'
        and result.properties->>'provider'=attempt.properties->>'provider'
        and result.properties->>'trigger'=attempt.properties->>'trigger'
        and result.idempotency_key='signup-login:'||attempt.attempt_nonce||':'||(result.properties->>'outcome')
        and result.occurred_at>=attempt.started_at
    )
),
wallet_result_observations as (
  select result.properties
  from login_attempts attempt
  join signup_events result
    on result.event_name='login_result' and result.source='signup.login'
   and result.anonymous_session_hash=attempt.anonymous_session_hash
   and result.properties->>'guide'=attempt.properties->>'guide'
   and result.properties->>'provider'=attempt.properties->>'provider'
   and result.properties->>'trigger'=attempt.properties->>'trigger'
   and result.idempotency_key='signup-login:'||attempt.attempt_nonce||':'||(result.properties->>'outcome')
   and result.occurred_at>=attempt.started_at
),
wallet_diagnostic_metrics as (
  select jsonb_build_object(
    'semantics','wallet_wait_in_observed_login_results_not_unique_users',
    'instrumentedResultObservations',(select count(*) from wallet_result_observations where properties ? 'walletWaitOutcome'),
    'withoutDiagnosticResultObservations',(select count(*) from wallet_result_observations where not (properties ? 'walletWaitOutcome')),
    'groups',coalesce((select jsonb_agg(t) from (
      select properties->>'provider' provider,properties->>'browser' browser,
        properties->>'outcome' outcome,properties->>'stage' stage,
        properties->>'walletWaitOutcome' wallet_wait_outcome,
        properties->>'walletReconciliation' wallet_reconciliation,
        count(*) observations,
        max((properties->>'walletWaitMs')::numeric) max_capped_wait_ms,
        max((properties->>'walletReconciliationMs')::numeric) max_capped_reconciliation_ms
      from wallet_result_observations where properties ? 'walletWaitOutcome'
      group by 1,2,3,4,5,6 order by 1,2,3,4,5,6
    ) t),'[]'::jsonb)
  ) as value
),
canonical_accounts as (
  select account.id,account.verified_email,account.created_at
  from public.app_users account,parameters
  where account.created_at>=from_at and account.created_at<to_at
),
canonical_progress as (
  select account.*,
    exists(select 1 from public.user_profiles profile
      where profile.app_user_id=account.id and profile.created_at>=account.created_at
        and profile.created_at<(select to_at from parameters)) as profile_completed,
    exists(select 1 from public.fan_passports passport
      where passport.app_user_id=account.id and passport.issued_at>=account.created_at
        and passport.issued_at<(select to_at from parameters)) as passport_issued,
    exists(select 1 from public.admin_allowlist admin
      where admin.active and admin.email=account.verified_email) as admin_allowlisted,
    exists(select 1 from signup_events event
      where event.event_name='account_created' and event.source='server.commit_projection'
        and event.app_user_id=account.id and event.occurred_at=account.created_at
        and event.properties='{}'::jsonb) as account_projection
  from canonical_accounts account
),
canonical_metrics as (
  select count(*)::integer as accounts,
    count(*) filter(where profile_completed)::integer as profiles,
    count(*) filter(where passport_issued)::integer as passports,
    count(*) filter(where admin_allowlisted)::integer as admin_allowlisted,
    count(*) filter(where account_projection)::integer as account_projections
  from canonical_progress
),
profile_projection_metrics as (
  select count(*)::integer as source_profiles,
    count(*) filter(where exists(
      select 1 from signup_events event
      where event.event_name='profile_completed' and event.source='server.commit_projection'
        and event.app_user_id=profile.app_user_id and event.occurred_at=profile.created_at
        and event.properties='{}'::jsonb
    ))::integer as profile_projections
  from public.user_profiles profile
  join canonical_accounts account on account.id=profile.app_user_id
  cross join parameters
  where profile.created_at>=account.created_at and profile.created_at<to_at
)
select jsonb_build_object(
  'window',jsonb_build_object('from',:'from'::timestamptz,'to',:'to'::timestamptz,'semantics','[from,to)'),
  'anonymousGuideEngagement',jsonb_build_object(
    'cohort','first_signup_guide_view_per_anonymous_session_and_guide',
    'views',guide_metrics.views,
    'anyCta',guide_metrics.any_cta,
    'anyCtaRate',case when guide_metrics.views=0 then null else guide_metrics.any_cta::numeric/guide_metrics.views end,
    'verifyCta',guide_metrics.verify_cta,
    'verifyCtaRate',case when guide_metrics.views=0 then null else guide_metrics.verify_cta::numeric/guide_metrics.views end,
    'unknownAudienceViews',guide_metrics.unknown_audience,
    'dimensions',guide_dimensions.value
  ),
  'guestVerifyToLogin',jsonb_build_object(
    'cohort','first_verify_cta_with_guest_audience_per_anonymous_session_and_guide',
    'attemptSelection','first_provider_triggered_attempt_after_first_verify_cta',
    'verifyCtaSessions',guest_signup_funnel.verify_cta_sessions,
    'unknownAudienceVerifyCtaSessions',verify_cta_metrics.unknown_audience,
    'loginStarted',guest_signup_funnel.login_started,
    'loginStartedRate',case when guest_signup_funnel.verify_cta_sessions=0 then null else guest_signup_funnel.login_started::numeric/guest_signup_funnel.verify_cta_sessions end,
    'loginSucceeded',guest_signup_funnel.login_succeeded,
    'loginSucceededRate',case when guest_signup_funnel.login_started=0 then null else guest_signup_funnel.login_succeeded::numeric/guest_signup_funnel.login_started end
  ),
  'loginAttempts',jsonb_build_object(
    'cohort','login_started_in_window',
    'attempts',attempt_metrics.attempts,'succeeded',attempt_metrics.succeeded,
    'failedWithoutSuccess',attempt_metrics.failed_without_success,
    'pending',attempt_metrics.pending,'recovered',attempt_metrics.recovered,
    'byTrigger',attempt_triggers.value,
    'failuresByBrowserProviderStageReason',failure_breakdown.value,
    'unmatchedOrInconsistentResultObservations',inconsistent_results.observations
  ),
  'walletDiagnostics',wallet_diagnostic_metrics.value,
  'canonicalSignupProgress',jsonb_build_object(
    'cohort','app_users_created_in_window',
    'accounts',canonical_metrics.accounts,
    'profiles',canonical_metrics.profiles,
    'profileRate',case when canonical_metrics.accounts=0 then null else canonical_metrics.profiles::numeric/canonical_metrics.accounts end,
    'fanPassports',canonical_metrics.passports,
    'fanPassportRate',case when canonical_metrics.accounts=0 then null else canonical_metrics.passports::numeric/canonical_metrics.accounts end,
    'adminAllowlistedAccounts',canonical_metrics.admin_allowlisted,
    'testAccountsExcluded',false
  ),
  'projectionCoverage',jsonb_build_object(
    'accountCreated',jsonb_build_object(
      'sourceRows',canonical_metrics.accounts,'projectedRows',canonical_metrics.account_projections,
      'rate',case when canonical_metrics.accounts=0 then null else canonical_metrics.account_projections::numeric/canonical_metrics.accounts end
    ),
    'profileCompleted',jsonb_build_object(
      'sourceRows',profile_projection_metrics.source_profiles,'projectedRows',profile_projection_metrics.profile_projections,
      'rate',case when profile_projection_metrics.source_profiles=0 then null else profile_projection_metrics.profile_projections::numeric/profile_projection_metrics.source_profiles end
    )
  )
) as signup_conversion_funnel
from guide_metrics cross join guide_dimensions cross join verify_cta_metrics cross join guest_signup_funnel
cross join attempt_metrics cross join attempt_triggers cross join failure_breakdown
cross join wallet_diagnostic_metrics cross join inconsistent_results cross join canonical_metrics cross join profile_projection_metrics
\gset signup_report_

select :'signup_report_signup_conversion_funnel'::jsonb as signup_conversion_funnel;

\if :{?signup_report_embedded}
\else
rollback;
\endif
