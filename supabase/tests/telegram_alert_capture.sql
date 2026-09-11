-- Telegram major-event capture regression. Run after the alert migration.
-- All fixture facts and temporary trigger objects are rolled back.
begin;

do $$
declare
  activation_time timestamptz;
  disabled_member uuid := 'f1000000-0000-4000-8000-000000000001';
  operator_id uuid := 'f1000000-0000-4000-8000-000000000002';
  reserved_fan uuid := 'f1000000-0000-4000-8000-000000000003';
  new_member uuid := 'f1000000-0000-4000-8000-000000000004';
  old_member uuid := 'f1000000-0000-4000-8000-000000000005';
  admin_id uuid := 'f1000000-0000-4000-8000-000000000010';
  creator_id uuid := 'f1100000-0000-4000-8000-000000000001';
  private_creator_id uuid := 'f1100000-0000-4000-8000-000000000002';
  brand_id uuid := 'f1200000-0000-4000-8000-000000000001';
  public_live_id uuid := 'f1300000-0000-4000-8000-000000000001';
  private_live_id uuid := 'f1300000-0000-4000-8000-000000000002';
  quiz_id uuid := 'f1400000-0000-4000-8000-000000000001';
  private_quiz_id uuid := 'f1400000-0000-4000-8000-000000000002';
  reserved_attempt_id uuid := 'f1500000-0000-4000-8000-000000000001';
  new_attempt_id uuid := 'f1500000-0000-4000-8000-000000000002';
  private_attempt_id uuid := 'f1500000-0000-4000-8000-000000000003';
  reserved_pass_id uuid := 'f1600000-0000-4000-8000-000000000001';
  new_pass_id uuid := 'f1600000-0000-4000-8000-000000000002';
  private_pass_id uuid := 'f1600000-0000-4000-8000-000000000003';
  reserved_passport_id uuid := 'f1700000-0000-4000-8000-000000000001';
  new_passport_id uuid := 'f1700000-0000-4000-8000-000000000002';
  private_passport_id uuid := 'f1700000-0000-4000-8000-000000000003';
  reservation_id uuid := 'f1800000-0000-4000-8000-000000000001';
  attendance_id uuid := 'f1800000-0000-4000-8000-000000000002';
  private_reservation_id uuid := 'f1800000-0000-4000-8000-000000000003';
  benefit_id uuid := 'f1900000-0000-4000-8000-000000000001';
  campaign_id uuid := 'f1a00000-0000-4000-8000-000000000001';
  draw_id uuid := 'f1b00000-0000-4000-8000-000000000001';
  candidate_id uuid := 'f1c00000-0000-4000-8000-000000000001';
  winner_id uuid := 'f1d00000-0000-4000-8000-000000000001';
