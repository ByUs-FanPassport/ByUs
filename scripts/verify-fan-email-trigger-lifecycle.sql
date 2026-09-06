\set ON_ERROR_STOP on
begin;

create temporary table claimed_email_jobs (
  id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,
  template_key text,locale text,destination text,payload jsonb,attempt_count integer,
  lease_owner text,lease_expires_at timestamptz
) on commit drop;

create temporary table claimed_external_jobs (
  id uuid,notification_id uuid,plan_id uuid,channel text,sequence integer,
  template_key text,locale text,destination text,payload jsonb,attempt_count integer,
  lease_owner text,lease_expires_at timestamptz
) on commit drop;

create temporary table sanitized_email_queue_exports (
  fixture text primary key,job jsonb not null
) on commit drop;

insert into public.app_users(id,privy_user_id,verified_email,preferred_locale)
values
  ('61000000-0000-4000-8000-000000000001','did:privy:email-lifecycle-ko','ko@example.test','ko'),
  ('61000000-0000-4000-8000-000000000002','did:privy:email-lifecycle-en','en@example.test',null),
  ('61000000-0000-4000-8000-000000000003','did:privy:email-lifecycle-third','third@example.test','ko');

do $$
begin
  if public.initialize_owned_preferred_locale(
    '61000000-0000-4000-8000-000000000002','en'
  )<>'en' then raise exception 'first-login locale initialization failed'; end if;
  if public.initialize_owned_preferred_locale(
    '61000000-0000-4000-8000-000000000002','ko'
  )<>'en' then raise exception 'first-login locale overwrote a prior choice'; end if;
  if public.set_owned_preferred_locale(
    '61000000-0000-4000-8000-000000000002','en'
  )<>'en' then raise exception 'settings locale update failed'; end if;
end $$;

select public.sync_owned_google_notification_channel(
  '61000000-0000-4000-8000-000000000001','did:privy:email-lifecycle-ko',
  'ko@example.test',true,'2030-01-01T00:00:00Z'
);
select public.sync_owned_google_notification_channel(
  '61000000-0000-4000-8000-000000000002','did:privy:email-lifecycle-en',
  'en@example.test',true,'2030-01-01T00:00:00Z'
);

insert into public.push_subscriptions(
  id,app_user_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent
) values(
  '61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000001',
  'https://push.example.test/email-lifecycle',repeat('a',64),repeat('p',65),
  repeat('s',16),'email-lifecycle-fixture'
);

insert into public.admin_allowlist(id,email,role,created_by_app_user_id)
values(
  '61000000-0000-4000-8000-000000000010','ko@example.test','admin',
  '61000000-0000-4000-8000-000000000001'
);

insert into public.celebrities(id,slug,status,image_url)
values(
  '61000000-0000-4000-8000-000000000020','email-lifecycle-artist','draft',
  'https://example.test/artist.jpg'
);
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
values
  ('61000000-0000-4000-8000-000000000020','ko','테스트 아티스트','테스트 소개','아티스트'),
  ('61000000-0000-4000-8000-000000000020','en','Test Artist','Test summary','Artist');
update public.celebrities set status='published',published_at='2030-01-01T00:00:00Z'
where id='61000000-0000-4000-8000-000000000020';

insert into public.brands(id,slug,status,logo_url,logo_alt)
values(
  '61000000-0000-4000-8000-000000000030','email-lifecycle-brand','draft',
  'https://example.test/logo.png','Test'
);
insert into public.brand_localizations(brand_id,locale,name,description)
values
  ('61000000-0000-4000-8000-000000000030','ko','테스트 브랜드','테스트 설명'),
  ('61000000-0000-4000-8000-000000000030','en','Test Brand','Test description');
update public.brands set status='published',published_at='2030-01-01T00:00:00Z'
where id='61000000-0000-4000-8000-000000000030';

insert into public.celebrity_quizzes(id,celebrity_id,version)
values(
  '61000000-0000-4000-8000-000000000040',
  '61000000-0000-4000-8000-000000000020',1
);
insert into public.quiz_attempts(
  id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at
) values
  ('61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000040',1,
    '61000000-0000-4000-8000-000000000141','passed',3,'2030-01-01T00:00:00Z'),
  ('61000000-0000-4000-8000-000000000042','61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000040',1,
    '61000000-0000-4000-8000-000000000142','passed',3,'2030-01-01T00:00:00Z');
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id)
values
  ('61000000-0000-4000-8000-000000000051','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000041'),
  ('61000000-0000-4000-8000-000000000052','61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000042');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id)
values
  ('61000000-0000-4000-8000-000000000061','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000051'),
  ('61000000-0000-4000-8000-000000000062','61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000052');

