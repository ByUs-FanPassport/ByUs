-- Revision-aware reservation communication without changing the canonical 24h/10m schedule.
alter table public.fan_notifications add column superseded_at timestamptz,add column superseded_by_revision integer;
alter table public.fan_notifications drop constraint fan_notifications_source_shape;
alter table public.fan_notifications add constraint fan_notifications_source_shape check(
 (kind in('live_reserved','live_24h','live_10m','live_changed','live_cancelled','survey_reminder')and live_event_id is not null and benefit_id is null)
 or(kind in('benefit_available','benefit_unlocked')and benefit_id is not null and live_event_id is null));

create or replace function public.notification_delivery_is_eligible(p_notification_id uuid,p_at timestamptz default pg_catalog.now())
returns boolean language sql stable security definer set search_path='' as $$
 select case when n.kind::text in('live_reserved','live_changed','live_cancelled')then true
 when n.kind::text in('live_24h','live_10m')then coalesce(p.live_reminders,true)and public.live_effective_status_at(n.live_event_id,p_at)='scheduled'
 when n.kind::text='survey_reminder'then coalesce(p.survey_reminders,true)and public.live_effective_status_at(n.live_event_id,p_at)='ended'and not exists(select 1 from public.live_survey_responses r where r.app_user_id=n.app_user_id and r.live_event_id=n.live_event_id and r.status='submitted')
 when n.kind::text in('benefit_available','benefit_unlocked')then coalesce(p.benefit_notifications,true)and exists(select 1 from public.benefits b where b.id=n.benefit_id and b.publication_status='published'and b.archived_at is null and p_at>=b.claim_opens_at and p_at<b.claim_closes_at and not exists(select 1 from public.benefit_claims c where c.benefit_id=b.id and c.app_user_id=n.app_user_id))else true end
 from public.fan_notifications n left join public.notification_preferences p on p.app_user_id=n.app_user_id where n.id=p_notification_id and n.superseded_at is null
$$;

create function public.phase5_rewrite_live_reminder_source()returns trigger language plpgsql set search_path='' as $$declare v_revision integer;begin
 if new.kind in('live_24h','live_10m')then select schedule_revision into v_revision from public.live_events where id=new.live_event_id;new.source_key:='live:'||new.live_event_id::text||':schedule:'||v_revision::text||':'||case new.kind when 'live_24h' then '24h' else '10m' end;end if;return new;end $$;
create trigger phase5_rewrite_live_reminder_source before insert on public.fan_notifications for each row execute function public.phase5_rewrite_live_reminder_source();

create function public.phase5_enqueue_notification_deliveries()returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)select new.id,s.id,greatest(new.scheduled_for,pg_catalog.now())from public.push_subscriptions s where s.app_user_id=new.app_user_id and s.disabled_at is null on conflict(notification_id,subscription_id)do nothing;
 perform public.create_external_notification_plan(new.id,pg_catalog.now());return new;end $$;
create trigger phase5_enqueue_notification_deliveries after insert on public.fan_notifications for each row execute function public.phase5_enqueue_notification_deliveries();

create function public.phase5_notify_live_reservation()returns trigger language plpgsql security definer set search_path='' as $$declare v_revision integer;begin
 select schedule_revision into v_revision from public.live_events where id=new.live_event_id;
 insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
 values(new.app_user_id,'live_reserved','live:'||new.live_event_id::text||':schedule:'||v_revision::text||':reserved',new.live_event_id,pg_catalog.now(),'/live/'||(select slug from public.live_events where id=new.live_event_id),jsonb_build_object('title','LIVE 예약 완료','detail','예약한 LIVE 알림을 보내드릴게요.'))on conflict(app_user_id,source_key)do nothing;return new;end $$;
create trigger phase5_notify_live_reservation after insert on public.live_reservations for each row execute function public.phase5_notify_live_reservation();

create function public.phase5_invalidate_live_revision()returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.schedule_revision=old.schedule_revision then return new;end if;
 update public.fan_notifications set superseded_at=pg_catalog.now(),superseded_by_revision=new.schedule_revision where live_event_id=new.id and superseded_at is null and kind in('live_24h','live_10m')and source_key not like '%:schedule:'||new.schedule_revision::text||':%';
 update public.notification_delivery_outbox o set status='failed',available_at='infinity',last_error_code='SCHEDULE_SUPERSEDED',lease_owner=null,lease_expires_at=null where o.notification_id in(select id from public.fan_notifications where live_event_id=new.id and superseded_by_revision=new.schedule_revision)and o.status in('pending','failed','processing');
 update public.external_notification_delivery_outbox o set status='failed',available_at='infinity',last_error_code='SCHEDULE_SUPERSEDED',lease_owner=null,lease_expires_at=null where o.notification_id in(select id from public.fan_notifications where live_event_id=new.id and superseded_by_revision=new.schedule_revision)and o.status in('pending','failed','processing');
 insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)
 select r.app_user_id,'live_changed','live:'||new.id::text||':schedule:'||new.schedule_revision::text||':changed',new.id,pg_catalog.now(),'/live/'||new.slug,jsonb_build_object('title','LIVE 일정 변경','detail','변경된 LIVE 일정을 확인해 주세요.')from public.live_reservations r where r.live_event_id=new.id on conflict(app_user_id,source_key)do nothing;return new;end $$;
create trigger phase5_invalidate_live_revision after update of schedule_revision on public.live_events for each row execute function public.phase5_invalidate_live_revision();

create function public.phase5_notify_live_cancelled()returns trigger language plpgsql security definer set search_path='' as $$declare v_live public.live_events%rowtype;begin
 if new.effective_status<>'cancelled'then return new;end if;select * into v_live from public.live_events where id=new.live_event_id;
 update public.fan_notifications set superseded_at=pg_catalog.now(),superseded_by_revision=v_live.schedule_revision where live_event_id=v_live.id and superseded_at is null and kind in('live_24h','live_10m');
 update public.notification_delivery_outbox o set status='failed',available_at='infinity',last_error_code='LIVE_CANCELLED',lease_owner=null,lease_expires_at=null where o.notification_id in(select id from public.fan_notifications where live_event_id=v_live.id and kind in('live_24h','live_10m'))and o.status in('pending','failed','processing');
 update public.external_notification_delivery_outbox o set status='failed',available_at='infinity',last_error_code='LIVE_CANCELLED',lease_owner=null,lease_expires_at=null where o.notification_id in(select id from public.fan_notifications where live_event_id=v_live.id and kind in('live_24h','live_10m'))and o.status in('pending','failed','processing');
 insert into public.fan_notifications(app_user_id,kind,source_key,live_event_id,scheduled_for,deep_link,payload)select r.app_user_id,'live_cancelled','live:'||v_live.id::text||':schedule:'||v_live.schedule_revision::text||':cancelled',v_live.id,pg_catalog.now(),'/live/'||v_live.slug,jsonb_build_object('title','LIVE 취소','detail','예약한 LIVE가 취소되었어요.')from public.live_reservations r where r.live_event_id=v_live.id on conflict(app_user_id,source_key)do nothing;return new;end $$;
create trigger phase5_notify_live_cancelled after insert on public.live_status_overrides for each row execute function public.phase5_notify_live_cancelled();

revoke all on function public.phase5_rewrite_live_reminder_source(),public.phase5_enqueue_notification_deliveries(),public.phase5_notify_live_reservation(),public.phase5_invalidate_live_revision(),public.phase5_notify_live_cancelled() from public,anon,authenticated,service_role;
