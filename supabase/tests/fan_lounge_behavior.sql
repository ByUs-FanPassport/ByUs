begin;

create or replace function pg_temp.expect_error(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error %', p_message;
exception when others then
  if sqlerrm = 'expected error ' || p_message or position(p_message in sqlerrm) = 0 then
    raise;
  end if;
end $$;

do $$
declare
  creator uuid := '10000000-0000-4000-8000-000000000001';
  other_creator uuid := '10000000-0000-4000-8000-000000000002';
  owner uuid := '20000000-0000-4000-8000-000000000001';
  other uuid := '20000000-0000-4000-8000-000000000002';
  disabled uuid := '20000000-0000-4000-8000-000000000003';
  admin_allowlist uuid := '30000000-0000-4000-8000-000000000001';
  viewer_allowlist uuid := '30000000-0000-4000-8000-000000000002';
  first_id uuid;
  reply_id uuid;
  quote_id uuid;
  result jsonb;
  page jsonb;
  replay jsonb;
  i integer;
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
  values
    (creator,'lounge-qa','published','/images/creator.webp',now(),'{creator}','creator'),
    (other_creator,'lounge-other','published','/images/other.webp',now(),'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
  values
    (creator,'ko','라운지','소개','프로필'),(creator,'en','Lounge','Summary','Profile'),
    (other_creator,'ko','다른 라운지','소개','프로필'),(other_creator,'en','Other Lounge','Summary','Profile');
  insert into public.app_users(id,privy_user_id,verified_email,status)
  values
    (owner,'did:privy:lounge-owner','lounge-owner@example.test','active'),
    (other,'did:privy:lounge-other','lounge-other@example.test','active'),
    (disabled,'did:privy:lounge-disabled','lounge-disabled@example.test','disabled');
  insert into public.user_profiles(app_user_id,nickname,nickname_normalized)
  values (owner,'별빛팬','별빛팬'),(other,'달빛팬','달빛팬'),(disabled,'휴면팬','휴면팬');
  insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id)
  values (owner,'star-pink','star-pink'),(other,'heart-lavender','heart-lavender'),(disabled,'ghost-cream','ghost-cream');

  result := public.post_celebrity_lounge_message(owner,'lounge-qa','첫 메시지','40000000-0000-4000-8000-000000000001',null,'ko');
  first_id := (result->>'id')::uuid;
  replay := public.post_celebrity_lounge_message(owner,'lounge-qa','첫 메시지','40000000-0000-4000-8000-000000000001',null,'ko');
  if replay->>'id' <> first_id::text or replay->>'replayed' <> 'true' then raise exception 'replay failed'; end if;
  perform pg_temp.expect_error(format('select public.post_celebrity_lounge_message(%L,%L,%L,%L,null,%L)',owner,'lounge-qa','다른 본문','40000000-0000-4000-8000-000000000001','ko'),'FANPAGE_IDEMPOTENCY_CONFLICT');

  result := public.post_celebrity_lounge_message(other,'lounge-qa','답글','40000000-0000-4000-8000-000000000002',first_id,'ko');
  reply_id := (result->>'id')::uuid;
  update public.fan_lounge_messages set created_at=now()-interval '2 seconds' where id=first_id;
  update public.fan_lounge_messages set created_at=now()-interval '1 second' where id=reply_id;
  perform pg_temp.expect_error(format('select public.post_celebrity_lounge_message(%L,%L,%L,%L,%L,%L)',owner,'lounge-other','잘못된 답글','40000000-0000-4000-8000-000000000003',first_id,'ko'),'FANPAGE_NOT_FOUND');

  result := public.read_celebrity_lounge('lounge-qa',owner,null,null,50,null,'ko');
  if result->>'total' <> '2' or result#>>'{messages,1,isOwner}' <> 'true' then raise exception 'visible owner projection failed'; end if;
  if result#>>'{messages,0,replyTo,body}' <> '첫 메시지' then raise exception 'reply quote missing'; end if;
  perform public.remove_owned_lounge_message(owner,first_id);
  result := public.read_celebrity_lounge('lounge-qa',other,null,null,50,null,'ko');
  if result->>'total' <> '1' or result#>>'{messages,0,replyTo,id}' <> first_id::text
     or result#>'{messages,0,replyTo,body}' <> 'null'::jsonb
     or result#>'{messages,0,replyTo,nickname}' <> 'null'::jsonb then raise exception 'deleted quote was not redacted'; end if;

  update public.app_users set status='active' where id=disabled;
  result := public.post_celebrity_lounge_message(disabled,'lounge-qa','곧 비활성','40000000-0000-4000-8000-000000000004',null,'ko');
  first_id := (result->>'id')::uuid;
  result := public.post_celebrity_lounge_message(owner,'lounge-qa','인용','40000000-0000-4000-8000-000000000005',first_id,'ko');
  quote_id := (result->>'id')::uuid;
  update public.app_users set status='disabled' where id=disabled;
  result := public.read_celebrity_lounge('lounge-qa',owner,null,null,50,array[quote_id],'ko');
  if result#>'{messages,0,replyTo,body}' <> 'null'::jsonb then raise exception 'disabled parent author quote was not redacted'; end if;

  for i in 1..8 loop
    perform public.post_celebrity_lounge_message(owner,'lounge-qa','속도 '||i,extensions.gen_random_uuid(),null,'ko');
  end loop;
  perform pg_temp.expect_error(format('select public.post_celebrity_lounge_message(%L,%L,%L,%L,null,%L)',owner,'lounge-qa','제한',extensions.gen_random_uuid(),'ko'),'FANPAGE_RATE_LIMITED');

  perform public.set_lounge_message_reaction(other,reply_id,'🔥',true);
  perform public.set_lounge_message_reaction(other,reply_id,'🔥',true);
  result := public.read_celebrity_lounge('lounge-qa',other,null,null,50,array[reply_id],'ko');
  if result#>>'{messages,0,reactions,0,count}' <> '1' or result#>>'{messages,0,reactions,0,reacted}' <> 'true' then raise exception 'reaction desired state failed'; end if;
  for i in 1..14 loop
    perform public.set_lounge_message_reaction(other,reply_id,'👏',true);
    perform public.set_lounge_message_reaction(other,reply_id,'👏',false);
  end loop;
  perform public.set_lounge_message_reaction(other,reply_id,'👏',true);
  perform pg_temp.expect_error(format('select public.set_lounge_message_reaction(%L,%L,%L,false)',other,reply_id,'👏'),'FANPAGE_RATE_LIMITED');
  perform public.set_lounge_message_reaction(other,reply_id,'🔥',true);

  alter table public.fan_reactions disable trigger user;
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload)
  values ('50000000-0000-4000-8000-000000000001','reaction','50000000-0000-4000-8000-000000000002','lounge-like-job','{}');
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id)
  values ('50000000-0000-4000-8000-000000000002',other,creator,'50000000-0000-4000-8000-000000000001');
  alter table public.fan_reactions enable trigger user;
  result := public.read_celebrity_lounge('lounge-qa',owner,null,null,50,null,'ko');
  if result->>'likeCount' <> '1' then raise exception 'creator like count failed'; end if;

  page := public.read_celebrity_lounge('lounge-qa',owner,null,null,2,null,'ko');
  result := public.read_celebrity_lounge('lounge-qa',owner,(page#>>'{messages,1,createdAt}')::timestamptz,(page#>>'{messages,1,id}')::uuid,2,null,'ko');
  if jsonb_array_length(result->'messages') <> 2 or page#>>'{messages,0,id}' = result#>>'{messages,0,id}' then raise exception 'keyset failed'; end if;

  insert into public.admin_allowlist(id,email,role) values
    (admin_allowlist,'lounge-owner@example.test','operator'),
    (viewer_allowlist,'lounge-other@example.test','viewer');
  perform pg_temp.expect_error(format('select public.hide_admin_lounge_message(%L,%L,%L,%L,%L)',other,viewer_allowlist,extensions.gen_random_uuid(),reply_id,'위반'),'viewer is read-only');
  perform public.hide_admin_lounge_message(owner,admin_allowlist,extensions.gen_random_uuid(),reply_id,'운영 기준 위반');
  perform public.hide_admin_lounge_message(owner,admin_allowlist,extensions.gen_random_uuid(),reply_id,'운영 기준 위반');
  if (select count(*) from public.audit_logs where action='lounge.message.hide' and entity_id=reply_id::text) <> 1 then raise exception 'moderation audit failed'; end if;
  if jsonb_array_length(public.read_admin_lounge_messages(owner,admin_allowlist,null,null,50)->'messages') < 1 then raise exception 'admin read failed'; end if;

  -- The native clean-chain database is owned by the local OS role, while the
  -- lifecycle trigger recognizes the production migration owner `postgres`.
  -- Disable user triggers only while installing an archive-shaped fixture.
  perform pg_catalog.set_config('session_replication_role','replica',true);
  update public.celebrities set archived_at=now(),archived_by_admin_allowlist_id=admin_allowlist,
    archive_reason='라운지 보관 상태 검증을 위한 사유' where id=creator;
  perform pg_catalog.set_config('session_replication_role','origin',true);
  if public.read_celebrity_lounge('lounge-qa',owner,null,null,50,null,'ko') is not null then raise exception 'archived creator readable'; end if;
  update public.celebrities set status='draft',published_at=null where id=other_creator;
  if public.read_celebrity_lounge('lounge-other',owner,null,null,50,null,'ko') is not null then raise exception 'draft creator readable'; end if;
  perform pg_temp.expect_error(format('select public.post_celebrity_lounge_message(%L,%L,%L,%L,null,%L)',other,'lounge-other','비공개','40000000-0000-4000-8000-000000000099','ko'),'FANPAGE_NOT_FOUND');

  if has_table_privilege('service_role','public.fan_lounge_messages','SELECT')
     or has_table_privilege('service_role','public.fan_lounge_message_reactions','INSERT')
     or has_table_privilege('service_role','public.fan_lounge_reaction_mutation_events','SELECT')
     or has_function_privilege('anon','public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale)','EXECUTE')
     or has_function_privilege('authenticated','public.post_celebrity_lounge_message(uuid,text,text,uuid,uuid,public.content_locale)','EXECUTE') then
    raise exception 'lounge database authority exposed';
  end if;
  if not has_function_privilege('service_role','public.read_celebrity_lounge(text,uuid,timestamptz,uuid,integer,uuid[],public.content_locale)','EXECUTE') then raise exception 'service RPC missing'; end if;
end $$;

rollback;
