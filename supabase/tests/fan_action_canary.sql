-- Run only through scripts/verify-clean-migration-chain.sh against a disposable database.
begin;

create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAN_ACTION_CANARY_TEST: %', message;
  end if;
end;
$$;

create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
declare
  caught boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'Unexpected error %, wanted %', sqlerrm, expected;
    end if;
    caught := true;
  end;
  if not caught then
    raise exception 'Expected error was not raised: %', expected;
  end if;
end;
$$;

do $$
declare
  creator uuid := 'fac10000-0000-4000-8000-000000000001';
  unlisted_creator uuid := 'fac10000-0000-4000-8000-000000000009';
  bad_binding_creator uuid := 'fac10000-0000-4000-8000-000000000015';
  selected_actor uuid := 'fac10000-0000-4000-8000-000000000002';
  other_actor uuid := 'fac10000-0000-4000-8000-000000000003';
  binding uuid := 'fac10000-0000-4000-8000-000000000004';
  bad_binding uuid := 'fac10000-0000-4000-8000-000000000014';
  selected_reaction uuid := 'fac10000-0000-4000-8000-000000000005';
  selected_job uuid := 'fac10000-0000-4000-8000-000000000006';
  other_reaction uuid := 'fac10000-0000-4000-8000-000000000007';
  other_job uuid := 'fac10000-0000-4000-8000-000000000008';
  unlisted_reaction uuid := 'fac10000-0000-4000-8000-000000000010';
  unlisted_job uuid := 'fac10000-0000-4000-8000-000000000011';
  invalid_binding_reaction uuid := 'fac10000-0000-4000-8000-000000000012';
  invalid_binding_job uuid := 'fac10000-0000-4000-8000-000000000013';
  campaign uuid;
  campaign_creator uuid;
  campaign_creator_slug text;
  issuance text := '0x' || repeat('a', 64);
