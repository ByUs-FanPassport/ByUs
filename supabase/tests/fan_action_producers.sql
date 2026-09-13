-- Run only through scripts/verify-clean-migration-chain.sh against a disposable database.
begin;

create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAN_ACTION_PRODUCER_TEST: %',message; end if; end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
declare caught boolean:=false;begin
  begin execute statement;exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected error %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error was not raised: %',expected; end if;
end $$;

do $$
declare
  creator uuid:='fa110000-0000-4000-8000-000000000001';
  owner_legacy uuid:='fa110000-0000-4000-8000-000000000002';
  owner_native uuid:='fa110000-0000-4000-8000-000000000003';
  binding uuid:='fa110000-0000-4000-8000-000000000004';
  action_code integer;entity_id uuid;outbox_id uuid;descriptor jsonb;snapshot jsonb;
  reaction_id uuid:='fa110000-0000-4000-8000-000000000005';
  reaction_job uuid:='fa110000-0000-4000-8000-000000000006';
  legacy_reaction uuid:='fa110000-0000-4000-8000-000000000010';
  legacy_reaction_job uuid:='fa110000-0000-4000-8000-000000000011';
  historical_occurrence uuid:='fa110000-0000-4000-8000-000000000012';
  historical_outbox uuid:='fa110000-0000-4000-8000-000000000013';
  issuance text:='0x'||repeat('a',64);
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(creator,'fan-action-producer','published','/fan-action.webp',now(),'{artist}','idol');
  insert into public.app_users(id,privy_user_id,verified_email,status) values
    (owner_legacy,'did:privy:fan-action-legacy','fan-action-legacy@byus.test','active'),
    (owner_native,'did:privy:fan-action-native','fan-action-native@byus.test','active');

  -- With no route rows, the existing producer remains the only lane.
  perform pg_temp.assert(not public.fan_action_native_enabled(7),'missing route must be disabled');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_legacy,91342,'0x1111111111111111111111111111111111111111','privy','embedded');
  perform pg_temp.assert(exists(select 1 from public.community_stamps
    where app_user_id=owner_legacy and kind='welcome' and blockchain_job_id is not null and fan_action_outbox_id is null),
    'disabled welcome producer did not preserve legacy lane');
  perform public.react_to_creator(owner_legacy,creator,legacy_reaction,legacy_reaction_job,'0x'||repeat('9',64));

  insert into public.fan_action_bindings(id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,
    binding_version,asset_base_uri,assets) values(binding,91342,'0x'||repeat('1',64),
    '0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333',
    '0x'||repeat('4',64),1,1,'ipfs://bafybeigdyrzt',jsonb_build_object(
      '0','0x5555555555555555555555555555555555555555',
      '1','0x6666666666666666666666666666666666666666',
      '2','0x7777777777777777777777777777777777777777'));
  for action_code in 1..11 loop
    insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
      values(action_code,binding,true,1,clock_timestamp());
  end loop;
  insert into public.fan_action_verified_creators(
    binding_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding,creator,123456,'0x'||repeat('8',64),clock_timestamp());

  -- Exercise every registered action code through the same atomic source adapter.
  for action_code in 1..11 loop
    entity_id:=extensions.gen_random_uuid();
    descriptor:=jsonb_build_array(jsonb_build_object(
      'entityType',case when action_code=1 then 'passport' when action_code=6 then 'reaction'
        when action_code between 7 and 10 then 'community_stamp' when action_code=11 then 'collectible' else 'stamp' end,
      'entityId',entity_id,'kind',case when action_code=1 then 0 when action_code=11 then 2 else 1 end,
      'issuanceKey',case when action_code=11 then null else '0x'||encode(extensions.digest('issuance:'||action_code::text,'sha256'),'hex') end,
      'operationKey','byus:test:v1:'||entity_id::text,'legacyPayload',case
        when action_code=1 then jsonb_build_object('recipient','0x1111111111111111111111111111111111111111',
          'celebritySlug','fan-action-producer','passportId','0x'||repeat('1',64))
        when action_code between 2 and 5 then jsonb_build_object('recipient','0x1111111111111111111111111111111111111111',
          'celebritySlug','fan-action-producer','issuanceId','0x'||encode(extensions.digest('issuance:'||action_code::text,'sha256'),'hex'),
          'stampType',case action_code when 2 then 'Reservation' when 3 then 'Attendance' else 'Survey' end)
        when action_code=6 then jsonb_build_object('recipient','0x1111111111111111111111111111111111111111',
          'celebritySlug','fan-action-producer','issuanceId','0x'||encode(extensions.digest('issuance:6','sha256'),'hex'),
          'reactionType','FirstReaction')
        when action_code between 7 and 10 then jsonb_build_object('recipient','0x1111111111111111111111111111111111111111',
          'issuanceId','0x'||encode(extensions.digest('issuance:'||action_code::text,'sha256'),'hex'),
          'stampKind',case action_code when 7 then 'welcome' when 8 then 'first_comment' when 9 then 'invite' else 'daily_checkin' end,
          'celebritySlug',case when action_code in(7,9) then null else 'fan-action-producer' end)
        else jsonb_build_object('recipient','0x1111111111111111111111111111111111111111',
          'celebritySlug','fan-action-producer','liveSlug','producer-test-live','claimId',entity_id::text,'metadataVersion',1)
      end));
    if action_code=1 then
      entity_id:=extensions.gen_random_uuid();
      descriptor:=descriptor||jsonb_build_array(jsonb_build_object('entityType','stamp','entityId',entity_id,'kind',1,
        'issuanceKey','0x'||encode(extensions.digest('issuance:1:stamp','sha256'),'hex'),
        'operationKey','byus:test:v1:'||entity_id::text,'legacyPayload',jsonb_build_object(
          'recipient','0x1111111111111111111111111111111111111111','celebritySlug','fan-action-producer',
          'issuanceId','0x'||encode(extensions.digest('issuance:1:stamp','sha256'),'hex'),'stampType','Knowledge')));
    end if;
    outbox_id:=public.enqueue_fan_action_source('producer_test','source-'||action_code::text,owner_legacy,creator,null,
      '2026-09-13 01:00:00+09',action_code,descriptor);
    select source_snapshot into strict snapshot from public.fan_action_outbox where id=outbox_id;
    perform pg_temp.assert(snapshot->>'version'='1' and snapshot->>'actionCode'=action_code::text
      and snapshot->>'policyVersion'='1' and snapshot->>'operationKind'='RECORD_AND_ISSUE'
      and snapshot->>'origin'='NATIVE' and snapshot->>'assetBaseUri'='ipfs://bafybeigdyrzt'
      and snapshot->>'sourceOccurredAt' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      and snapshot->>'evidenceCommitment' ~ '^0x[0-9a-f]{64}$'
      and snapshot->>'migrationBatchId'='0x'||repeat('0',64)
      and jsonb_typeof(snapshot->'migrationProof')='array'
      and jsonb_array_length(snapshot->'credentials')=case when action_code=1 then 2 else 1 end
      and (action_code<>11 or snapshot->'credentials'->0->'issuanceKey'='null'::jsonb),
      'worker snapshot contract failed for code '||action_code);
  end loop;
  perform pg_temp.assert((select count(*) from public.fan_action_occurrences where source_namespace='producer_test')=11,
    'not all 11 occurrences were persisted');
  perform pg_temp.assert((select count(*) from public.fan_action_credentials credential join public.fan_action_outbox outbox
    on outbox.id=credential.outbox_id join public.fan_action_occurrences occurrence on occurrence.id=outbox.occurrence_row_id
    where occurrence.source_namespace='producer_test')=12,'credential fan-out changed');

  -- Actual trigger producer: enabling WELCOME changes only new sources to v2.
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_native,91342,'0x8888888888888888888888888888888888888888','privy','embedded');
  perform pg_temp.assert(exists(select 1 from public.community_stamps where app_user_id=owner_native and kind='welcome'
    and blockchain_job_id is null and fan_action_outbox_id is not null),'enabled welcome producer did not use v2 lane');

  perform public.react_to_creator(owner_native,creator,reaction_id,reaction_job,issuance);
  perform pg_temp.assert(exists(select 1 from public.fan_reactions where id=reaction_id
    and blockchain_job_id is null and fan_action_outbox_id is not null),'enabled reaction producer did not use v2 lane');
  perform pg_temp.assert(not exists(select 1 from public.blockchain_jobs where id=reaction_job),
    'enabled producer created a fake legacy job');

  -- H2 recovery overlays a completed historical mint in owner reads while the
  -- legacy business row and its original queue job remain unchanged.
  insert into public.fan_action_occurrences(id,source_namespace,canonical_source_key,app_user_id,creator_id,source_occurred_at)
    values(historical_occurrence,'historical_test',legacy_reaction::text,owner_legacy,creator,'2026-09-12 01:00:00+09');
  insert into public.fan_action_outbox(id,occurrence_row_id,binding_id,operation_kind,source_snapshot,action_id,occurrence_id,
    request_hash,payload,status,tx_hash,signed_transaction)
    values(historical_outbox,historical_occurrence,binding,'import_historical','{}',
      '0x'||repeat('a',64),'0x'||repeat('b',64),'0x'||repeat('c',64),'{}','COMPLETED','0x'||repeat('d',64),'0x12');
  insert into public.fan_action_credentials(outbox_id,entity_type,entity_id,credential_kind,issuance_key,legacy_job_id,
    token_id,nft_contract,metadata_uri,link_origin)
    values(historical_outbox,'reaction',legacy_reaction,1,'0x'||repeat('9',64),legacy_reaction_job,77,
      '0x6666666666666666666666666666666666666666','ipfs://bafybeigdyrzt/reaction.json','MINTED_NOW');
  perform pg_temp.assert(public.get_owned_reaction(owner_legacy,'fan-action-producer')->>'mintStatus'='minted',
    'completed H2 mint was not visible in the owner reaction read');
  perform pg_temp.assert((select mint_status='queued' and blockchain_job_id=legacy_reaction_job and tx_hash is null and token_id is null
    from public.fan_reactions where id=legacy_reaction)
    and (select status='PENDING' and tx_hash is null and token_id is null from public.blockchain_jobs where id=legacy_reaction_job),
    'H2 read overlay mutated legacy evidence');
  perform pg_temp.assert(public.effective_fan_action_mint(owner_legacy,'reaction',legacy_reaction,'minted',
    '0x'||repeat('e',64),'88')=jsonb_build_object('status','minted','txHash','0x'||repeat('e',64),'tokenId','88'),
    'H1 existing mint evidence was replaced by an import overlay');

  perform pg_temp.expect_error(format('update public.fan_reactions set fan_action_outbox_id=%L where id=%L',
    (select id from public.fan_action_outbox where id<>(select fan_action_outbox_id from public.fan_reactions where id=reaction_id) limit 1),reaction_id),
    'credential fan action link is immutable');