insert into public.live_events(
  id,slug,celebrity_id,brand_id,starts_at,ends_at,reservation_opens_at,
  reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,
  attendance_valid_from,attendance_valid_until
) values(
  '61000000-0000-4000-8000-000000000070','email-lifecycle-live',
  '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000030',
  '2030-01-10T12:00:00Z','2030-01-10T13:00:00Z',
  '2029-12-01T00:00:00Z','2030-01-10T11:00:00Z',
  'https://www.youtube.com/watch?v=abcdefghijk','https://example.test/live.jpg',
  extensions.crypt('EMAIL-LIFECYCLE',extensions.gen_salt('bf',12)),
  '2030-01-10T11:55:00Z','2030-01-10T13:10:00Z'
);
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
values
  ('61000000-0000-4000-8000-000000000070','ko','테스트 라이브','라이브 소개','라이브'),
  ('61000000-0000-4000-8000-000000000070','en','Test Live','Live summary','Live');
update public.live_events set publication_status='published',published_at='2030-01-01T00:00:00Z'
where id='61000000-0000-4000-8000-000000000070';

-- Real reservation producer creates immediate reserved notifications.
insert into public.live_reservations(
  id,app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key,reserved_at
) values
  ('61000000-0000-4000-8000-000000000071','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000070','61000000-0000-4000-8000-000000000020',
    '61000000-0000-4000-8000-000000000061','61000000-0000-4000-8000-000000000171',
    '2030-01-01T00:00:00Z'),
  ('61000000-0000-4000-8000-000000000072','61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000070','61000000-0000-4000-8000-000000000020',
    '61000000-0000-4000-8000-000000000062','61000000-0000-4000-8000-000000000172',
    '2030-01-01T00:00:00Z');

-- Real scheduler creates both reminder kinds; only 10m may enter email.
select public.enqueue_due_notification_maintenance('2030-01-10T11:55:00Z');

do $$
begin
  if (select count(*) from public.fan_notifications where kind='live_24h')<>2
    or (select count(*) from public.fan_notifications where kind='live_10m')<>2 then
    raise exception 'LIVE scheduler did not produce both inbox/push reminder kinds';
  end if;
  if exists(
    select 1 from public.external_notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    where delivery.channel='email' and notification.kind='live_24h'
      and delivery.status<>'failed'
  ) then raise exception '24-hour reminder entered an email-sendable state'; end if;
  if not exists(
    select 1 from public.notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    where notification.kind='live_24h'
      and notification.app_user_id='61000000-0000-4000-8000-000000000001'
      and delivery.subscription_id='61000000-0000-4000-8000-000000000005'
  ) then raise exception '24-hour reminder push delivery was not preserved'; end if;
  if exists(
    select 1 from public.external_notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    where notification.kind in ('live_10m') and delivery.available_at<
      notification.scheduled_for
  ) then raise exception 'email outbox was available before its schedule'; end if;
end $$;

insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-live',100,300,'2030-01-10T11:55:00Z'
);

do $$
begin
  if (select count(*) from claimed_email_jobs where template_key='live_10m')<>2 then
    raise exception 'KO/EN 10-minute jobs were not claimed'; end if;
  if exists(select 1 from claimed_email_jobs where template_key='live_24h') then
    raise exception '24-hour email was claimed'; end if;
  if exists(
    select 1 from claimed_email_jobs
    where template_key='live_10m'
      and (payload#>>'{context,kind}')<>'live_10m'
  ) then raise exception 'LIVE payload discriminant missing'; end if;
  if exists(
    select 1 from claimed_email_jobs
    where template_key='live_10m'
      and payload->>'deepLink'<>'/live/email-lifecycle-live'
  ) then raise exception 'scheduled LIVE deep link was not canonical'; end if;
  if (select count(distinct locale) from claimed_email_jobs where template_key='live_10m')<>2 then
    raise exception 'outbox did not snapshot both user locales'; end if;
end $$;

select public.complete_external_notification_delivery(id,'fixture-live','fixture', '2030-01-10T11:55:01Z')
from claimed_email_jobs;
truncate claimed_email_jobs;

-- Actual schedule revision producer invalidates old reminders and creates changed.
update public.live_events set schedule_revision=2
where id='61000000-0000-4000-8000-000000000070';
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-changed',100,300,'2030-01-10T11:56:00Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs where template_key='live_changed')<>2 then
    raise exception 'schedule revision did not produce KO/EN changed jobs'; end if;
