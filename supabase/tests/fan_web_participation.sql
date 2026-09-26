begin;
create or replace function pg_temp.expect_participation_error(p_sql text,p_marker text)
returns void language plpgsql as $$ begin execute p_sql; raise exception 'expected:%',p_marker;
exception when others then if sqlerrm='expected:'||p_marker or position(p_marker in sqlerrm)=0 then raise; end if; end $$;
do $$
declare
  admin_id uuid:=extensions.gen_random_uuid(); allow_id uuid:=extensions.gen_random_uuid();
  fan uuid:=extensions.gen_random_uuid(); other_fan uuid:=extensions.gen_random_uuid(); creator uuid:=extensions.gen_random_uuid(); draft_creator uuid:=extensions.gen_random_uuid(); live_id uuid:=extensions.gen_random_uuid();
  brand_id uuid:=extensions.gen_random_uuid(); correlation uuid:=extensions.gen_random_uuid(); input jsonb; result jsonb; again jsonb; request_id uuid; suggestion_id uuid; v_schedule_id uuid; submission_id uuid; other_id uuid;
  before_rewards bigint; v_month timestamptz:=date_trunc('month',clock_timestamp());
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (admin_id,'did:privy:participation-admin','participation-admin@example.test'),(fan,'did:privy:participation-fan','participation-fan@example.test'),(other_fan,'did:privy:participation-other','participation-other@example.test');
  insert into public.admin_allowlist(id,email,role,active) values(allow_id,'participation-admin@example.test','operator',true);
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
    (creator,'participation-qa','published','/images/qa.webp',now(),'{creator}','creator'),(draft_creator,'participation-draft','draft','/images/draft.webp',null,'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (creator,'ko','참여 검증','소개','사진'),(creator,'en','Participation QA','Summary','Photo'),(draft_creator,'ko','비공개 초안','소개','사진'),(draft_creator,'en','Private draft','Summary','Photo');
  insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values(brand_id,'participation-brand','published','/images/brand.webp','Brand',now());
  insert into public.brand_localizations(brand_id,locale,name,description) values(brand_id,'ko','검사 브랜드','소개'),(brand_id,'en','QA brand','Description');
  insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,attendance_valid_from,attendance_valid_until)
  values(live_id,'participation-live',creator,brand_id,'published',now()+interval '2 days',now()+interval '2 days 1 hour',now()-interval '1 day',now()+interval '1 day','https://www.youtube.com/watch?v=abcdefghijk','/images/qa.webp',extensions.crypt('QA1234',extensions.gen_salt('bf',10)),now(),now()+interval '2 days',now()+interval '2 days 1 hour');
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values(live_id,'ko','참여 방송','소개','사진'),(live_id,'en','Participation LIVE','Summary','Photo');
  select count(*) into before_rewards from public.fan_activities;

  input:=jsonb_build_object('celebrityId',creator,'kind','concert','title',jsonb_build_object('ko','공연','en','Concert'),'description',jsonb_build_object('ko','소개','en','Details'),
    'startsAt',clock_timestamp()+interval '2 days','endsAt',clock_timestamp()+interval '2 days 1 hour','timeZone','Asia/Seoul','location','Seoul','participationInstructions','Ticket required','officialSourceUrl','https://example.test/concert','status','published');
  result:=public.fan_web_admin_save_schedule(admin_id,allow_id,correlation,null,0,correlation,input); v_schedule_id:=(result#>>'{item,id}')::uuid;
  again:=public.fan_web_admin_save_schedule(admin_id,allow_id,correlation,null,0,correlation,input);
  if again#>>'{item,id}'<>v_schedule_id::text or again->>'replayed'<>'true' then raise exception 'schedule create idempotency failed'; end if;
  result:=public.fan_web_get_schedule(null,v_schedule_id,'ko');
  if result->>'title'<>'공연' or result->'subscribed'<>'null'::jsonb then raise exception 'public schedule projection failed'; end if;
  perform public.fan_web_set_schedule_subscription(fan,v_schedule_id,true);
  perform public.fan_web_set_schedule_subscription(fan,v_schedule_id,true);
  if (select count(*) from public.schedule_subscriptions where schedule_id=v_schedule_id and app_user_id=fan)<>1 then raise exception 'subscription duplicated'; end if;
  if public.fan_web_get_schedule(other_fan,v_schedule_id,'ko')->>'subscribed'<>'false' then raise exception 'other subscription leaked'; end if;
  perform public.fan_web_set_schedule_subscription(fan,v_schedule_id,false);
  if public.fan_web_get_schedule(fan,v_schedule_id,'ko')->>'subscribed'<>'false' then raise exception 'unsubscribe failed'; end if;
  perform pg_temp.expect_participation_error(format('select public.fan_web_admin_save_schedule(%L,%L,%L,%L,99,%L,%L::jsonb)',admin_id,allow_id,correlation,v_schedule_id,correlation,input),'FAN_WEB_REVISION_CONFLICT');

  input:=jsonb_build_object('celebritySlug','participation-qa','kind','birthday','title','생일','description','','startsAt',clock_timestamp()+interval '3 days','endsAt',clock_timestamp()+interval '4 days','timeZone','Asia/Seoul','location','','participationInstructions','','sourceUrl','https://example.test/birthday','locale','ko','idempotencyKey',extensions.gen_random_uuid());
  result:=public.fan_web_submit_schedule_suggestion(fan,input); suggestion_id:=(result#>>'{item,id}')::uuid;
  if public.fan_web_submit_schedule_suggestion(fan,input)->>'replayed'<>'true' then raise exception 'suggestion retry failed'; end if;
  if jsonb_array_length(public.fan_web_list_owned_schedule_suggestions(other_fan,null,null,20)->'items')<>0 then raise exception 'suggestion ownership failed'; end if;
  perform pg_temp.expect_participation_error(format('select public.fan_web_submit_schedule_suggestion(%L,%L::jsonb)',fan,input||jsonb_build_object('title','different')),'FAN_WEB_IDEMPOTENCY_CONFLICT');
  input:=(input-array['celebritySlug','title','description','sourceUrl','locale','idempotencyKey'])||jsonb_build_object('celebrityId',creator,'title',jsonb_build_object('ko','생일','en','Birthday'),'description',jsonb_build_object('ko','','en',''),'officialSourceUrl','https://example.test/birthday','status','published');
  result:=public.fan_web_admin_review_schedule_suggestion(admin_id,allow_id,correlation,suggestion_id,1,'approve',null,input);
  again:=public.fan_web_admin_review_schedule_suggestion(admin_id,allow_id,correlation,suggestion_id,1,'approve',null,input);
  if result#>>'{item,scheduleId}' is null or again#>>'{item,scheduleId}'<>result#>>'{item,scheduleId}' or again->>'replayed'<>'true' then raise exception 'approval idempotency failed'; end if;

  input:=jsonb_build_object('name','New artist','officialSocialUrl','https://www.instagram.com/participationqa/','note','','locale','en','idempotencyKey',extensions.gen_random_uuid());
  result:=public.fan_web_submit_fanpage_request(fan,input); request_id:=(result#>>'{item,id}')::uuid;
  again:=public.fan_web_submit_fanpage_request(fan,input||jsonb_build_object('idempotencyKey',extensions.gen_random_uuid()));
  if again#>>'{item,id}'<>request_id::text then raise exception 'own pending duplicate not reused'; end if;
  result:=public.fan_web_submit_fanpage_request(other_fan,input||jsonb_build_object('idempotencyKey',extensions.gen_random_uuid()));
  if result#>>'{item,id}'=request_id::text or result::text like '%'||fan::text||'%' then raise exception 'another pending request leaked'; end if;
  if jsonb_array_length(public.fan_web_check_fanpage_request('New artist','https://instagram.com/participationqa','en')->'artists')<>0 then raise exception 'private pending duplicate exposed'; end if;
  result:=public.fan_web_admin_review_fanpage_request(admin_id,allow_id,correlation,request_id,1,'approve',null,draft_creator,'en');
  if result#>'{item,artist}'<>'null'::jsonb or result::text like '%participation-draft%' then raise exception 'draft artist leaked'; end if;

  perform pg_temp.expect_participation_error(format('select public.fan_web_submit_live_submission(%L,%L,%L,%L,%L)',fan,'participation-live','question','Before open',extensions.gen_random_uuid()),'FAN_WEB_CLOSED');
  perform public.fan_web_admin_save_live_submission_settings(admin_id,allow_id,correlation,live_id,0,true,clock_timestamp()+interval '1 hour','public');
  result:=public.fan_web_submit_live_submission(fan,'participation-live','question','My question',correlation); submission_id:=(result#>>'{item,id}')::uuid;
  if public.fan_web_submit_live_submission(fan,'participation-live','question','My question',correlation)->>'replayed'<>'true' then raise exception 'LIVE retry failed'; end if;
  if jsonb_array_length(public.fan_web_list_live_submissions(null,'participation-live','en',null,null,20)->'items')<>0 then raise exception 'unselected content leaked'; end if;
  perform pg_temp.expect_participation_error(format('select public.fan_web_delete_live_submission(%L,%L)',other_fan,submission_id),'FAN_WEB_NOT_FOUND');
  perform public.fan_web_admin_review_live_submission(admin_id,allow_id,correlation,submission_id,1,'select',null);
  if public.fan_web_get_live_submission_target(null,submission_id)->>'body'<>'My question' then raise exception 'selected content missing'; end if;
  insert into public.user_blocks(app_user_id,blocked_app_user_id) values(fan,other_fan);
  if public.fan_web_get_live_submission_target(other_fan,submission_id) is not null then raise exception 'reverse block leak'; end if;
  perform public.fan_web_admin_save_live_submission_settings(admin_id,allow_id,correlation,live_id,1,true,clock_timestamp()+interval '1 hour','members');
  if public.fan_web_get_live_submission_target(null,submission_id) is not null then raise exception 'member content leaked'; end if;
  result:=public.fan_web_list_live_submissions(fan,'participation-live','en',null,null,20);
  if result#>'{mine,0,body}'<>'null'::jsonb then raise exception 'lost membership exposed body'; end if;
  perform public.fan_web_admin_save_live_submission_settings(admin_id,allow_id,correlation,live_id,2,true,clock_timestamp()+interval '1 hour','public');
  perform public.fan_web_hide_live_submission(admin_id,allow_id,correlation,submission_id,'Moderation test');
  if public.fan_web_get_live_submission_target(fan,submission_id) is not null then raise exception 'hidden content leaked'; end if;
  perform public.fan_web_delete_live_submission(fan,submission_id);
  if public.fan_web_delete_live_submission(fan,submission_id)->>'replayed'<>'true' then raise exception 'delete retry failed'; end if;
  update public.live_fan_submission_settings set closes_at=clock_timestamp() where live_event_id=live_id;
  perform pg_temp.expect_participation_error(format('select public.fan_web_submit_live_submission(%L,%L,%L,%L,%L)',other_fan,'participation-live','cheer','At deadline',extensions.gen_random_uuid()),'FAN_WEB_CLOSED');
  if public.fan_web_replay_url('youtube','https://www.youtube.com/@channel') then raise exception 'channel mistaken for replay'; end if;
  if not public.fan_web_replay_url('youtube','https://www.youtube.com/watch?v=abcdefghijk') then raise exception 'valid replay rejected'; end if;
  perform public.fan_web_admin_save_live_replay(admin_id,allow_id,correlation,live_id,1,'youtube','https://www.youtube.com/watch?v=abcdefghijk',true);
  if (select count(*) from public.fan_activities)<>before_rewards then raise exception 'participation awarded rewards'; end if;
  update public.app_users set status='disabled' where id=fan;
  perform pg_temp.expect_participation_error(format('select public.fan_web_set_schedule_subscription(%L,%L,true)',fan,v_schedule_id),'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  if has_table_privilege('authenticated','public.live_fan_submissions','SELECT') or has_table_privilege('service_role','public.fanpage_requests','SELECT') or has_function_privilege('anon','public.fan_web_submit_live_submission(uuid,text,text,text,uuid)','EXECUTE') then raise exception 'browser/direct privileges leaked'; end if;
end $$;
rollback;