end $$;

-- Exercise every public producer with its route enabled. The fixtures model one
-- complete fan journey and keep all business-side score, ticket, rate-limit,
-- response, and idempotency writes inside the same transaction as the v2 lane.
do $$
declare
  creator uuid:='fa110000-0000-4000-8000-000000000001';
  binding uuid:='fa110000-0000-4000-8000-000000000004';
  private_creator uuid:='fa110000-0000-4000-8000-000000000014';
  owner uuid:='fa110000-0000-4000-8000-000000000003';
  invitee uuid:='fa110000-0000-4000-8000-000000000007';
  brand uuid:='fa110000-0000-4000-8000-000000000008';
  allowlist uuid:='fa110000-0000-4000-8000-000000000009';
  quiz uuid:='fa120000-0000-4000-8000-000000000001';
  attempt uuid:='fa120000-0000-4000-8000-000000000002';
  passport_stamp uuid:='fa120000-0000-4000-8000-000000000003';
  live_reserve uuid:='fa130000-0000-4000-8000-000000000001';
  live_mission uuid:='fa130000-0000-4000-8000-000000000002';
  live_collectible uuid:='fa130000-0000-4000-8000-000000000003';
  reservation_stamp uuid:='fa140000-0000-4000-8000-000000000001';
  attendance_stamp uuid:='fa140000-0000-4000-8000-000000000002';
  survey_stamp uuid:='fa140000-0000-4000-8000-000000000003';
  mission_stamp uuid:='fa140000-0000-4000-8000-000000000004';
  legacy_survey uuid:='fa150000-0000-4000-8000-000000000001';
  mission uuid:='fa150000-0000-4000-8000-000000000002';
  survey_question uuid:='fa150000-0000-4000-8000-000000000011';
  mission_question uuid:='fa150000-0000-4000-8000-000000000012';
  survey_option uuid:='fa150000-0000-4000-8000-000000000021';
  mission_option uuid:='fa150000-0000-4000-8000-000000000023';
  template_live public.live_events%rowtype;
  template_localization public.live_event_localizations%rowtype;
  reward_setting public.live_reward_setting_revisions%rowtype;
  requirement uuid:='fa160000-0000-4000-8000-000000000001';
  completion uuid:='fa160000-0000-4000-8000-000000000002';
  observed timestamptz:=statement_timestamp();
  result jsonb;invite_code text;passport_id uuid;attendance_id uuid;claim_id uuid;share_link jsonb;
  i integer;q uuid;o_good uuid;o_bad uuid;snapshot_q uuid;snapshot_good uuid;snapshot_bad uuid;