end $$;
insert into sanitized_email_queue_exports(fixture,job)
select 'ko-live-changed',jsonb_build_object(
  'templateKey',template_key,'locale',locale,'payload',payload
)
from claimed_email_jobs where template_key='live_changed' and locale='ko' limit 1;
select public.complete_external_notification_delivery(id,'fixture-changed','fixture','2030-01-10T11:56:01Z')
from claimed_email_jobs;
truncate claimed_email_jobs;

-- A legacy row whose outbox timestamp predates its notification schedule must
-- remain queued until the actual notification due time.
insert into public.fan_notifications(
  id,app_user_id,kind,source_key,live_event_id,scheduled_for
) values(
  '61000000-0000-4000-8000-000000000075','61000000-0000-4000-8000-000000000001',
  'live_10m','fixture:future:live-10m','61000000-0000-4000-8000-000000000070',
  '2030-01-10T11:59:00Z'
);
update public.external_notification_delivery_outbox
set available_at='2030-01-10T11:58:00Z'
where notification_id='61000000-0000-4000-8000-000000000075' and channel='email';
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-before-due',100,300,'2030-01-10T11:58:00Z'
);
do $$
begin
  if exists(
    select 1 from claimed_email_jobs
    where notification_id='61000000-0000-4000-8000-000000000075'
  ) then raise exception 'future email was claimed before scheduled_for'; end if;
  if not exists(
    select 1 from public.external_notification_delivery_outbox
    where notification_id='61000000-0000-4000-8000-000000000075'
      and channel='email' and status='pending'
  ) then raise exception 'future email was terminally suppressed before due'; end if;
end $$;
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-at-due',100,300,'2030-01-10T11:59:00Z'
);
do $$
begin
  if not exists(
    select 1 from claimed_email_jobs
    where notification_id='61000000-0000-4000-8000-000000000075'
  ) then raise exception 'future email was not claimable at scheduled_for'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-at-due','fixture','2030-01-10T11:59:01Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

-- Actual cancellation producer keeps inbox rows while email is terminally suppressed.
insert into public.live_status_overrides(
  id,live_event_id,effective_status,effective_from,reason,actor_admin_allowlist_id
) values(
  '61000000-0000-4000-8000-000000000080','61000000-0000-4000-8000-000000000070',
  'cancelled','2030-01-10T11:57:00Z','Fixture cancellation reason',
  '61000000-0000-4000-8000-000000000010'
);
do $$
begin
  if (select count(*) from public.fan_notifications where kind='live_cancelled')<>2 then
    raise exception 'cancellation inbox producer did not run'; end if;
  if exists(
    select 1 from public.external_notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    where notification.kind='live_cancelled' and delivery.channel='email'
      and (delivery.status,delivery.available_at) is distinct from
        ('failed'::public.notification_delivery_status,'infinity'::timestamptz)
  ) then raise exception 'cancellation email was not terminally suppressed'; end if;
  if not exists(
    select 1 from public.notification_delivery_outbox delivery
    join public.fan_notifications notification on notification.id=delivery.notification_id
    where notification.kind='live_cancelled'
      and notification.app_user_id='61000000-0000-4000-8000-000000000001'
      and delivery.subscription_id='61000000-0000-4000-8000-000000000005'
  ) then raise exception 'cancellation push delivery was not preserved'; end if;
end $$;

-- A submitted Quiz/Vote mission must not suppress the distinct legacy
-- post-LIVE survey producer.
insert into public.live_events(
  id,slug,celebrity_id,brand_id,starts_at,ends_at,reservation_opens_at,
  reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,
  attendance_valid_from,attendance_valid_until
) values(
  '61000000-0000-4000-8000-000000000300','email-lifecycle-ended-live',
  '61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000030',
  '2030-01-08T12:00:00Z','2030-01-08T13:00:00Z',
  '2029-12-01T00:00:00Z','2030-01-08T11:00:00Z',
  'https://www.youtube.com/watch?v=abcdefghijk','https://example.test/ended-live.jpg',
  extensions.crypt('EMAIL-SURVEY',extensions.gen_salt('bf',12)),
  '2020-01-01T00:00:00Z','2040-01-01T00:00:00Z'
);
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
values
  ('61000000-0000-4000-8000-000000000300','ko','종료 라이브','종료 라이브 소개','종료 라이브'),
  ('61000000-0000-4000-8000-000000000300','en','Ended Live','Ended live summary','Ended live');
