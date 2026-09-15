-- Standalone creator raffle regression. All fixture writes roll back.
begin;

create function pg_temp.expect_error(p_sql text,p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: %',p_message;
exception when others then
  if sqlerrm='EXPECTED_ERROR_NOT_RAISED: '||p_message or position(p_message in sqlerrm)=0 then
    raise;
  end if;
end;
$$;

do $$
declare
  actor uuid:='d0000000-0000-4000-8000-000000000001';
  allowlist uuid:='d0000000-0000-4000-8000-000000000002';
  creator uuid:='d1000000-0000-4000-8000-000000000001';
  other_creator uuid:='d1000000-0000-4000-8000-000000000002';
  benefit1 uuid:='d2000000-0000-4000-8000-000000000001';
  benefit2 uuid:='d2000000-0000-4000-8000-000000000002';
  wrong_benefit uuid:='d2000000-0000-4000-8000-000000000003';
  campaign uuid; item1 uuid; item2 uuid; campaign_revision integer;
  unverified uuid:='d3000000-0000-4000-8000-000000000001';
  wrong_verified uuid:='d3000000-0000-4000-8000-000000000002';
  verified uuid:='d3000000-0000-4000-8000-000000000003';
  insufficient uuid:='d3000000-0000-4000-8000-000000000004';
  other_passport uuid:='d4000000-0000-4000-8000-000000000001';
  verified_passport uuid:='d4000000-0000-4000-8000-000000000002';
  insufficient_passport uuid:='d4000000-0000-4000-8000-000000000003';
  other_job uuid:='d4100000-0000-4000-8000-000000000001';
  verified_job uuid:='d4100000-0000-4000-8000-000000000002';
  insufficient_job uuid:='d4100000-0000-4000-8000-000000000003';
  quiz1 uuid:='d5000000-0000-4000-8000-000000000001';
  quiz2 uuid:='d5000000-0000-4000-8000-000000000002';
  attempt1 uuid:='d6000000-0000-4000-8000-000000000001';
  attempt2 uuid:='d6000000-0000-4000-8000-000000000002';
  attempt3 uuid:='d6000000-0000-4000-8000-000000000003';
  pass1 uuid:='d7000000-0000-4000-8000-000000000001';
  pass2 uuid:='d7000000-0000-4000-8000-000000000002';
  pass3 uuid:='d7000000-0000-4000-8000-000000000003';
  legacy_fan uuid:='d3000000-0000-4000-8000-000000000005';
  legacy_benefit uuid:='d2000000-0000-4000-8000-000000000004';
  legacy_campaign uuid:='d9000000-0000-4000-8000-000000000001';
  legacy_live uuid; legacy_creator uuid;
  key1 uuid:='d8000000-0000-4000-8000-000000000001';
  result jsonb; state jsonb; public_result jsonb; analytics jsonb;
  celebrity_template jsonb; benefit_template jsonb;
  benefits_json jsonb;
  debit_count integer; before_balance bigint; after_balance bigint; insufficient_balance bigint;
begin
  insert into public.app_users(id,privy_user_id,verified_email,status) values
    (actor,'did:privy:creator-raffle-admin','creator-raffle-admin@example.test','active'),
    (unverified,'did:privy:creator-raffle-unverified','creator-raffle-unverified@example.test','active'),
    (wrong_verified,'did:privy:creator-raffle-wrong','creator-raffle-wrong@example.test','active'),
    (verified,'did:privy:creator-raffle-verified','creator-raffle-verified@example.test','active'),
    (insufficient,'did:privy:creator-raffle-empty','creator-raffle-empty@example.test','active'),
    (legacy_fan,'did:privy:creator-raffle-legacy','creator-raffle-legacy@example.test','active');
  insert into public.admin_allowlist(id,email,role,active)
    values(allowlist,'creator-raffle-admin@example.test','admin',true);

  select to_jsonb(c) into celebrity_template from public.celebrities c limit 1;
  if celebrity_template is null then raise exception 'celebrity template required'; end if;
  insert into public.celebrities
  select * from jsonb_populate_record(null::public.celebrities,celebrity_template||jsonb_build_object(
    'id',creator,'slug','creator-raffle-owner','status','published','published_at',clock_timestamp(),
    'archived_at',null,'archive_reason',null,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  insert into public.celebrities
  select * from jsonb_populate_record(null::public.celebrities,celebrity_template||jsonb_build_object(
    'id',other_creator,'slug','creator-raffle-other','status','published','published_at',clock_timestamp(),
    'archived_at',null,'archive_reason',null,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));

  select to_jsonb(b) into benefit_template from public.benefits b limit 1;
  if benefit_template is null then raise exception 'benefit template required'; end if;
  insert into public.benefits
  select * from jsonb_populate_record(null::public.benefits,benefit_template||jsonb_build_object(
    'id',benefit1,'slug','creator-raffle-ticket-one','celebrity_id',creator,
    'publication_status','published','published_at',clock_timestamp(),'archived_at',null,
    'claim_opens_at','2026-09-01T00:00:00Z','claim_closes_at','2027-01-01T00:00:00Z'));
  insert into public.benefits
  select * from jsonb_populate_record(null::public.benefits,benefit_template||jsonb_build_object(
    'id',benefit2,'slug','creator-raffle-ticket-two','celebrity_id',creator,
    'allocation_mode','application_selection',
    'publication_status','published','published_at',clock_timestamp(),'archived_at',null,
    'claim_opens_at','2026-09-01T00:00:00Z','claim_closes_at','2027-01-01T00:00:00Z'));
  insert into public.benefits
  select * from jsonb_populate_record(null::public.benefits,benefit_template||jsonb_build_object(
    'id',wrong_benefit,'slug','creator-raffle-wrong-owner','celebrity_id',other_creator,
    'publication_status','published','published_at',clock_timestamp(),'archived_at',null,
    'claim_opens_at','2026-09-01T00:00:00Z','claim_closes_at','2027-01-01T00:00:00Z'));
  insert into public.benefit_localizations(benefit_id,locale,title,summary,eligibility_label,delivery_label) values
    (benefit1,'ko','Creator ticket one','summary','verified fan','shipping'),
    (benefit1,'en','Creator ticket one','summary','verified fan','shipping'),
    (benefit2,'ko','Creator ticket two','summary','verified fan','digital'),
    (benefit2,'en','Creator ticket two','summary','verified fan','digital'),
    (wrong_benefit,'ko','Wrong owner','summary','verified fan','digital'),
    (wrong_benefit,'en','Wrong owner','summary','verified fan','digital');

  perform pg_temp.expect_error(format(
    'insert into public.live_benefit_campaigns(live_event_id,celebrity_id,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id) values(null,null,now(),now()+interval ''1 day'',%L,%L)',actor,allowlist),
    'live_benefit_campaign_source_xor');
  perform pg_temp.expect_error(format(
    'select public.save_admin_creator_benefit_campaign(%L,%L,gen_random_uuid(),null,null,%L,now()-interval ''1 hour'',now()+interval ''1 day'',%L::jsonb,false)',
    actor,allowlist,creator,jsonb_build_array(jsonb_build_object('benefitId',wrong_benefit,'priority',1))),
    'invalid campaign benefit constraint');
  perform pg_temp.expect_error(format(
    'select public.save_admin_creator_benefit_campaign(%L,%L,gen_random_uuid(),null,null,%L,now()-interval ''1 hour'',now()+interval ''1 day'',%L::jsonb,false)',
    unverified,allowlist,creator,jsonb_build_array(jsonb_build_object('benefitId',benefit1,'priority',1))),
    'active admin required');

  benefits_json:=jsonb_build_array(
    jsonb_build_object('benefitId',benefit1,'priority',1,'perFanTicketLimit',10,
      'winnerQuantity',10,'fulfillmentMethod','physical_shipping','teaserImageUrl','/raffle-one.webp'),
    jsonb_build_object('benefitId',benefit2,'priority',2,'perFanTicketLimit',10,
      'winnerQuantity',10,'fulfillmentMethod','digital','teaserImageUrl','/raffle-two.webp'));
  campaign:=public.save_admin_creator_benefit_campaign(
    actor,allowlist,gen_random_uuid(),null,null,creator,
    now()-interval '1 hour',now()+interval '1 day',benefits_json,false);
  select id into item1 from public.live_benefit_campaign_items where campaign_id=campaign and benefit_id=benefit1;
  select id into item2 from public.live_benefit_campaign_items where campaign_id=campaign and benefit_id=benefit2;
  perform pg_temp.expect_error(format(
    'insert into public.live_benefit_campaign_items(campaign_id,benefit_id,priority,winner_quantity,fulfillment_method) values(%L,%L,3,1,''digital'')',
    campaign,wrong_benefit),'BENEFIT_CAMPAIGN_OWNER_MISMATCH');
  perform pg_temp.expect_error(format(
    'update public.benefits set celebrity_id=%L where id=%L',other_creator,benefit1),
    'BENEFIT_CAMPAIGN_OWNER_MISMATCH');
  perform pg_temp.expect_error(format(
    'update public.live_benefit_campaigns set celebrity_id=%L where id=%L',other_creator,campaign),
    'CREATOR_RAFFLE_OWNER_IMMUTABLE');
  perform pg_temp.expect_error(format(
    'select public.save_admin_creator_benefit_campaign(%L,%L,gen_random_uuid(),%L,null,%L,now()-interval ''1 hour'',now()+interval ''1 day'',%L::jsonb,false)',
    actor,allowlist,campaign,creator,benefits_json),'benefit campaign revision conflict');

  perform public.configure_admin_raffle_fulfillment_policy(actor,allowlist,gen_random_uuid(),campaign,benefit1,1,
    jsonb_build_object('version','physical-v1','method','physical_shipping','shippingCountry','KR',
      'requiresShippingAcknowledgment',true,'recipientWindowDays',7,'pickupEndsOn',null,
      'pickupVenue',jsonb_build_object('ko','','en',''),'pickupInstructions',jsonb_build_object('ko','','en','')));
  perform public.configure_admin_raffle_fulfillment_policy(actor,allowlist,gen_random_uuid(),campaign,benefit2,2,
    jsonb_build_object('version','digital-v1','method','digital','shippingCountry',null,
      'requiresShippingAcknowledgment',false,'recipientWindowDays',7,'pickupEndsOn',null,
      'pickupVenue',jsonb_build_object('ko','','en',''),'pickupInstructions',jsonb_build_object('ko','','en','')));
  select revision into campaign_revision from public.live_benefit_campaigns where id=campaign;
  perform pg_temp.expect_error(format(
    'select public.save_admin_creator_benefit_campaign(%L,%L,gen_random_uuid(),%L,%s,%L,now()-interval ''1 hour'',now()+interval ''1 day'',%L::jsonb,false)',
    actor,allowlist,campaign,campaign_revision,creator,
    jsonb_build_array(jsonb_build_object('benefitId',benefit2,'priority',1,'winnerQuantity',10,'fulfillmentMethod','digital'))),
    'RAFFLE_POLICY_BOUND_ITEM_REMOVAL_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.save_admin_creator_benefit_campaign(%L,%L,gen_random_uuid(),%L,%s,%L,now()-interval ''1 hour'',now()+interval ''1 day'',%L::jsonb,false)',
    actor,allowlist,campaign,campaign_revision,creator,
    jsonb_build_array(
      jsonb_build_object('benefitId',benefit1,'priority',1,'winnerQuantity',10,'fulfillmentMethod','digital'),
      jsonb_build_object('benefitId',benefit2,'priority',2,'winnerQuantity',10,'fulfillmentMethod','digital'))),
    'RAFFLE_POLICY_BOUND_METHOD_MISMATCH');

  benefits_json:=jsonb_build_array(
    jsonb_build_object('benefitId',benefit1,'priority',2,'perFanTicketLimit',10,
      'winnerQuantity',10,'fulfillmentMethod','physical_shipping','teaserImageUrl','/raffle-one.webp'),
    jsonb_build_object('benefitId',benefit2,'priority',1,'perFanTicketLimit',10,
      'winnerQuantity',10,'fulfillmentMethod','digital','teaserImageUrl','/raffle-two.webp'));
  perform public.save_admin_creator_benefit_campaign(actor,allowlist,gen_random_uuid(),campaign,campaign_revision,creator,
    now()-interval '2 hours',now()+interval '2 days',benefits_json,false);
  if (select id from public.live_benefit_campaign_items where campaign_id=campaign and benefit_id=benefit1) is distinct from item1
    or (select id from public.live_benefit_campaign_items where campaign_id=campaign and benefit_id=benefit2) is distinct from item2
    or (select active_fulfillment_policy_version from public.live_benefit_campaign_items where id=item1) is distinct from 'physical-v1' then
    raise exception 'UPSERT did not preserve item IDs or active policy';
  end if;
  select revision into campaign_revision from public.live_benefit_campaigns where id=campaign;
  perform public.publish_admin_benefit_campaign(actor,allowlist,gen_random_uuid(),campaign,campaign_revision);

  public_result:=public.get_public_raffles('creator-raffle-owner','ko',now());
  if jsonb_array_length(public_result->'raffles')<>2
    or not coalesce((public_result#>>'{raffles,0,requiresFanVerification}')::boolean,false) then
    raise exception 'standalone public raffle projection invalid: %',public_result;
  end if;
  state:=public.get_owned_benefit_entry_state(unverified,benefit1);
  if state->>'requiresFanVerification'<>'true' or state->>'fanVerified'<>'false' or state->>'canEnter'<>'false' then
    raise exception 'unverified owner state invalid: %',state;
  end if;

  perform public.post_fan_ticket_entry(unverified,creator,'credit',5,'creator_raffle_test',gen_random_uuid(),gen_random_uuid(),2,null,null);
  before_balance:=public.get_fan_ticket_balance(unverified,creator);
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''physical-v1'',true,now())',unverified,benefit1),
    'eligible fan passport is required');
  if public.get_fan_ticket_balance(unverified,creator)<>before_balance then raise exception 'unverified gate debited tickets'; end if;

  insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at) values
    (quiz1,other_creator,1,'published',now()),(quiz2,creator,1,'published',now());
  insert into public.quiz_attempts(id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
    (attempt1,wrong_verified,other_creator,quiz1,1,gen_random_uuid(),'passed',3,now()),
    (attempt2,verified,creator,quiz2,1,gen_random_uuid(),'passed',3,now()),
    (attempt3,insufficient,creator,quiz2,1,gen_random_uuid(),'passed',3,now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
    (pass1,wrong_verified,other_creator,attempt1),(pass2,verified,creator,attempt2),
    (pass3,insufficient,creator,attempt3);
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
    (wrong_verified,91342,'0xd300000000000000000000000000000000000002','privy','embedded'),
    (verified,91342,'0xd300000000000000000000000000000000000003','privy','embedded'),
    (insufficient,91342,'0xd300000000000000000000000000000000000004','privy','embedded');
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values
    (other_job,'passport',other_passport,'byus:passport:v1:'||wrong_verified||':creator-raffle-other',1,
      jsonb_build_object('recipient','0xd300000000000000000000000000000000000002','celebritySlug','creator-raffle-other','passportId','0x'||repeat('1',64))),
    (verified_job,'passport',verified_passport,'byus:passport:v1:'||verified||':creator-raffle-owner',1,
      jsonb_build_object('recipient','0xd300000000000000000000000000000000000003','celebritySlug','creator-raffle-owner','passportId','0x'||repeat('2',64))),
    (insufficient_job,'passport',insufficient_passport,'byus:passport:v1:'||insufficient||':creator-raffle-owner',1,
      jsonb_build_object('recipient','0xd300000000000000000000000000000000000004','celebritySlug','creator-raffle-owner','passportId','0x'||repeat('3',64)));
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id,business_status,mint_status,blockchain_job_id) values
    (other_passport,wrong_verified,other_creator,pass1,'issued','queued',other_job),
    (verified_passport,verified,creator,pass2,'issued','queued',verified_job),
    (insufficient_passport,insufficient,creator,pass3,'issued','queued',insufficient_job);
  before_balance:=public.get_fan_ticket_balance(verified,creator);
  perform pg_temp.expect_error(format(
    'select public.submit_benefit_application(%L,%L,gen_random_uuid(),now())',benefit2,verified),
    'CREATOR_RAFFLE_LEGACY_ROUTE_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.claim_benefit(%L,%L,gen_random_uuid(),now())',benefit1,verified),
    'CREATOR_RAFFLE_LEGACY_ROUTE_FORBIDDEN');
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit(%L,%L,gen_random_uuid(),1,now())',verified,benefit1),
    'RAFFLE_POLICY_ACK_REQUIRED');
  if exists(select 1 from public.benefit_applications where benefit_id=benefit2 and app_user_id=verified)
    or exists(select 1 from public.benefit_claims where benefit_id=benefit1 and app_user_id=verified)
    or public.get_fan_ticket_balance(verified,creator)<>before_balance then
    raise exception 'legacy route guard mutated standalone raffle state';
  end if;
  perform public.post_fan_ticket_entry(wrong_verified,creator,'credit',5,'creator_raffle_test',gen_random_uuid(),gen_random_uuid(),2,null,null);
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''physical-v1'',true,now())',wrong_verified,benefit1),
    'eligible fan passport is required');

  perform public.post_fan_ticket_entry(verified,creator,'credit',3,'quiz_verification_reward',pass2,gen_random_uuid(),2,null,null);
  before_balance:=public.get_fan_ticket_balance(verified,creator);
  result:=public.enter_owned_benefit_v2(verified,benefit1,key1,1,'physical-v1',true,now());
  if result->>'replayed'<>'false' or (result->>'resultingBalance')::bigint<>before_balance-1 then
    raise exception 'verified fan entry invalid: %',result;
  end if;
  after_balance:=public.get_fan_ticket_balance(verified,creator);
  result:=public.enter_owned_benefit_v2(verified,benefit1,key1,1,'physical-v1',true,now());
  if result->>'replayed'<>'true' or public.get_fan_ticket_balance(verified,creator)<>after_balance then
    raise exception 'entry replay debited or was not replayed';
  end if;
  select count(*) into debit_count from public.fan_ticket_ledger
    where app_user_id=verified and celebrity_id=creator and entry_kind='debit';
  if debit_count<>1 then raise exception 'verification ticket grant did not yield exactly one entry debit'; end if;
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''stale'',true,now())',verified,benefit1),
    'RAFFLE_POLICY_ACK_REQUIRED');
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),99,''physical-v1'',true,now())',verified,benefit1),
    'PHASE4_BENEFIT_ENTRY_LIMIT_REACHED');
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''physical-v1'',true,now()+interval ''3 days'')',verified,benefit1),
    'PHASE4_BENEFIT_ENTRY_WINDOW_CLOSED');
  insufficient_balance:=public.get_fan_ticket_balance(insufficient,creator);
  if insufficient_balance>0 then
    perform public.post_fan_ticket_entry(insufficient,creator,'debit',-insufficient_balance,
      'creator_raffle_test_drain',gen_random_uuid(),gen_random_uuid(),2,null,null);
  end if;
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''physical-v1'',true,now())',insufficient,benefit1),
    'PHASE1_TICKET_NEGATIVE_BALANCE');

  if not exists(select 1 from public.fan_product_events e where e.event_name='benefit_entered'
    and e.app_user_id=verified and e.celebrity_id=creator and e.live_event_id is null and e.benefit_id=benefit1) then
    raise exception 'standalone committed event lost creator attribution';
  end if;
  analytics:=public.read_admin_platform_analytics(
    actor,allowlist,now()-interval '1 day',clock_timestamp(),clock_timestamp()+interval '1 second');
  if not exists(select 1 from jsonb_array_elements(analytics#>'{creators,value}') x
    where (x->>'celebrityId')::uuid=creator) then
    raise exception 'standalone entry missing from active creator analytics';
  end if;
  if exists(select 1 from public.telegram_alert_outbox o where o.source_id=campaign) then
    raise exception 'standalone raffle unexpectedly activated Telegram alert';
  end if;

  select revision into campaign_revision from public.live_benefit_campaigns where id=campaign;
  perform public.cancel_admin_benefit_campaign(actor,allowlist,gen_random_uuid(),campaign,campaign_revision,
    'Creator raffle cancellation regression',now());
  result:=public.enter_owned_benefit_v2(verified,benefit1,key1,1,'physical-v1',true,now());
  if result->>'replayed'<>'true' then raise exception 'cancelled campaign broke idempotent replay'; end if;
  perform pg_temp.expect_error(format(
    'select public.enter_owned_benefit_v2(%L,%L,gen_random_uuid(),1,''physical-v1'',true,now())',verified,benefit1),
    'PHASE4_BENEFIT_ENTRY_UNAVAILABLE');

  select e.id,e.celebrity_id into legacy_live,legacy_creator from public.live_events e
    join public.celebrities c on c.id=e.celebrity_id
    where e.publication_status='published' and e.archived_at is null
      and c.status='published' and c.archived_at is null limit 1;
  if legacy_live is null then raise exception 'published LIVE fixture required'; end if;
  insert into public.benefits
  select * from jsonb_populate_record(null::public.benefits,benefit_template||jsonb_build_object(
    'id',legacy_benefit,'slug','creator-raffle-legacy-live','celebrity_id',legacy_creator,
    'allocation_mode','application_selection',
    'publication_status','published','published_at',clock_timestamp(),'archived_at',null,
    'claim_opens_at','2026-09-01T00:00:00Z','claim_closes_at','2027-01-01T00:00:00Z'));
  insert into public.benefit_localizations(benefit_id,locale,title,summary,eligibility_label,delivery_label) values
    (legacy_benefit,'ko','Legacy LIVE raffle','summary','LIVE fan','digital'),
    (legacy_benefit,'en','Legacy LIVE raffle','summary','LIVE fan','digital');
  insert into public.live_benefit_campaigns(
    id,live_event_id,celebrity_id,status,entry_opens_at,entry_closes_at,actor_app_user_id,
    actor_admin_allowlist_id,published_at
  ) values(legacy_campaign,legacy_live,null,'published',now()-interval '1 hour',now()+interval '1 day',
    actor,allowlist,now());
  insert into public.live_benefit_campaign_items(
    campaign_id,benefit_id,priority,per_fan_ticket_limit,winner_quantity,fulfillment_method
  ) values(legacy_campaign,legacy_benefit,1,10,1,'digital');
  perform public.post_fan_ticket_entry(legacy_fan,legacy_creator,'credit',2,'legacy_raffle_test',
    gen_random_uuid(),gen_random_uuid(),2,null,null);
  result:=public.enter_owned_benefit(legacy_fan,legacy_benefit,gen_random_uuid(),1,now());
  if result->>'replayed'<>'false' then raise exception 'legacy LIVE entry behavior changed'; end if;
  perform pg_temp.expect_error(format(
    'select public.submit_benefit_application(%L,%L,gen_random_uuid(),now())',legacy_benefit,legacy_fan),
    'eligible fan passport required');
  perform pg_temp.expect_error(format(
    'select public.claim_benefit(%L,%L,gen_random_uuid(),now())',legacy_benefit,legacy_fan),
    'eligible fan passport is required');
  public_result:=public.get_public_raffles(
    (select slug from public.celebrities where id=legacy_creator),'ko',now());
  if not exists(select 1 from jsonb_array_elements(public_result->'raffles') x
    where (x->>'benefitId')::uuid=legacy_benefit and x->>'requiresFanVerification'='false') then
    raise exception 'legacy LIVE public filter/projection changed';
  end if;

  if has_function_privilege('service_role','public.enter_owned_benefit_v2_before_creator_fan_gate(uuid,uuid,uuid,integer,text,boolean,timestamptz)','execute')
    or has_function_privilege('service_role','public.submit_benefit_application_before_creator_raffle_gate(uuid,uuid,uuid,timestamptz)','execute')
    or has_function_privilege('service_role','public.claim_benefit_before_creator_raffle_gate(uuid,uuid,uuid,timestamptz)','execute')
    or has_function_privilege('anon','public.save_admin_creator_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean)','execute')
    or not has_function_privilege('service_role','public.save_admin_creator_benefit_campaign(uuid,uuid,uuid,uuid,integer,uuid,timestamptz,timestamptz,jsonb,boolean)','execute') then
    raise exception 'creator raffle function privilege boundary invalid';
  end if;
  if position('FOR SHARE' in upper(pg_get_functiondef(
      'public.enforce_benefit_campaign_item_owner()'::regprocedure)))=0 then
    raise exception 'campaign item owner check is missing FK-compatible row locks';
  end if;
end;
$$;

rollback;
