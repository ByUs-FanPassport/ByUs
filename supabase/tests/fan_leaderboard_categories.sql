begin;

create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected error %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error was not raised: %',expected; end if;
end $$;

do $$
declare
  creator uuid:=extensions.gen_random_uuid();
  other_creator uuid:=extensions.gen_random_uuid();
  slug text:='qa-leaderboard-'||replace(creator::text,'-','');
  other_slug text:='qa-leaderboard-'||replace(other_creator::text,'-','');
  owners uuid[]:='{}';
  owner uuid;
  activity uuid;
  result jsonb;
  legacy jsonb;
  i integer;
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,fan_count,roles,primary_role) values
    (creator,slug,'published','/images/guest-home/kara-card.jpg',now(),0,'{artist}','idol'),
    (other_creator,other_slug,'published','/images/guest-home/kara-card.jpg',now(),0,'{artist}','idol');

  alter table public.fan_reactions disable trigger all;
  for i in 1..103 loop
    owner:=extensions.gen_random_uuid();
    owners:=array_append(owners,owner);
    insert into public.app_users(id,privy_user_id,verified_email)
      values(owner,'did:privy:qa-leaderboard-'||owner::text,owner::text||'@example.test');
    insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,completed_at)
      values(extensions.gen_random_uuid(),owner,creator,extensions.gen_random_uuid(),'2026-01-01 00:00:00+00'::timestamptz+make_interval(secs=>i));
  end loop;
  alter table public.fan_reactions enable trigger all;
  insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values(owners[1],'첫 번째 팬','첫 번째 팬');

  alter table public.fan_activities disable trigger user;
  alter table public.fan_score_ledger disable trigger all;
  for i in 1..101 loop
    activity:=extensions.gen_random_uuid();
    insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
      values(activity,owners[i],creator,'attendance','qa_attendance',extensions.gen_random_uuid());
    insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points)
      values(owners[i],creator,activity,3);
  end loop;
  activity:=extensions.gen_random_uuid();
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
    values(activity,owners[1],creator,'knowledge','qa_knowledge',extensions.gen_random_uuid());
  insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points) values(owners[1],creator,activity,1);
  activity:=extensions.gen_random_uuid();
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
    values(activity,owners[1],creator,'reservation','qa_reservation',extensions.gen_random_uuid());
  insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points) values(owners[1],creator,activity,1);
  activity:=extensions.gen_random_uuid();
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
    values(activity,owners[102],creator,'survey','qa_mission',extensions.gen_random_uuid());
  insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points) values(owners[102],creator,activity,2);
  insert into public.fan_score_ledger(app_user_id,celebrity_id,manual_submission_id,points)
    values(owners[103],creator,extensions.gen_random_uuid(),4);
  insert into public.fan_score_ledger(app_user_id,celebrity_id,adjustment_id,points) values
    (owners[1],creator,extensions.gen_random_uuid(),10),
    (owners[1],creator,extensions.gen_random_uuid(),-5);
  activity:=extensions.gen_random_uuid();
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id)
    values(activity,owners[102],other_creator,'knowledge','qa_other_creator',extensions.gen_random_uuid());
  insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points)
    values(owners[102],other_creator,activity,50);
  alter table public.fan_score_ledger enable trigger all;
  alter table public.fan_activities enable trigger user;

  result:=public.read_celebrity_fan_leaderboard(slug,owners[102],'ko','all');
  if result->>'fanCount'<>'103' or result->>'membershipCount'<>'0' or result->>'available'<>'true'
    or jsonb_array_length(result->'rows')<>100 or result#>>'{me,rank}'<>'103' or result#>>'{me,points}'<>'2'
    or result#>>'{rows,0,points}'<>'10'
  then raise exception 'All-category score, Top100, or current-fan projection failed: %',result; end if;

  result:=public.read_celebrity_fan_leaderboard(slug,owners[1],'ko','live');
  if result->>'fanCount'<>'103' or jsonb_array_length(result->'rows')<>100
    or result#>>'{me,rank}'<>'1' or result#>>'{me,points}'<>'4'
  then raise exception 'Live reservation/attendance grouping or tie order failed: %',result; end if;
  result:=public.read_celebrity_fan_leaderboard(slug,owners[102],'ko','mission');
  if jsonb_array_length(result->'rows')<>1 or result#>>'{me,rank}'<>'1' or result#>>'{me,points}'<>'2'
  then raise exception 'Category-specific fan outside global Top100 failed: %',result; end if;
  result:=public.read_celebrity_fan_leaderboard(slug,owners[102],'ko','knowledge');
  if jsonb_array_length(result->'rows')<>1 or result#>>'{rows,0,points}'<>'1' or result->'me'<>'null'::jsonb
  then raise exception 'Knowledge category leaked zero-score or unrelated creator ledger: %',result; end if;
  result:=public.read_celebrity_fan_leaderboard(slug,owners[103],'ko','certification');
  if jsonb_array_length(result->'rows')<>1 or result#>>'{me,points}'<>'4'
  then raise exception 'Manual certification category failed: %',result; end if;
  if result::text ~ '(appUserId|privy|email|manual_submission|adjustment)' then
    raise exception 'Leaderboard leaked private identity or provenance: %',result;
  end if;

  legacy:=public.read_celebrity_fan_leaderboard(slug,owners[1],'ko')-'asOf';
  if legacy is distinct from public.read_celebrity_fan_leaderboard(slug,owners[1])-'asOf'
    or legacy is distinct from public.read_celebrity_fan_leaderboard(slug,owners[1],'ko','all')-'asOf'
  then raise exception 'Backward-compatible overloads diverged'; end if;

  alter table public.fan_reactions disable trigger all;
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,completed_at)
    select extensions.gen_random_uuid(),owners[g.n],other_creator,extensions.gen_random_uuid(),now()+make_interval(secs=>g.n)
    from generate_series(1,99) g(n);
  alter table public.fan_reactions enable trigger all;
  result:=public.read_celebrity_fan_leaderboard(other_slug,null,'ko','mission');
  if result->>'fanCount'<>'99' or result->>'available'<>'false' or jsonb_array_length(result->'rows')<>0 then
    raise exception '99-fan boundary failed: %',result;
  end if;
  alter table public.fan_reactions disable trigger all;
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,completed_at)
    values(extensions.gen_random_uuid(),owners[100],other_creator,extensions.gen_random_uuid(),now()+interval '100 seconds');
  alter table public.fan_reactions enable trigger all;
  result:=public.read_celebrity_fan_leaderboard(other_slug,null,'ko','mission');
  if result->>'fanCount'<>'100' or result->>'available'<>'true' or jsonb_array_length(result->'rows')<>0 then
    raise exception '100-fan boundary or category zero-score exclusion failed: %',result;
  end if;

  perform pg_temp.expect_error(format('select public.read_celebrity_fan_leaderboard(%L,null,%L,%L)',slug,'ko','other'),'invalid leaderboard category');
  perform pg_temp.expect_error(format('select public.read_celebrity_fan_leaderboard(%L,null,%L,%L)',slug,'ko',''),'invalid leaderboard category');
  perform pg_temp.expect_error(format('select public.read_celebrity_fan_leaderboard(%L,null,%L,null)',slug,'ko'),'invalid leaderboard category');

  if has_function_privilege('anon','public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text)','EXECUTE')
    or has_function_privilege('authenticated','public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text)','EXECUTE')
    or not has_function_privilege('service_role','public.read_celebrity_fan_leaderboard(text,uuid,public.content_locale,text)','EXECUTE')
  then raise exception 'Category leaderboard RPC authority exposed or missing'; end if;
  raise notice 'PASS category scores, adjustments, creator isolation, Top100/me, 99/100 boundary, DTO and RPC ACL';
end $$;

rollback;
