-- This fixture is applied only by the disposable clean-replay harness.
do $$ begin if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local only'; end if; end $$;
create schema alert_safety_test;
create sequence alert_safety_test.phone;
create function alert_safety_test.assert(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ALERT_SAFETY: %',message; end if; end $$;
begin;
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
 ('92000000-0000-4000-8000-000000000001','alert-safety-artist','published','/test.png',now(),array['creator']::public.celebrity_role[],'creator');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
 ('92000000-0000-4000-8000-000000000001','ko','테스트 크리에이터','통합 검증','크리에이터'),
 ('92000000-0000-4000-8000-000000000001','en','Test creator','Integration test','Creator');
insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values
 ('92000000-0000-4000-8000-000000000002','alert-safety-brand','published','/test.png','브랜드',now());
insert into public.brand_localizations(brand_id,locale,name,description) values
 ('92000000-0000-4000-8000-000000000002','ko','테스트 브랜드','통합 검증'),
 ('92000000-0000-4000-8000-000000000002','en','Test brand','Integration test');
insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,content_status,
 starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at)
values('92000000-0000-4000-8000-000000000003','alert-safety-live','92000000-0000-4000-8000-000000000001',
 '92000000-0000-4000-8000-000000000002','published','scheduled',now()+interval '10 minutes',now()+interval '1 hour',
 now()-interval '1 day',now()+interval '5 minutes','https://youtube.com/watch?v=abc12345678','/test.png',extensions.crypt('TEST',extensions.gen_salt('bf',10)),now());
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values
 ('92000000-0000-4000-8000-000000000003','ko','카카오 통합 검증 LIVE','통합 검증','LIVE'),
 ('92000000-0000-4000-8000-000000000003','en','Integration LIVE','Integration test','LIVE');
commit;
create function alert_safety_test.owner(p_locale text,p_kakao boolean default false) returns uuid language plpgsql as $$
declare o uuid:=extensions.gen_random_uuid(); s text:=encode(extensions.digest(o::text,'sha256'),'hex'); pending jsonb;
begin
insert into public.app_users(id,privy_user_id,verified_email,preferred_locale) values(o,'did:privy:alert-'||o,o||'@example.invalid',p_locale);
perform public.sync_owned_google_notification_channel(o,'did:privy:alert-'||o,o||'@example.invalid',true,now());
if p_kakao then
perform public.create_owned_kakao_alimtalk_state(o,s,repeat('a',64),'/settings');
perform public.consume_owned_kakao_connection_state(o,s);
perform public.complete_owned_kakao_connection(o,s);
pending:=public.stage_owned_kakao_phone_enrollment(o,s,s,'0108'||lpad(nextval('alert_safety_test.phone')::text,7,'0'));
perform public.confirm_owned_kakao_phone_enrollment(o,(pending->>'id')::uuid,'kakao-alimtalk-v1');
end if;
return o;
end $$;
create function alert_safety_test.notification(o uuid,k public.notification_kind default 'live_10m') returns uuid language plpgsql as $$ declare n uuid; begin
insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link)
values(o,k,'audit:'||extensions.gen_random_uuid(),'92000000-0000-4000-8000-000000000003',now(),'/live/alert-safety-live')returning id into n; return n;
end $$;
select alert_safety_test.notification(alert_safety_test.owner('en'));
create table alert_safety_test.outbox_before as select id,to_jsonb(d) snapshot from public.external_notification_delivery_outbox d;
create table alert_safety_test.plans_before as select id,to_jsonb(p) snapshot from public.notification_delivery_plans p;
create table alert_safety_test.channels_before as select id,to_jsonb(c) snapshot from public.fan_notification_channels c;
