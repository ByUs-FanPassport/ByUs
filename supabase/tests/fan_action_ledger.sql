-- Disposable PostgreSQL only; all fixtures roll back.
begin;
create function pg_temp.expect_action_error(statement text,expected text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected error %, expected %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected failure: %',expected; end if;
end $$;

do $$
declare
  owner_id uuid:=extensions.gen_random_uuid(); binding uuid; occurrence uuid; job uuid; other_job uuid;
  h text:='0x'||repeat('1',64); h2 text:='0x'||repeat('2',64); h3 text:='0x'||repeat('3',64);
  address text:='0x'||repeat('1',40); relayer text:='0x'||repeat('2',40);
  source jsonb; payload jsonb; receipt jsonb; q public.fan_action_outbox; claimed integer; t text; f record;
  history_snapshot jsonb; history_job uuid; evidence jsonb; legacy_job uuid:=extensions.gen_random_uuid(); legacy_entity uuid:=extensions.gen_random_uuid(); history_creds jsonb;
begin
  insert into public.app_users(id,privy_user_id,verified_email) values(owner_id,'did:privy:action-ledger','action-ledger@example.test');
  insert into public.fan_action_bindings(chain_id,environment_id,hub_proxy,relayer,migrator_relayer,schema_uid,schema_version,binding_version,asset_base_uri,assets)
    values(91342,h,address,relayer,'0x'||repeat('3',40),h2,1,1,'ipfs://bafyfixture','{}') returning id into binding;
  source:=jsonb_build_object('chainId',91342,'environmentId',h,'hubProxy',address,'schemaUid',h2,'bindingVersion',1);
  insert into public.fan_action_occurrences(source_namespace,canonical_source_key,app_user_id,source_occurred_at)
    values('core_fixture','1',owner_id,clock_timestamp()) returning id into occurrence;
  insert into public.fan_action_outbox(occurrence_row_id,binding_id,operation_kind,source_snapshot)
    values(occurrence,binding,'record_only',source) returning id into job;
  select count(*) into claimed from public.claim_fan_action_jobs('core-test',1,120);
  if claimed<>1 then raise exception 'claim did not return fixture'; end if;
  payload:=source||jsonb_build_object('actionId',h,'occurrenceId',h2,'requestHash',h3,'request',jsonb_build_object('bindingVersion',1));
  q:=public.prepare_fan_action_job(job,'core-test',payload);
  q:=public.prepare_fan_action_job(job,'core-test',payload);
  perform pg_temp.expect_action_error(format('select public.prepare_fan_action_job(%L,%L,%L::jsonb)',job,'core-test',
    payload||jsonb_build_object('requestHash',h2)),'FAN_ACTION_REQUEST_CONFLICT');
  perform pg_temp.expect_action_error(format('select public.record_prepared_fan_action_job(%L,%L,%L,%L)',
    job,'core-test',h,'0x1234'),'CHAIN_WRITER_LEASE_LOST');
  if not public.admit_chain_writer('fan_action',job,'core-test',91342,relayer,120) then raise exception 'writer denied'; end if;
  q:=public.record_prepared_fan_action_job(job,'core-test',h,'0x1234');
  q:=public.record_prepared_fan_action_job(job,'core-test',h,'0x1234');
  perform pg_temp.expect_action_error(format('select public.record_prepared_fan_action_job(%L,%L,%L,%L)',
    job,'core-test',h,'0x5678'),'FAN_ACTION_SIGNED_CONFLICT');
  perform public.release_chain_writer('fan_action',job,'core-test',91342,relayer);
  insert into public.fan_action_occurrences(source_namespace,canonical_source_key,app_user_id,source_occurred_at)
    values('core_fixture','2',owner_id,clock_timestamp()) returning id into occurrence;
  insert into public.fan_action_outbox(occurrence_row_id,binding_id,operation_kind,source_snapshot)
    values(occurrence,binding,'record_only',source) returning id into other_job;
  perform public.claim_fan_action_jobs('other-worker',1,120);
  if public.admit_chain_writer('fan_action',other_job,'other-worker',91342,relayer,120) then
    raise exception 'unresolved signed transaction failed to block new nonce writer'; end if;
  perform pg_temp.expect_action_error(format('select public.retry_fan_action_job(%L,%L,%L,%L,true)',
    job,'wrong-owner','fixture','fixture'),'STALE_JOB_LEASE');
  receipt:=jsonb_build_object('txHash',h,'blockNumber','1','blockHash',h2,'easUid',h3,'recordHash',h,
    'credentialRefsHash',h2,'credentials','[]'::jsonb,'inclusionStatus','included');
  perform pg_temp.expect_action_error(format('select public.complete_fan_action_job(%L,%L,%L::jsonb)',
    job,'core-test',receipt||jsonb_build_object('txHash',h2)),'FAN_ACTION_RECEIPT_MISMATCH');
  perform public.complete_fan_action_job(job,'core-test',receipt);
  perform public.complete_fan_action_job(job,'core-test',receipt);
  if (select count(*) from public.fan_action_chain_receipts where outbox_id=job)<>1 then raise exception 'duplicate receipt'; end if;
  if (select inclusion_status from public.fan_action_chain_receipts where outbox_id=job)<>'included' then raise exception 'false finality'; end if;
  if public.set_fan_action_finality(job,h3,'finalized') then raise exception 'stale block hash accepted'; end if;
  if not public.set_fan_action_finality(job,h2,'safe') then raise exception 'valid finality CAS failed'; end if;
  if public.replace_fan_action_receipt(job,h2,receipt) then raise exception 'non-orphan receipt replacement accepted'; end if;
  perform public.set_fan_action_finality(job,h2,'orphaned');
  if not public.replace_fan_action_receipt(job,h2,receipt||jsonb_build_object('blockHash',h3,'blockNumber','2')) then
    raise exception 'validated reorg receipt replacement failed'; end if;
  if (select inclusion_status from public.fan_action_chain_receipts where outbox_id=job)<>'included' then
    raise exception 're-included receipt falsely marked finalized'; end if;
  if (select attempts from public.fan_action_outbox where id=other_job)<>0 then raise exception 'writer contention consumed retry budget'; end if;
  update public.fan_action_outbox set next_attempt_at=clock_timestamp() where id=other_job;
  perform public.claim_fan_action_jobs('other-worker',1,120);
  if not public.admit_chain_writer('fan_action',other_job,'other-worker',91342,relayer,120) then raise exception 'writer not released after completion'; end if;
  perform pg_temp.expect_action_error(format('update public.fan_action_outbox set source_snapshot=%L::jsonb where id=%L','{}',job),'FAN_ACTION_IMMUTABLE');
  perform pg_temp.expect_action_error(format('update public.fan_action_bindings set relayer=%L where id=%L',address,binding),'FAN_ACTION_IMMUTABLE');
  if (select count(*) from public.list_fan_action_receipts(100,job))<>0 then raise exception 'receipt cursor repeated row'; end if;
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_id,91342,address,'privy','embedded');
  history_snapshot:=source||jsonb_build_object('version',1,'sourceNamespace','historical_fixture','canonicalSourceKey','history1',
    'revision',1,'actionCode',7,'policyVersion',1,'recipient',address,'creatorId','0x'||repeat('0',64),
    'campaignId','0x'||repeat('0',64),'sourceOccurredAt','2026-01-01T00:00:00Z','origin','HISTORICAL',
    'operationKind','IMPORT_HISTORICAL','schemaVersion',1,'migrationBatchId',h,'evidenceCommitment',h2,
    'credentials','[]'::jsonb,'migrationProof','[]'::jsonb,'assetBaseUri','ipfs://bafyfixture');
  evidence:=jsonb_build_object('sourceVerified',true,'publicContextApproved',true,'unresolvedSubmissions',0);
  history_job:=public.enqueue_historical_fan_action(binding,owner_id,null,null,history_snapshot,h2,'H3','Approved no-credential source',evidence,'[]');
  if public.enqueue_historical_fan_action(binding,owner_id,null,null,history_snapshot,h2,'H3','Approved no-credential source',evidence,'[]')<>history_job then
    raise exception 'historical retry duplicated outbox'; end if;
  perform pg_temp.expect_action_error(format('select public.enqueue_historical_fan_action(%L,%L,null,null,%L::jsonb,%L,%L,%L,%L::jsonb,%L::jsonb)',
    binding,owner_id,history_snapshot,h3,'H3','Unresolved submission',evidence||jsonb_build_object('unresolvedSubmissions',1),'[]'),
    'FAN_ACTION_HISTORICAL_NOT_APPROVED');
  -- Evidence booleans cannot override an unresolved legacy submission.
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload,tx_hash)
    values(legacy_job,'passport',legacy_entity,'byus:passport:v1:'||owner_id::text||':history-test',1,
      jsonb_build_object('recipient',address,'celebritySlug','history-test','passportId',h),h3);
  history_creds:=jsonb_build_array(jsonb_build_object('entityType','passport','entityId',legacy_entity,
    'kind',0,'issuanceKey',h,'legacyJobId',legacy_job));
  history_snapshot:=history_snapshot||jsonb_build_object('canonicalSourceKey','history-unresolved','actionCode',1,
    'credentials',jsonb_build_array(jsonb_build_object('kind',0,'mode','MINT','issuanceKey',h)));
  perform pg_temp.expect_action_error(format('select public.enqueue_historical_fan_action(%L,%L,null,null,%L::jsonb,%L,%L,%L,%L::jsonb,%L::jsonb)',
    binding,owner_id,history_snapshot,h3,'H2','Reviewed missing claim',evidence,history_creds),
    'FAN_ACTION_LEGACY_SUBMISSION_UNRESOLVED');
  foreach t in array array['fan_action_outbox','fan_action_occurrences','fan_action_bindings','fan_action_credentials','fan_action_chain_receipts'] loop
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT')
      or has_table_privilege('service_role','public.'||t,'UPDATE') then raise exception 'ledger table grants leak: %',t; end if;
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('claim_fan_action_jobs','complete_fan_action_job','prepare_fan_action_job','admit_chain_writer') loop
    if has_function_privilege('anon',f.signature,'EXECUTE') or has_function_privilege('authenticated',f.signature,'EXECUTE') then
      raise exception 'ledger RPC publicly callable: %',f.signature; end if;
  end loop;
end $$;
rollback;