update public.live_events
set publication_status='published',published_at='2030-01-01T00:00:00Z'
where id='61000000-0000-4000-8000-000000000300';
insert into public.live_attendances(
  id,app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key,attended_at
) values(
  '61000000-0000-4000-8000-000000000301','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000300','61000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000061','61000000-0000-4000-8000-000000000302',
  '2030-01-08T12:30:00Z'
);
insert into public.live_reward_setting_revisions(
  id,live_event_id,revision,policy_version,lifecycle_status,mission_score,
  mission_ticket,journey_bonus_ticket,actor_app_user_id,
  actor_admin_allowlist_id,correlation_id,published_at
)
select
  '61000000-0000-4000-8000-000000000305','61000000-0000-4000-8000-000000000300',
  2,activation.policy_version,'published',1,0,0,
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000306','2030-01-08T11:00:00Z'
from public.reward_policy_activation activation
where activation.singleton;
insert into public.live_journey_requirement_revisions(
  id,live_event_id,revision,lifecycle_status,require_passport,
  require_reservation,require_attendance,bonus_ticket_amount,
  reward_setting_revision_id,reward_setting_revision,policy_version,
  actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at,
  claim_window_duration_hours
)
select
  '61000000-0000-4000-8000-000000000320','61000000-0000-4000-8000-000000000300',
  1,'published',true,false,true,0,
  '61000000-0000-4000-8000-000000000305',2,activation.policy_version,
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000321','2030-01-08T11:00:00Z',12
from public.reward_policy_activation activation where activation.singleton;
insert into public.live_journey_completions(
  id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,
  bonus_ticket_amount,policy_version,reward_setting_revision,
  reward_setting_revision_id,completed_at
)
select
  '61000000-0000-4000-8000-000000000322','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000300','61000000-0000-4000-8000-000000000320',
  '{}'::jsonb,0,activation.policy_version,2,
  '61000000-0000-4000-8000-000000000305','2030-01-08T12:59:00Z'
from public.reward_policy_activation activation where activation.singleton;
insert into public.live_surveys(
  id,live_event_id,version,publication_status,published_at,lifecycle_status,
  ever_published_at,legacy_contract
) values(
  '61000000-0000-4000-8000-000000000310','61000000-0000-4000-8000-000000000300',
  1,'published','2030-01-08T13:00:00Z','published','2030-01-08T13:00:00Z',true
);
insert into public.live_surveys(
  id,live_event_id,version,mission_type,legacy_contract,attendance_requirement,
  visible_from,visible_until
) values(
  '61000000-0000-4000-8000-000000000311','61000000-0000-4000-8000-000000000300',
  2,'vote',false,'not_required','2030-01-08T12:00:00Z','2030-01-08T13:00:00Z'
);
insert into public.live_survey_responses(
  id,app_user_id,live_event_id,celebrity_id,survey_id,attendance_id,passport_id,
  status,submitted_at,legacy_contract
) values(
  '61000000-0000-4000-8000-000000000312','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000300','61000000-0000-4000-8000-000000000020',
  '61000000-0000-4000-8000-000000000311',null,
  '61000000-0000-4000-8000-000000000061','submitted','2030-01-08T12:45:00Z',false
);

select public.enqueue_due_notification_maintenance('2030-01-08T13:01:00Z');
do $$
begin
  if not exists(
    select 1 from public.live_collectible_claim_windows
    where live_event_id='61000000-0000-4000-8000-000000000300'
      and opens_at='2030-01-08T13:00:00Z'
  ) then raise exception 'ended LIVE collectible window was not frozen at authoritative end'; end if;
  if public.freeze_due_live_collectible_claim_windows('2030-01-08T13:01:30Z')<>0 then
    raise exception 'frozen collectible window was revisited';
  end if;
end $$;
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-survey',100,300,'2030-01-08T13:01:00Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs where template_key='survey_reminder')<>1 then
    raise exception 'non-legacy mission response suppressed legacy survey reminder';
  end if;
  if (select count(*) from claimed_email_jobs where template_key='collectible_claim_available')<>1 then
    raise exception 'initial collectible availability email missing';
  end if;
  if exists(
    select 1 from claimed_email_jobs where template_key='survey_reminder'
      and payload->>'deepLink'<>'/live/email-lifecycle-ended-live/survey'
  ) then raise exception 'legacy survey link was not canonical'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-survey','fixture','2030-01-08T13:01:01Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

-- Closed and archived legacy surveys invalidate already planned email work.
update public.live_surveys
set lifecycle_status='closed',publication_status='draft',published_at=null,
  closed_at='2030-01-08T19:01:00Z'
