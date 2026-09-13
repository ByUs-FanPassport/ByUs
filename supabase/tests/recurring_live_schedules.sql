-- Disposable recurring LIVE behavior fixture. All rows are rolled back.
begin;

do $$
declare actor uuid:=pg_catalog.gen_random_uuid(); allow_id uuid:=pg_catalog.gen_random_uuid(); creator uuid;
begin
  insert into public.app_users(id,privy_user_id,verified_email,status)
  values(actor,'did:privy:recurring-live-'||actor,'recurring-live@example.invalid','active');
  insert into public.admin_allowlist(id,email,role,active)
  values(allow_id,'recurring-live@example.invalid','admin',true);
  select celebrity.id into creator from public.celebrities celebrity
    where celebrity.status='published' and celebrity.archived_at is null
      and exists(select 1 from public.celebrity_localizations where celebrity_id=celebrity.id and locale='ko')
      and exists(select 1 from public.celebrity_localizations where celebrity_id=celebrity.id and locale='en') limit 1;
  if creator is null then raise exception 'recurring LIVE test requires a published creator'; end if;
  perform set_config('byus.recurring.actor',actor::text,true);
  perform set_config('byus.recurring.allow',allow_id::text,true);
  perform set_config('byus.recurring.creator',creator::text,true);
end $$;

-- Private rows/helpers are inspected by the disposable DB owner. RPC grants are
-- asserted below; separate service_role smoke calls follow the behavior fixture.
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'RECURRING_TEST: %',message; end if; end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
declare caught boolean:=false;begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected error %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error was not raised: %',expected; end if;
end $$;

do $$
declare actor uuid:=current_setting('byus.recurring.actor')::uuid; allow_id uuid:=current_setting('byus.recurring.allow')::uuid;
  creator uuid:=current_setting('byus.recurring.creator')::uuid; import_run uuid:=pg_catalog.gen_random_uuid();
  replenish_run uuid:=pg_catalog.gen_random_uuid(); correlation uuid:=pg_catalog.gen_random_uuid(); slot_id uuid:=pg_catalog.gen_random_uuid();
  input jsonb; imported jsonb; approved jsonb; replenished jsonb; coverage jsonb; proposal uuid; generated public.live_events%rowtype;
  schedule_revision_before integer; caught boolean:=false;
  binding uuid:=gen_random_uuid(); quiz uuid; attempt uuid:=gen_random_uuid(); quiz_pass uuid:=gen_random_uuid();
  passport uuid:=gen_random_uuid(); passport_job uuid:=gen_random_uuid(); stamp uuid:=gen_random_uuid(); booking_key uuid:=gen_random_uuid();
  booking jsonb; retried jsonb; before_live jsonb; changed_input jsonb; changed_import jsonb; changed_proposal uuid;
  series_id uuid; changed_rule jsonb; booked_id uuid; untouched_id uuid; outbox_count integer; notification_id uuid;
  manual_id uuid:=gen_random_uuid(); manual_stamp uuid:=gen_random_uuid(); manual_start timestamptz:='2040-01-06T22:00:00Z';
  shadow_id uuid:=gen_random_uuid(); manual_template public.live_events%rowtype; manual_rule jsonb; manual_proposal uuid; manual_series uuid; manual_count integer;
