-- Run against the authorized Dev database after 030000 and 050000 migrations.
-- All fixture users, ledgers, content and events roll back; workers cannot see them.
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
declare creator uuid:=extensions.gen_random_uuid();quiz uuid:=extensions.gen_random_uuid();
  owner uuid;first_owner uuid;second_owner uuid;last_owner uuid;attempt uuid;pass uuid;activity uuid;
  slug text:='qa-fanpage-'||replace(creator::text,'-','');result jsonb;again jsonb;
  notice uuid:=extensions.gen_random_uuid();comment uuid;idem uuid:=extensions.gen_random_uuid();
  admin_id uuid:=extensions.gen_random_uuid();viewer_id uuid:=extensions.gen_random_uuid();i integer;
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,fan_count)
    values(creator,slug,'published','/images/guest-home/kara-card.jpg',now(),12800000);
  insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values(quiz,creator,1,'published',now());
  for i in 1..501 loop
    owner:=extensions.gen_random_uuid();attempt:=extensions.gen_random_uuid();pass:=extensions.gen_random_uuid();
    insert into public.app_users(id,privy_user_id,verified_email) values(owner,'did:privy:qa-fanpage-'||owner::text,owner::text||'@example.test');
    insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at)
      values(attempt,owner,creator,quiz,1,extensions.gen_random_uuid(),'passed',3,now());
    insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values(pass,owner,creator,attempt);
    insert into public.fan_passports(app_user_id,celebrity_id,quiz_pass_id,issued_at) values(owner,creator,pass,now()-make_interval(secs=>502-i));
    if i=1 then first_owner:=owner; end if;
    if i=2 then second_owner:=owner; end if;
    if i=500 then
      result:=public.read_celebrity_fan_leaderboard(slug,owner);
      if result->>'membershipCount'<>'500' or result->>'available'<>'false' or result->'rows'<>'[]'::jsonb or result->'me'<>'null'::jsonb then raise exception '500 boundary failed'; end if;
    end if;
    last_owner:=owner;
  end loop;
  if (select count(*) from public.fan_product_events where celebrity_id=creator and event_name='passport_issued')<>501 then raise exception 'Committed passport events missing'; end if;
  if (select count(*) from public.fan_product_events where celebrity_id=creator and event_name='ticket_credited')<>501 then raise exception 'Committed ticket events missing'; end if;
  result:=public.read_celebrity_fan_leaderboard(slug,last_owner);
  if result->>'membershipCount'<>'501' or result->>'available'<>'true' or jsonb_array_length(result->'rows')<>100 or result#>>'{me,rank}'<>'501' then raise exception '501 boundary or outside Top100 owner failed'; end if;
  if result::text ~ '(appUserId|privy|email|wallet)' then raise exception 'Public ranking leaked private identity'; end if;
  update public.app_users set status='disabled' where id=last_owner;
  if public.read_celebrity_fan_leaderboard(slug,last_owner)->>'available'<>'false' then raise exception 'Disabled user counted'; end if;
  update public.app_users set status='active' where id=last_owner;
  insert into public.fan_activities(app_user_id,celebrity_id,activity_type,source_type,source_id)
    values(last_owner,creator,'knowledge','quiz_pass',pass) returning id into activity;
  insert into public.fan_score_ledger(app_user_id,celebrity_id,activity_id,points) values(last_owner,creator,activity,1);
  result:=public.read_celebrity_fan_leaderboard(slug,last_owner);
  if result#>>'{me,rank}'<>'1' or result#>>'{me,points}'<>'1' then raise exception 'Lifetime score ordering failed'; end if;
  raise notice 'PASS leaderboard 500/501, Top100, own rank outside100, inactive exclusion, lifetime score, no private fields';

  if public.read_celebrity_fanpage(slug)->'activity'<>'[]'::jsonb then raise exception 'Default activity consent was not OFF'; end if;
  if public.read_owned_fan_activity_visibility(first_owner)->>'enabled'<>'false' then raise exception 'Missing visibility default incorrect'; end if;
  perform public.set_owned_fan_activity_visibility(first_owner,true);
  result:=public.read_celebrity_fanpage(slug);
  if jsonb_array_length(result->'activity')<>1 or result#>>'{activity,0,kind}'<>'joined' then raise exception 'Opt-in activity missing'; end if;
  perform public.set_owned_fan_activity_visibility(first_owner,false);
  if public.read_celebrity_fanpage(slug)->'activity'<>'[]'::jsonb then raise exception 'Revoked activity still public'; end if;
  raise notice 'PASS activity defaultOFF, opt-in and revocation';

  insert into public.celebrity_notices(id,celebrity_id,slug,publication_status,published_at,ever_published_at)
    values(notice,creator,'qa-notice','published',now(),now());
  result:=public.post_celebrity_notice_comment(first_owner,slug,'qa-notice','응원해요',idem);comment:=(result->>'id')::uuid;
  again:=public.post_celebrity_notice_comment(first_owner,slug,'qa-notice','응원해요',idem);
  if again->>'id'<>comment::text or again->>'replayed'<>'true' then raise exception 'Comment replay failed'; end if;
  perform pg_temp.expect_error(format('select public.post_celebrity_notice_comment(%L,%L,%L,%L,%L)',first_owner,slug,'qa-notice','다른 본문',idem),'FANPAGE_IDEMPOTENCY_CONFLICT');
  perform pg_temp.expect_error(format('select public.remove_owned_notice_comment(%L,%L)',second_owner,comment),'FANPAGE_NOT_FOUND');
  result:=public.read_celebrity_notice_comments(slug,'qa-notice',first_owner);
  if result#>>'{comments,0,isOwner}'<>'true' then raise exception 'Owner projection missing'; end if;
  result:=public.read_celebrity_notice_comments(slug,'qa-notice',second_owner);
  if result#>>'{comments,0,isOwner}'<>'false' then raise exception 'Foreign owner projection wrong'; end if;
  for i in 1..4 loop perform public.post_celebrity_notice_comment(first_owner,slug,'qa-notice','추가 댓글'||i,extensions.gen_random_uuid()); end loop;
  perform pg_temp.expect_error(format('select public.post_celebrity_notice_comment(%L,%L,%L,%L,%L)',first_owner,slug,'qa-notice','제한 댓글',extensions.gen_random_uuid()),'FANPAGE_RATE_LIMITED');
  perform public.remove_owned_notice_comment(first_owner,comment);
  if public.read_celebrity_notice_comments(slug,'qa-notice')->>'total'<>'4' then raise exception 'Removed comment still public'; end if;
  if (select count(*) from public.celebrity_notice_comments where id=comment)<>1 then raise exception 'Comment history physically deleted'; end if;
  result:=public.read_celebrity_notice_comments(slug,'qa-notice',null,null,null,2);
  again:=public.read_celebrity_notice_comments(slug,'qa-notice',null,(result#>>'{comments,1,createdAt}')::timestamptz,(result#>>'{comments,1,id}')::uuid,2);
  if jsonb_array_length(again->'comments')<>2 or result#>>'{comments,0,id}'=again#>>'{comments,0,id}' then raise exception 'Keyset pagination failed'; end if;

  insert into public.admin_allowlist(id,email,role) values(admin_id,first_owner::text||'@example.test','operator'),(viewer_id,second_owner::text||'@example.test','viewer');
  comment:=(result#>>'{comments,0,id}')::uuid;
  perform pg_temp.expect_error(format('select public.hide_admin_notice_comment(%L,%L,%L,%L,%L)',second_owner,viewer_id,extensions.gen_random_uuid(),comment,'운영 기준 위반'),'viewer is read-only');
  perform public.hide_admin_notice_comment(first_owner,admin_id,extensions.gen_random_uuid(),comment,'운영 기준 위반');
  perform public.hide_admin_notice_comment(first_owner,admin_id,extensions.gen_random_uuid(),comment,'운영 기준 위반');
  if (select count(*) from public.audit_logs where action='notice.comment.hide' and entity_id=comment::text)<>1 then raise exception 'Hide audit duplicated'; end if;
  update public.celebrity_notices set publication_status='draft',published_at=null where id=notice;
  if public.read_celebrity_notice_comments(slug,'qa-notice') is not null then raise exception 'Hidden notice comments public'; end if;
  raise notice 'PASS comments owner/admin scopes, replay/conflict, rate limit, softdelete/audit, keyset and notice visibility';

  if has_function_privilege('anon','public.read_celebrity_fan_leaderboard(text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.post_celebrity_notice_comment(uuid,text,text,text,uuid)','EXECUTE') or has_table_privilege('service_role','public.celebrity_notice_comments','SELECT') then raise exception 'Direct database authority exposed'; end if;
  if not has_function_privilege('service_role','public.read_celebrity_fanpage(text)','EXECUTE') then raise exception 'Server read missing'; end if;
  raise notice 'PASS anonymous/authenticated table and RPC ACL';
end $$;
rollback;