where id='61000000-0000-4000-8000-000000000310';
insert into public.fan_notifications(
  id,app_user_id,kind,source_key,live_event_id,scheduled_for
) values(
  '61000000-0000-4000-8000-000000000330','61000000-0000-4000-8000-000000000001',
  'survey_reminder','fixture:survey:closed','61000000-0000-4000-8000-000000000300',
  '2030-01-08T19:01:00Z'
);
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-survey-closed',100,300,'2030-01-08T19:01:00Z'
);
update public.live_surveys
set lifecycle_status='archived',archived_at='2030-01-08T19:02:00Z'
where id='61000000-0000-4000-8000-000000000310';
insert into public.fan_notifications(
  id,app_user_id,kind,source_key,live_event_id,scheduled_for
) values(
  '61000000-0000-4000-8000-000000000331','61000000-0000-4000-8000-000000000001',
  'survey_reminder','fixture:survey:archived','61000000-0000-4000-8000-000000000300',
  '2030-01-08T19:02:00Z'
);
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-survey-archived',100,300,'2030-01-08T19:02:00Z'
);
do $$
begin
  if exists(
    select 1 from claimed_email_jobs
    where notification_id in (
      '61000000-0000-4000-8000-000000000330',
      '61000000-0000-4000-8000-000000000331'
    )
  ) then raise exception 'closed or archived survey email was claimed'; end if;
  if (select count(*) from public.external_notification_delivery_outbox
      where notification_id in (
        '61000000-0000-4000-8000-000000000330',
        '61000000-0000-4000-8000-000000000331'
      ) and channel='email' and status='failed' and available_at='infinity'::timestamptz)<>2 then
    raise exception 'closed or archived survey email was not terminally suppressed';
  end if;
end $$;

-- A completion recorded after the window froze still receives availability.
insert into public.live_journey_completions(
  id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,
  bonus_ticket_amount,policy_version,reward_setting_revision,
  reward_setting_revision_id,completed_at
)
select
  '61000000-0000-4000-8000-000000000323','61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000300','61000000-0000-4000-8000-000000000320',
  '{}'::jsonb,0,activation.policy_version,2,
  '61000000-0000-4000-8000-000000000305','2030-01-08T13:01:30Z'
from public.reward_policy_activation activation where activation.singleton;
select public.enqueue_due_notification_maintenance('2030-01-08T13:02:00Z');
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-late-completion',100,300,'2030-01-08T13:02:00Z'
);
do $$
begin
  if not exists(
    select 1 from claimed_email_jobs
    where template_key='collectible_claim_available' and locale='en'
      and (payload#>>'{context,actionAt}')::timestamptz='2030-01-09T01:00:00Z'
  ) then raise exception 'late completion did not receive collectible availability'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-late-completion','fixture','2030-01-08T13:02:01Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

-- Mark the KO completion as claimed, then verify expiry only targets the still
-- unclaimed EN completion.
insert into public.user_wallets(id,app_user_id,chain_id,address)
values(
  '61000000-0000-4000-8000-000000000324','61000000-0000-4000-8000-000000000001',
  91342,'0x1111111111111111111111111111111111111111'
);
insert into public.blockchain_jobs(
  id,entity_type,entity_id,operation_key,payload_version,payload
) values(
  '61000000-0000-4000-8000-000000000325','collectible',
  '61000000-0000-4000-8000-000000000326',
  'byus:collectible:v1:61000000-0000-4000-8000-000000000326',1,
  jsonb_build_object(
    'recipient','0x1111111111111111111111111111111111111111',
    'celebritySlug','email-lifecycle-artist','liveSlug','email-lifecycle-ended-live',
    'claimId','61000000-0000-4000-8000-000000000326','metadataVersion',1
  )
);
insert into public.live_collectible_claims(
  id,app_user_id,live_event_id,journey_completion_id,requirement_revision_id,
  frozen_ends_at,claim_window_until,blockchain_job_id,claimed_at
) values(
  '61000000-0000-4000-8000-000000000326','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000300','61000000-0000-4000-8000-000000000322',
  '61000000-0000-4000-8000-000000000320','2030-01-08T13:00:00Z',
  '2030-01-09T01:00:00Z','61000000-0000-4000-8000-000000000325',
  '2030-01-08T13:03:00Z'
);
select public.enqueue_due_notification_maintenance('2030-01-08T19:00:00Z');
do $$
begin
  if exists(
    select 1 from public.fan_notifications
    where kind='collectible_claim_expiring'
      and app_user_id='61000000-0000-4000-8000-000000000001'
  ) then raise exception 'claimed collectible received expiry notification'; end if;
  if not exists(
    select 1 from public.fan_notifications
    where kind='collectible_claim_expiring'
      and app_user_id='61000000-0000-4000-8000-000000000002'
  ) then raise exception 'unclaimed collectible expiry notification missing'; end if;
end $$;
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-collectible-expiry',100,300,'2030-01-08T19:00:00Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs
      where template_key='collectible_claim_expiring' and locale='en')<>1 then
    raise exception 'unclaimed collectible expiry email missing'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-collectible-expiry','fixture','2030-01-08T19:00:01Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

