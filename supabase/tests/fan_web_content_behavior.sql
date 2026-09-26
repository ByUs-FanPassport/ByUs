-- Disposable latest-chain database only. Real membership/ACL helpers; fixtures roll back.
begin;
create or replace function pg_temp.expect_error(p_sql text,p_message text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error %',p_message;
exception when others then
  if sqlerrm='expected error '||p_message or position(p_message in sqlerrm)=0 then raise; end if;
end $$;
do $$
declare
  owner_id uuid:='ac260000-0000-4000-8000-000000000001';
  other_id uuid:='ac260000-0000-4000-8000-000000000002';
  third_id uuid:='ac260000-0000-4000-8000-000000000003';
  artist uuid:='ac260000-0000-4000-8000-000000000004';
  admin_id uuid:='ac260000-0000-4000-8000-000000000005';
  viewer_id uuid:='ac260000-0000-4000-8000-000000000006';
  quiz uuid:=extensions.gen_random_uuid(); attempt uuid:=extensions.gen_random_uuid(); passed uuid:=extensions.gen_random_uuid();
  passport_id uuid:=extensions.gen_random_uuid(); job_id uuid:=extensions.gen_random_uuid();
  key_id uuid:=extensions.gen_random_uuid(); post_id uuid; private_id uuid; comment_id uuid; reply_id uuid; block_id uuid; report_id uuid;
  asset_id uuid; pending_id uuid; notice_id uuid; pinned_notice_id uuid; normal_notice_id uuid; result jsonb; source jsonb; claimed jsonb; old_generation bigint; new_generation bigint;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (owner_id,'did:privy:content-owner','content-owner@example.test'),
    (other_id,'did:privy:content-other','content-other@example.test'),
    (third_id,'did:privy:content-third','content-third@example.test');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(artist,'content-qa','published','/images/creator.webp',now(),'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
    values(artist,'ko','콘텐츠 검사','소개','사진'),(artist,'en','Content QA','Summary','Photo');
  insert into public.admin_allowlist(id,email,role) values(admin_id,'content-owner@example.test','operator'),(viewer_id,'content-other@example.test','viewer');

  result:=public.save_fan_post(owner_id,'content-qa',null,'Public post','public','{}',null,key_id); post_id:=(result->>'id')::uuid;
  result:=public.save_fan_post(owner_id,'content-qa',null,'Public post','public','{}',null,key_id);
  if result->>'id'<>post_id::text or result->>'replayed'<>'true' then raise exception 'create replay failed'; end if;
  perform pg_temp.expect_error(format('select public.save_fan_post(%L,%L,null,%L,%L,''{}'',null,%L)',owner_id,'content-qa','different','public',key_id),'FAN_WEB_CONFLICT');
  perform pg_temp.expect_error(format('select public.save_fan_post(%L,%L,%L,%L,%L,''{}'',1,null)',other_id,'content-qa',post_id,'foreign edit','public'),'FAN_WEB_NOT_FOUND');
  perform public.save_fan_post(owner_id,'content-qa',post_id,'Edited post','public','{}',1,null);
  perform pg_temp.expect_error(format('select public.save_fan_post(%L,%L,%L,%L,%L,''{}'',1,null)',owner_id,'content-qa',post_id,'stale edit','public'),'FAN_WEB_CONFLICT');
  if public.read_fan_post(null,post_id)#>>'{post,body}'<>'Edited post' then raise exception 'public read failed'; end if;
  if public.read_fan_post(null,post_id)#>'{post,author}' ? 'appUserId' then raise exception 'public author identifier leaked'; end if;

  perform pg_temp.expect_error(format('select public.save_fan_post(%L,%L,null,%L,%L,''{}'',null,%L)',owner_id,'content-qa','Private post','members',extensions.gen_random_uuid()),'FAN_WEB_FORBIDDEN');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values(owner_id,91342,'0x'||repeat('b',40),'privy','embedded');
  insert into public.celebrity_quizzes(id,celebrity_id,version,status) values(quiz,artist,1,'draft');
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values(attempt,owner_id,artist,quiz,1,attempt,'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values(passed,owner_id,artist,attempt);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
    values(job_id,'passport',passport_id,'byus:passport:v1:'||owner_id||':content-qa',1,jsonb_build_object('recipient','0x'||repeat('b',40),'celebritySlug','content-qa','passportId','0x'||repeat('b',64)));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id) values(passport_id,owner_id,artist,passed,job_id);
  result:=public.reserve_content_asset(owner_id,'content-qa',64,2,2,repeat('a',64)); asset_id:=(result->>'id')::uuid;
  perform public.finish_content_asset_upload(owner_id,asset_id);
  perform pg_temp.expect_error(format('select public.save_fan_post(%L,%L,null,%L,%L,ARRAY[%L]::uuid[],null,%L)',other_id,'content-qa','stolen','public',asset_id,extensions.gen_random_uuid()),'FAN_WEB_INVALID_ASSET');
  result:=public.save_fan_post(owner_id,'content-qa',null,'Private post','members',array[asset_id],null,extensions.gen_random_uuid()); private_id:=(result->>'id')::uuid;
  if public.read_fan_post(null,private_id) is not null or public.read_fan_post(other_id,private_id) is not null or public.read_content_asset(other_id,asset_id) is not null then raise exception 'member content leaked'; end if;
  if public.read_fan_post(owner_id,private_id) is null or public.read_content_asset(owner_id,asset_id) is null then raise exception 'member content denied'; end if;

  result:=public.post_fan_post_comment(other_id,post_id,null,'Parent comment',extensions.gen_random_uuid()); comment_id:=(result->>'id')::uuid;
  result:=public.post_fan_post_comment(owner_id,post_id,comment_id,'One level reply',extensions.gen_random_uuid()); reply_id:=(result->>'id')::uuid;
  perform pg_temp.expect_error(format('select public.post_fan_post_comment(%L,%L,%L,%L,%L)',owner_id,post_id,reply_id,'Nested reply',extensions.gen_random_uuid()),'FAN_WEB_NOT_FOUND');
  perform public.set_fan_post_like(other_id,post_id,true); perform public.set_fan_post_like(other_id,post_id,true);
  if public.read_fan_post(third_id,post_id)#>>'{post,likeCount}'<>'1' then raise exception 'like is not idempotent'; end if;
  source:=public.fan_web_content_target(third_id,'fan_post_comment',comment_id);
  perform public.save_content_translation(third_id,'fan_post_comment',comment_id,'ja','ko',1,source->>'sourceHash','訳文','en');
  if public.read_content_translation(third_id,'fan_post_comment',comment_id,'ja') is null then raise exception 'translation cache failed'; end if;
  result:=public.block_content_author(third_id,'fan_post_comment',comment_id); block_id:=(result->>'id')::uuid;
  if public.read_fan_post(third_id,post_id)#>>'{post,commentCount}'<>'0' or public.read_fan_post(third_id,post_id)#>>'{post,likeCount}'<>'0' then raise exception 'blocked parent/replies/count leaked'; end if;
  if public.fan_web_content_visible(third_id,'fan_post_comment',reply_id) then raise exception 'reply retained blocked parent'; end if;
  perform pg_temp.expect_error(format('select public.read_content_translation(%L,%L,%L,%L)',third_id,'fan_post_comment',comment_id,'ja'),'FAN_WEB_NOT_FOUND');
  if not public.fan_web_blocked(other_id,third_id) then raise exception 'block is not symmetric'; end if;
  perform public.remove_content_block(third_id,block_id);

  source:=public.fan_web_content_target(other_id,'fan_post',post_id);
  perform public.save_content_translation(other_id,'fan_post',post_id,'ja','ko',2,source->>'sourceHash','訳文','en');
  perform public.save_fan_post(owner_id,'content-qa',post_id,'Third revision','public','{}',2,null);
  if public.read_content_translation(other_id,'fan_post',post_id,'ja') is not null then raise exception 'stale translation served'; end if;
  perform pg_temp.expect_error(format('select public.save_content_translation(%L,%L,%L,%L,%L,2,%L,%L,%L)',other_id,'fan_post',post_id,'ja','ko',source->>'sourceHash','stale','en'),'FAN_WEB_CONFLICT');

  result:=public.post_content_report(other_id,'fan_post',post_id,'Policy violation',extensions.gen_random_uuid()); report_id:=(result->>'id')::uuid;
  perform pg_temp.expect_error(format('select public.resolve_admin_content_report(%L,%L,%L,%L,%L,true,%L)',other_id,viewer_id,extensions.gen_random_uuid(),report_id,'resolved','Long enough review reason'),'viewer is read-only');
  if (select status from public.content_reports where id=report_id)<>'open' or public.read_fan_post(null,post_id) is null then raise exception 'viewer changed content'; end if;
  perform public.resolve_admin_content_report(owner_id,admin_id,extensions.gen_random_uuid(),report_id,'resolved',true,'Confirmed community policy violation');
  if public.read_fan_post(null,post_id) is not null or (select status from public.content_reports where id=report_id)<>'resolved' or not exists(select 1 from public.audit_logs where action='content.report.resolve' and entity_id=report_id::text) then raise exception 'atomic moderation failed'; end if;

  notice_id:=public.save_admin_celebrity_notice(owner_id,admin_id,extensions.gen_random_uuid(),null,null,artist,'members-note',false,'회원 공지','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"회원 본문"}]}]}'::jsonb,'Member notice','{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Member body"}]}]}'::jsonb,'artist_post','members');
  perform public.set_admin_celebrity_notice_state(owner_id,admin_id,extensions.gen_random_uuid(),notice_id,1,'publish',null);
  if public.read_fan_notice(null,'content-qa','members-note') is not null or public.read_fan_notice(other_id,'content-qa','members-note') is not null or public.read_fan_notice(owner_id,'content-qa','members-note')->>'postType'<>'artist_post' then raise exception 'official visibility failed'; end if;

  source:='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Public body"}]}]}'::jsonb;
  pinned_notice_id:=public.save_admin_celebrity_notice(owner_id,admin_id,extensions.gen_random_uuid(),null,null,artist,'old-pinned',true,'고정 공지',source,'Pinned notice',source,'notice','public');
  perform public.set_admin_celebrity_notice_state(owner_id,admin_id,extensions.gen_random_uuid(),pinned_notice_id,1,'publish',null);
  normal_notice_id:=public.save_admin_celebrity_notice(owner_id,admin_id,extensions.gen_random_uuid(),null,null,artist,'newer-normal',false,'최신 공지',source,'Newer notice',source,'notice','public');
  perform public.set_admin_celebrity_notice_state(owner_id,admin_id,extensions.gen_random_uuid(),normal_notice_id,1,'publish',null);
  result:=public.read_fan_notices(null,'content-qa','ko',null,null,1);
  if result#>>'{notices,0,id}'<>pinned_notice_id::text or result->>'hasMore'<>'true' then raise exception 'older pinned notice lost before pagination'; end if;
  result:=public.read_fan_notices(null,'content-qa','ko',(result#>>'{notices,0,publishedAt}')::timestamptz,pinned_notice_id,1,true);
  if result#>>'{notices,0,id}'<>normal_notice_id::text or result->>'hasMore'<>'false' then raise exception 'pin cursor skipped newer unpinned notice'; end if;

  -- Deletion waits for the initial upload to settle, even after an earlier removal.
  result:=public.reserve_content_asset(third_id,'content-qa',64,2,2,repeat('b',64)); pending_id:=(result->>'id')::uuid;
  update public.content_assets set cleanup_requested_at=clock_timestamp(),storage_deleted_at=clock_timestamp() where id=pending_id;
  if not exists(select 1 from public.content_assets where id=pending_id and upload_settled_at is null) then raise exception 'pending upload readiness lost'; end if;
  update public.content_assets set storage_deleted_at=null where id=pending_id;
  claimed:=public.claim_content_asset_cleanup(100);
  if exists(select 1 from jsonb_array_elements(claimed->'items') x where x->>'id'=pending_id::text) then raise exception 'in-flight upload was cleaned prematurely'; end if;
  -- A dead uploader's bounded lease expires, so the worker removes once more.
  update public.content_assets set upload_expires_at=clock_timestamp()-interval '1 second' where id=pending_id;
  claimed:=public.claim_content_asset_cleanup(100);
  select (x->>'generation')::bigint into old_generation from jsonb_array_elements(claimed->'items') x where x->>'id'=pending_id::text;
  if old_generation is null then raise exception 'expired upload not claimed'; end if;
  -- Exact race: old removal -> late upload -> abandon -> stale acknowledgement.
  perform public.abandon_content_asset_upload(third_id,pending_id);
  perform public.finish_content_asset_cleanup(pending_id,old_generation,true);
  if (select storage_deleted_at from public.content_assets where id=pending_id) is not null then raise exception 'stale cleanup acknowledged late upload'; end if;
  claimed:=public.claim_content_asset_cleanup(100);
  select (x->>'generation')::bigint into new_generation from jsonb_array_elements(claimed->'items') x where x->>'id'=pending_id::text;
  if new_generation is null or new_generation<=old_generation then raise exception 'late upload not requeued'; end if;
  perform public.finish_content_asset_cleanup(pending_id,new_generation,true);
  if (select storage_deleted_at from public.content_assets where id=pending_id) is null then raise exception 'current cleanup did not finish'; end if;
  perform public.remove_fan_post(owner_id,private_id);
  if public.read_content_asset(owner_id,asset_id) is not null then raise exception 'deleted parent asset leaked'; end if;

  perform public.reserve_content_translation_request(other_id,10000);
  perform pg_temp.expect_error(format('select public.reserve_content_translation_request(%L,1)',other_id),'TRANSLATION_RATE_LIMITED');
  update public.content_translation_requests set app_user_id=null where app_user_id=other_id;
  perform public.reserve_content_translation_request(third_id,10000);
  perform pg_temp.expect_error(format('select public.reserve_content_translation_request(%L,1)',owner_id),'TRANSLATION_RATE_LIMITED');
  if (select sum(character_count) from public.content_translation_requests)<>20000 then raise exception 'anonymization lost global spend'; end if;
  update public.app_users set status='disabled' where id=third_id;
  perform pg_temp.expect_error(format('select public.reserve_content_asset(%L,%L,64,2,2,%L)',third_id,'content-qa',repeat('c',64)),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  -- Cleanup must remain callable after disable, including after later migrations fence owner writes.
  perform public.abandon_content_asset_upload(third_id,pending_id);
  if not exists(select 1 from public.content_assets where id=pending_id and upload_settled_at is not null and cleanup_requested_at is not null and storage_deleted_at is null) then raise exception 'disabled uploader cannot settle cleanup'; end if;
  select cleanup_generation into old_generation from public.content_assets where id=asset_id;
  perform public.abandon_content_asset_upload(third_id,asset_id);
  if (select cleanup_generation from public.content_assets where id=asset_id)<>old_generation then raise exception 'cleanup changed another owner asset'; end if;
  update public.app_users set status='disabled' where id=owner_id;
  perform pg_temp.expect_error(format('select public.set_admin_celebrity_notice_state(%L,%L,%L,%L,2,%L,null)',owner_id,admin_id,extensions.gen_random_uuid(),notice_id,'unpublish'),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  if has_function_privilege('service_role','public.fan_web_notice_state_base(uuid,uuid,uuid,uuid,integer,text,text)','EXECUTE') then raise exception 'notice state base bypasses user fence'; end if;
  if has_table_privilege('authenticated','public.fan_posts','SELECT') or has_function_privilege('anon','public.read_fan_post(uuid,uuid,public.content_locale)','EXECUTE') then raise exception 'browser direct privilege leak'; end if;
end $$;
rollback;
select 'Fan web content CRUD, ACL, moderation, translation and upload cleanup PASS' as result;
