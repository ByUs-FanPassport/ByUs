begin;
do $$
declare
  fan uuid:=extensions.gen_random_uuid(); other_fan uuid:=extensions.gen_random_uuid(); artist uuid:=extensions.gen_random_uuid();
  stamp_artist uuid; quiz uuid:=extensions.gen_random_uuid(); attempt uuid:=extensions.gen_random_uuid(); passed uuid:=extensions.gen_random_uuid();
  passport uuid:=extensions.gen_random_uuid(); job uuid:=extensions.gen_random_uuid(); v_token text:=repeat('e',32); card jsonb; page jsonb; second_page jsonb;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values(fan,'did:privy:personal-qa','personal-qa@example.test'),(other_fan,'did:privy:personal-other','personal-other@example.test');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values(fan,91342,'0x'||replace(fan::text,'-','')||'00000000','privy','embedded');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values(artist,'personal-qa','published','/test.webp',now(),'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values(artist,'ko','기록 검증','소개','사진'),(artist,'en','History QA','Summary','Photo');
  insert into public.celebrity_quizzes(id,celebrity_id,version,status) values(quiz,artist,1,'draft');
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values(attempt,fan,artist,quiz,1,attempt,'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values(passed,fan,artist,attempt);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(job,'passport',passport,'byus:passport:v1:'||fan||':personal-qa',1,jsonb_build_object('recipient','0x'||replace(fan::text,'-','')||'00000000','celebritySlug','personal-qa','passportId','0x'||repeat('b',64)));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id) values(passport,fan,artist,passed,job);
  insert into public.community_stamp_share_links(token,owner_app_user_id,celebrity_id,fan_passport_id) values(v_token,fan,artist,passport);
  for g in 1..31 loop
    stamp_artist:=case when g=1 then artist else extensions.gen_random_uuid() end;
    if g>1 then insert into public.celebrities(id,slug,status,image_url,roles,primary_role,published_at)
      values(stamp_artist,'personal-stamp-'||g,'published','/test.webp','{creator}','creator',now()); end if;
    perform public.issue_community_stamp(fan,stamp_artist,'daily_checkin','daily-checkin:'||stamp_artist::text||':'||public.community_stamp_kst_date()::text);
  end loop;
  -- Wallet insertion also issues the existing welcome stamp: 31 daily + 1 welcome + 1 Passport.
  page:=public.get_owned_fan_history(fan,'collection','en');
  if jsonb_array_length(page->'items')<>30 or page->'nextCursor'='null'::jsonb then raise exception 'history pagination first page failed'; end if;
  second_page:=public.get_owned_fan_history(fan,'collection','en',(page#>>'{nextCursor,at}')::timestamptz,page#>>'{nextCursor,id}');
  if jsonb_array_length(second_page->'items')<>3 or second_page->'nextCursor'<>'null'::jsonb then raise exception 'history pagination tail failed: first=%, next=%, tail=%',jsonb_array_length(page->'items'),page->'nextCursor',second_page; end if;
  if exists(select 1 from jsonb_array_elements(page->'items') a join jsonb_array_elements(second_page->'items') b on a->>'id'=b->>'id') then raise exception 'history cursor duplicated items'; end if;
  if jsonb_array_length(public.get_owned_fan_history(other_fan,'collection','en')->'items')<>0 then raise exception 'another owner history leaked'; end if;
  card:=public.read_shared_passport_activity(v_token);
  if (select count(*) from jsonb_object_keys(card))<>6 or card->>'creator'<>'personal-qa' or (card->>'stampCount')::integer<>1
    or card::text like '%'||fan::text||'%' or card::text like '%personal-qa@example.test%' then raise exception 'public activity projection leaked or fabricated data'; end if;
  update public.community_stamp_share_links set revoked_at=now() where community_stamp_share_links.token=v_token;
  if public.read_shared_passport_activity(v_token) is not null then raise exception 'revoked share link remained visible'; end if;
  if has_function_privilege('anon','public.get_owned_fan_history(uuid,text,public.content_locale,timestamp with time zone,text)','EXECUTE') then raise exception 'history exposed to browser role'; end if;
end $$;
rollback;
select 'Owner history cursor and minimal revocable share activity PASS' as result;