-- Winner, recipient-information, and all five meaningful fulfillment states
-- are projected by their real table triggers.
insert into public.benefits(
  id,slug,celebrity_id,delivery_type,claim_opens_at,claim_closes_at
) values(
  '61000000-0000-4000-8000-000000000350','email-lifecycle-benefit',
  '61000000-0000-4000-8000-000000000020','text',
  '2029-01-01T00:00:00Z','2031-01-01T00:00:00Z'
);
insert into public.benefit_localizations(
  benefit_id,locale,title,summary,eligibility_label,delivery_label
) values
  ('61000000-0000-4000-8000-000000000350','ko','테스트 Benefit','혜택 설명','당첨자','개별 안내'),
  ('61000000-0000-4000-8000-000000000350','en','Test Benefit','Benefit summary','Winner','Direct delivery');
insert into public.benefit_delivery_vault(benefit_id,delivery_type,secret_value)
values('61000000-0000-4000-8000-000000000350','text','fixture delivery');
update public.benefits
set publication_status='published',published_at='2030-01-01T00:00:00Z'
where id='61000000-0000-4000-8000-000000000350';

insert into public.live_benefit_campaigns(
  id,live_event_id,status,entry_opens_at,entry_closes_at,
  actor_app_user_id,actor_admin_allowlist_id,published_at
) values(
  '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000300',
  'published','2029-01-01T00:00:00Z','2030-01-01T00:00:00Z',
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '2029-01-01T00:00:00Z'
);
insert into public.live_benefit_campaign_items(
  id,campaign_id,benefit_id,priority,winner_quantity,fulfillment_method
) values(
  '61000000-0000-4000-8000-000000000352','61000000-0000-4000-8000-000000000351',
  '61000000-0000-4000-8000-000000000350',1,3,'physical_shipping'
);
insert into public.benefit_draws(
  id,campaign_id,idempotency_key,algorithm,seed_hash,actor_app_user_id,
  actor_admin_allowlist_id,correlation_id,executed_at
) values(
  '61000000-0000-4000-8000-000000000353','61000000-0000-4000-8000-000000000351',
  '61000000-0000-4000-8000-000000000354','sha256-weighted-rank-v1',repeat('b',64),
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000355','2030-01-10T12:00:00Z'
);
insert into public.benefit_draw_candidates(
  id,draw_id,campaign_id,benefit_id,app_user_id,weight,digest,
  uniform_value,rank_value,result
) values
  ('61000000-0000-4000-8000-000000000356','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000001',1,repeat('c',64),0.1,0.1,'won'),
  ('61000000-0000-4000-8000-000000000357','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000002',1,repeat('d',64),0.2,0.2,'won'),
  ('61000000-0000-4000-8000-000000000358','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000003',1,repeat('e',64),0.3,0.3,'won');
insert into public.benefit_draw_winners(
  id,draw_id,campaign_id,benefit_id,app_user_id,candidate_id,selected_at
) values
  ('61000000-0000-4000-8000-000000000360','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000356',
    '2030-01-10T12:00:00Z'),
  ('61000000-0000-4000-8000-000000000361','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000357',
    '2030-01-10T12:00:00Z'),
  ('61000000-0000-4000-8000-000000000362','61000000-0000-4000-8000-000000000353',
    '61000000-0000-4000-8000-000000000351','61000000-0000-4000-8000-000000000350',
    '61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000358',
    '2030-01-10T12:00:00Z');
insert into public.benefit_fulfillments(id,winner_id,method,status)
values
  ('61000000-0000-4000-8000-000000000363','61000000-0000-4000-8000-000000000360',
    'on_site_pickup','information_required'),
  ('61000000-0000-4000-8000-000000000364','61000000-0000-4000-8000-000000000361',
    'physical_shipping','information_required'),
  ('61000000-0000-4000-8000-000000000365','61000000-0000-4000-8000-000000000362',
    'digital','ready');

insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-winner-info',100,300,'2030-01-10T12:00:30Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs where template_key='benefit_won')<>2 then
    raise exception 'winner emails missing'; end if;
  if (select count(*) from claimed_email_jobs
      where template_key='recipient_information_required')<>2 then
    raise exception 'recipient-information emails missing'; end if;
  if exists(
    select 1 from claimed_email_jobs
    where template_key in ('benefit_won','recipient_information_required')
      and (payload#>>'{context,title}') is distinct from
        case locale when 'en' then 'Test Benefit' else '테스트 Benefit' end
  ) then raise exception 'benefit email context was not localized'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-winner-info','fixture','2030-01-10T12:00:31Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

select public.save_owned_benefit_recipient(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000360',
  '61000000-0000-4000-8000-000000000370','2026-09-v1',true,
  'Fixture One','010-1111-1111',null,null,null
);
select public.save_owned_benefit_recipient(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000361',
  '61000000-0000-4000-8000-000000000371','2026-09-v1',true,
  'Fixture Two','010-2222-2222','12345','Fixture address',null
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000372','61000000-0000-4000-8000-000000000360',
  2,'pickup_available',null,null,'Pickup is now available.'
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000373','61000000-0000-4000-8000-000000000360',
  3,'pickup_completed',null,null,'Pickup was fully completed.'
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000374','61000000-0000-4000-8000-000000000361',
  2,'shipping_preparing',null,null,'Shipping preparation started.'
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000375','61000000-0000-4000-8000-000000000361',
  3,'shipping_in_transit','Fixture Carrier','TRACK-123','Package is now in transit.'
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000376','61000000-0000-4000-8000-000000000361',
  4,'shipping_completed',null,null,'Package delivery completed.'
);
select public.transition_admin_benefit_fulfillment(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000377','61000000-0000-4000-8000-000000000362',
  1,'digital_delivered',null,null,'Digital delivery completed.'
);
do $$
declare expected text;
begin
  foreach expected in array array[
    'shipping_in_transit','shipping_completed','pickup_available',
    'pickup_completed','digital_delivered'
  ] loop
    if not exists(
      select 1 from public.fan_notifications
      where kind='fulfillment_meaningful_update'
        and payload->>'fulfillmentStatus'=expected
    ) then raise exception 'fulfillment producer omitted state %',expected; end if;
  end loop;
end $$;
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-fulfillment',100,300,'2030-01-10T12:01:00Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs
      where template_key='fulfillment_meaningful_update')<>2 then
    raise exception 'current fulfillment emails missing'; end if;
  if not exists(
    select 1 from claimed_email_jobs
    where locale='en' and payload#>>'{context,fulfillmentStatus}'='shipping_completed'
  ) then raise exception 'EN shipping-completed payload missing'; end if;
end $$;
insert into sanitized_email_queue_exports(fixture,job)
select 'en-shipping-completed',jsonb_build_object(
  'templateKey',template_key,'locale',locale,'payload',payload
)
from claimed_email_jobs
where locale='en' and payload#>>'{context,fulfillmentStatus}'='shipping_completed'
limit 1;
select public.complete_external_notification_delivery(
  id,'fixture-fulfillment','fixture','2030-01-10T12:01:01Z'
) from claimed_email_jobs;
truncate claimed_email_jobs;

-- Real tier projection proves the restored level_up source shape and locale snapshot.
insert into public.fan_score_adjustments(
  id,app_user_id,celebrity_id,points,reason,idempotency_key,actor_app_user_id,
  actor_admin_allowlist_id,correlation_id,resulting_score,created_at
) values
  ('61000000-0000-4000-8000-000000000091','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000020',40,'Fixture level upgrade',
    '61000000-0000-4000-8000-000000000191','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000291',40,
    '2030-01-10T12:00:00Z'),
  ('61000000-0000-4000-8000-000000000092','61000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000020',40,'Fixture level upgrade',
    '61000000-0000-4000-8000-000000000192','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000010','61000000-0000-4000-8000-000000000292',40,
    '2030-01-10T12:00:00Z');
insert into public.fan_score_ledger(id,adjustment_id,app_user_id,celebrity_id,points,created_at)
values
  ('61000000-0000-4000-8000-000000000093','61000000-0000-4000-8000-000000000091',
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000020',40,
    '2030-01-10T12:00:00Z'),
  ('61000000-0000-4000-8000-000000000094','61000000-0000-4000-8000-000000000092',
    '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000020',40,
    '2030-01-10T12:00:00Z');
