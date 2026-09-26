-- Disposable database only. Fixtures and direct injection probes all roll back.
begin;
do $$
declare
  fan uuid:=extensions.gen_random_uuid(); other uuid:=extensions.gen_random_uuid(); artist uuid:=extensions.gen_random_uuid();
  schedule uuid:=extensions.gen_random_uuid(); notification uuid; push_id uuid:=extensions.gen_random_uuid(); first_count integer;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values
    (fan,'did:privy:web-notification-a','web-notification-a@example.test'),(other,'did:privy:web-notification-b','web-notification-b@example.test');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(artist,'web-notification-qa','published','/test.webp',now(),'{creator}','creator');
  insert into public.celebrity_schedules(id,celebrity_id,kind,title_ko,title_en,starts_at,ends_at,time_zone,status,official_source_url,idempotency_key,request_hash)
    values(schedule,artist,'event','알림 검증','Notification QA',now()+interval '12 hours',now()+interval '13 hours','Asia/Seoul','published','https://example.test/schedule',extensions.gen_random_uuid(),repeat('a',64));
  insert into public.push_subscriptions(id,app_user_id,endpoint,endpoint_hash,p256dh,auth_secret)
    values(push_id,fan,'https://push.example.test/web-notification',repeat('a',64),repeat('a',40),repeat('b',16));
  perform public.fan_web_set_schedule_subscription(fan,schedule,true);
  if (select count(*) from public.fan_web_notification_intents where recipient_app_user_id=fan)<>1 then raise exception 'subscription intent missing'; end if;
  if public.fan_web_drain_notification_intents(fan)<>1 or public.fan_web_drain_notification_intents(fan)<>0 then raise exception 'intent materialization not exactly once'; end if;
  update public.fan_notifications set scheduled_for=now() where app_user_id=fan;
  select id into notification from public.fan_notifications where app_user_id=fan;
  if public.fan_web_notification_can_send(notification) or public.notification_delivery_is_eligible(notification) then raise exception 'web notification eligible for external delivery'; end if;
  if public.create_external_notification_plan(notification) is not null then raise exception 'web notification created external plan'; end if;
  insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at) values(notification,push_id,now());
  if exists(select 1 from public.notification_delivery_outbox where notification_id=notification)
    or exists(select 1 from public.notification_delivery_plans where notification_id=notification)
    or exists(select 1 from public.external_notification_delivery_outbox where notification_id=notification) then raise exception 'new web kind leaked into outbound queues'; end if;
  if public.count_owned_web_notifications(fan)<>1 or public.count_owned_web_notifications(other)<>0 then raise exception 'owner unread count mismatch'; end if;
  if public.mark_owned_web_notifications_read(other,notification) then raise exception 'other owner marked notification'; end if;
  -- Actual source revisions replace obsolete reminders and preserve cancellation.
  update public.celebrity_schedules set revision=revision+1,status='cancelled' where id=schedule;
  perform public.fan_web_drain_notification_intents(fan);
  update public.fan_notifications set scheduled_for=now() where app_user_id=fan;
  if public.fan_web_notification_path(fan,notification) is not null or public.count_owned_web_notifications(fan)<>1 then raise exception 'cancelled schedule retained stale reminder'; end if;
  perform public.fan_web_set_schedule_subscription(fan,schedule,false);
  if public.count_owned_web_notifications(fan)<>0 or jsonb_array_length(public.get_owned_web_notifications(fan,'ko'))<>0 then raise exception 'unsubscribe left visible notification'; end if;
  -- Muted categories are consumed without a visible notification.
  perform public.fan_web_patch_notification_preferences(fan,'{"schedule_notifications":false}'::jsonb);
  select count(*) into first_count from public.fan_notifications where app_user_id=fan;
  perform public.fan_web_emit_notification(fan,'schedule_changed','schedule',schedule,40,now());
  perform public.fan_web_drain_notification_intents(fan);
  update public.fan_notifications set scheduled_for=now() where app_user_id=fan;
  if (select count(*) from public.fan_notifications where app_user_id=fan)<>first_count then raise exception 'muted intent emitted'; end if;
  -- Badge is all visible unread, even if newest 100 list rows are read.
  update public.celebrity_schedules set revision=revision+1,status='published' where id=schedule;
  perform public.fan_web_patch_notification_preferences(fan,'{"schedule_notifications":true}'::jsonb);
  perform public.fan_web_set_schedule_subscription(fan,schedule,true);
  perform public.fan_web_drain_notification_intents(fan);
  update public.fan_notifications set scheduled_for=now() where app_user_id=fan;
  perform public.mark_owned_web_notifications_read(fan,null);
  insert into public.fan_notifications(app_user_id,kind,source_key,scheduled_for,deep_link,payload,web_only,read_at,created_at)
    select fan,'schedule_changed','badge-qa:'||g,now()-interval '1 day','/my',jsonb_build_object('targetType','schedule','targetId',schedule,'revision',3),true,
      case when g=0 then null else now() end,now()-interval '2 days'+g*interval '1 minute' from generate_series(0,100) g;
  if public.count_owned_web_notifications(fan)<>1 then raise exception '101st unread was lost from badge'; end if;
  if jsonb_array_length(public.get_owned_web_notifications(fan,'ko'))<>100 then raise exception 'inbox list bound changed'; end if;
  perform public.mark_owned_web_notifications_read(fan,null);
  if public.count_owned_web_notifications(fan)<>0 then raise exception 'mark-all failed for old visible row'; end if;
  update public.app_users set status='disabled' where id=fan;
  if public.count_owned_web_notifications(fan)<>0 or jsonb_array_length(public.get_owned_web_notifications(fan,'en'))<>0 then raise exception 'disabled user inbox visible'; end if;
  if has_function_privilege('anon','public.fan_web_emit_notification(uuid,text,text,uuid,integer,timestamp with time zone)','EXECUTE')
    or has_table_privilege('authenticated','public.fan_web_notification_intents','SELECT') then raise exception 'browser role can inspect intents'; end if;
end $$;
rollback;
select 'Web notification intents, web-only delivery, source ACL, preference and full unread count PASS' as result;
