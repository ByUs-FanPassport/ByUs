-- Local synthetic fixtures only. Never run this file against production.
-- Default: assert fixed permissions. Set expect_denied=false only for the
-- pre-migration regression fixture; all writes are rolled back in either mode.
\set ON_ERROR_STOP on
\if :{?expect_denied}
\else
\set expect_denied true
\endif
begin;
select set_config('byus.security_expect_denied', :'expect_denied', true);

insert into public.app_users(id,privy_user_id,verified_email) values
('a9100000-0000-4000-8000-000000000001','did:privy:security-fixture-owner','security-owner@example.invalid'),
('a9100000-0000-4000-8000-000000000002','did:privy:security-fixture-admin','security-admin@example.invalid');
insert into public.admin_allowlist(id,email,role,active) values
('a9100000-0000-4000-8000-000000000003','security-admin@example.invalid','admin',true);
insert into public.celebrities(id,slug,status,image_url,roles,primary_role) values
('a9100000-0000-4000-8000-000000000004','security-acl-fixture','draft','/fixture.webp','{artist}','idol');
insert into public.celebrity_quizzes(id,celebrity_id,version,status) values
('a9100000-0000-4000-8000-000000000005','a9100000-0000-4000-8000-000000000004',1,'draft');
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
('a9100000-0000-4000-8000-000000000006','a9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000005',1,'a9100000-0000-4000-8000-000000000007','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
('a9100000-0000-4000-8000-000000000008','a9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000006');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
('a9100000-0000-4000-8000-000000000009','a9100000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000008');
insert into public.benefits(id,slug,celebrity_id,delivery_type,claim_opens_at,claim_closes_at) values
('a9100000-0000-4000-8000-000000000010','security-acl-benefit','a9100000-0000-4000-8000-000000000004','text',now()-interval '1 hour',now()+interval '1 day');

-- Finish unrelated fixture triggers under their creating role before testing
-- BFF notice commands; public content helpers are deliberately internal.
set constraints all immediate;
set constraints all deferred;

do $$
declare
  role_name text;
  denied boolean;
  expected_denial boolean := current_setting('byus.security_expect_denied')::boolean;
  notice_id uuid;
  passport public.fan_passports;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    execute format('set local role %I', role_name);
    denied := false;
    begin
      notice_id := public.save_admin_celebrity_notice(
        'a9100000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000003',
        'a9100000-0000-4000-8000-000000000011',null,null,'a9100000-0000-4000-8000-000000000004',
        'security-'||replace(role_name,'_','-'),false,'보안 검증','{"type":"doc","content":[]}',
        'Security fixture','{"type":"doc","content":[]}');
    exception when insufficient_privilege then denied := true;
    end;
    if denied is distinct from (expected_denial and role_name <> 'service_role') then
      raise exception 'Notice creation permission mismatch for % (denied=%)',role_name,denied;
    end if;
    denied := false;
    begin
      perform public.set_admin_celebrity_notice_state(
        'a9100000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000003',
        'a9100000-0000-4000-8000-000000000011',notice_id,1,'unpublish',null);
    exception when insufficient_privilege then denied := true;
    end;
    if denied is distinct from (expected_denial and role_name <> 'service_role') then
      raise exception 'Notice state permission mismatch for % (denied=%)',role_name,denied;
    end if;
    denied := false;
    begin
      passport := public.assert_benefit_application_eligibility(
        'a9100000-0000-4000-8000-000000000010','a9100000-0000-4000-8000-000000000001');
      if passport.id is distinct from 'a9100000-0000-4000-8000-000000000009'::uuid then
        raise exception 'Expected synthetic owner passport';
      end if;
    exception when insufficient_privilege then denied := true;
    end;
    if denied is distinct from (expected_denial and role_name <> 'service_role') then
      raise exception 'Passport helper permission mismatch for % (denied=%)',role_name,denied;
    end if;
    reset role;
  end loop;
end $$;

\if :expect_denied
-- There are currently no intentional direct anon/authenticated public RPCs.
-- Future exceptions require an explicit reviewed signature, never a name prefix.
do $$
declare exposed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into exposed from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef
    and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
  if exposed is not null then raise exception 'Public SECURITY DEFINER exposure: %',exposed; end if;
end $$;

-- Exercise effective defaults rather than grepping migration source.
create function public.security_acl_future_fixture() returns boolean
language sql security definer set search_path='' as $$ select true $$;
do $$ begin
  if has_function_privilege('anon','public.security_acl_future_fixture()','EXECUTE')
    or has_function_privilege('authenticated','public.security_acl_future_fixture()','EXECUTE') then
    raise exception 'New function defaults re-open the public RPC boundary';
  end if;
end $$;
\endif

-- Fire the deferred publication trigger as the real BFF database role too.
set local role service_role;
set constraints all immediate;
reset role;
select jsonb_build_object('status','PASS','expectedDenied', :'expect_denied'::boolean,
  'rolesChecked',3,'operationsPerRole',3,'syntheticOnly',true) as security_acl_result;
rollback;
