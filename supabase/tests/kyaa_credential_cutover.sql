-- Disposable PostgreSQL only; fixtures and policy changes roll back.
begin;
update public.mint_dispatch_policy set daily_job_limit=1000000 where singleton;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'KYAA_CUTOVER: %',message; end if; end $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error: %',expected; end if;
end $$;

do $$
declare
  owner_id uuid:=extensions.gen_random_uuid(); creator uuid:=extensions.gen_random_uuid();
  old_binding uuid; new_binding uuid; old_job uuid; new_job uuid; legacy_job uuid;
  descriptor jsonb; before_snapshot jsonb; before_payload jsonb; q public.fan_action_outbox;
  happened timestamptz:=clock_timestamp(); h text:='0x'||repeat('1',64);
  h2 text:='0x'||repeat('2',64); h3 text:='0x'||repeat('3',64);
  hub text:='0x'||repeat('2',40); writer text:='0x'||repeat('3',40);
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(creator,'kyaa-cutover-test','published','/cutover.webp',now(),'{artist}','idol');
  insert into public.app_users(id,privy_user_id,verified_email,status)
    values(owner_id,'did:privy:kyaa-cutover','cutover@example.test','active');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_id,91342,'0x'||repeat('1',40),'privy','embedded');
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets)
    values(91342,h,hub,writer,h2,1,1,'ipfs://bafyfixture',jsonb_build_object('1','0x'||repeat('4',40)))
    returning id into old_binding;
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,schema_uid,
    schema_version,binding_version,asset_base_uri,assets)
    values(91342,h,hub,writer,h2,1,2,'ipfs://bafyfixture',jsonb_build_object('1','0x'||repeat('5',40)))
    returning id into new_binding;
  insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
    values(6,old_binding,true,1,clock_timestamp());
  descriptor:=jsonb_build_array(jsonb_build_object('entityType','reaction','entityId',extensions.gen_random_uuid(),
    'kind',1,'issuanceKey',h3,'operationKey','kyaa:cutover:old','legacyPayload',jsonb_build_object(
      'recipient','0x'||repeat('1',40),'celebritySlug','kyaa-cutover-test','issuanceId',h3,'reactionType','FirstReaction')));
  old_job:=public.enqueue_fan_action_source('cutover_fixture','old',owner_id,creator,null,happened,6,descriptor);
  select source_snapshot into before_snapshot from public.fan_action_outbox where id=old_job;
  update public.fan_action_producer_routes set binding_id=new_binding,policy_version=2 where action_code=6;
  perform pg_temp.assert(public.enqueue_fan_action_source('cutover_fixture','old',owner_id,creator,null,happened,6,descriptor)=old_job,
    'duplicate event must retain its original outbox');
  perform pg_temp.assert((select binding_id=old_binding and source_snapshot=before_snapshot from public.fan_action_outbox where id=old_job),
    'cutover rewrote a pending event');
  perform pg_temp.expect_error(format('select public.enqueue_fan_action_source(%L,%L,%L,%L,null,%L,6,%L::jsonb)',
    'cutover_fixture','old',owner_id,creator,happened, jsonb_set(descriptor,'{0,legacyPayload,reactionType}','"Other"')),
    'FAN_ACTION_SOURCE_CONFLICT');
  update public.fan_action_producer_routes set policy_version=1 where action_code=6;
  descriptor:=jsonb_set(jsonb_set(descriptor,'{0,entityId}',to_jsonb(extensions.gen_random_uuid())),
    '{0,operationKey}','"kyaa:cutover:new"');
  new_job:=public.enqueue_fan_action_source('cutover_fixture','new',owner_id,creator,null,happened,6,descriptor);
  perform pg_temp.assert((select binding_id=new_binding and source_snapshot->>'bindingVersion'='2'
    and source_snapshot#>>'{credentials,0,nftContract}'='0x'||repeat('5',40) from public.fan_action_outbox where id=new_job),
    'new event did not use the new contract');

  perform pg_temp.expect_error(format('select public.fan_action_native_enabled(6,%L,%L)',owner_id,creator),
    'FAN_ACTION_CONTEXT_NOT_VERIFIED');
  insert into public.fan_action_verified_creators(binding_id,creator_id,verified_block_number,verified_block_hash,verified_at)
    values(new_binding,creator,100,h,clock_timestamp());
  perform pg_temp.assert(public.fan_action_native_enabled(6,owner_id,creator),'verified creator must be admitted');
  update public.fan_action_producer_routes set enabled=false where action_code=6;
  perform pg_temp.expect_error(format('select public.fan_action_native_enabled(6,%L,%L)',owner_id,creator),
    'FAN_ACTION_ROUTE_REQUIRED');
  update public.fan_action_producer_routes set enabled=true where action_code=6;
  insert into public.fan_action_canary_scope(action_code,app_user_id) values(6,owner_id);
  perform pg_temp.expect_error('select public.fan_action_native_enabled(6,null::uuid)', 'FAN_ACTION_ROUTE_REQUIRED');
  delete from public.fan_action_canary_scope where action_code=6;

  update public.fan_action_outbox set status='PROCESSING',attempts=2,lease_owner='cutover',
    lease_expires_at=clock_timestamp()+interval '5 minutes' where id=old_job;
  update public.mint_dispatch_policy set transmission_paused=true where singleton;
  perform pg_temp.assert(not public.admit_fan_action_dispatch(old_job,'cutover'),'paused unsigned action was admitted');
  perform pg_temp.assert((select attempts=1 and status='RETRYING' and lease_owner is null
    and last_error_code='MINT_TRANSMISSION_PAUSED' from public.fan_action_outbox where id=old_job),
    'paused action consumed an attempt or retained its lease');
  update public.mint_dispatch_policy set transmission_paused=false where singleton;
  update public.fan_action_outbox set status='PROCESSING',attempts=2,lease_owner='cutover',
    lease_expires_at=clock_timestamp()+interval '5 minutes' where id=old_job;
  perform pg_temp.assert(public.admit_fan_action_dispatch(old_job,'cutover'),'resume did not admit action');
  q:=public.prepare_fan_action_job(old_job,'cutover',before_snapshot||jsonb_build_object(
    'actionId',h,'occurrenceId',h2,'requestHash',h3,'request',before_snapshot||jsonb_build_object('fan',before_snapshot->>'recipient')));
  perform pg_temp.assert(public.admit_chain_writer('fan_action',old_job,'cutover',91342,writer,120),'writer denied');
  q:=public.record_prepared_fan_action_job(old_job,'cutover',h,'0x1234');
  before_payload:=q.payload;
  update public.mint_dispatch_policy set transmission_paused=true where singleton;
  perform pg_temp.assert(not public.admit_fan_action_dispatch(old_job,'cutover'),'pause bypassed signed/reserved action');
  perform public.release_chain_writer('fan_action',old_job,'cutover',91342,writer);
  perform pg_temp.assert((select signed_transaction='0x1234' and tx_hash=h and payload=before_payload
    and source_snapshot=before_snapshot and attempts=1 from public.fan_action_outbox where id=old_job),
    'pause changed an already signed action');

  insert into public.blockchain_jobs(entity_type,entity_id,operation_key,payload,status,attempts,lease_owner,lease_expires_at)
    values('passport',extensions.gen_random_uuid(),'kyaa:cutover:legacy','{}','PROCESSING',2,'cutover',
      clock_timestamp()+interval '5 minutes') returning id into legacy_job;
  perform pg_temp.assert(not public.admit_mint_dispatch(legacy_job,'cutover'),'paused legacy job was admitted');
  perform pg_temp.assert((select attempts=1 and status='RETRYING' and lease_owner is null from public.blockchain_jobs where id=legacy_job),
    'legacy pause consumed an attempt');
  update public.mint_dispatch_policy set transmission_paused=false where singleton;
  update public.blockchain_jobs set status='PROCESSING',attempts=2,lease_owner='cutover',
    lease_expires_at=clock_timestamp()+interval '5 minutes' where id=legacy_job;
  perform pg_temp.assert(public.admit_mint_dispatch(legacy_job,'cutover'),'legacy resume failed');
  update public.blockchain_jobs set payload=jsonb_build_object('workerSubmission',jsonb_build_object('txHash',h,'signedTransaction','0x1234'))
    where id=legacy_job;
  update public.mint_dispatch_policy set transmission_paused=true where singleton;
  perform pg_temp.assert(not public.admit_mint_dispatch(legacy_job,'cutover'),'pause bypassed reserved legacy job');
  perform pg_temp.assert((select attempts=1 and payload#>>'{workerSubmission,signedTransaction}'='0x1234'
    from public.blockchain_jobs where id=legacy_job),'pause changed signed legacy job');
end $$;

set local role service_role;
do $$
begin
  begin
    update public.mint_dispatch_policy set transmission_paused=false where singleton;
    raise exception 'worker unexpectedly changed transmission policy';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
