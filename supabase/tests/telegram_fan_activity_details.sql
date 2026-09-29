-- Disposable local database only; real source facts and all sends roll back.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; end $$;
select public.configure_telegram_alerts('-1001234567890',true);
update public.telegram_alert_settings set activated_at='2000-01-01';
do $$
declare
  a uuid:='fa300000-0000-4000-8000-000000000011'; b uuid:='fa300000-0000-4000-8000-000000000012';
  c uuid:='fa300000-0000-4000-8000-000000000013'; artist uuid:='fa300000-0000-4000-8000-000000000021';
  notice uuid:='fa300000-0000-4000-8000-000000000022'; post uuid; comment uuid; reply uuid;
  lounge uuid; lounge_reply uuid; note_comment uuid; key uuid:=gen_random_uuid();
  d jsonb; batch jsonb; payload jsonb; role_name text; n integer; sent integer:=0; old_like uuid;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (a,'did:privy:telegram-detail-a','detail-a@example.test'),
    (b,'did:privy:telegram-detail-b','detail-b@example.test'),
    (c,'did:privy:telegram-detail-c','detail-c@example.test');
  insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
    (a,'민지','민지'),(b,'지민','지민'),(c,'수아','수아');
  insert into public.admin_allowlist(id,email,role) values(a,'detail-a@example.test','operator');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(a,91342,'0xfa30000000000000000000000000000000000011','privy','embedded');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(artist,'telegram-detail','published','/images/creator.webp',now(),'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
    values(artist,'ko','알림 최애','소개','사진');
  insert into public.celebrity_notices(id,celebrity_id,slug,publication_status,published_at,ever_published_at)
    values(notice,artist,'telegram-detail-notice','published',now(),now());
  -- An English-only notice must still produce a valid detail/link.
  insert into public.celebrity_notice_localizations(notice_id,locale,title,body_json)
    values(notice,'en','Upcoming event','{"type":"doc","content":[]}');
  delete from public.telegram_alert_outbox;

  post:=(public.save_fan_post(a,'telegram-detail',null,'오늘도 응원해요','public','{}',null,key)->>'id')::uuid;
  perform public.save_fan_post(a,'telegram-detail',null,'오늘도 응원해요','public','{}',null,key);
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='fan_post_created'),'post retry captured once');
  comment:=(public.post_fan_post_comment(b,post,null,E'민지님 반가워요\n함께 응원해요 💖',key)->>'id')::uuid;
  perform public.post_fan_post_comment(b,post,null,E'민지님 반가워요\n함께 응원해요 💖',key);
  reply:=(public.post_fan_post_comment(c,post,comment,'지민님 저도 반가워요',key)->>'id')::uuid;
  perform pg_temp.expect((select count(*)=2 from public.telegram_alert_outbox where kind='fan_post_commented'),'comment/reply dedupe');
  select public.telegram_fan_activity_detail(o) into d from public.telegram_alert_outbox o where activity_source_id=comment;
  perform pg_temp.expect(d#>>'{detail,actor_id}'=b::text and d#>>'{detail,recipient_id}'=a::text and d#>>'{detail,recipient_name}'='민지','comment actor and post author');
  perform pg_temp.expect(d#>>'{detail,body}'=E'민지님 반가워요\n함께 응원해요 💖' and d->>'actor_email'='detail-b@example.test','exact comment body/email');
  select public.telegram_fan_activity_detail(o) into d from public.telegram_alert_outbox o where activity_source_id=reply;
  perform pg_temp.expect(d#>>'{detail,recipient_id}'=b::text and d#>>'{detail,is_reply}'='true','reply targets parent comment author');
  perform pg_temp.expect(d#>>'{detail,path}'='/c/telegram-detail/community/'||post::text||'#comment-'||reply::text,'reply canonical link');

  perform public.set_fan_post_like(b,post,true); perform public.set_fan_post_like(b,post,true);
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='fan_post_liked'),'same like state emits once');
  select id into old_like from public.telegram_alert_outbox where kind='fan_post_liked';
  perform public.set_fan_post_like(b,post,false);
  -- Simulate a later committed like while both old/new queue rows are pending.
  insert into public.fan_post_likes(post_id,app_user_id,created_at) values(post,b,clock_timestamp()+interval '1 second');
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where id=old_like),'old like cannot read a later re-like');
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox o where kind='fan_post_liked' and public.telegram_fan_activity_detail(o) is not null),'new like is its own fact');

  insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key)
    values(artist,a,'응원합니다!',gen_random_uuid()) returning id into lounge;
  insert into public.fan_lounge_messages(celebrity_id,app_user_id,body,idempotency_key,reply_to_id)
    values(artist,b,'함께해요',gen_random_uuid(),lounge) returning id into lounge_reply;
  select public.telegram_fan_activity_detail(o) into d from public.telegram_alert_outbox o where activity_source_id=lounge_reply;
  perform pg_temp.expect(d#>>'{detail,recipient_id}'=a::text and d#>>'{detail,is_reply}'='true' and d#>>'{detail,path}'='/telegram-detail#cheers','lounge reply who to whom');
  insert into public.celebrity_notice_comments(notice_id,app_user_id,body,idempotency_key)
    values(notice,b,'공지 확인했어요',gen_random_uuid()) returning id into note_comment;
  select public.telegram_fan_activity_detail(o) into d from public.telegram_alert_outbox o where activity_source_id=note_comment;
  perform pg_temp.expect(d#>>'{detail,context}'='Upcoming event' and d#>>'{detail,path}'='/c/telegram-detail/notices/telegram-detail-notice#comment-'||note_comment::text,'notice fallback locale and link');
  perform public.check_in_community_stamp(a,'telegram-detail'); perform public.check_in_community_stamp(a,'telegram-detail');
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where kind='daily_checked_in'),'one daily checkin');
  select public.telegram_fan_activity_detail(o) into d from public.telegram_alert_outbox o where kind='daily_checked_in';
  perform pg_temp.expect(d#>>'{detail,actor_id}'=a::text and d#>>'{detail,path}'='/telegram-detail#daily-checkin'
    and d#>>'{detail,result}'=to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD')||' 일일 출석 완료','daily actor/date/result');

  -- Suppress children when parents or parent authors become unavailable.
  update public.fan_post_comments set hidden_at=clock_timestamp() where id=comment;
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where activity_source_id=reply),'hidden parent comment suppresses reply');
  update public.fan_post_comments set hidden_at=null where id=comment;
  update public.fan_posts set hidden_at=clock_timestamp() where id=post;
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where activity_source_id=comment),'hidden post suppresses comment');
  update public.fan_posts set hidden_at=null where id=post;
  update public.fan_lounge_messages set removed_at=clock_timestamp() where id=lounge;
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where activity_source_id=lounge_reply),'removed lounge parent suppresses reply');
  update public.fan_lounge_messages set removed_at=null where id=lounge;
  update public.celebrity_notices set archived_at=clock_timestamp(),archived_by_admin_allowlist_id=a,archive_reason='텔레그램 부모 공지 보관 검증' where id=notice;
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where activity_source_id=note_comment),'archived notice suppresses comment');
  update public.celebrity_notices set archived_at=null,archived_by_admin_allowlist_id=null,archive_reason=null where id=notice;
  update public.app_users set status='disabled' where id=a;
  perform pg_temp.expect((select public.telegram_fan_activity_detail(o) is null from public.telegram_alert_outbox o where activity_source_id=comment),'inactive parent author suppresses comment');
  update public.app_users set status='active' where id=a;

  select count(*) into n from public.telegram_alert_outbox;
  begin
    perform public.save_fan_post(b,'telegram-detail',null,'rollback','public','{}',null,gen_random_uuid());
    raise exception 'rollback test';
  exception when raise_exception then null; end;
  perform pg_temp.expect((select count(*)=n from public.telegram_alert_outbox),'source rollback rolls back capture');
  perform pg_temp.expect(public.claim_telegram_alert_batch_with_cs_content('-999') is null,'wrong room cannot claim');
  loop
    batch:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
    exit when batch is null;
    perform pg_temp.expect(jsonb_array_length(batch->'alerts') between 1 and 5,'bounded batch');
    for payload in select value from jsonb_array_elements(batch->'alerts') loop
      perform pg_temp.expect(payload ? 'detail' and payload->>'actor_email' is not null,'real claim carries detail');
      sent:=sent+1;
    end loop;
    perform pg_temp.expect(public.begin_telegram_alert_send((batch->>'batch_id')::uuid,'-1001234567890'),'begin');
    perform public.finish_telegram_alert_batch((batch->>'batch_id')::uuid,'sent',123);
    update public.telegram_alert_settings set next_send_at='-infinity';
  end loop;
  perform pg_temp.expect(sent=8 and (select status='skipped' from public.telegram_alert_outbox where id=old_like),'drain all 8 valid events, retire stale like');
  perform pg_temp.expect(public.claim_telegram_alert_batch_with_cs_content('-1001234567890') is null,'idle silent');

  -- Full 1000-codepoint comments stay in a single message-sized batch.
  perform public.post_fan_post_comment(c,post,null,repeat('💖',1000),gen_random_uuid());
  perform public.post_fan_post_comment(b,post,null,repeat('가',1000),gen_random_uuid());
  batch:=public.claim_telegram_alert_batch_with_cs_content('-1001234567890');
  perform pg_temp.expect(jsonb_array_length(batch->'alerts')=1 and char_length(batch#>>'{alerts,0,detail,body}')=1000,'long comment preserved and isolated');
  perform pg_temp.expect((select count(*)=1 from public.telegram_alert_outbox where status='pending'),'remainder stays pending');
  raise notice 'TELEGRAM_DETAIL_FIXTURE=%',batch;

  foreach role_name in array array['anon','authenticated','service_role'] loop
    perform pg_temp.expect(not has_function_privilege(role_name,'public.telegram_fan_activity_detail(public.telegram_alert_outbox)','execute'),'private detail projection '||role_name);
    perform pg_temp.expect(not has_function_privilege(role_name,'public.capture_telegram_fan_activity()','execute'),'private capture '||role_name);
    perform pg_temp.expect(not has_table_privilege(role_name,'public.telegram_alert_outbox','select'),'private outbox '||role_name);
  end loop;
  perform pg_temp.expect(not has_function_privilege('anon','public.claim_telegram_alert_batch_with_cs_content(text)','execute') and
    has_function_privilege('service_role','public.claim_telegram_alert_batch_with_cs_content(text)','execute'),'service-only scoped claim');
end $$;
rollback;
