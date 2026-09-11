-- Admin member-population regression.
-- Run with psql -v ON_ERROR_STOP=1 against a disposable clean-replay database.
-- All fixtures are rolled back.
begin;

insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
  ('a9000000-0000-4000-8000-000000000001','did:privy:fan-population-admin','fan-population-admin@byus.test','active','2099-01-01 00:00:00+00'),
  ('a9000000-0000-4000-8000-000000000002','did:privy:no-passport-no-profile','no-profile@byus.test','active','2099-01-01 05:00:00+00'),
  ('a9000000-0000-4000-8000-000000000003','did:privy:disabled-no-passport','disabled@byus.test','disabled','2099-01-01 04:00:00+00'),
  ('a9000000-0000-4000-8000-000000000004','did:privy:passport-one','passport-one@byus.test','active','2099-01-01 03:00:00+00'),
  ('a9000000-0000-4000-8000-000000000005','did:privy:passport-two','passport-two@byus.test','active','2099-01-01 02:00:00+00');
insert into public.admin_allowlist(id,email,role,active) values
  ('a9000000-0000-4000-8000-000000000010','fan-population-admin@byus.test','viewer',true);
insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
  ('a9000000-0000-4000-8000-000000000003','비활성팬','비활성팬'),
  ('a9000000-0000-4000-8000-000000000004','PassportFan','passportfan'),
  ('a9000000-0000-4000-8000-000000000005','다른팬','다른팬');
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('a9000000-0000-4000-8000-000000000003',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0003','privy','embedded'),
  ('a9000000-0000-4000-8000-000000000004',91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0004','privy','embedded');

insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
  ('a9100000-0000-4000-8000-000000000001','fan-population-one','published','/fan-population-one.webp',now(),'{artist}','idol'),
  ('a9100000-0000-4000-8000-000000000002','fan-population-two','published','/fan-population-two.webp',now(),'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('a9100000-0000-4000-8000-000000000001','ko','첫 번째 크리에이터','첫 번째','첫 번째'),
  ('a9100000-0000-4000-8000-000000000001','en','First Creator','First','First'),
  ('a9100000-0000-4000-8000-000000000002','ko','두 번째 크리에이터','두 번째','두 번째'),
  ('a9100000-0000-4000-8000-000000000002','en','Second Creator','Second','Second');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
  ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001',1,'published',now()),
  ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002',1,'published',now());
insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('a9300000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000001','a9200000-0000-4000-8000-000000000001',1,'a9300000-0000-4000-8000-000000000011','passed',3,now()),
  ('a9300000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000005','a9100000-0000-4000-8000-000000000002','a9200000-0000-4000-8000-000000000002',1,'a9300000-0000-4000-8000-000000000012','passed',3,now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('a9400000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001'),
  ('a9400000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000005','a9100000-0000-4000-8000-000000000002','a9300000-0000-4000-8000-000000000002');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('a9500000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000004','a9100000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001'),
  ('a9500000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000005','a9100000-0000-4000-8000-000000000002','a9400000-0000-4000-8000-000000000002');

do $$
declare
  all_ko jsonb;
  all_en jsonb;
  disabled_members jsonb;
  email_result jsonb;
  nickname_result jsonb;
  creator_result jsonb;
  page_one jsonb;
  page_two jsonb;
  detail jsonb;
  page_cursor jsonb;
begin
  select coalesce(jsonb_agg(value),'[]'::jsonb) into all_ko
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000001',
    'ko',null,null,null,null,null,100
  ) value;
  if not exists (
    select 1 from jsonb_array_elements(all_ko) member
    where member->>'fanId'='a9000000-0000-4000-8000-000000000002'
      and member->'nickname'='null'::jsonb
      and member->'maskedWallet'='null'::jsonb
      and member->'celebritySummaries'='[]'::jsonb
      and member->>'accountStatus'='active'
  ) then
    raise exception 'ADMIN_FAN_POPULATION_MISSING_ACCOUNT_WITHOUT_PASSPORT';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(all_ko) member
    where member->>'fanId'='a9000000-0000-4000-8000-000000000004'
      and member->>'nickname'='PassportFan'
      and member->>'maskedWallet'='0xaaaa…0004'
      and member->'celebritySummaries'->0->'celebrity'->>'name'='첫 번째 크리에이터'
      and member->'celebritySummaries'->0->'activityCounts' ? 'membership'
  ) then
    raise exception 'admin fan Korean journey or membership fields changed';
  end if;
  if all_ko::text like '%@byus.test%' or all_ko::text like '%did:privy:%' then
    raise exception 'admin fan list exposed private identity values';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into all_en
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000002',
    'en',null,null,null,null,null,100
  ) value;
  if not exists (
    select 1 from jsonb_array_elements(all_en) member
    where member->>'fanId'='a9000000-0000-4000-8000-000000000004'
      and member->'celebritySummaries'->0->'celebrity'->>'name'='First Creator'
  ) then
    raise exception 'admin fan English localization changed';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into disabled_members
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000003',
    'ko',null,null,'disabled',null,null,100
  ) value;
  if jsonb_array_length(disabled_members)<>1
     or disabled_members->0->>'fanId'<>'a9000000-0000-4000-8000-000000000003'
     or disabled_members->0->>'nickname'<>'비활성팬'
     or disabled_members->0->>'maskedWallet'<>'0xaaaa…0003'
     or disabled_members->0->'celebritySummaries'<>'[]'::jsonb then
    raise exception 'account-status or no-passport member projection changed';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into email_result
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000004',
    'ko','DISABLED@BYUS.TEST',null,null,null,null,100
  ) value;
  if jsonb_array_length(email_result)<>1
     or email_result->0->>'fanId'<>'a9000000-0000-4000-8000-000000000003'
     or email_result::text like '%disabled@byus.test%' then
    raise exception 'private exact-email search contract changed';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into nickname_result
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000005',
    'ko','PORTFAN',null,null,null,null,100
  ) value;
  if jsonb_array_length(nickname_result)<>1
     or nickname_result->0->>'fanId'<>'a9000000-0000-4000-8000-000000000004' then
    raise exception 'normalized nickname search changed';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into creator_result
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000006',
    'ko',null,'a9100000-0000-4000-8000-000000000001',null,null,null,100
  ) value;
  if jsonb_array_length(creator_result)<>1
     or creator_result->0->>'fanId'<>'a9000000-0000-4000-8000-000000000004'
     or jsonb_array_length(creator_result->0->'celebritySummaries')<>1 then
    raise exception 'explicit creator filter included a non-holder or excluded its holder';
  end if;

  select coalesce(jsonb_agg(value),'[]'::jsonb) into page_one
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000007',
    'ko',null,null,'active',null,null,2
  ) value;
  if jsonb_array_length(page_one)<>2
     or page_one->0->>'fanId'<>'a9000000-0000-4000-8000-000000000002'
     or page_one->1->>'fanId'<>'a9000000-0000-4000-8000-000000000004' then
    raise exception 'first member cursor page changed';
  end if;
  page_cursor:=page_one->1->'cursor';
  select coalesce(jsonb_agg(value),'[]'::jsonb) into page_two
  from public.get_admin_fans(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000008',
    'ko',null,null,'active',(page_cursor->>'createdAt')::timestamptz,(page_cursor->>'id')::uuid,2
  ) value;
  if not exists (
    select 1 from jsonb_array_elements(page_two) member
    where member->>'fanId'='a9000000-0000-4000-8000-000000000005'
  ) or exists (
    select 1 from jsonb_array_elements(page_two) member
    where member->>'fanId'='a9000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'member cursor repeated or skipped the next fixture';
  end if;

  detail:=public.get_admin_fan_detail(
    'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000010','aa000000-0000-4000-8000-000000000009',
    'a9000000-0000-4000-8000-000000000002','ko'
  );
  if detail->>'fanId'<>'a9000000-0000-4000-8000-000000000002'
     or detail->'nickname'<>'null'::jsonb
     or detail->'wallets'<>'[]'::jsonb
     or detail->'passports'<>'[]'::jsonb
     or detail::text like '%@byus.test%'
     or detail::text like '%did:privy:%' then
    raise exception 'detail for account without profile, wallet, or passport changed';
  end if;

  if (select count(*) from public.audit_logs where correlation_id between
      'aa000000-0000-4000-8000-000000000001' and 'aa000000-0000-4000-8000-000000000009')<>9
     or (select count(*) from public.audit_logs where correlation_id between
      'aa000000-0000-4000-8000-000000000001' and 'aa000000-0000-4000-8000-000000000008'
      and action='admin.fans.read')<>8
     or not exists(select 1 from public.audit_logs where correlation_id='aa000000-0000-4000-8000-000000000009' and action='admin.fan_detail.read') then
    raise exception 'admin member read audit coverage changed';
  end if;

  if has_function_privilege('anon','public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.get_admin_fans(uuid,uuid,uuid,public.content_locale,text,uuid,public.app_user_status,timestamptz,uuid,integer)','EXECUTE')
    or has_function_privilege('anon','public.get_admin_fan_detail(uuid,uuid,uuid,uuid,public.content_locale)','EXECUTE')
    or has_function_privilege('authenticated','public.get_admin_fan_detail(uuid,uuid,uuid,uuid,public.content_locale)','EXECUTE')
    or not has_function_privilege('service_role','public.get_admin_fan_detail(uuid,uuid,uuid,uuid,public.content_locale)','EXECUTE') then
    raise exception 'admin member RPC privilege boundary changed';
  end if;
end $$;

select 'admin fan population behavioral verification passed' as result;
rollback;
