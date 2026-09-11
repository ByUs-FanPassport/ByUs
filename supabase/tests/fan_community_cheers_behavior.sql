begin;

create or replace function pg_temp.expect_error(p_sql text,p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error %',p_message;
exception when others then
  if sqlerrm='expected error '||p_message or position(p_message in sqlerrm)=0 then raise; end if;
end $$;

do $$
declare
  creator uuid := '61000000-0000-4000-8000-000000000001';
  unlocalized uuid := '61000000-0000-4000-8000-000000000002';
  draft_creator uuid := '61000000-0000-4000-8000-000000000003';
  archived_creator uuid := '61000000-0000-4000-8000-000000000004';
  admin_user uuid := '62000000-0000-4000-8000-000000000001';
  admin_allowlist uuid := '63000000-0000-4000-8000-000000000001';
  fan_ids uuid[] := '{}';
  user_id uuid;
  quiz_id uuid := '64000000-0000-4000-8000-000000000010';
  attempt_id uuid;
  pass_id uuid;
  activity_id uuid;
  job_id uuid;
  reaction_id uuid;
  first_id uuid;
  second_id uuid;
  third_id uuid;
  reply_id uuid;
  delete_id uuid;
  hidden_id uuid;
  result jsonb;
  page jsonb;
  replay jsonb;
  i integer;
begin
  insert into public.app_users(id,privy_user_id,verified_email)
  values(admin_user,'did:privy:fan-community-admin','fan-community-admin@example.test');
  insert into public.admin_allowlist(id,email,role)
  values(admin_allowlist,'fan-community-admin@example.test','operator');

  insert into public.celebrities(
    id,slug,status,image_url,published_at,roles,primary_role,
    archived_at,archived_by_admin_allowlist_id,archive_reason
  ) values
    (creator,'fan-community-qa','published','/images/community.webp',now(),'{creator}','creator',null,null,null),
    (unlocalized,'fan-community-unlocalized','published','/images/unlocalized.webp',now(),'{creator}','creator',null,null,null),
    (draft_creator,'fan-community-draft','draft','/images/draft.webp',null,'{creator}','creator',null,null,null),
    (archived_creator,'fan-community-archived','published','/images/archived.webp',now(),'{creator}','creator',now(),admin_allowlist,'팬 커뮤니티 보관 상태 검증 사유');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (creator,'ko','팬 커뮤니티','소개','프로필'),(creator,'en','Fan Community','Summary','Profile'),
    (unlocalized,'ko','한국어 전용','소개','프로필'),
    (draft_creator,'ko','비공개','소개','프로필'),(draft_creator,'en','Draft','Summary','Profile'),
    (archived_creator,'ko','보관됨','소개','프로필'),(archived_creator,'en','Archived','Summary','Profile');

  insert into public.celebrity_quizzes(id,celebrity_id,version,status)
  values(quiz_id,creator,1,'draft');

  for i in 1..28 loop
    user_id := extensions.gen_random_uuid();
    fan_ids := array_append(fan_ids,user_id);
    insert into public.app_users(id,privy_user_id,verified_email)
    values(user_id,'did:privy:fan-community-'||i,user_id::text||'@example.test');
    insert into public.user_profiles(app_user_id,nickname,nickname_normalized)
    values(user_id,'FanQA'||i,lower('FanQA'||i));
    if i=1 then
      insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id,source,object_path)
      values(user_id,'star-pink','star-pink','upload',user_id::text||'/1-64000000-0000-4000-8000-000000000001.webp');
    else
      insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id)
      values(user_id,'star-pink','star-pink');
    end if;
    if i=1 then
      insert into public.fan_activity_visibility(app_user_id,enabled) values(user_id,false);
    elsif i<>27 then
      insert into public.fan_activity_visibility(app_user_id,enabled) values(user_id,true);
    end if;
  end loop;
  update public.app_users set status='disabled' where id=fan_ids[28];

  alter table public.fan_reactions disable trigger user;
  for i in 1..28 loop
    if i=27 then continue; end if;
    job_id := extensions.gen_random_uuid();
    reaction_id := extensions.gen_random_uuid();
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload)
    values(job_id,'reaction',reaction_id,'fan-community-like-'||i,'{}');
    insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,mint_status,completed_at)
    values(reaction_id,fan_ids[i],creator,job_id,case when i%2=0 then 'permanent_failure'::public.credential_mint_status else 'queued'::public.credential_mint_status end,now()-make_interval(secs=>i));
  end loop;
  alter table public.fan_reactions enable trigger user;

  for i in 1..2 loop
    user_id := case when i=1 then fan_ids[1] else fan_ids[27] end;
    attempt_id := extensions.gen_random_uuid();
    pass_id := extensions.gen_random_uuid();
    insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at)
    values(attempt_id,user_id,creator,quiz_id,1,extensions.gen_random_uuid(),'passed',3,now());
    insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id)
    values(pass_id,user_id,creator,attempt_id);
    if i=1 then
      select id into strict reaction_id from public.fan_reactions
      where app_user_id=user_id and celebrity_id=creator;
      activity_id := extensions.gen_random_uuid();
      insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
      select activity_id,user_id,creator,'first_reaction','fan_reaction',reaction_id,completed_at
      from public.fan_reactions where id=reaction_id;
      insert into public.first_reaction_stamps(
        reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id
      ) select id,app_user_id,celebrity_id,null,activity_id,id,mint_status,tx_hash,token_id
        from public.fan_reactions where id=reaction_id;
    end if;
    insert into public.fan_passports(app_user_id,celebrity_id,quiz_pass_id,issued_at)
    values(user_id,creator,pass_id,case when i=1 then now()-interval '100 seconds' else now() end);
  end loop;

  result := public.read_celebrity_fan_community('fan-community-qa','ko');
  if result->>'likeCount'<>'26' or result->>'fanCount'<>'27' or result->>'publicFanCount'<>'27'
     or jsonb_array_length(result->'fans')<>24 then
    raise exception 'reaction/passport audience counts or public bound failed: %',result;
  end if;
  if result#>>'{fans,0,nickname}'<>'FanQA27' or result#>>'{fans,1,nickname}'<>'FanQA1' then
    raise exception 'latest eligible activity ordering failed: %',result;
  end if;
  if result::text not like '%FanQA1%' or result::text not like '%FanQA27%' then
    raise exception 'visibility-false or missing-setting fan was hidden: %',result;
  end if;
  if result::text like '%FanQA28%' then
    raise exception 'inactive fan leaked: %',result;
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(result) key)
     <> array['fanCount','fans','likeCount','publicFanCount'] then raise exception 'fan community DTO keys changed: %',result; end if;
  if result::text like '%appUserId%' or result::text like '%objectPath%' or result::text like '%@example.test%' then raise exception 'private fan field leaked'; end if;
  if result#>>'{fans,0,avatarUrl}'<>'/images/avatars/star-pink.webp' then raise exception 'private avatar path projected'; end if;
  if public.read_celebrity_fan_community('missing','ko') is not null
     or public.read_celebrity_fan_community('fan-community-unlocalized','en') is not null
     or public.read_celebrity_fan_community('fan-community-draft','ko') is not null
     or public.read_celebrity_fan_community('fan-community-archived','ko') is not null then
    raise exception 'creator publication or locale gate failed';
  end if;

  result := public.read_celebrity_fanpage('fan-community-qa','ko');
  if result->>'membershipCount'<>'2' or result->>'leaderboardAvailable'<>'false'
     or jsonb_array_length(result->'activity')<>2
     or result::text not like '%FanQA1%' or result::text not like '%FanQA27%' then
    raise exception 'fanpage activity did not make visibility-false and unset members public: %',result;
  end if;
  if public.read_celebrity_fanpage('fan-community-unlocalized','en') is not null
     or public.read_celebrity_fanpage('fan-community-draft','ko') is not null
     or public.read_celebrity_fanpage('fan-community-archived','ko') is not null then
    raise exception 'fanpage creator locale or publication gate failed';
  end if;
  if public.read_celebrity_fanpage('fan-community-qa') is distinct from result then
    raise exception 'legacy fanpage wrapper does not preserve Korean projection';
  end if;

  result := public.post_celebrity_cheer(fan_ids[1],'fan-community-qa','첫 응원','65000000-0000-4000-8000-000000000001','ko');
  first_id := (result->>'id')::uuid;
  replay := public.post_celebrity_cheer(fan_ids[1],'fan-community-qa','첫 응원','65000000-0000-4000-8000-000000000001','ko');
  if replay->>'id'<>first_id::text or replay->>'replayed'<>'true' then raise exception 'cheer replay failed'; end if;
  perform pg_temp.expect_error(format('select public.post_celebrity_cheer(%L,%L,%L,%L,%L)',fan_ids[1],'fan-community-qa','다른 본문','65000000-0000-4000-8000-000000000001','ko'),'FANPAGE_IDEMPOTENCY_CONFLICT');
  second_id := (public.post_celebrity_cheer(fan_ids[2],'fan-community-qa','두 번째 응원','65000000-0000-4000-8000-000000000002','ko')->>'id')::uuid;
  third_id := (public.post_celebrity_cheer(fan_ids[3],'fan-community-qa','세 번째 응원','65000000-0000-4000-8000-000000000003','ko')->>'id')::uuid;
  reply_id := (public.post_celebrity_lounge_message(fan_ids[2],'fan-community-qa','레거시 답글','65000000-0000-4000-8000-000000000004',first_id,'ko')->>'id')::uuid;
  update public.fan_lounge_messages set created_at=now()-interval '3 seconds' where id=first_id;
  update public.fan_lounge_messages set created_at=now()-interval '2 seconds' where id=second_id;
  update public.fan_lounge_messages set created_at=now()-interval '1 second' where id=third_id;

  page := public.read_celebrity_cheers('fan-community-qa',fan_ids[1],null,null,2,'ko');
  if page->>'total'<>'3' or jsonb_array_length(page->'comments')<>2 or page#>>'{comments,0,id}'<>third_id::text then raise exception 'first cheer page failed: %',page; end if;
  result := public.read_celebrity_cheers('fan-community-qa',fan_ids[1],(page#>>'{comments,1,createdAt}')::timestamptz,(page#>>'{comments,1,id}')::uuid,2,'ko');
  if jsonb_array_length(result->'comments')<>1 or result#>>'{comments,0,id}'<>first_id::text then raise exception 'cheer keyset failed: %',result; end if;
  if page::text like '%'||reply_id::text||'%' then raise exception 'legacy reply leaked into cheers'; end if;
  if page#>>'{comments,1,isOwner}'<>'false' or result#>>'{comments,0,isOwner}'<>'true' then raise exception 'cheer owner projection failed'; end if;

  delete_id := (public.post_celebrity_cheer(fan_ids[1],'fan-community-qa','삭제할 응원','65000000-0000-4000-8000-000000000005','ko')->>'id')::uuid;
  perform pg_temp.expect_error(format('select public.remove_owned_lounge_message(%L,%L)',fan_ids[2],delete_id),'FANPAGE_NOT_FOUND');
  perform public.remove_owned_lounge_message(fan_ids[1],delete_id);
  hidden_id := (public.post_celebrity_cheer(fan_ids[2],'fan-community-qa','숨길 응원','65000000-0000-4000-8000-000000000006','ko')->>'id')::uuid;
  perform public.hide_admin_lounge_message(admin_user,admin_allowlist,extensions.gen_random_uuid(),hidden_id,'운영 기준 위반');
  result := public.read_celebrity_cheers('fan-community-qa',null,null,null,20,'ko');
  if result::text like '%'||delete_id::text||'%' or result::text like '%'||hidden_id::text||'%' then raise exception 'removed cheer remained visible'; end if;

  user_id := fan_ids[4];
  delete_id := (public.post_celebrity_cheer(user_id,'fan-community-qa','비활성 작성자','65000000-0000-4000-8000-000000000007','ko')->>'id')::uuid;
  update public.app_users set status='disabled' where id=user_id;
  if public.read_celebrity_cheers('fan-community-qa',null,null,null,20,'ko')::text like '%'||delete_id::text||'%' then raise exception 'inactive author remained visible'; end if;

  for i in 1..499 loop
    user_id := extensions.gen_random_uuid();
    attempt_id := extensions.gen_random_uuid();
    pass_id := extensions.gen_random_uuid();
    insert into public.app_users(id,privy_user_id,verified_email)
    values(user_id,'did:privy:fan-community-scale-'||i,user_id::text||'@scale.example.test');
    insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at)
    values(attempt_id,user_id,creator,quiz_id,1,extensions.gen_random_uuid(),'passed',3,now());
    insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id)
    values(pass_id,user_id,creator,attempt_id);
    insert into public.fan_passports(app_user_id,celebrity_id,quiz_pass_id,issued_at)
    values(user_id,creator,pass_id,now()-make_interval(secs=>500-i));
    if i=498 and (public.read_celebrity_fanpage('fan-community-qa','ko')->>'leaderboardAvailable')::boolean then
      raise exception 'fanpage leaderboard opened at 500 members';
    end if;
  end loop;
  result := public.read_celebrity_fanpage('fan-community-qa','ko');
  if result->>'membershipCount'<>'501' or result->>'leaderboardAvailable'<>'true'
     or jsonb_array_length(result->'activity')<>6 then
    raise exception 'fanpage 501-member gate or public activity bound changed: %',result;
  end if;

  if has_function_privilege('anon','public.read_celebrity_fan_community(text,public.content_locale)','EXECUTE')
     or has_function_privilege('authenticated','public.read_celebrity_cheers(text,uuid,timestamptz,uuid,integer,public.content_locale)','EXECUTE')
     or has_function_privilege('service_role','public.post_celebrity_cheer(uuid,text,text,uuid,public.content_locale)','EXECUTE')=false
     or has_function_privilege('anon','public.read_celebrity_fanpage(text,public.content_locale)','EXECUTE')
     or has_function_privilege('authenticated','public.read_celebrity_fanpage(text)','EXECUTE')
     or has_function_privilege('service_role','public.read_celebrity_fanpage(text,public.content_locale)','EXECUTE')=false
     or has_function_privilege('anon','public.read_owned_fan_activity_visibility(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.set_owned_fan_activity_visibility(uuid,boolean)','EXECUTE')
     or has_function_privilege('service_role','public.read_owned_fan_activity_visibility(uuid)','EXECUTE')
     or has_function_privilege('service_role','public.set_owned_fan_activity_visibility(uuid,boolean)','EXECUTE') then
    raise exception 'fan community RPC ACL failed';
  end if;
  if exists(
    select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    where p.oid in (
      'public.read_owned_fan_activity_visibility(uuid)'::regprocedure,
      'public.set_owned_fan_activity_visibility(uuid,boolean)'::regprocedure
    ) and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then raise exception 'legacy visibility RPC retained PUBLIC execute'; end if;
end $$;

rollback;