begin
  insert into public.celebrities(id, slug, status, image_url, published_at, roles, primary_role) values
    (creator, 'fan-action-canary', 'published', '/fan-action-canary.webp', now(), '{artist}', 'idol'),
    (unlisted_creator, 'fan-action-unlisted', 'published', '/fan-action-unlisted.webp', now(), '{artist}', 'idol'),
    (bad_binding_creator, 'fan-action-bad-binding', 'published', '/fan-action-bad-binding.webp', now(), '{artist}', 'idol');
  insert into public.app_users(id, privy_user_id, verified_email, status) values
    (selected_actor, 'did:privy:fan-action-canary-selected', 'fan-action-canary-selected@byus.test', 'active'),
    (other_actor, 'did:privy:fan-action-canary-other', 'fan-action-canary-other@byus.test', 'active');
  select live.id, live.celebrity_id, celebrity.slug
    into strict campaign, campaign_creator, campaign_creator_slug
  from public.live_events live
  join public.celebrities celebrity on celebrity.id = live.celebrity_id
  where live.publication_status = 'published'
  order by live.id
  limit 1;
  insert into public.user_wallets(app_user_id, chain_id, address, provider, wallet_type) values
    (selected_actor, 91342, '0xc100000000000000000000000000000000000002', 'privy', 'embedded'),
    (other_actor, 91342, '0xc100000000000000000000000000000000000003', 'privy', 'embedded');
  insert into public.fan_action_bindings(
    id, chain_id, environment_id, hub_proxy, relayer, schema_uid, schema_version,
    binding_version, asset_base_uri, assets
  ) values (
    binding, 91342, '0x' || repeat('1', 64), '0x' || repeat('2', 40),
    '0x' || repeat('3', 40), '0x' || repeat('4', 64), 1, 1,
    'ipfs://bafybeicanary', jsonb_build_object(
      '0', '0xc100000000000000000000000000000000000010',
      '1', '0xc100000000000000000000000000000000000011',
      '2', '0xc100000000000000000000000000000000000012'
    )
  );
  insert into public.fan_action_bindings(
    id, chain_id, environment_id, hub_proxy, relayer, schema_uid, schema_version,
    binding_version, asset_base_uri, assets
  ) values (
    bad_binding, 91342, '0x' || repeat('1', 64), '0x' || repeat('6', 40),
    '0x' || repeat('3', 40), '0x' || repeat('4', 64), 1, 1,
    'ipfs://bafybeicanarybadbinding', jsonb_build_object(
      '0', '0xc100000000000000000000000000000000000010',
      '2', '0xc100000000000000000000000000000000000012'
    )
  );
  insert into public.fan_action_producer_routes(action_code, binding_id, enabled, policy_version, enabled_at) values
    (2, binding, true, 1, now()),
    (6, binding, true, 1, now()),
    (7, binding, true, 1, now()),
    (9, binding, true, 1, now());
  perform pg_temp.assert(not exists(select 1 from public.fan_action_verified_creators),
    'creator verification table was not empty by default');
  perform pg_temp.expect_error(
    format('insert into public.fan_action_verified_creators values(%L,%L,0,%L,now())',
      binding, creator, '0x' || repeat('5', 64)),
    'fan_action_verified_creators_verified_block_number_check'
  );
  perform pg_temp.expect_error(
    format('insert into public.fan_action_verified_creators values(%L,%L,123456,%L,now())',
      binding, creator, '0x1234'),
    'fan_action_verified_creators_verified_block_hash_check'
  );
  insert into public.fan_action_verified_creators(
    binding_id, creator_id, verified_block_number, verified_block_hash, verified_at
  ) values
    (binding, creator, 123456, '0x' || repeat('5', 64), now()),
    (bad_binding, bad_binding_creator, 123456, '0x' || repeat('5', 64), now());
  insert into public.fan_action_verified_creators(
    binding_id, creator_id, verified_block_number, verified_block_hash, verified_at
  ) values
    (binding, campaign_creator, 123456, '0x' || repeat('5', 64), now()),
    (bad_binding, campaign_creator, 123456, '0x' || repeat('5', 64), now())
  on conflict (binding_id, creator_id) do nothing;

  perform pg_temp.assert(not exists(select 1 from public.fan_action_verified_campaigns),
    'campaign verification table was not empty by default');
  perform pg_temp.expect_error(
    format('insert into public.fan_action_verified_campaigns values(%L,%L,%L,0,%L,now())',
      binding, campaign, campaign_creator, '0x' || repeat('5', 64)),
    'fan_action_verified_campaigns_verified_block_number_check'
  );
  perform pg_temp.expect_error(
    format('insert into public.fan_action_verified_campaigns values(%L,%L,%L,123456,%L,now())',
      binding, campaign, campaign_creator, '0x1234'),
    'fan_action_verified_campaigns_verified_block_hash_check'
  );
  perform pg_temp.expect_error(
    format('insert into public.fan_action_verified_campaigns values(%L,%L,%L,123456,%L,now())',
      binding, campaign, creator, '0x' || repeat('5', 64)),
    'fan_action_verified_campaigns_campaign_creator_fkey'
  );
  insert into public.fan_action_verified_campaigns(
    binding_id, campaign_id, creator_id, verified_block_number, verified_block_hash, verified_at
  ) values
    (binding, campaign, campaign_creator, 123456, '0x' || repeat('5', 64), now()),
    (bad_binding, campaign, campaign_creator, 123456, '0x' || repeat('5', 64), now());

  perform pg_temp.assert(public.configure_fan_action_canary_scope(2, array[selected_actor]) = 1,
    'service configuration did not select the LIVE actor');
  perform pg_temp.assert(public.configure_fan_action_canary_scope(6, array[selected_actor]) = 1,
    'service configuration did not select exactly one actor');
  perform pg_temp.assert(public.fan_action_native_enabled(6),
    'the original global route helper changed behavior');
  perform pg_temp.assert(public.fan_action_native_enabled(6, selected_actor),
    'selected actor was not admitted to the new lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(6, other_actor),
    'unselected actor was admitted to the new lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(6, null),
    'null actor bypassed the canary scope');
  perform pg_temp.assert(public.fan_action_native_enabled(6, selected_actor, creator),
    'selected actor and verified creator were not admitted to the new lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(6, selected_actor, unlisted_creator),
    'unlisted creator was admitted to the new lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(6, other_actor, creator),
    'unselected actor bypassed the actor canary through the creator helper');
  perform pg_temp.assert(public.fan_action_native_enabled(2, selected_actor, campaign_creator, campaign),
    'selected actor and verified campaign were not admitted to the LIVE lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(2, other_actor, campaign_creator, campaign),
    'unselected actor bypassed the LIVE canary');
  perform pg_temp.assert(not public.fan_action_native_enabled(2, selected_actor, creator, campaign),
    'mismatched campaign creator was admitted to the LIVE lane');
  perform pg_temp.assert(not public.fan_action_native_enabled(2, selected_actor, campaign_creator,
      'fac10000-0000-4000-8000-000000000099'),
    'unregistered campaign was admitted to the LIVE lane');
  perform pg_temp.assert(public.fan_action_native_enabled(6, selected_actor, creator, null),
    'the four-argument helper did not delegate a creator-bound non-LIVE action');
  perform pg_temp.assert(public.fan_action_native_enabled(7, other_actor, null, null),
    'the four-argument helper did not delegate a global action');
  perform pg_temp.assert(public.fan_action_native_enabled(7, other_actor, null)
      and public.fan_action_native_enabled(9, other_actor, null),
    'global creator-independent routes 7 and 9 changed behavior');

  perform public.react_to_creator(selected_actor, creator, selected_reaction, selected_job, issuance);
  perform public.react_to_creator(other_actor, creator, other_reaction, other_job, issuance);
  perform public.react_to_creator(selected_actor, unlisted_creator, unlisted_reaction, unlisted_job, issuance);
  perform pg_temp.assert(exists(
      select 1 from public.fan_reactions
      where id = selected_reaction and blockchain_job_id is null and fan_action_outbox_id is not null
    ), 'selected actor did not use the new lane');
  perform pg_temp.assert(exists(
      select 1 from public.fan_reactions
      where id = other_reaction and blockchain_job_id = other_job and fan_action_outbox_id is null
    ), 'unselected actor did not remain on the legacy lane');
  perform pg_temp.assert(exists(
      select 1 from public.fan_reactions
      where id = unlisted_reaction and blockchain_job_id = unlisted_job and fan_action_outbox_id is null
    ), 'unlisted creator did not remain on the legacy lane');
  perform pg_temp.assert(not exists(select 1 from public.blockchain_jobs where id = selected_job),
    'selected actor also received a legacy reward job');
  perform pg_temp.assert((select count(*) from public.fan_action_credentials credential
      join public.fan_action_outbox outbox on outbox.id = credential.outbox_id
      join public.fan_action_occurrences occurrence on occurrence.id = outbox.occurrence_row_id
      where occurrence.app_user_id in (selected_actor, other_actor)) = 1,
    'canary routing duplicated or omitted reward credentials');

  -- Replaying either public producer request must not create another reward record.
  perform public.react_to_creator(selected_actor, creator, selected_reaction, selected_job, issuance);
  perform public.react_to_creator(other_actor, creator, other_reaction, other_job, issuance);
  perform public.react_to_creator(selected_actor, unlisted_creator, unlisted_reaction, unlisted_job, issuance);
  perform pg_temp.assert((select count(*) from public.fan_reactions where app_user_id in (selected_actor, other_actor)) = 3
      and (select count(*) from public.blockchain_jobs where id in (selected_job, other_job, unlisted_job)) = 2
      and (select count(*) from public.fan_action_occurrences where app_user_id in (selected_actor, other_actor)) = 1,
    'producer replay duplicated a business or reward record');

  update public.fan_action_producer_routes set binding_id = bad_binding where action_code = 6;
  perform pg_temp.expect_error(
    format('select public.react_to_creator(%L,%L,%L,%L,%L)', selected_actor, bad_binding_creator,
      invalid_binding_reaction, invalid_binding_job, issuance),
    'FAN_ACTION_BINDING_ASSET_INVALID'
  );
  update public.fan_action_producer_routes set binding_id = binding where action_code = 6;

  perform pg_temp.expect_error(
    'select public.configure_fan_action_canary_scope(6, array[null::uuid])',
    'FAN_ACTION_CANARY_ACTOR_REQUIRED'
  );
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.fan_action_canary_scope', 'select')
      and not has_table_privilege('authenticated', 'public.fan_action_canary_scope', 'insert')
      and not has_table_privilege('service_role', 'public.fan_action_canary_scope', 'insert')
      and not has_table_privilege('anon', 'public.fan_action_verified_creators', 'select')
      and not has_table_privilege('authenticated', 'public.fan_action_verified_creators', 'insert')
      and not has_table_privilege('service_role', 'public.fan_action_verified_creators', 'insert'),
    'canary table permits a direct read or write');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.fan_action_verified_campaigns', 'select')
      and not has_table_privilege('authenticated', 'public.fan_action_verified_campaigns', 'insert')
      and not has_table_privilege('service_role', 'public.fan_action_verified_campaigns', 'insert'),
    'campaign verification table permits a direct read or write');
  perform pg_temp.assert(not has_function_privilege('authenticated',
      'public.configure_fan_action_canary_scope(integer,uuid[])', 'execute')
      and not has_function_privilege('authenticated',
        'public.fan_action_native_enabled(integer,uuid)', 'execute')
      and not has_function_privilege('anon',
        'public.fan_action_native_enabled(integer,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated',
        'public.fan_action_native_enabled(integer,uuid,uuid)', 'execute')
      and not has_function_privilege('service_role',
        'public.fan_action_native_enabled(integer,uuid,uuid)', 'execute')
      and not has_function_privilege('anon',
        'public.fan_action_native_enabled(integer,uuid,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated',
        'public.fan_action_native_enabled(integer,uuid,uuid,uuid)', 'execute')
      and not has_function_privilege('service_role',
        'public.fan_action_native_enabled(integer,uuid,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated',
        'public.react_to_creator(uuid,uuid,uuid,uuid,text)', 'execute')
      and has_function_privilege('service_role',
        'public.configure_fan_action_canary_scope(integer,uuid[])', 'execute'),
    'an authenticated caller can spoof canary configuration or actor routing');

  perform pg_temp.assert(public.configure_fan_action_canary_scope(6, array[]::uuid[]) = 0
      and public.fan_action_native_enabled(6, other_actor)
      and public.fan_action_native_enabled(6, other_actor, creator)
      and not public.fan_action_native_enabled(6, other_actor, unlisted_creator),
    'clearing the canary scope did not restore global enabled behavior');
  perform pg_temp.assert(public.configure_fan_action_canary_scope(2, array[]::uuid[]) = 0
      and public.fan_action_native_enabled(2, other_actor, campaign_creator, campaign),
    'clearing the LIVE canary scope did not restore verified campaign behavior');
  update public.fan_action_producer_routes set binding_id = bad_binding where action_code = 2;
  perform pg_temp.assert(public.fan_action_native_enabled(2, selected_actor, campaign_creator, campaign),
    'verified campaign did not follow the route binding');
  perform pg_temp.expect_error(
    format('select public.enqueue_fan_action_source(%L,%L,%L,%L,%L,now(),2,%L::jsonb)',
      'campaign_binding_test', campaign::text, selected_actor, campaign_creator, campaign,
      jsonb_build_array(jsonb_build_object(
        'entityType','stamp','entityId',extensions.gen_random_uuid(),'kind',1,
        'issuanceKey','0x'||repeat('6',64),'operationKey','byus:test:campaign-binding',
        'legacyPayload',jsonb_build_object(
          'recipient','0xc100000000000000000000000000000000000002',
          'celebritySlug',campaign_creator_slug,'issuanceId','0x'||repeat('6',64),
          'stampType','Reservation')))),
    'FAN_ACTION_BINDING_ASSET_INVALID'
  );
  update public.fan_action_producer_routes set binding_id = binding where action_code = 2;
  update public.fan_action_producer_routes set enabled = false, enabled_at = null where action_code = 6;
  perform pg_temp.assert(not public.fan_action_native_enabled(6, selected_actor)
      and not public.fan_action_native_enabled(6, other_actor)
      and not public.fan_action_native_enabled(6, selected_actor, creator),
    'disabled route admitted an actor');
