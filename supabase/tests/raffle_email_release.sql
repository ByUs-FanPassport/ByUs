-- Disposable fixture only; no provider calls or real recipients.
do $$ begin if current_database()<>'byus_clean' or inet_server_addr() is not null then raise exception 'local only'; end if; end $$;
begin;
do $$
<<fixture>>
declare
  owner_id uuid:=alert_safety_test.owner('en'); outsider uuid:=alert_safety_test.owner('en');
  actor uuid:=extensions.gen_random_uuid(); admin_id uuid:=extensions.gen_random_uuid();
  campaign_id uuid:=extensions.gen_random_uuid(); other_campaign uuid:=extensions.gen_random_uuid();
  draw_id uuid:=extensions.gen_random_uuid(); other_draw uuid:=extensions.gen_random_uuid();
  candidate_id uuid:=extensions.gen_random_uuid(); winner_id uuid:=extensions.gen_random_uuid();
  other_candidate uuid:=extensions.gen_random_uuid(); other_winner uuid:=extensions.gen_random_uuid();
  benefit_id uuid; creator_id uuid; winner_notification uuid; spoof uuid; live_notification uuid;
  cutoff timestamptz; j jsonb; role_name text;
begin
  perform alert_safety_test.assert(not exists(select 1 from public.benefit_draw_email_releases),'migration releases nothing');
  select b.id,b.celebrity_id into strict benefit_id,creator_id from public.benefits b
    where b.publication_status='published' and b.archived_at is null limit 1;
  insert into public.app_users(id,privy_user_id,verified_email)
    values(actor,'did:privy:raffle-email-admin', 'raffle-email-admin@example.invalid');
  insert into public.admin_allowlist(id,email,role,active) values(admin_id,'raffle-email-admin@example.invalid','admin',true);
  insert into public.live_benefit_campaigns(id,celebrity_id,status,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id,published_at)
    values(campaign_id,creator_id,'published',now()-interval '2 days',now()-interval '1 day',actor,admin_id,now()),
      (other_campaign,creator_id,'published',now()-interval '2 days',now()-interval '1 day',actor,admin_id,now());
  insert into public.live_benefit_campaign_items(campaign_id,benefit_id,priority,winner_quantity,fulfillment_method)
    values(campaign_id,benefit_id,1,1,'digital'),(other_campaign,benefit_id,1,1,'digital');
  insert into public.benefit_draws(id,campaign_id,idempotency_key,algorithm,seed_hash,actor_app_user_id,actor_admin_allowlist_id,correlation_id)
    values(draw_id,campaign_id,extensions.gen_random_uuid(),'sha256-weighted-rank-v1',repeat('a',64),actor,admin_id,extensions.gen_random_uuid()),
      (other_draw,other_campaign,extensions.gen_random_uuid(),'sha256-weighted-rank-v1',repeat('b',64),actor,admin_id,extensions.gen_random_uuid());
  insert into public.benefit_draw_candidates(id,draw_id,campaign_id,benefit_id,app_user_id,weight,digest,uniform_value,rank_value,result)
    values(candidate_id,draw_id,campaign_id,benefit_id,owner_id,1,repeat('a',64),0.5,1,'won'),
      (other_candidate,other_draw,other_campaign,benefit_id,owner_id,1,repeat('b',64),0.5,1,'won');
  insert into public.benefit_draw_winners(id,draw_id,campaign_id,benefit_id,app_user_id,candidate_id)
    values(winner_id,draw_id,campaign_id,benefit_id,owner_id,candidate_id),
      (other_winner,other_draw,other_campaign,benefit_id,owner_id,other_candidate);
  begin
    insert into public.benefit_draw_email_releases(draw_id,reason) values(other_draw,'unpublished fixture');
    raise exception 'unpublished draw released';
  exception when foreign_key_violation then null; end;
  insert into public.benefit_draw_publications(draw_id,campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id)
    values(draw_id,campaign_id,actor,admin_id,extensions.gen_random_uuid()),
      (other_draw,other_campaign,actor,admin_id,extensions.gen_random_uuid());
  update public.fan_notification_delivery_control set allowed_kinds=array['live_reserved','live_24h','live_10m','live_changed','live_cancelled'];
  cutoff:=public.configure_fan_notification_delivery('email','enabled');
  perform public.configure_fan_notification_delivery('kakao','enabled');
  insert into public.fan_notifications(app_user_id,kind,source_key,benefit_id,scheduled_for,created_at)
    values(owner_id,'benefit_won','benefit_won:'||winner_id::text||':1',benefit_id,now(),clock_timestamp()) returning id into winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'published draw still requires explicit release');
  insert into public.benefit_draw_email_releases(draw_id,reason) values(draw_id,'approved fixture draw');
  perform alert_safety_test.assert(public.fan_notification_is_released(winner_notification,'email'),'approved winner email released');
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'kakao'),'Kakao unchanged');
  insert into public.fan_notifications(app_user_id,kind,source_key,benefit_id,scheduled_for,created_at)
    values(owner_id,'benefit_won','benefit_won:'||other_winner::text||':1',benefit_id,now(),clock_timestamp()) returning id into spoof;
  perform alert_safety_test.assert(not public.fan_notification_is_released(spoof,'email'),'other published draw stays blocked');
  update public.fan_notifications set created_at=cutoff where id=winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'equal cutoff excluded');
  update public.fan_notifications set created_at=clock_timestamp() where id=winner_notification;
  update public.fan_notification_delivery_control set mode='test',test_user_ids=array[outsider] where channel='email';
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'test-user restriction retained');
  update public.fan_notification_delivery_control set mode='enabled',test_user_ids='{}' where channel='email';
  insert into public.fan_notifications(app_user_id,kind,source_key,benefit_id,scheduled_for,created_at)
    values(outsider,'benefit_won','benefit_won:'||winner_id::text||':1',benefit_id,now(),clock_timestamp()) returning id into spoof;
  perform alert_safety_test.assert(not public.fan_notification_is_released(spoof,'email'),'cross-owner source rejected');
  update public.fan_notifications set benefit_id=(select b.id from public.benefits b where b.id<>fixture.benefit_id limit 1) where id=winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'wrong benefit rejected');
  update public.fan_notifications set benefit_id=fixture.benefit_id where id=winner_notification;
  update public.fan_notifications set source_key='benefit_won:'||extensions.gen_random_uuid()::text||':1' where id=winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'wrong winner source rejected');
  update public.fan_notifications set source_key='benefit_won:'||winner_id::text||':1',kind='benefit_available' where id=winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'duplicate availability email stays blocked');
  update public.fan_notifications set kind='recipient_information_required' where id=winner_notification;
  perform alert_safety_test.assert(not public.fan_notification_is_released(winner_notification,'email'),'recipient reminder stays blocked');
  update public.fan_notifications set kind='benefit_won' where id=winner_notification;
  live_notification:=alert_safety_test.notification(owner_id);
  update public.fan_notifications set created_at=clock_timestamp() where id=live_notification;
  perform alert_safety_test.assert(public.fan_notification_is_released(live_notification,'email'),'LIVE release preserved');
  select to_jsonb(q) into j from public.claim_email_notification_deliveries_safely('raffle-email-test',100,120) q where q.notification_id=winner_notification;
  perform alert_safety_test.assert(j is not null,'winner delivery claims through existing protocol');
  update public.fan_notification_delivery_control set mode='disabled' where channel='email';
  perform alert_safety_test.assert(not public.revalidate_email_notification_delivery((j->>'id')::uuid,'raffle-email-test'),'pause blocks revalidation');
  perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,'raffle-email-test',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'pause blocks begin');
  update public.fan_notification_delivery_control set mode='enabled' where channel='email';
  perform alert_safety_test.assert(public.begin_email_notification_send((j->>'id')::uuid,'raffle-email-test',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'first approved begin succeeds');
  perform alert_safety_test.assert(not public.begin_email_notification_send((j->>'id')::uuid,'raffle-email-test',(j->>'attempt_count')::int,encode(extensions.digest(j->>'destination','sha256'),'hex')),'repeat begin denied');
  foreach role_name in array array['anon','authenticated','service_role'] loop
    perform alert_safety_test.assert(not has_table_privilege(role_name,'public.benefit_draw_email_releases','select,insert,update,delete'),'release table private');
    perform alert_safety_test.assert(not has_function_privilege(role_name,'public.fan_notification_is_released(uuid,text)','execute'),'release helper private');
  end loop;
end $$;
rollback;
select 'Raffle email scope, publication, owner, channel, cutoff, pause and send-once PASS' as result;