begin
  -- Disabled is the default and creates neither capture nor backfill work.
  insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
    (disabled_member,'did:privy:telegram-disabled','telegram-disabled@example.test','active',pg_catalog.clock_timestamp());
  if exists (select 1 from public.telegram_alert_outbox where source_id=disabled_member) then
    raise exception 'TELEGRAM_CAPTURED_WHILE_DISABLED';
  end if;

  -- Prerequisites are deliberately committed before activation, proving no backfill.
  insert into public.app_users(id,privy_user_id,verified_email,status) values
    (operator_id,'did:privy:telegram-operator','telegram-operator@example.test','active'),
    (reserved_fan,'did:privy:telegram-reserved','telegram-reserved@example.test','active');
  insert into public.admin_allowlist(id,email,role,active) values
    (admin_id,'telegram-operator@example.test','admin',true);
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values
    (creator_id,'telegram-public-creator','published','/telegram-creator.webp',pg_catalog.clock_timestamp(),'{artist}','idol'),
    (private_creator_id,'telegram-private-creator','draft','/telegram-private.webp',null,'{artist}','idol');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (creator_id,'ko','공개 크리에이터','공개 크리에이터 소개','공개 크리에이터'),
    (private_creator_id,'ko','비공개 크리에이터','비공개 크리에이터 소개','비공개 크리에이터');
  insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values
    (brand_id,'telegram-brand','published','/telegram-brand.svg','Telegram brand',pg_catalog.clock_timestamp());
  insert into public.live_events(
    id,slug,celebrity_id,brand_id,publication_status,content_status,starts_at,ends_at,
    reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,
    attendance_valid_from,attendance_valid_until
  ) values
    (public_live_id,'telegram-public-live',creator_id,brand_id,'published','scheduled',
      pg_catalog.clock_timestamp()+interval '3 hours',pg_catalog.clock_timestamp()+interval '4 hours',
      pg_catalog.clock_timestamp()+interval '1 hour',pg_catalog.clock_timestamp()+interval '2 hours',
      'https://youtu.be/telegramlive','/telegram-live.webp','$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()-interval '1 hour',pg_catalog.clock_timestamp()+interval '1 hour'),
    (private_live_id,'telegram-private-live',creator_id,brand_id,'draft','scheduled',
      pg_catalog.clock_timestamp()+interval '5 hours',pg_catalog.clock_timestamp()+interval '6 hours',
      pg_catalog.clock_timestamp()+interval '3 hours',pg_catalog.clock_timestamp()+interval '4 hours',
      'https://youtu.be/telegramprivate','/telegram-private-live.webp','$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',null,
      pg_catalog.clock_timestamp()+interval '5 hours',pg_catalog.clock_timestamp()+interval '6 hours');
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values
    (public_live_id,'ko','공개 LIVE 제목','공개 LIVE 소개','공개 LIVE'),
    (private_live_id,'ko','비공개 LIVE 제목','비공개 LIVE 소개','비공개 LIVE');
  insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
    (quiz_id,creator_id,1,'published',pg_catalog.clock_timestamp()),
    (private_quiz_id,private_creator_id,1,'draft',null);
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
    (reserved_attempt_id,reserved_fan,creator_id,quiz_id,1,'f1500000-0000-4000-8000-000000000011','passed',3,pg_catalog.clock_timestamp());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
    (reserved_pass_id,reserved_fan,creator_id,reserved_attempt_id);
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,issued_at) values
    (reserved_passport_id,reserved_fan,creator_id,reserved_pass_id,pg_catalog.clock_timestamp());
  if exists (select 1 from public.telegram_alert_outbox where source_id=reserved_passport_id) then
    raise exception 'TELEGRAM_BACKFILLED_PREACTIVATION_PASSPORT';
  end if;

  perform public.configure_telegram_alerts('-1001234567890',true);
  select activated_at into strict activation_time from public.telegram_alert_settings where singleton;

  insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
    (new_member,'did:privy:telegram-member','telegram-member@example.test','active',activation_time+interval '1 second'),
    (old_member,'did:privy:telegram-old','telegram-old@example.test','active',activation_time-interval '1 second');
  if not exists (select 1 from public.telegram_alert_outbox where kind='member_joined' and source_id=new_member and chat_id='-1001234567890' and creator_name is null and live_title is null and winner_count is null and occurred_at=activation_time+interval '1 second') then
    raise exception 'TELEGRAM_MEMBER_CAPTURE_MISSING_OR_UNSAFE';
  end if;
  if exists (select 1 from public.telegram_alert_outbox where source_id=old_member) then
    raise exception 'TELEGRAM_CAPTURED_PREACTIVATION_MEMBER';
  end if;

  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
    (new_attempt_id,new_member,creator_id,quiz_id,1,'f1500000-0000-4000-8000-000000000012','passed',3,activation_time+interval '2 seconds'),
    (private_attempt_id,new_member,private_creator_id,private_quiz_id,1,'f1500000-0000-4000-8000-000000000013','passed',3,activation_time+interval '2 seconds');
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
    (new_pass_id,new_member,creator_id,new_attempt_id),
    (private_pass_id,new_member,private_creator_id,private_attempt_id);
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,issued_at) values
    (new_passport_id,new_member,creator_id,new_pass_id,activation_time+interval '2 seconds'),
    (private_passport_id,new_member,private_creator_id,private_pass_id,activation_time+interval '2 seconds');
  if not exists (select 1 from public.telegram_alert_outbox where kind='fan_joined' and source_id=new_passport_id and creator_name='공개 크리에이터' and live_title is null and winner_count is null and occurred_at=activation_time+interval '2 seconds') then
    raise exception 'TELEGRAM_FAN_CAPTURE_MISSING_OR_UNSAFE';
  end if;
  if exists (select 1 from public.telegram_alert_outbox where source_id=private_passport_id) then
    raise exception 'TELEGRAM_CAPTURED_PRIVATE_CREATOR';
  end if;

  insert into public.live_reservations(id,app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key,reserved_at) values
    (reservation_id,reserved_fan,public_live_id,creator_id,reserved_passport_id,'f1800000-0000-4000-8000-000000000011',activation_time+interval '3 seconds'),
    (private_reservation_id,reserved_fan,private_live_id,creator_id,reserved_passport_id,'f1800000-0000-4000-8000-000000000012',activation_time+interval '3 seconds');
  if not exists (select 1 from public.telegram_alert_outbox where kind='live_reserved' and source_id=reservation_id and creator_name='공개 크리에이터' and live_title='공개 LIVE 제목' and winner_count is null and occurred_at=activation_time+interval '3 seconds') then
    raise exception 'TELEGRAM_RESERVATION_CAPTURE_MISSING_OR_UNSAFE';
  end if;
  if exists (select 1 from public.telegram_alert_outbox where source_id=private_reservation_id) then
    raise exception 'TELEGRAM_CAPTURED_PRIVATE_LIVE';
  end if;
  insert into public.live_reservations(id,app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key,reserved_at)
    values(reservation_id,reserved_fan,public_live_id,creator_id,reserved_passport_id,'f1800000-0000-4000-8000-000000000011',activation_time+interval '3 seconds')
    on conflict (idempotency_key) do nothing;
  if (select count(*) from public.telegram_alert_outbox where kind='live_reserved' and source_id=reservation_id)<>1 then
    raise exception 'TELEGRAM_DUPLICATED_IDEMPOTENT_RESERVATION';
  end if;

  insert into public.live_attendances(id,app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key,attended_at) values
    (attendance_id,reserved_fan,public_live_id,creator_id,reserved_passport_id,'f1800000-0000-4000-8000-000000000013',activation_time+interval '4 seconds');
  if not exists (select 1 from public.telegram_alert_outbox where kind='live_attended' and source_id=attendance_id and creator_name='공개 크리에이터' and live_title='공개 LIVE 제목' and winner_count is null and occurred_at=activation_time+interval '4 seconds') then
    raise exception 'TELEGRAM_ATTENDANCE_CAPTURE_MISSING_OR_UNSAFE';
  end if;

  insert into public.benefits(id,slug,celebrity_id,publication_status,delivery_type,claim_opens_at,claim_closes_at) values
    (benefit_id,'telegram-benefit',creator_id,'draft','text',null,null);
  insert into public.live_benefit_campaigns(id,live_event_id,status,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id,published_at) values
    (campaign_id,public_live_id,'published',activation_time-interval '1 hour',activation_time+interval '1 hour',operator_id,admin_id,activation_time);
  insert into public.live_benefit_campaign_items(campaign_id,benefit_id,priority,winner_quantity,fulfillment_method) values
    (campaign_id,benefit_id,1,1,'digital');
  insert into public.benefit_draws(id,campaign_id,idempotency_key,algorithm,seed_hash,actor_app_user_id,actor_admin_allowlist_id,correlation_id,executed_at) values
    (draw_id,campaign_id,'f1b00000-0000-4000-8000-000000000011','sha256-weighted-rank-v1',repeat('a',64),operator_id,admin_id,'f1b00000-0000-4000-8000-000000000012',activation_time+interval '5 seconds');
  insert into public.benefit_draw_candidates(id,draw_id,campaign_id,benefit_id,app_user_id,weight,digest,uniform_value,rank_value,result) values
    (candidate_id,draw_id,campaign_id,benefit_id,reserved_fan,1,repeat('b',64),0.5,0.5,'won');
  insert into public.benefit_draw_winners(id,draw_id,campaign_id,benefit_id,app_user_id,candidate_id,selected_at) values
    (winner_id,draw_id,campaign_id,benefit_id,reserved_fan,candidate_id,activation_time+interval '5 seconds');
  if exists (select 1 from public.telegram_alert_outbox where kind='draw_published' and source_id=draw_id) then
    raise exception 'TELEGRAM_CAPTURED_UNPUBLISHED_DRAW';
  end if;
  insert into public.benefit_draw_publications(draw_id,campaign_id,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at) values
    (draw_id,campaign_id,operator_id,admin_id,'f1b00000-0000-4000-8000-000000000013',activation_time+interval '6 seconds');
  if not exists (select 1 from public.telegram_alert_outbox where kind='draw_published' and source_id=draw_id and creator_name='공개 크리에이터' and live_title='공개 LIVE 제목' and winner_count=1 and occurred_at=activation_time+interval '6 seconds') then
    raise exception 'TELEGRAM_DRAW_PUBLICATION_CAPTURE_MISSING_OR_UNSAFE';
  end if;