insert into claimed_email_jobs
select * from public.claim_email_notification_deliveries(
  'fixture-level',100,300,'2030-01-10T12:00:01Z'
);
do $$
begin
  if (select count(*) from claimed_email_jobs where template_key='level_up')<>2 then
    raise exception 'KO/EN level-up jobs missing'; end if;
  if exists(
    select 1 from claimed_email_jobs where template_key='level_up'
      and coalesce(payload#>>'{context,newLevel}','')=''
  ) then raise exception 'level-up payload omitted newLevel'; end if;
end $$;

-- Keep the KO lease for the final-send revocation check and complete the EN
-- direct email before exercising Kakao-primary / EN-email-fallback behavior.
select public.complete_external_notification_delivery(
  id,'fixture-level','fixture','2030-01-10T12:00:02Z'
) from claimed_email_jobs where locale='en';

select public.complete_owned_kakao_connection(
  '61000000-0000-4000-8000-000000000002',repeat('f',64),'2030-01-10T12:00:02Z'
);
select public.enroll_owned_kakao_notification_channel(
  '61000000-0000-4000-8000-000000000002',repeat('1',64),
  'fixture-kakao-recipient','Fixture Kakao','fixture-v1','2030-01-10T12:00:02Z'
);
insert into public.fan_notifications(
  id,app_user_id,kind,source_key,scheduled_for,benefit_id,deep_link,payload
) values(
  '61000000-0000-4000-8000-000000000390','61000000-0000-4000-8000-000000000002',
  'benefit_won','fixture:mixed:benefit-won','2030-01-10T12:00:03Z',
  '61000000-0000-4000-8000-000000000350','/benefits/61000000-0000-4000-8000-000000000350',
  jsonb_build_object(
    'title','카카오 원문 제목','detail','카카오 원문 상세'
  )
);
insert into claimed_external_jobs
select * from public.claim_external_notification_deliveries(
  'fixture-kakao',100,300,'2030-01-10T12:00:03Z'
);
do $$
begin
  if (select count(*) from claimed_external_jobs
      where notification_id='61000000-0000-4000-8000-000000000390'
        and channel='kakao' and locale='ko')<>1 then
    raise exception 'Kakao primary mixed claim missing'; end if;
  if exists(
    select 1 from claimed_external_jobs
    where notification_id='61000000-0000-4000-8000-000000000390'
      and (payload->>'title'<>'카카오 원문 제목' or payload ? 'context')
  ) then raise exception 'Kakao legacy payload or KO locale changed'; end if;
end $$;
select public.fail_external_notification_delivery(
  id,'fixture-kakao','KAKAO_FIXTURE_FAILURE',false,'2030-01-10T12:00:04Z'
) from claimed_external_jobs
where notification_id='61000000-0000-4000-8000-000000000390';
truncate claimed_external_jobs;
insert into claimed_external_jobs
select * from public.claim_external_notification_deliveries(
  'fixture-email-fallback',100,300,'2030-01-10T12:00:05Z'
);
do $$
begin
  if (select count(*) from claimed_external_jobs
      where notification_id='61000000-0000-4000-8000-000000000390'
        and channel='email' and locale='en')<>1 then
    raise exception 'EN email fallback did not preserve locale snapshot'; end if;
  if exists(
    select 1 from claimed_external_jobs
    where notification_id='61000000-0000-4000-8000-000000000390'
      and (payload#>>'{context,kind}'<>'benefit_won'
        or payload#>>'{context,title}'<>'Test Benefit'
        or payload#>>'{context,artist}'<>'Test Artist')
  ) then raise exception 'generic EMAIL fallback payload was not enriched'; end if;
end $$;
select public.complete_external_notification_delivery(
  id,'fixture-email-fallback','fixture','2030-01-10T12:00:06Z'
) from claimed_external_jobs
where notification_id='61000000-0000-4000-8000-000000000390';
truncate claimed_external_jobs;

-- A leased email is invalidated atomically if consent changes before provider send.
update public.fan_notification_channels set consent_revoked_at='2030-01-10T12:00:02Z',status='disabled'
where app_user_id='61000000-0000-4000-8000-000000000001' and kind='email';
do $$
declare target_id uuid;
begin
  select id into target_id from claimed_email_jobs where locale='ko' limit 1;
  if public.revalidate_email_notification_delivery(
    target_id,'fixture-level','2030-01-10T12:00:03Z'
  ) then raise exception 'final-send consent revalidation unexpectedly passed'; end if;
  if not exists(
    select 1 from public.external_notification_delivery_outbox
    where id=target_id and status='failed' and available_at='infinity'::timestamptz
      and last_error_code='EMAIL_NOT_ELIGIBLE'
  ) then raise exception 'invalid final-send row was not terminally suppressed'; end if;
end $$;

select jsonb_build_object(
  'reservationProducer',true,
  'schedulerProducer',true,
  'legacySurveyProducer',true,
  'scheduleChangeProducer',true,
  'cancellationInboxPreserved',true,
  'collectibleLifecycle',true,
  'benefitFulfillmentStates',5,
  'kakaoEmailFallback',true,
  'levelProducer',true,
  'localeSnapshots',2,
  'finalSendRevalidation',true,
  'status','PASS'
) as fan_email_trigger_lifecycle_result;

select jsonb_agg(job order by fixture) as sanitized_email_queue_exports
from sanitized_email_queue_exports;

rollback;