begin
  if has_table_privilege('service_role','public.recurring_live_observations','select')
    or has_table_privilege('service_role','public.recurring_live_rule_revisions','select')
    or has_function_privilege('anon','public.get_recurring_live_roster()','execute')
    or not has_function_privilege('service_role','public.get_recurring_live_roster()','execute') then
    raise exception 'recurring LIVE privilege boundary failed'; end if;
  if not public.is_valid_recurring_live_channel_url('chzzk','https://chzzk.naver.com/0a3f97086cb81d3360c69fdf5d020045')
    or public.is_valid_recurring_live_channel_url('chzzk','https://user@chzzk.naver.com/0a3f97086cb81d3360c69fdf5d020045') then
    raise exception 'CHZZK URL validation failed'; end if;
  input:=jsonb_build_object('version',1,'runId',import_run,'rosterObservedAt','2029-12-31T00:00:00Z','creators',jsonb_build_array(
    jsonb_build_object('celebrityId',creator,'result','regular','verification','verified','observations',jsonb_build_array(
      jsonb_build_object('sourceUrl','https://www.youtube.com/@official','sourceAccount',null,'sourcePublishedAt',null,
        'observedAt','2029-12-31T00:00:00Z','originalText','Every Friday at 07:00','evidencePath',null,'contentHash',repeat('a',64))),
      'seriesKey','weekly-live','proposedRule',jsonb_build_object('timeZone','Asia/Seoul','effectiveFrom','2030-01-01','effectiveUntil',null,
        'provider','youtube','channelUrl','https://www.youtube.com/@official/live','slots',jsonb_build_array(
          jsonb_build_object('id',slot_id,'isoWeekday',5,'localStartTime','07:00','end',null))),
      'expectedCurrentRevisionId',null)));
  imported:=public.import_recurring_live_observations(import_run,'recurring-test-import',input);
  proposal:=(imported->'proposedRuleRevisionIds'->>0)::uuid;
  if proposal is null or imported->>'inputHash'<>encode(extensions.digest(convert_to(input::text,'UTF8'),'sha256'),'hex') then
    raise exception 'recurring LIVE import/hash failed'; end if;
  approved:=public.approve_initial_recurring_live_rules(actor,allow_id,import_run,imported->>'inputHash',array[proposal],correlation);
  if approved->>'status'<>'completed' then raise exception 'initial recurring rule approval failed'; end if;
  approved:=public.approve_initial_recurring_live_rules(actor,allow_id,import_run,imported->>'inputHash','{}'::uuid[],pg_catalog.gen_random_uuid());
  if approved->'approvedRuleRevisionIds'->>0<>proposal::text then raise exception 'bootstrap approval retry was not idempotent'; end if;
  replenished:=public.replenish_recurring_live_events(replenish_run,49,'2030-01-01T00:00:00Z');
  if (replenished->>'createdCount')::integer<1 then raise exception 'recurring LIVE replenishment created no occurrence'; end if;
  select * into generated from public.live_events where id=(replenished->'eventIds'->>1)::uuid;
  if generated.live_type<>'recurring' or generated.ends_at is not null or generated.brand_id is not null
    or generated.fan_code_hash is not null or generated.reservation_opens_at>=generated.reservation_closes_at
    or generated.publication_status<>'published' then raise exception 'generated recurring LIVE fields are invalid'; end if;
  if public.live_effective_status_at(generated.id,generated.starts_at+interval '2 hours')<>'scheduled' then
    raise exception 'unknown-end recurring LIVE inferred an ended/live status'; end if;
  caught:=false;
  begin
    insert into public.live_attendances(app_user_id,live_event_id,celebrity_id,passport_id,idempotency_key)
    values(pg_catalog.gen_random_uuid(),generated.id,generated.celebrity_id,pg_catalog.gen_random_uuid(),pg_catalog.gen_random_uuid());
  exception when check_violation then
    if sqlerrm like '%G3_ATTENDANCE_NOT_CONFIGURED%' then caught:=true; else raise; end if;
  end;
  if not caught then raise exception 'unconfigured recurring attendance did not fail closed'; end if;
  -- The actual producer must reject an unconfigured code, before any fan record.
  perform pg_temp.expect_error(format('select public.attend_owned_live_event(%L,%L,%L,%L,%L,%L,%L)',
    actor,generated.slug,gen_random_uuid(),'ANYCODE',gen_random_uuid(),'unused','0x'||repeat('a',64)),
    'G3_ATTENDANCE_NOT_CONFIGURED');
  series_id:=generated.recurring_series_id;
  -- Real local reservation + current GIWA outbox lane, including a fresh-key retry.
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(actor,91342,'0x9876543210987654321098765432109876543210','privy','embedded');
  select id into quiz from public.celebrity_quizzes where celebrity_id=creator limit 1;
  if quiz is null then
    quiz:=gen_random_uuid();
    insert into public.celebrity_quizzes(id,celebrity_id,version,status) values(quiz,creator,1,'draft');
  end if;
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at)
    values(attempt,actor,creator,quiz,1,gen_random_uuid(),'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values(quiz_pass,actor,creator,attempt);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload,next_attempt_at)
    select passport_job,'passport',passport,'byus:passport:v1:'||actor||':'||slug,1,
      jsonb_build_object('recipient','0x9876543210987654321098765432109876543210','celebritySlug',slug,
        'passportId','0x'||repeat('f',64)),'infinity' from public.celebrities where id=creator;
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,blockchain_job_id)
    values(passport,actor,creator,quiz_pass,passport_job);
  insert into public.fan_action_bindings(id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,
    binding_version,asset_base_uri,assets) values(binding,91342,'0x'||repeat('1',64),
    '0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333',
    '0x'||repeat('4',64),1,1,'ipfs://bafybeigdyrzt',jsonb_build_object(
      '0','0x5555555555555555555555555555555555555555',
      '1','0x6666666666666666666666666666666666666666',
      '2','0x7777777777777777777777777777777777777777'));
  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
    values(2,binding,true,1,clock_timestamp());
  insert into public.fan_action_verified_creators(
    binding_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding,creator,123456,'0x'||repeat('8',64),clock_timestamp());
  insert into public.fan_action_verified_campaigns(
    binding_id,campaign_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding,generated.id,creator,123456,'0x'||repeat('8',64),clock_timestamp());
  booking:=public.reserve_owned_live_event(actor,generated.id,booking_key,stamp,'byus:stamp:v1:'||stamp,'0x'||repeat('d',64));
  retried:=public.reserve_owned_live_event(actor,generated.id,gen_random_uuid(),gen_random_uuid(),'unused','unused');
  perform pg_temp.assert(booking=retried,'fresh transport retry changed booking result');
  perform pg_temp.assert((select count(*)=1 from public.live_reservations where app_user_id=actor and live_event_id=generated.id),
    'reservation was not exactly once');
  perform pg_temp.assert((select fan_action_outbox_id is not null and blockchain_job_id is null from public.stamps where id=stamp),
    'recurring reservation bypassed current GIWA producer');
  select count(*) into outbox_count from public.fan_action_occurrences where app_user_id=actor and source_namespace='live_reservations';
  perform pg_temp.assert(outbox_count=1,'reservation generated duplicate GIWA actions');
  booked_id:=generated.id;
  select to_jsonb(live) into before_live from public.live_events live where id=booked_id;
  perform public.replenish_recurring_live_events(gen_random_uuid(),49,'2030-01-01T00:00:00Z');
  perform pg_temp.assert((select to_jsonb(live)=before_live from public.live_events live where id=booked_id),
    'replenishment changed booked identity, schedule, or initial reservation window');
  select id into notification_id from public.fan_notifications where live_event_id=booked_id and kind='live_reserved' limit 1;
  if notification_id is not null then
    perform pg_temp.assert(not public.notification_delivery_is_eligible(notification_id,generated.starts_at+interval '1 minute'),
      'delayed reservation notification remained eligible after start');
  end if;
  -- A repeated official rule is a no-op: no new review or schedule revision.
  changed_input:=jsonb_set(input,'{runId}',to_jsonb(gen_random_uuid()))
    ||jsonb_build_object('creators',jsonb_build_array((input->'creators'->0)
      ||jsonb_build_object('expectedCurrentRevisionId',proposal)));
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-reconfirm-'||(changed_input->>'runId'),changed_input);
  perform pg_temp.assert(jsonb_array_length(changed_import->'proposedRuleRevisionIds')=0,'reconfirmation created a new rule review');
  perform pg_temp.assert((select schedule_revision=1 from public.live_events where id=booked_id),'reconfirmation incremented schedule revision');
  -- Approved changes preserve earlier effective dates and the booked canonical ID.
  select id into untouched_id from public.live_events where recurring_series_id=series_id order by starts_at limit 1;
  changed_rule:=jsonb_set(input->'creators'->0->'proposedRule','{effectiveFrom}','"2030-01-11"')
    ||jsonb_build_object('slots',jsonb_build_array(jsonb_build_object('id',slot_id,'isoWeekday',5,'localStartTime','08:00','end',null)));
  changed_input:=jsonb_set(changed_input,'{runId}',to_jsonb(gen_random_uuid()));
  changed_input:=jsonb_set(changed_input,'{creators,0,proposedRule}',changed_rule);
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-change-'||(changed_input->>'runId'),changed_input);
  changed_proposal:=(changed_import->'proposedRuleRevisionIds'->>0)::uuid;
  perform pg_temp.expect_error(format('select public.resolve_admin_recurring_live_review(%L,%L,%L,%L,%L::jsonb,%L)',
    actor,allow_id,changed_proposal,gen_random_uuid(),'{"action":"approve_rule"}',gen_random_uuid()),'CONFLICT');
  perform set_config('byus.recurring_live_writer','',true);
  perform public.resolve_admin_recurring_live_review(actor,allow_id,changed_proposal,proposal,'{"action":"approve_rule"}',gen_random_uuid());
  perform pg_temp.assert((select schedule_revision=1 from public.live_events where id=untouched_id),'rule changed an occurrence before effectiveFrom');
  perform pg_temp.assert(exists(select 1 from public.live_events where recurring_series_id=series_id
    and starts_at::date>='2030-01-11' and schedule_revision=2),'approved time change did not use audited reschedule');
  perform pg_temp.assert((select count(*)=1 from public.live_reservations where app_user_id=actor and live_event_id=booked_id),
    'rule change lost canonical booking');
  perform pg_temp.expect_error(format('select public.resolve_admin_recurring_live_review(%L,%L,%L,%L,%L::jsonb,%L)',
    actor,allow_id,changed_proposal,proposal,'{"action":"approve_rule"}',gen_random_uuid()),'ALREADY_RESOLVED');
  select * into generated from public.live_events where id=booked_id;
  schedule_revision_before:=generated.schedule_revision;
  perform public.generate_admin_live_attendance_code(actor,allow_id,pg_catalog.gen_random_uuid(),generated.id,
    generated.starts_at,generated.starts_at+interval '1 hour');
  if (select schedule_revision from public.live_events where id=generated.id)<>schedule_revision_before then
    raise exception 'initial attendance setup changed schedule revision'; end if;
  caught:=false;
  begin
    perform public.generate_admin_live_attendance_code(actor,allow_id,pg_catalog.gen_random_uuid(),generated.id,
      generated.starts_at,generated.starts_at+interval '2 hours');
  exception when others then if sqlerrm like '%audited reschedule%' then caught:=true; else raise; end if; end;
  if not caught then raise exception 'published configured attendance window was mutable'; end if;
  if public.replenish_recurring_live_events(replenish_run,49,'2030-01-01T00:00:00Z')<>replenished then
    raise exception 'replenishment retry changed its result'; end if;
  coverage:=public.verify_recurring_live_coverage('2030-01-01T00:00:00Z',42);
  if coverage->>'status'<>'completed' then raise exception 'recurring LIVE coverage incomplete after replenish'; end if;
  caught:=false;
  begin
    insert into public.live_events(slug,celebrity_id,brand_id,starts_at,ends_at,reservation_opens_at,reservation_closes_at,
      youtube_url,approved_hero_url,fan_code_hash) values('invalid-general-'||replace(pg_catalog.gen_random_uuid()::text,'-',''),
      creator,null,now()+interval '2 days',null,now(),now()+interval '1 day','https://youtu.be/abc','/test.jpg',null);
  exception when check_violation then caught:=true; end;
  if not caught then raise exception 'general LIVE nullable fields bypassed strict constraint'; end if;
  perform pg_temp.assert(public.recurring_live_local_instant('2026-03-08','02:30','America/New_York') is null,
    'DST gap accepted');
  perform pg_temp.assert(public.recurring_live_local_instant('2026-11-01','01:30','America/New_York') is null,
    'DST fold accepted');
  perform pg_temp.expect_error(format('select public.approve_initial_recurring_live_rules(%L,%L,%L,null,array[]::uuid[],%L)',
    actor,allow_id,import_run,gen_random_uuid()),'HASH_CONFLICT');
  -- Unknown / inaccessible source does not revoke the last approved rule.
  changed_input:=jsonb_set(changed_input,'{runId}',to_jsonb(gen_random_uuid()));
  changed_input:=jsonb_set(changed_input,'{creators,0}',(changed_input->'creators'->0)||jsonb_build_object(
    'result','unconfirmed','verification','inaccessible','proposedRule',null,'expectedCurrentRevisionId',changed_proposal));
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-unknown-'||(changed_input->>'runId'),changed_input);
  perform pg_temp.assert((select status='active' and current_rule_revision_id=changed_proposal
    from public.recurring_live_series where id=series_id),'inaccessible source revoked approved rule');
  -- Repeated identical hiatus evidence creates one pending review and freezes generation.
  changed_input:=jsonb_set(changed_input,'{runId}',to_jsonb(gen_random_uuid()));
  changed_input:=jsonb_set(changed_input,'{creators,0}',(changed_input->'creators'->0)||jsonb_build_object(
    'result','irregular','verification','verified'));
  changed_input:=jsonb_set(changed_input,'{creators,0,observations,0,originalText}','"Official broadcasts paused"');
  changed_input:=jsonb_set(changed_input,'{creators,0,observations,0,contentHash}',to_jsonb(repeat('b',64)));
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-hiatus-'||(changed_input->>'runId'),changed_input);
  proposal:=(changed_import->'proposedRuleRevisionIds'->>0)::uuid;
  changed_input:=jsonb_set(changed_input,'{runId}',to_jsonb(gen_random_uuid()));
  perform public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-hiatus-retry-'||(changed_input->>'runId'),changed_input);
  perform pg_temp.assert((select count(*)=1 from public.recurring_live_rule_revisions review
    where review.series_id=generated.recurring_series_id and review.status='proposed' and review.reason='hiatus'),
    'identical hiatus evidence generated duplicate reviews');
  select id into untouched_id from public.live_events where live_type='general' limit 1;
  perform pg_temp.expect_error(format('select public.resolve_admin_recurring_live_review(%L,%L,%L,%L,%L::jsonb,%L)',
    actor,allow_id,proposal,changed_proposal,jsonb_build_object('action','cancel_occurrences','eventIds',jsonb_build_array(untouched_id),'reason','invalid scope'),gen_random_uuid()),'');
  perform public.resolve_admin_recurring_live_review(actor,allow_id,proposal,changed_proposal,
    '{"action":"cancel_occurrences","eventIds":[],"reason":"Official hiatus; retain existing bookings"}',gen_random_uuid());
  perform pg_temp.assert((select status='paused' from public.recurring_live_series where id=series_id),'hiatus did not pause generation');
  replenished:=public.replenish_recurring_live_events(gen_random_uuid(),49,'2030-02-01T00:00:00Z');
  perform pg_temp.assert((replenished->>'createdCount')::integer=0,'paused series generated new broadcasts');
  perform pg_temp.assert((select count(*)=1 from public.live_reservations where app_user_id=actor and live_event_id=booked_id),
    'pausing a series removed its existing booking');
  -- An already published and reserved manual LIVE remains the canonical event.
  select * into strict manual_template from public.live_events where live_type='general' and brand_id is not null limit 1;
  insert into public.live_events select (jsonb_populate_record(null::public.live_events,to_jsonb(manual_template)||jsonb_build_object(
    'id',manual_id,'slug','recurring-manual-preservation','celebrity_id',creator,
    'starts_at',manual_start,'ends_at',manual_start+interval '1 hour',
    'reservation_opens_at',transaction_timestamp(),'reservation_closes_at',manual_start,
    'attendance_valid_from',manual_start,'attendance_valid_until',manual_start+interval '1 hour',
    'live_provider','tiktok','external_live_url','https://www.tiktok.com/@official/live',
    'youtube_url','https://www.tiktok.com/@official/live','content_status','scheduled',
    'publication_status','draft','published_at',null,'ever_published_at',null,'archived_at',null,
    'created_at',now(),'updated_at',now(),'schedule_revision',1))).*;
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values
    (manual_id,'ko','기존 예약 방송','기존 방송','기존 방송'),(manual_id,'en','Existing booked LIVE','Existing LIVE','Existing LIVE');
  update public.live_events set publication_status='published',published_at=now(),ever_published_at=now() where id=manual_id;
  perform public.reserve_owned_live_event(actor,manual_id,gen_random_uuid(),manual_stamp,'byus:stamp:v1:'||manual_stamp,'0x'||repeat('e',64));
  manual_rule:=jsonb_build_object('timeZone','Asia/Seoul','effectiveFrom','2040-01-07','effectiveUntil','2040-01-07',
    'provider','tiktok','channelUrl','https://www.tiktok.com/@official/live','slots',jsonb_build_array(
      jsonb_build_object('id',gen_random_uuid(),'isoWeekday',extract(isodow from date '2040-01-07')::integer,'localStartTime','07:00','end',null)));
  changed_input:=jsonb_set(input,'{runId}',to_jsonb(gen_random_uuid()));
  changed_input:=jsonb_set(changed_input,'{creators,0}',(input->'creators'->0)||jsonb_build_object(
    'seriesKey','manual-preservation','proposedRule',manual_rule,'expectedCurrentRevisionId',null));
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-manual-'||(changed_input->>'runId'),changed_input);
  manual_proposal:=(changed_import->'proposedRuleRevisionIds'->>0)::uuid;
  perform public.approve_initial_recurring_live_rules(actor,allow_id,(changed_input->>'runId')::uuid,
    changed_import->>'inputHash',array[manual_proposal],gen_random_uuid());
  replenished:=public.replenish_recurring_live_events(gen_random_uuid(),49,'2040-01-01T00:00:00Z');
  perform pg_temp.assert((replenished->>'reusedCount')::integer=1 and (replenished->>'createdCount')::integer=0,
    'booked manual broadcast was duplicated rather than reused');
  select recurring_series_id into manual_series from public.live_events where id=manual_id;
  perform pg_temp.assert(manual_series is not null and (select slug='recurring-manual-preservation' and schedule_revision=1
    from public.live_events where id=manual_id),'manual ID/slug/revision was not retained');
  perform pg_temp.assert((select count(*)=1 from public.live_reservations where app_user_id=actor and live_event_id=manual_id),
    'manual reuse lost booking identity');
  select count(*) into manual_count from public.live_events where celebrity_id=creator and starts_at=manual_start;
  perform pg_temp.assert(manual_count=1,'manual reuse created a second event');
  perform set_config('byus.recurring_live_writer','',true);
  perform pg_temp.expect_error(format('update public.live_events set recurring_slot_id=%L where id=%L',gen_random_uuid(),manual_id),
    'identity requires');
  -- Manual creation after generation, including a different time/channel, uses
  -- the same creator lock and collision boundary as replenishment.
  before_live:=to_jsonb(manual_template)||jsonb_build_object('id',shadow_id,'slug','recurring-manual-collision',
    'celebrity_id',creator,'starts_at',manual_start+interval '2 hours','ends_at',manual_start+interval '3 hours',
    'reservation_opens_at',now(),'reservation_closes_at',manual_start+interval '2 hours',
    'attendance_valid_from',manual_start+interval '2 hours','attendance_valid_until',manual_start+interval '3 hours',
    'live_provider','tiktok','external_live_url','https://www.tiktok.com/@different/live',
    'youtube_url','https://www.tiktok.com/@different/live','content_status','scheduled',
    'publication_status','draft','published_at',null,'ever_published_at',null,'archived_at',null);
  perform pg_temp.expect_error(format('insert into public.live_events select (jsonb_populate_record(null::public.live_events,%L::jsonb)).*',before_live),
    'collision');
  before_live:=before_live||jsonb_build_object('starts_at',manual_start+interval '1 day','ends_at',manual_start+interval '25 hours',
    'reservation_closes_at',manual_start+interval '1 day','attendance_valid_from',manual_start+interval '1 day',
    'attendance_valid_until',manual_start+interval '25 hours');
  insert into public.live_events select (jsonb_populate_record(null::public.live_events,before_live)).*;
  perform pg_temp.expect_error(format('update public.live_events set starts_at=%L,ends_at=%L,reservation_closes_at=%L where id=%L',
    manual_start+interval '2 hours',manual_start+interval '3 hours',manual_start+interval '2 hours',shadow_id),'collision');

  -- A different series on the same local day must become a review, even with a
  -- different hour and channel; it must never steal the existing recurring ID.
  changed_input:=jsonb_set(changed_input,'{runId}',to_jsonb(gen_random_uuid()));
  manual_rule:=jsonb_set(manual_rule,'{slots,0,id}',to_jsonb(gen_random_uuid()));
  manual_rule:=jsonb_set(manual_rule,'{slots,0,localStartTime}','"08:00"');
  manual_rule:=jsonb_set(manual_rule,'{channelUrl}','"https://www.tiktok.com/@another/live"');
  changed_input:=jsonb_set(changed_input,'{creators,0}',(changed_input->'creators'->0)||jsonb_build_object(
    'seriesKey','ambiguous-same-day','proposedRule',manual_rule));
  changed_import:=public.import_recurring_live_observations((changed_input->>'runId')::uuid,
    'recurring-ambiguous-'||(changed_input->>'runId'),changed_input);
  manual_proposal:=(changed_import->'proposedRuleRevisionIds'->>0)::uuid;
  perform public.approve_initial_recurring_live_rules(actor,allow_id,(changed_input->>'runId')::uuid,
    changed_import->>'inputHash',array[manual_proposal],gen_random_uuid());
  replenished:=public.replenish_recurring_live_events(gen_random_uuid(),49,'2040-01-01T00:00:00Z');
  perform pg_temp.assert((replenished->>'createdCount')::integer=0 and (replenished->>'needsReviewCount')::integer>0,
    'ambiguous same-day cross-series collision was generated');
  perform pg_temp.assert((select recurring_series_id=manual_series from public.live_events where id=manual_id),
    'ambiguous series stole the canonical booked event');


end $$;

set local role service_role;
select public.get_recurring_live_roster() is not null as service_roster_access;
select public.get_admin_recurring_live_schedules(current_setting('byus.recurring.actor')::uuid,
  current_setting('byus.recurring.allow')::uuid) is not null as service_admin_access;
reset role;
rollback;
select 'Recurring LIVE schema/import/approval/replenish/coverage/attendance PASS' as result;