end;
$$;

rollback;

-- Reproduce the producer/configuration lock interleave with two real database
-- sessions. The producer owns the actor row before either session requests the
-- route; configuration must wait on the actor instead of creating a lock cycle.
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAN_ACTION_CANARY_CONCURRENCY_TEST: %', message;
  end if;
end;
$$;
create extension dblink with schema extensions;

begin;
insert into public.celebrities(id, slug, status, image_url, published_at, roles, primary_role)
values('fac20000-0000-4000-8000-000000000001', 'fan-action-canary-lock', 'published',
  '/fan-action-canary-lock.webp', now(), '{artist}', 'idol');
insert into public.celebrity_localizations(celebrity_id, locale, name, summary, image_alt) values
  ('fac20000-0000-4000-8000-000000000001', 'ko', '카나리 경합', '카나리 경합', '카나리 경합'),
  ('fac20000-0000-4000-8000-000000000001', 'en', 'Canary contention', 'Canary contention', 'Canary contention');
insert into public.app_users(id, privy_user_id, verified_email, status)
values('fac20000-0000-4000-8000-000000000002', 'did:privy:fan-action-canary-lock',
  'fan-action-canary-lock@byus.test', 'active');
insert into public.user_wallets(app_user_id, chain_id, address, provider, wallet_type)
values('fac20000-0000-4000-8000-000000000002', 91342,
  '0xc200000000000000000000000000000000000002', 'privy', 'embedded');