end $$;

-- Existing pending rows gain current actor identity without backfill or new PII columns.
insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
  ('f1000000-0000-4000-8000-000000000003','예약팬','예약팬');
do $$
declare batch jsonb; item jsonb; n integer:=0;
begin
  if has_function_privilege('anon','public.claim_telegram_alert_batch_with_identity(text)','execute')
    or has_function_privilege('authenticated','public.claim_telegram_alert_batch_with_identity(text)','execute')
    or not has_function_privilege('service_role','public.claim_telegram_alert_batch_with_identity(text)','execute') then
    raise exception 'TELEGRAM_IDENTITY_RPC_ACL';
  end if;
  if public.claim_telegram_alert_batch_with_identity('-999') is not null then raise exception 'TELEGRAM_IDENTITY_WRONG_ROOM'; end if;
  batch:=public.claim_telegram_alert_batch_with_identity('-1001234567890');
  if jsonb_array_length(batch->'alerts')<>5 then raise exception 'TELEGRAM_IDENTITY_BATCH_LIMIT'; end if;
  for item in select value from jsonb_array_elements(batch->'alerts') loop
    n:=n+1;
    if item->>'kind' in ('member_joined','fan_joined') then
      if item->>'actor_email' is distinct from 'telegram-member@example.test' or item->>'actor_name' is not null then
        raise exception 'TELEGRAM_IDENTITY_MEMBER_MAPPING';
      end if;
    elsif item->>'kind' in ('live_reserved','live_attended') then
      if item->>'actor_email' is distinct from 'telegram-reserved@example.test' or item->>'actor_name' is distinct from '예약팬' then
        raise exception 'TELEGRAM_IDENTITY_LIVE_ACTOR_MAPPING';
      end if;
    elsif item->>'kind'='draw_published' then
      if item->>'actor_email' is not null or item->>'actor_name' is not null then raise exception 'TELEGRAM_IDENTITY_DRAW_OPERATOR_LEAK'; end if;
    end if;
    if item ?| array['app_user_id','source_id','wallet','privy_user_id'] then raise exception 'TELEGRAM_IDENTITY_UNREQUESTED_DATA'; end if;
  end loop;
  if n<>5 or public.claim_telegram_alert_batch_with_identity('-1001234567890') is not null
    or public.claim_telegram_alert_batch('-1001234567890') is not null then raise exception 'TELEGRAM_IDENTITY_SHARED_FENCE'; end if;
  if not public.begin_telegram_alert_send((batch->>'batch_id')::uuid,'-1001234567890')
    or not public.finish_telegram_alert_batch((batch->>'batch_id')::uuid,'sent',321) then raise exception 'TELEGRAM_IDENTITY_SEND_LIFECYCLE'; end if;
  update public.telegram_alert_settings set next_send_at='-infinity';
  if public.claim_telegram_alert_batch_with_identity('-1001234567890') is not null then raise exception 'TELEGRAM_IDENTITY_EMPTY_QUEUE'; end if;
  raise notice 'PASS Telegram identity mapping, nickname absence, draw privacy, private RPC, shared claim fence and empty queue';
