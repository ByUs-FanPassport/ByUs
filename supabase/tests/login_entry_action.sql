-- Local disposable DB only. No production fixtures; all writes roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  common jsonb := '{"channel":"direct","landing":"creator","guide":"none","browser":"chrome","os":"other","locale":"ko","provider":"google","trigger":"provider"}';
  diagnostic jsonb := '{"walletWaitOutcome":"succeeded","walletWaitMs":1200,"walletReconciliation":"not_needed","walletReconciliationMs":0}';
  props jsonb; v jsonb; action text; event text; suffix text; k text; result jsonb; replay jsonb; rejected boolean;
begin
  foreach action in array array['daily_checkin','cheer','passport_share','other'] loop
    foreach event in array array['login_started','login_result'] loop
      props := common||jsonb_build_object('entryAction',action);
      suffix := case when event='login_started' then 'started' else 'succeeded' end;
      if event='login_result' then props:=props||'{"outcome":"succeeded","stage":"session","reason":"none"}'; end if;
      k:='signup-login:'||extensions.gen_random_uuid()::text||':'||suffix;
      result:=public.record_product_event_v1(1::smallint,event,null,repeat('a',64),null,null,null,null,'signup.login',k,now(),props);
      replay:=public.record_product_event_v1(1::smallint,event,null,repeat('a',64),null,null,null,null,'signup.login',k,now(),props);
      if not (replay->>'replayed')::boolean or result->>'id'<>replay->>'id' then raise exception 'entry replay failed'; end if;
      if event='login_result' then
        perform public.record_product_event_v1(1::smallint,event,null,repeat('a',64),null,null,null,null,'signup.login','signup-login:'||extensions.gen_random_uuid()::text||':succeeded',now(),props||diagnostic);
      end if;
    end loop;
  end loop;
  for v in select value from jsonb_array_elements('[null,[],{},12,"invite","/s/private","someone@example.test"]') loop
    rejected:=false;
    begin
      perform public.record_product_event_v1(1::smallint,'login_started',null,repeat('a',64),null,null,null,null,'signup.login','signup-login:'||extensions.gen_random_uuid()::text||':started',now(),common||jsonb_build_object('entryAction',v));
    exception when sqlstate '22023' then rejected:=true; end;
    if not rejected then raise exception 'invalid entry accepted'; end if;
  end loop;
  for props in select value from jsonb_array_elements(jsonb_build_array(
    common||'{"entryAction":"cheer","rawUrl":"private"}'::jsonb,
    common||'{"entryAction":"cheer","outcome":"succeeded","stage":"session","reason":"none","walletWaitMs":1}'::jsonb,
    (common||'{"entryAction":"cheer","outcome":"succeeded","stage":"session","reason":"none"}'::jsonb||diagnostic)-'walletReconciliationMs'
  )) loop
    rejected:=false;
    event:=case when props ? 'outcome' then 'login_result' else 'login_started' end;
    suffix:=case when event='login_started' then 'started' else 'succeeded' end;
    begin
      perform public.record_product_event_v1(1::smallint,event,null,repeat('a',64),null,null,null,null,'signup.login','signup-login:'||extensions.gen_random_uuid()::text||':'||suffix,now(),props);
    exception when sqlstate '22023' then rejected:=true; end;
    if not rejected then raise exception 'unknown/partial wallet property accepted'; end if;
  end loop;
  rejected:=false;
  begin
    perform public.record_product_event_v1(1::smallint,'signup_guide_view',null,repeat('a',64),null,null,null,null,'signup.guide','signup-guide:'||extensions.gen_random_uuid()::text||':view',now(),(common-'provider'-'trigger')||'{"audience":"guest","entryAction":"cheer"}'::jsonb);
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'guide entry action accepted'; end if;
end $$;
-- Source-attributed groups; missing legacy differs from measured other. Result
-- category intentionally differs for cheer to prove attribution comes from start.
do $$
declare common jsonb := '{"channel":"direct","landing":"creator","guide":"none","browser":"chrome","os":"other","locale":"ko","provider":"google","trigger":"provider"}';
  props jsonb; action text; k text; i integer:=0; ts timestamptz;
begin
  foreach action in array array['unknown','other','cheer','daily_checkin','passport_share'] loop
    i:=i+1;props:=common;
    if action<>'unknown' then props:=props||jsonb_build_object('entryAction',action); end if;
    k:='signup-login:90000000-0000-4000-8000-00000000000'||i::text;
    ts:=now()-interval '20 hours'+case when i=5 then interval '55 minutes' else interval '1 minute' end;
    perform public.record_product_event_v1(1::smallint,'login_started',null,repeat('b',64),null,null,null,null,'signup.login',k||':started',ts,props);
    if i in(2,3) then
      perform public.record_product_event_v1(1::smallint,'login_result',null,repeat('b',64),null,null,null,null,'signup.login',k||':failed',ts+interval '1 minute',props||'{"outcome":"failed","stage":"oauth","reason":"provider_error"}'::jsonb);
    end if;
    if i in(1,3,5) then
      perform public.record_product_event_v1(1::smallint,'login_result',null,repeat('b',64),null,null,null,null,'signup.login',k||':succeeded',ts+case when i=5 then interval '6 minutes' else interval '2 minutes' end,props||'{"entryAction":"other","outcome":"succeeded","stage":"session","reason":"none"}'::jsonb);
    end if;
  end loop;
end $$;
\set signup_report_embedded true
select (now()-interval '20 hours')::text as fixture_from,(now()-interval '19 hours')::text as fixture_to
\gset
\set from :fixture_from
\set to :fixture_to
\ir ../../scripts/report-signup-conversion-funnel.sql
select set_config('byus.entry_report', :'signup_report_signup_conversion_funnel', true);
do $$
declare report jsonb:=current_setting('byus.entry_report')::jsonb; groups jsonb;
begin
  groups:=report#>'{loginEntryActions,groups}';
  if jsonb_array_length(groups)<>5 or (report#>>'{loginAttempts,attempts}')::int<>5 then raise exception 'entry group totals incorrect'; end if;
  if exists(select 1 from jsonb_array_elements(groups) g where (g->>'attempts')::int<>(g->>'succeeded')::int+(g->>'failed_without_success')::int+(g->>'pending')::int) then raise exception 'entry outcomes do not sum'; end if;
  if not exists(select 1 from jsonb_array_elements(groups) g where g->>'entry_action'='unknown' and (g->>'succeeded')::int=1)
    or not exists(select 1 from jsonb_array_elements(groups) g where g->>'entry_action'='other' and (g->>'failed_without_success')::int=1)
    or not exists(select 1 from jsonb_array_elements(groups) g where g->>'entry_action'='cheer' and (g->>'recovered')::int=1)
    or not exists(select 1 from jsonb_array_elements(groups) g where g->>'entry_action'='daily_checkin' and (g->>'pending')::int=1)
    or not exists(select 1 from jsonb_array_elements(groups) g where g->>'entry_action'='passport_share' and (g->>'pending')::int=1 and g->>'observation_age'='recent')
    then raise exception 'source attribution/legacy/window boundary changed'; end if;
end $$;
select 'login entry contracts and report PASS';
rollback;