begin
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (creator,'ko','팬 행동 테스트','팬 행동 테스트','팬 행동 테스트'),
    (creator,'en','Fan action test','Fan action test','Fan action test');
  insert into public.celebrities(id,slug,status,image_url,roles,primary_role)
    values(private_creator,'fan-action-private','draft','/fan-action-private.webp','{artist}','idol');
  insert into public.brands(id,slug,status,logo_url,logo_alt,published_at)
    values(brand,'fan-action-brand','published','/fan-action-brand.svg','Fan action brand',observed);
  insert into public.brand_localizations(brand_id,locale,name,description) values
    (brand,'ko','팬 행동 브랜드','팬 행동 브랜드'),(brand,'en','Fan action brand','Fan action brand');
  insert into public.admin_allowlist(id,email,role,active,created_by_app_user_id)
    values(allowlist,'fan-action-native@byus.test','admin',true,owner);
  insert into public.app_users(id,privy_user_id,verified_email,status)
    values(invitee,'did:privy:fan-action-invitee','fan-action-invitee@byus.test','active');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(invitee,91342,'0x9999999999999999999999999999999999999999','privy','embedded');
  begin
    perform public.enqueue_fan_action_source('public_context_test','private-creator',owner,private_creator,null,observed,6,
      jsonb_build_array(jsonb_build_object('entityType','reaction','entityId',extensions.gen_random_uuid(),'kind',1,
        'issuanceKey','0x'||repeat('8',64),'operationKey','byus:test:private-creator',
        'legacyPayload',jsonb_build_object('recipient','0x8888888888888888888888888888888888888888',
          'celebritySlug','fan-action-private','issuanceId','0x'||repeat('8',64),'reactionType','FirstReaction'))));
    raise exception 'private creator source unexpectedly accepted';
  exception when others then
    if sqlerrm<>'FAN_ACTION_CREATOR_NOT_PUBLIC' then raise; end if;
  end;

  insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at)
    values(quiz,creator,1,'draft',null);
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key)
    values(attempt,owner,creator,quiz,1,'fa120000-0000-4000-8000-000000000004');
  for i in 1..3 loop
    q:=('fa121000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    o_good:=('fa122000-0000-4000-8000-'||lpad((i*2-1)::text,12,'0'))::uuid;
    o_bad:=('fa122000-0000-4000-8000-'||lpad((i*2)::text,12,'0'))::uuid;
    snapshot_q:=('fa123000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    snapshot_good:=('fa124000-0000-4000-8000-'||lpad((i*2-1)::text,12,'0'))::uuid;
    snapshot_bad:=('fa124000-0000-4000-8000-'||lpad((i*2)::text,12,'0'))::uuid;
    insert into public.celebrity_quiz_questions(id,quiz_id,position,prompt_ko,prompt_en)
      values(q,quiz,i,'질문 '||i,'Question '||i);
    insert into public.celebrity_quiz_options(id,question_id,position,label_ko,label_en,is_correct) values
      (o_good,q,1,'정답','Correct',true),(o_bad,q,2,'오답','Wrong',false);
    insert into public.quiz_attempt_questions(id,attempt_id,quiz_id,source_question_id,position,prompt_ko,prompt_en)
      values(snapshot_q,attempt,quiz,q,i,'질문 '||i,'Question '||i);
    insert into public.quiz_attempt_options(id,attempt_question_id,source_question_id,source_option_id,position,label_ko,label_en,is_correct) values
      (snapshot_good,snapshot_q,q,o_good,1,'정답','Correct',true),
      (snapshot_bad,snapshot_q,q,o_bad,2,'오답','Wrong',false);
    insert into public.quiz_attempt_answers(attempt_id,attempt_question_id,selected_option_id)
      values(attempt,snapshot_q,snapshot_good);
  end loop;
  update public.celebrity_quizzes set status='published',published_at=observed where id=quiz;
  result:=public.submit_owned_quiz_attempt(owner,attempt,passport_stamp,
    'byus:passport:v1:'||owner::text||':fan-action-producer','0x'||repeat('b',64),
    'byus:stamp:v1:'||passport_stamp::text,'0x'||repeat('c',64));
  select id into strict passport_id from public.fan_passports where app_user_id=owner and celebrity_id=creator;
  perform pg_temp.assert((select fan_action_outbox_id is not null and blockchain_job_id is null from public.fan_passports where id=passport_id),
    'enabled quiz did not issue its Passport through v2');
  perform pg_temp.assert((select count(*) from public.fan_action_credentials credential
    join public.fan_action_outbox outbox on outbox.id=credential.outbox_id
    join public.fan_action_occurrences occurrence on occurrence.id=outbox.occurrence_row_id
    where occurrence.source_namespace='quiz_passes' and occurrence.app_user_id=owner)=2,
    'enabled quiz did not enqueue both credentials');

  select * into strict template_live from public.live_events where publication_status='published' limit 1;
  select * into strict template_localization from public.live_event_localizations
    where live_event_id=template_live.id and locale='ko';
  insert into public.live_events select (jsonb_populate_record(null::public.live_events,to_jsonb(template_live)||jsonb_build_object(
    'id',live_reserve,'slug','fan-action-live','celebrity_id',creator,'brand_id',brand,
    'starts_at',observed+interval '1 hour','ends_at',observed+interval '2 hours',
    'reservation_opens_at',observed-interval '1 hour','reservation_closes_at',observed+interval '30 minutes',
    'attendance_valid_from',observed-interval '1 hour','attendance_valid_until',observed+interval '3 hours',
    'fan_code_hash',extensions.crypt('FAN2026',extensions.gen_salt('bf',12)),
    'publication_status','draft','published_at',null,'ever_published_at',null,'created_at',observed,'updated_at',observed))).*;
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
    select live_reserve,locale,'Fan action live','Fan action live','Fan action live'
    from (values('ko'::public.content_locale),('en'::public.content_locale)) locale(locale);
  begin
    perform public.enqueue_fan_action_source('public_context_test','draft-campaign',owner,creator,live_reserve,observed,2,
      jsonb_build_array(jsonb_build_object('entityType','stamp','entityId',extensions.gen_random_uuid(),'kind',1,
        'issuanceKey','0x'||repeat('7',64),'operationKey','byus:test:draft-campaign',
        'legacyPayload',jsonb_build_object('recipient','0x8888888888888888888888888888888888888888',
          'celebritySlug','fan-action-producer','issuanceId','0x'||repeat('7',64),'stampType','Reservation'))));
    raise exception 'draft campaign source unexpectedly accepted';
  exception when others then
    if sqlerrm<>'FAN_ACTION_CAMPAIGN_NOT_PUBLIC' then raise; end if;
  end;
  update public.live_events set publication_status='published',published_at=observed,ever_published_at=observed where id=live_reserve;
  insert into public.fan_action_verified_campaigns(
    binding_id,campaign_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding,live_reserve,creator,123456,'0x'||repeat('8',64),clock_timestamp());
  insert into public.live_reward_setting_revisions(live_event_id,revision,policy_version,lifecycle_status,
    mission_score,mission_ticket,journey_bonus_ticket,correlation_id,published_at)
    select live_reserve,2,activation.policy_version,'published',1,1,0,
      'fa130000-0000-4000-8000-000000000021',observed from public.reward_policy_activation activation where activation.singleton;

  result:=public.reserve_owned_live_event(owner,live_reserve,'fa130000-0000-4000-8000-000000000011',reservation_stamp,
    'byus:stamp:v1:'||reservation_stamp::text,'0x'||repeat('d',64));
  perform pg_temp.assert(exists(select 1 from public.stamps where id=reservation_stamp and fan_action_outbox_id is not null and blockchain_job_id is null),
    'enabled reservation did not use v2');
  result:=public.reserve_owned_live_event(owner,live_reserve,'fa130000-0000-4000-8000-000000000011',reservation_stamp,
    'byus:stamp:v1:'||reservation_stamp::text,'0x'||repeat('d',64));
  perform pg_temp.assert((select count(*) from public.live_reservations
      where app_user_id=owner and live_event_id=live_reserve)=1
      and (select count(*) from public.fan_action_occurrences
        where app_user_id=owner and source_namespace='live_reservations')=1,
    'verified campaign replay duplicated its business or native occurrence');
  result:=public.attend_owned_live_event(owner,'fan-action-live','fa130000-0000-4000-8000-000000000012','FAN2026',true,
    attendance_stamp,'byus:stamp:v1:'||attendance_stamp::text,'0x'||repeat('e',64));
  select id into strict attendance_id from public.live_attendances where app_user_id=owner and live_event_id=live_reserve;
  perform pg_temp.assert(exists(select 1 from public.stamps where id=attendance_stamp and fan_action_outbox_id is not null and blockchain_job_id is null)
    and exists(select 1 from public.attendance_verification_attempts where app_user_id=owner and live_event_id=live_reserve and category='success')
    and exists(select 1 from public.attendance_rate_limits where app_user_id=owner and live_event_id=live_reserve and failed_count=0 and blocked_until is null),
    'enabled attendance did not preserve the successful rate-limit path');

  insert into public.live_surveys(id,live_event_id,version,legacy_contract,attendance_requirement,visible_from,visible_until)
    values(legacy_survey,live_reserve,1,true,'required',observed-interval '1 hour',observed+interval '1 day');
  insert into public.live_survey_localizations(survey_id,locale,title,description) values
    (legacy_survey,'ko','팬 행동 설문','팬 행동 설문'),(legacy_survey,'en','Fan action survey','Fan action survey');
  insert into public.live_survey_questions(id,survey_id,question_type,position) values(survey_question,legacy_survey,'single_choice',1);
  insert into public.live_survey_question_localizations(question_id,locale,question_text) values
    (survey_question,'ko','선택'),(survey_question,'en','Choose');
  insert into public.live_survey_options(id,question_id,position) values(survey_option,survey_question,1);
  insert into public.live_survey_option_localizations(option_id,locale,label) values
    (survey_option,'ko','예'),(survey_option,'en','Yes');
  update public.live_surveys set lifecycle_status='published',publication_status='published',published_at=observed,
    ever_published_at=observed where id=legacy_survey;
  result:=public.submit_owned_live_survey(owner,'fan-action-live','fa150000-0000-4000-8000-000000000031',
    jsonb_build_array(jsonb_build_object('questionId',survey_question,'selectedOptionIds',jsonb_build_array(survey_option))),
    survey_stamp,'byus:stamp:v1:'||survey_stamp::text,'0x'||repeat('1',64));
  perform pg_temp.assert(exists(select 1 from public.stamps where id=survey_stamp and fan_action_outbox_id is not null and blockchain_job_id is null),
    'enabled survey did not use v2');

  insert into public.live_events select (jsonb_populate_record(null::public.live_events,to_jsonb(template_live)||jsonb_build_object(
    'id',live_mission,'slug','fan-action-mission','celebrity_id',creator,'brand_id',brand,
    'starts_at',observed-interval '1 hour','ends_at',observed+interval '1 hour',
    'reservation_opens_at',observed-interval '2 hours','reservation_closes_at',observed-interval '1 hour',
    'attendance_valid_from',observed-interval '2 hours','attendance_valid_until',observed+interval '2 hours',
    'publication_status','draft','published_at',null,'ever_published_at',null,'created_at',observed,'updated_at',observed))).*;
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
    select live_mission,locale,'Fan action mission','Fan action mission','Fan action mission'
    from (values('ko'::public.content_locale),('en'::public.content_locale)) locale(locale);
  update public.live_events set publication_status='published',published_at=observed,ever_published_at=observed where id=live_mission;
  insert into public.fan_action_verified_campaigns(
    binding_id,campaign_id,creator_id,verified_block_number,verified_block_hash,verified_at
  ) values(binding,live_mission,creator,123456,'0x'||repeat('8',64),clock_timestamp());
  insert into public.live_reward_setting_revisions(live_event_id,revision,policy_version,lifecycle_status,
    mission_score,mission_ticket,journey_bonus_ticket,correlation_id,published_at)
    select live_mission,2,activation.policy_version,'published',1,1,0,
      'fa130000-0000-4000-8000-000000000022',observed from public.reward_policy_activation activation where activation.singleton;
  insert into public.live_surveys(id,live_event_id,version,mission_type,legacy_contract,attendance_requirement,visible_from,visible_until)
    values(mission,live_mission,1,'vote',false,'not_required',observed-interval '1 hour',observed+interval '1 day');
  insert into public.live_survey_localizations(survey_id,locale,title,description) values
    (mission,'ko','팬 행동 미션','팬 행동 미션'),(mission,'en','Fan action mission','Fan action mission');
  insert into public.live_survey_questions(id,survey_id,question_type,position) values(mission_question,mission,'single_choice',1);
  insert into public.live_survey_question_localizations(question_id,locale,question_text) values
    (mission_question,'ko','선택'),(mission_question,'en','Choose');
  insert into public.live_survey_options(id,question_id,position) values
    (mission_option,mission_question,1),('fa150000-0000-4000-8000-000000000024',mission_question,2);
  insert into public.live_survey_option_localizations(option_id,locale,label) values
    (mission_option,'ko','A'),(mission_option,'en','A'),
    ('fa150000-0000-4000-8000-000000000024','ko','B'),('fa150000-0000-4000-8000-000000000024','en','B');
  update public.live_surveys set lifecycle_status='published',publication_status='published',published_at=observed,
    ever_published_at=observed where id=mission;
  result:=public.submit_owned_live_mission(owner,mission,'fa150000-0000-4000-8000-000000000032',
    jsonb_build_array(jsonb_build_object('questionId',mission_question,'selectedOptionIds',jsonb_build_array(mission_option))),
    mission_stamp,'byus:stamp:v1:'||mission_stamp::text,'0x'||repeat('2',64));
  perform pg_temp.assert(exists(select 1 from public.stamps where id=mission_stamp and fan_action_outbox_id is not null and blockchain_job_id is null),
    'enabled mission did not use v2');

  insert into public.live_events select (jsonb_populate_record(null::public.live_events,to_jsonb(template_live)||jsonb_build_object(
    'id',live_collectible,'slug','fan-action-collectible','celebrity_id',creator,'brand_id',brand,
    'starts_at',observed-interval '2 hours','ends_at',observed-interval '1 hour',
    'reservation_opens_at',observed-interval '4 hours','reservation_closes_at',observed-interval '3 hours',
    'attendance_valid_from',observed-interval '3 hours','attendance_valid_until',observed,
    'schedule_revision',1,'publication_status','draft','published_at',null,'ever_published_at',null,'created_at',observed,'updated_at',observed))).*;
  insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt)
    select live_collectible,locale,'Fan action collectible','Fan action collectible','Fan action collectible'
    from (values('ko'::public.content_locale),('en'::public.content_locale)) locale(locale);
  update public.live_events set publication_status='published',published_at=observed-interval '1 day',ever_published_at=observed-interval '1 day' where id=live_collectible;
  insert into public.live_reward_setting_revisions(live_event_id,revision,policy_version,lifecycle_status,
    mission_score,mission_ticket,journey_bonus_ticket,correlation_id,published_at)
    select live_collectible,2,activation.policy_version,'published',1,1,0,
      'fa130000-0000-4000-8000-000000000023',observed from public.reward_policy_activation activation where activation.singleton;
  select * into strict reward_setting from public.live_reward_setting_revisions
    where live_event_id=live_collectible and lifecycle_status='published' order by revision desc limit 1;
  insert into public.live_journey_requirement_revisions(id,live_event_id,revision,lifecycle_status,require_passport,
    require_reservation,require_attendance,bonus_ticket_amount,reward_setting_revision_id,reward_setting_revision,
    policy_version,actor_app_user_id,actor_admin_allowlist_id,correlation_id,published_at)
    values(requirement,live_collectible,1,'published',true,false,false,0,reward_setting.id,reward_setting.revision,
      reward_setting.policy_version,owner,allowlist,'fa160000-0000-4000-8000-000000000003',observed-interval '1 day');
  insert into public.live_journey_completions(id,app_user_id,live_event_id,requirement_revision_id,requirement_snapshot,
    bonus_ticket_amount,policy_version,reward_setting_revision,reward_setting_revision_id,completed_at)
    values(completion,owner,live_collectible,requirement,'{}',0,reward_setting.policy_version,reward_setting.revision,
      reward_setting.id,observed-interval '30 minutes');
  result:=public.claim_owned_live_collectible(owner,'fan-action-collectible','fa160000-0000-4000-8000-000000000004');
  claim_id:=(result->'claim'->>'id')::uuid;
  perform pg_temp.assert(exists(select 1 from public.live_collectible_claims where id=claim_id
    and fan_action_outbox_id is not null and blockchain_job_id is null),'enabled collectible did not use v2');

  result:=public.post_celebrity_lounge_message(owner,'fan-action-producer','첫 댓글','fa170000-0000-4000-8000-000000000001');
  perform pg_temp.assert(exists(select 1 from public.community_stamps where app_user_id=owner and celebrity_id=creator
    and kind='first_comment' and fan_action_outbox_id is not null and blockchain_job_id is null),
    'enabled first-comment producer did not use v2');
  result:=public.check_in_community_stamp(owner,'fan-action-producer');
  perform pg_temp.assert(exists(select 1 from public.community_stamps where app_user_id=owner and celebrity_id=creator
    and kind='daily_checkin' and fan_action_outbox_id is not null and blockchain_job_id is null),
    'enabled daily-checkin producer did not use v2');
  invite_code:=public.get_community_stamp_invite_code(owner)->>'code';
  result:=public.redeem_community_stamp_invite(invitee,invite_code);
  perform pg_temp.assert((select count(*) from public.community_stamps where kind='invite'
    and app_user_id in(owner,invitee) and fan_action_outbox_id is not null and blockchain_job_id is null)=2,
    'enabled invite producer did not issue both v2 stamps');

  -- SHARE has verified source evidence but no ActionHub action code. Even while
  -- all mapped routes are enabled, it must retain its canonical legacy job.
  share_link:=public.create_community_stamp_share_link(owner,'fan-action-producer');
  perform public.visit_community_stamp_share_link(invitee,share_link->>'token');
  perform public.visit_community_stamp_share_link(invitee,share_link->>'token');
  perform pg_temp.assert((select count(*) from public.community_stamps
      where app_user_id=owner and celebrity_id=creator and kind='share')=1
      and exists(select 1 from public.community_stamps stamp
        join public.blockchain_jobs job on job.id=stamp.blockchain_job_id
        where stamp.app_user_id=owner and stamp.celebrity_id=creator and stamp.kind='share'
          and stamp.fan_action_outbox_id is null and job.entity_type='community_stamp'
          and job.payload->>'stampKind'='share')
      and not exists(select 1 from public.fan_action_occurrences occurrence
        where occurrence.app_user_id=owner and occurrence.source_namespace='community_stamps'
          and occurrence.canonical_source_key like 'verified-share-visit:%'),
    'verified share did not remain idempotent on the legacy lane');

  perform pg_temp.assert(not exists(select 1 from public.blockchain_jobs job where job.entity_id in
    (passport_stamp,reservation_stamp,attendance_stamp,survey_stamp,mission_stamp,claim_id)),
    'an enabled producer created a legacy job');
  perform pg_temp.assert((select count(distinct (outbox.source_snapshot->>'actionCode')::integer)
    from public.fan_action_occurrences occurrence join public.fan_action_outbox outbox on outbox.occurrence_row_id=occurrence.id
    where occurrence.app_user_id in(owner,invitee) and (outbox.source_snapshot->>'actionCode')::integer between 1 and 11)=11,
    'actual producers did not cover all 11 action codes');
end $$;

do $$
declare item record;definition text;
begin
  for item in select * from (values
    ('public.submit_owned_quiz_attempt(uuid,uuid,uuid,text,text,text,text)'::regprocedure,'fan_action_native_enabled(1,p_app_user_id,attempt_record.celebrity_id)'),
    ('public.reserve_owned_live_event(uuid,uuid,uuid,uuid,text,text)'::regprocedure,'fan_action_native_enabled(2,p_app_user_id,live_record.celebrity_id,live_record.id)'),
    ('public.attend_owned_live_event_before_recurring_live(uuid,text,uuid,text,uuid,text,text)'::regprocedure,'fan_action_native_enabled(3,p_app_user_id,live_record.celebrity_id,live_record.id)'),
    ('public.submit_owned_live_mission(uuid,uuid,uuid,jsonb,uuid,text,text)'::regprocedure,'fan_action_native_enabled(4,p_app_user_id,live_record.celebrity_id,mission.live_event_id)'),
    ('public.submit_owned_live_survey(uuid,text,uuid,jsonb,uuid,text,text)'::regprocedure,'fan_action_native_enabled(5,p_app_user_id,response_record.celebrity_id,response_record.live_event_id)'),
    ('public.react_to_creator(uuid,uuid,uuid,uuid,text)'::regprocedure,'fan_action_native_enabled(6,p_app_user_id,p_celebrity_id)'),
    ('public.claim_owned_live_collectible(uuid,text,uuid)'::regprocedure,'fan_action_native_enabled(11,p_app_user_id)')
  ) v(signature,marker) loop
    definition:=pg_get_functiondef(item.signature);
    perform pg_temp.assert(position(item.marker in definition)>0,item.signature::text||' is missing its v2 branch');
  end loop;
  definition:=pg_get_functiondef('public.attend_owned_live_event(uuid,text,uuid,text,uuid,text,text)'::regprocedure);
  perform pg_temp.assert(
    (length(definition)-length(replace(definition,'public.attend_owned_live_event_before_recurring_live(','')))
      / length('public.attend_owned_live_event_before_recurring_live(')=1,
    'recurring LIVE attendance wrapper no longer delegates exactly once to the patched producer');
  definition:=pg_get_functiondef('public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure);
  perform pg_temp.assert(position('fan_action_native_enabled(v_action_code,p_app_user_id,p_celebrity_id)' in definition)>0,
    'community producer is missing action codes 7-10 branch');
  perform pg_temp.assert(position('v_action_code is not null and' in definition)>0
      and position('p_kind in (''subscription'',''support'')' in definition)>0,
    'community producer did not preserve unmapped share on the legacy lane');
  perform pg_temp.assert(not has_function_privilege('anon','public.enqueue_fan_action_source(text,text,uuid,uuid,uuid,timestamptz,integer,jsonb)','execute')
    and not has_function_privilege('authenticated','public.enqueue_fan_action_source(text,text,uuid,uuid,uuid,timestamptz,integer,jsonb)','execute')
    and not has_function_privilege('service_role','public.enqueue_fan_action_source(text,text,uuid,uuid,uuid,timestamptz,integer,jsonb)','execute'),
    'internal enqueue helper is executable by an API role');
end $$;

rollback;