end $$;

-- The capture function catches secondary outbox failures, preserving its source row.
create function pg_temp.fail_telegram_outbox_fixture() returns trigger language plpgsql as $$
begin
  raise exception 'fixture outbox failure';
end $$;
create trigger telegram_alert_outbox_fixture_failure
before insert on public.telegram_alert_outbox for each row execute function pg_temp.fail_telegram_outbox_fixture();

do $$
declare fixture_source_id uuid := 'f1000000-0000-4000-8000-000000000006';
begin
  insert into public.app_users(id,privy_user_id,verified_email,status,created_at) values
    (fixture_source_id,'did:privy:telegram-capture-failure','telegram-capture-failure@example.test','active',pg_catalog.clock_timestamp()+interval '1 second');
  if not exists (select 1 from public.app_users where id=fixture_source_id) then
    raise exception 'TELEGRAM_CAPTURE_FAILURE_ROLLED_BACK_MEMBER';
  end if;
  if exists (select 1 from public.telegram_alert_outbox where source_id=fixture_source_id) then
    raise exception 'TELEGRAM_CAPTURE_FAILURE_CREATED_OUTBOX';
  end if;
end $$;

rollback;

do $$
begin
  if exists (select 1 from public.app_users where id in (
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000004'::uuid,
    'f1000000-0000-4000-8000-000000000006'::uuid
  ))
  or exists (select 1 from public.fan_passports where id in (
    'f1700000-0000-4000-8000-000000000001'::uuid,
    'f1700000-0000-4000-8000-000000000002'::uuid
  ))
  or exists (select 1 from public.live_reservations where id='f1800000-0000-4000-8000-000000000001'::uuid)
  or exists (select 1 from public.live_attendances where id='f1800000-0000-4000-8000-000000000002'::uuid)
  or exists (select 1 from public.benefit_draw_publications where draw_id='f1b00000-0000-4000-8000-000000000001'::uuid)
  or exists (select 1 from public.telegram_alert_outbox where source_id in (
    'f1000000-0000-4000-8000-000000000004'::uuid,
    'f1700000-0000-4000-8000-000000000002'::uuid,
    'f1800000-0000-4000-8000-000000000001'::uuid,
    'f1800000-0000-4000-8000-000000000002'::uuid,
    'f1b00000-0000-4000-8000-000000000001'::uuid
  )) then
    raise exception 'TELEGRAM_CAPTURE_FIXTURE_ROLLBACK_INCOMPLETE';
  end if;
end $$;
