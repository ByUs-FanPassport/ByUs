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
  selected_actor uuid := 'fac10000-0000-4000-8000-000000000002';
  other_actor uuid := 'fac10000-0000-4000-8000-000000000003';
  binding uuid := 'fac10000-0000-4000-8000-000000000004';
  selected_reaction uuid := 'fac10000-0000-4000-8000-000000000005';
  selected_job uuid := 'fac10000-0000-4000-8000-000000000006';
  other_reaction uuid := 'fac10000-0000-4000-8000-000000000007';
  other_job uuid := 'fac10000-0000-4000-8000-000000000008';
  issuance text := '0x' || repeat('a', 64);
begin
  insert into public.celebrities(id, slug, status, image_url, published_at, roles, primary_role)
  values(creator, 'fan-action-canary', 'published', '/fan-action-canary.webp', now(), '{artist}', 'idol');
  insert into public.app_users(id, privy_user_id, verified_email, status) values
    (selected_actor, 'did:privy:fan-action-canary-selected', 'fan-action-canary-selected@byus.test', 'active'),
    (other_actor, 'did:privy:fan-action-canary-other', 'fan-action-canary-other@byus.test', 'active');
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
  insert into public.fan_action_producer_routes(action_code, binding_id, enabled, policy_version, enabled_at)
  values(6, binding, true, 1, now());

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

  perform public.react_to_creator(selected_actor, creator, selected_reaction, selected_job, issuance);
  perform public.react_to_creator(other_actor, creator, other_reaction, other_job, issuance);
  perform pg_temp.assert(exists(
      select 1 from public.fan_reactions
      where id = selected_reaction and blockchain_job_id is null and fan_action_outbox_id is not null
    ), 'selected actor did not use the new lane');
  perform pg_temp.assert(exists(
      select 1 from public.fan_reactions
      where id = other_reaction and blockchain_job_id = other_job and fan_action_outbox_id is null
    ), 'unselected actor did not remain on the legacy lane');
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
  perform pg_temp.assert((select count(*) from public.fan_reactions where app_user_id in (selected_actor, other_actor)) = 2
      and (select count(*) from public.blockchain_jobs where id in (selected_job, other_job)) = 1
      and (select count(*) from public.fan_action_occurrences where app_user_id in (selected_actor, other_actor)) = 1,
    'producer replay duplicated a business or reward record');

  perform pg_temp.expect_error(
    'select public.configure_fan_action_canary_scope(6, array[null::uuid])',
    'FAN_ACTION_CANARY_ACTOR_REQUIRED'
  );
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.fan_action_canary_scope', 'select')
      and not has_table_privilege('authenticated', 'public.fan_action_canary_scope', 'insert')
      and not has_table_privilege('service_role', 'public.fan_action_canary_scope', 'insert'),
    'canary table permits a direct read or write');
  perform pg_temp.assert(not has_function_privilege('authenticated',
      'public.configure_fan_action_canary_scope(integer,uuid[])', 'execute')
      and not has_function_privilege('authenticated',
        'public.fan_action_native_enabled(integer,uuid)', 'execute')
      and not has_function_privilege('authenticated',
        'public.react_to_creator(uuid,uuid,uuid,uuid,text)', 'execute')
      and has_function_privilege('service_role',
        'public.configure_fan_action_canary_scope(integer,uuid[])', 'execute'),
    'an authenticated caller can spoof canary configuration or actor routing');

  perform pg_temp.assert(public.configure_fan_action_canary_scope(6, array[]::uuid[]) = 0
      and public.fan_action_native_enabled(6, other_actor),
    'clearing the canary scope did not restore global enabled behavior');
  update public.fan_action_producer_routes set enabled = false, enabled_at = null where action_code = 6;
  perform pg_temp.assert(not public.fan_action_native_enabled(6, selected_actor)
      and not public.fan_action_native_enabled(6, other_actor),
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
