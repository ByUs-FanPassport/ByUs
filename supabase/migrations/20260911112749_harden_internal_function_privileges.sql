-- The BFF verifies Privy and supplies actor/owner IDs. These routines are not
-- direct client APIs: SECURITY DEFINER plus the default PUBLIC EXECUTE grant
-- otherwise lets callers bypass that BFF identity boundary.
revoke execute on function public.assert_active_admin(uuid,uuid,boolean) from public, anon, authenticated;
revoke execute on function public.assert_benefit_application_eligibility(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.assert_legacy_live_survey_publishable(uuid) from public, anon, authenticated;
revoke execute on function public.assert_live_survey_publishable(uuid) from public, anon, authenticated;
revoke execute on function public.assert_notice_publishable(uuid) from public, anon, authenticated;
revoke execute on function public.save_admin_celebrity_notice(uuid,uuid,uuid,uuid,integer,uuid,text,boolean,text,jsonb,text,jsonb) from public, anon, authenticated;
revoke execute on function public.set_admin_celebrity_notice_state(uuid,uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;

-- Preserve both BFF calls and invoker publication triggers. Production already
-- grants service_role EXECUTE through Supabase defaults; local replay must not
-- depend on platform defaults for the same behavior.
grant execute on function public.assert_active_admin(uuid,uuid,boolean) to service_role;
grant execute on function public.assert_benefit_application_eligibility(uuid,uuid) to service_role;
grant execute on function public.assert_legacy_live_survey_publishable(uuid) to service_role;
grant execute on function public.assert_live_survey_publishable(uuid) to service_role;
grant execute on function public.assert_notice_publishable(uuid) to service_role;
grant execute on function public.save_admin_celebrity_notice(uuid,uuid,uuid,uuid,integer,uuid,text,boolean,text,jsonb,text,jsonb) to service_role;
grant execute on function public.set_admin_celebrity_notice_state(uuid,uuid,uuid,uuid,integer,text,text) to service_role;

-- Defaults apply to the migration owner (postgres in Supabase). A per-schema
-- REVOKE cannot cancel PostgreSQL's global PUBLIC default, so remove both the
-- global default and Supabase's additional public-schema role grants.
-- Other function-creating roles require the same policy before use; the SQL
-- regression gate checks effective grants for all existing routine owners.
alter default privileges revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