insert into public.fan_action_bindings(
  id, chain_id, environment_id, hub_proxy, relayer, schema_uid, schema_version,
  binding_version, asset_base_uri, assets
) values (
  'fac20000-0000-4000-8000-000000000003', 91342, '0x' || repeat('1', 64),
  '0x' || repeat('2', 40), '0x' || repeat('3', 40), '0x' || repeat('4', 64),
  1, 1, 'ipfs://bafybeicanarylock', jsonb_build_object(
    '0', '0xc200000000000000000000000000000000000010',
    '1', '0xc200000000000000000000000000000000000011',
    '2', '0xc200000000000000000000000000000000000012'
  )
);
insert into public.fan_action_producer_routes(action_code, binding_id, enabled, policy_version, enabled_at)
values(6, 'fac20000-0000-4000-8000-000000000003', true, 1, now());
insert into public.fan_action_verified_creators(
  binding_id, creator_id, verified_block_number, verified_block_hash, verified_at
) values(
  'fac20000-0000-4000-8000-000000000003',
  'fac20000-0000-4000-8000-000000000001',
  123457,
  '0x' || repeat('5', 64),
  now()
);
commit;

do $$
declare
  connection_string text := format(
    'host=%s port=%s dbname=%s user=%s',
    current_setting('unix_socket_directories'), current_setting('port'), current_database(), current_user
  );
  producer_result jsonb;
  configured integer;
begin
  perform extensions.dblink_connect('canary_producer', connection_string);
  perform extensions.dblink_connect('canary_config', connection_string);
  perform extensions.dblink_exec('canary_producer', 'begin');
  perform actor.id
  from extensions.dblink(
    'canary_producer',
    'select id from public.app_users where id=''fac20000-0000-4000-8000-000000000002''::uuid for update'
  ) as actor(id uuid);

  perform extensions.dblink_send_query(
    'canary_config',
    'select public.configure_fan_action_canary_scope(6,array[''fac20000-0000-4000-8000-000000000002''::uuid])'
  );
  perform pg_sleep(0.2);
  perform pg_temp.assert(extensions.dblink_is_busy('canary_config') = 1,
    'configuration did not wait behind the producer actor lock');

  select result into producer_result
  from extensions.dblink(
    'canary_producer',
    'select public.react_to_creator(
      ''fac20000-0000-4000-8000-000000000002''::uuid,
      ''fac20000-0000-4000-8000-000000000001''::uuid,
      ''fac20000-0000-4000-8000-000000000004''::uuid,
      ''fac20000-0000-4000-8000-000000000005''::uuid,
      ''0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa''
    )'
  ) as producer(result jsonb);
  perform extensions.dblink_exec('canary_producer', 'commit');

  select result into configured
  from extensions.dblink_get_result('canary_config') as config_result(result integer);
  perform pg_temp.assert(configured = 1 and producer_result->>'reactionId' = 'fac20000-0000-4000-8000-000000000004',
    'producer/configuration contention did not complete both operations');
  perform extensions.dblink_disconnect('canary_producer');
  perform extensions.dblink_disconnect('canary_config');
end;
$$;

select pg_temp.assert(exists(
  select 1 from public.fan_reactions
  where id = 'fac20000-0000-4000-8000-000000000004'
    and fan_action_outbox_id is not null
    and blockchain_job_id is null
), 'contended producer did not preserve the selected new lane');

drop extension dblink;
