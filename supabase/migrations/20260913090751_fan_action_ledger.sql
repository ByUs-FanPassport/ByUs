-- Additive action execution lane. No binding or producer is enabled by this migration.
-- Existing direct jobs and their signed submissions remain untouched.
create table public.fan_action_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  chain_id bigint not null check (chain_id=91342),
  environment_id text not null check (environment_id ~ '^0x[0-9a-f]{64}$'),
  hub_proxy text not null check (hub_proxy ~ '^0x[0-9a-f]{40}$'),
  relayer text not null check (relayer ~ '^0x[0-9a-f]{40}$'),
  migrator_relayer text check(migrator_relayer ~ '^0x[0-9a-f]{40}$' and migrator_relayer<>relayer),
  schema_uid text not null check (schema_uid ~ '^0x[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version between 1 and 65535),
  binding_version integer not null check (binding_version>0),
  asset_base_uri text not null check (asset_base_uri ~ '^ipfs://[a-zA-Z0-9]+(/.*)?$'),
  assets jsonb not null check (jsonb_typeof(assets)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(chain_id,hub_proxy,binding_version,schema_version)
);
create table public.fan_action_producer_routes (
  action_code integer primary key check (action_code between 1 and 11),
  binding_id uuid not null references public.fan_action_bindings(id),
  enabled boolean not null default false,
  policy_version integer not null check (policy_version>0),
  enabled_at timestamptz,
  check (not enabled or enabled_at is not null)
);
create table public.fan_action_occurrences (
  id uuid primary key default extensions.gen_random_uuid(),
  source_namespace text not null check(length(source_namespace) between 1 and 80),
  canonical_source_key text not null check(length(canonical_source_key) between 1 and 250),
  app_user_id uuid not null references public.app_users(id),
  creator_id uuid references public.celebrities(id),
  campaign_id uuid references public.live_events(id),
  source_occurred_at timestamptz not null,
  evidence_salt bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default clock_timestamp(),
  unique(source_namespace,canonical_source_key)
);
create table public.fan_action_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_row_id uuid not null references public.fan_action_occurrences(id),
  binding_id uuid not null references public.fan_action_bindings(id),
  revision integer not null default 1 check(revision>0),
  action_id text unique check(action_id ~ '^0x[0-9a-f]{64}$'),
  occurrence_id text check(occurrence_id ~ '^0x[0-9a-f]{64}$'),
  operation_kind text not null check(operation_kind in ('record_only','record_and_issue','import_historical','correct')),
  payload_version integer not null default 1 check(payload_version=1),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  request_hash text check(request_hash ~ '^0x[0-9a-f]{64}$'),
  payload jsonb,
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','RETRYING','COMPLETED','FAILED')),
  attempts integer not null default 0 check(attempts>=0),
  max_attempts integer not null default 10 check(max_attempts>0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  tx_hash text check(tx_hash ~ '^0x[0-9a-f]{64}$'),
  signed_transaction text check(signed_transaction ~ '^0x[0-9a-f]+$'),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default clock_timestamp(),
  unique(occurrence_row_id,revision),
  check ((payload is null and action_id is null and request_hash is null and occurrence_id is null)
    or (payload is not null and action_id is not null and request_hash is not null and occurrence_id is not null)),
  check ((tx_hash is null and signed_transaction is null) or
    (tx_hash is not null and signed_transaction is not null and payload is not null)),
  check ((status='PROCESSING' and lease_owner is not null and lease_expires_at is not null)
    or (status<>'PROCESSING' and lease_owner is null and lease_expires_at is null))
);
create index fan_action_outbox_claim on public.fan_action_outbox(status,next_attempt_at,created_at);
create table public.fan_action_credentials (
  id uuid primary key default extensions.gen_random_uuid(),
  outbox_id uuid not null references public.fan_action_outbox(id),
  entity_type text not null check(entity_type in ('passport','stamp','reaction','collectible','community_stamp')),
  entity_id uuid not null,
  credential_kind integer not null check(credential_kind between 0 and 2),
  issuance_key text check(issuance_key ~ '^0x[0-9a-f]{64}$'),
  legacy_job_id uuid references public.blockchain_jobs(id),
  token_id numeric(78,0),
  nft_contract text check(nft_contract ~ '^0x[0-9a-f]{40}$'),
  metadata_uri text,
  link_origin text check(link_origin in ('MINTED_NOW','LINKED_EXISTING')),
  check(issuance_key is not null or credential_kind=2),
  unique(outbox_id,entity_type,entity_id),
  unique(outbox_id,credential_kind,issuance_key)
);
create table public.fan_action_chain_receipts (
  outbox_id uuid primary key references public.fan_action_outbox(id),
  tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78,0) not null check(block_number>=0),
  block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
  eas_uid text not null check(eas_uid ~ '^0x[0-9a-f]{64}$'),
  record_hash text not null check(record_hash ~ '^0x[0-9a-f]{64}$'),
  credential_refs_hash text not null check(credential_refs_hash ~ '^0x[0-9a-f]{64}$'),
  inclusion_status text not null default 'included' check(inclusion_status in ('included','safe','finalized','orphaned')),
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.fan_action_migration_items (
  batch_id text not null check(batch_id ~ '^0x[0-9a-f]{64}$'),
  item_hash text not null check(item_hash ~ '^0x[0-9a-f]{64}$'),
  source_namespace text not null,
  canonical_source_key text not null,
  classification text not null check(classification in ('H1','H2','H3','H4','Q')),
  reason text not null,
  evidence jsonb not null,
  outbox_id uuid references public.fan_action_outbox(id),
  primary key(batch_id,item_hash),
  check(classification not in ('H4','Q') or outbox_id is null)
);
create table public.fan_action_receipt_history (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.fan_action_outbox(id),
  previous_receipt jsonb not null,
  previous_inclusion_status text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table public.chain_writer_leases (
  chain_id bigint not null,
  relayer text not null check(relayer ~ '^0x[0-9a-f]{40}$'),
  job_family text not null check(job_family in ('legacy','fan_action')),
  job_id uuid not null,
  worker_id text not null,
  expires_at timestamptz not null,
  primary key(chain_id,relayer)
);
create table public.fan_action_dispatch_reservations (
  budget_day date not null,
  outbox_id uuid not null references public.fan_action_outbox(id),
  primary key(budget_day,outbox_id)
);

create function public.reject_fan_action_identity_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'FAN_ACTION_IMMUTABLE'; end if;
  if tg_table_name='fan_action_outbox' then
    if (to_jsonb(new)-array['status','attempts','next_attempt_at','lease_owner','lease_expires_at',
      'tx_hash','signed_transaction','last_error_code','last_error_message','payload','action_id','occurrence_id','request_hash'])
      is distinct from (to_jsonb(old)-array['status','attempts','next_attempt_at','lease_owner','lease_expires_at',
      'tx_hash','signed_transaction','last_error_code','last_error_message','payload','action_id','occurrence_id','request_hash'])
      or (old.payload is not null and (new.payload is distinct from old.payload or new.action_id is distinct from old.action_id
        or new.occurrence_id is distinct from old.occurrence_id or new.request_hash is distinct from old.request_hash))
      or (old.signed_transaction is not null and (new.signed_transaction is distinct from old.signed_transaction or new.tx_hash is distinct from old.tx_hash)) then
      raise exception 'FAN_ACTION_IMMUTABLE';
    end if;
  elsif to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'FAN_ACTION_IMMUTABLE'; end if;
  return new;
end $$;
create trigger fan_action_outbox_immutable before update or delete on public.fan_action_outbox
for each row execute function public.reject_fan_action_identity_mutation();
create trigger fan_action_occurrences_immutable before update or delete on public.fan_action_occurrences
for each row execute function public.reject_fan_action_identity_mutation();
create trigger fan_action_bindings_immutable before update or delete on public.fan_action_bindings
for each row execute function public.reject_fan_action_identity_mutation();
create function public.preserve_fan_action_receipt_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new is distinct from old then
    insert into public.fan_action_receipt_history(outbox_id,previous_receipt,previous_inclusion_status)
      values(old.outbox_id,old.receipt,old.inclusion_status);
  end if;
  return new;
end $$;
create trigger fan_action_receipt_history_before_update before update on public.fan_action_chain_receipts
for each row execute function public.preserve_fan_action_receipt_history();
create trigger fan_action_receipt_history_immutable before update or delete on public.fan_action_receipt_history
for each row execute function public.reject_fan_action_identity_mutation();

create function public.claim_fan_action_jobs(p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_operation_kinds text[] default array['record_only','record_and_issue'])
returns setof public.fan_action_outbox language plpgsql security definer set search_path='' as $$
begin
  if nullif(btrim(p_worker_id),'') is null or p_batch_size not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception 'FAN_ACTION_INVALID_LEASE'; end if;
  if p_operation_kinds is null or cardinality(p_operation_kinds)=0 or exists(select 1 from unnest(p_operation_kinds) k
    where k is null or k not in ('record_only','record_and_issue','import_historical')) then raise exception 'FAN_ACTION_INVALID_OPERATION'; end if;
  return query with candidates as (
    select id from public.fan_action_outbox where
      ((status in ('PENDING','RETRYING') and next_attempt_at<=clock_timestamp())
        or (status='PROCESSING' and lease_expires_at<=clock_timestamp()))
      and (attempts<max_attempts or signed_transaction is not null) and operation_kind=any(p_operation_kinds)
    order by (signed_transaction is not null) desc,created_at,id for update skip locked limit p_batch_size
  ) update public.fan_action_outbox q set status='PROCESSING',attempts=q.attempts+1,
    lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from candidates c where q.id=c.id returning q.*;
end $$;

create function public.prepare_fan_action_job(p_job_id uuid,p_worker_id text,p_payload jsonb)
returns public.fan_action_outbox language plpgsql security definer set search_path='' as $$
declare q public.fan_action_outbox; resolved_key text; resolved_count integer;
begin
  select * into q from public.fan_action_outbox where id=p_job_id and status='PROCESSING'
    and lease_owner=p_worker_id and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'STALE_JOB_LEASE'; end if;
  if q.payload is not null then
    if q.payload is distinct from p_payload then raise exception 'FAN_ACTION_REQUEST_CONFLICT'; end if;
    return q;
  end if;
  if p_payload->>'requestHash' is null or p_payload->>'actionId' is null
    or p_payload->>'occurrenceId' is null
    or p_payload->>'chainId' is distinct from q.source_snapshot->>'chainId'
    or lower(p_payload->>'hubProxy') is distinct from lower(q.source_snapshot->>'hubProxy')
    or p_payload->>'environmentId' is distinct from q.source_snapshot->>'environmentId'
    or p_payload->>'schemaUid' is distinct from q.source_snapshot->>'schemaUid'
    or p_payload->'request'->>'bindingVersion' is distinct from q.source_snapshot->>'bindingVersion'
    or p_payload->'request'->>'schemaVersion' is distinct from q.source_snapshot->>'schemaVersion'
    or p_payload->'request'->>'revision' is distinct from q.source_snapshot->>'revision'
    or p_payload->'request'->>'actionCode' is distinct from q.source_snapshot->>'actionCode'
    or p_payload->'request'->>'policyVersion' is distinct from q.source_snapshot->>'policyVersion'
    or lower(p_payload->'request'->>'fan') is distinct from lower(q.source_snapshot->>'recipient')
    or p_payload->'request'->>'creatorId' is distinct from q.source_snapshot->>'creatorId'
    or p_payload->'request'->>'campaignId' is distinct from q.source_snapshot->>'campaignId'
    or p_payload->'request'->>'evidenceCommitment' is distinct from q.source_snapshot->>'evidenceCommitment'
    or p_payload->'request'->>'migrationBatchId' is distinct from q.source_snapshot->>'migrationBatchId' then
    raise exception 'FAN_ACTION_SNAPSHOT_MISMATCH'; end if;
  if exists(select 1 from public.fan_action_credentials where outbox_id=q.id and issuance_key is null) then
    select count(*),min(v->>'issuanceKey') into resolved_count,resolved_key from jsonb_array_elements(p_payload->'intents') v
      where v->>'kind'='2' and v->>'mode'='0';
    if resolved_count<>1 or resolved_key is null or resolved_key !~ '^0x[0-9a-f]{64}$' then
      raise exception 'FAN_ACTION_COLLECTIBLE_KEY_MISSING'; end if;
    update public.fan_action_credentials set issuance_key=resolved_key where outbox_id=q.id and credential_kind=2 and issuance_key is null;
  end if;
  update public.fan_action_outbox set payload=p_payload,request_hash=p_payload->>'requestHash',
    action_id=p_payload->>'actionId',occurrence_id=p_payload->>'occurrenceId'
    where id=p_job_id returning * into q;
  return q;
end $$;

create function public.record_prepared_fan_action_job(p_job_id uuid,p_worker_id text,p_tx_hash text,p_signed_transaction text)
returns public.fan_action_outbox language plpgsql security definer set search_path='' as $$
declare q public.fan_action_outbox;
begin
  select * into q from public.fan_action_outbox where id=p_job_id and status='PROCESSING'
    and lease_owner=p_worker_id and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'STALE_JOB_LEASE'; end if;
  if q.signed_transaction is not null then
    if q.tx_hash is distinct from p_tx_hash or q.signed_transaction is distinct from p_signed_transaction then
      raise exception 'FAN_ACTION_SIGNED_CONFLICT'; end if;
    return q;
  end if;
  if q.payload is null or p_tx_hash is null or p_signed_transaction is null then raise exception 'FAN_ACTION_NOT_PREPARED'; end if;
  if not exists(select 1 from public.chain_writer_leases l join public.fan_action_bindings b
    on b.chain_id=l.chain_id and (case when q.operation_kind='import_historical' then b.migrator_relayer else b.relayer end)=l.relayer where b.id=q.binding_id
    and l.job_family='fan_action' and l.job_id=q.id and l.worker_id=p_worker_id and l.expires_at>clock_timestamp()) then
    raise exception 'CHAIN_WRITER_LEASE_LOST'; end if;
  update public.fan_action_outbox set tx_hash=p_tx_hash,signed_transaction=p_signed_transaction
    where id=p_job_id returning * into q;
  return q;
end $$;

create function public.retry_fan_action_job(p_job_id uuid,p_worker_id text,p_error_code text,p_error_message text,p_retryable boolean)
returns void language plpgsql security definer set search_path='' as $$
declare q public.fan_action_outbox;
begin
  select * into q from public.fan_action_outbox where id=p_job_id and status='PROCESSING'
    and lease_owner=p_worker_id and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'STALE_JOB_LEASE'; end if;
  update public.fan_action_outbox set status=case when p_retryable and (attempts<max_attempts or signed_transaction is not null)
    then 'RETRYING' else 'FAILED' end,next_attempt_at=clock_timestamp()+interval '60 seconds',
    last_error_code=left(p_error_code,100),last_error_message=left(p_error_message,500),lease_owner=null,lease_expires_at=null
    where id=p_job_id;
end $$;

create function public.defer_chain_writer(p_job_family text,p_job_id uuid,p_worker_id text)
returns void language plpgsql set search_path='' as $$
begin
  if p_job_family='fan_action' then
    update public.fan_action_outbox set status='RETRYING',attempts=greatest(attempts-1,0),
      next_attempt_at=clock_timestamp()+interval '5 seconds',lease_owner=null,lease_expires_at=null,
      last_error_code='CHAIN_WRITER_BUSY',last_error_message='Another signing operation requires reconciliation'
      where id=p_job_id and status='PROCESSING' and lease_owner=p_worker_id and lease_expires_at>clock_timestamp();
  elsif p_job_family='legacy' then
    update public.blockchain_jobs set status='RETRYING',attempts=greatest(attempts-1,0),
      next_attempt_at=clock_timestamp()+interval '5 seconds',lease_owner=null,lease_expires_at=null,
      last_error_code='CHAIN_WRITER_BUSY',last_error_message='Another signing operation requires reconciliation'
      where id=p_job_id and status='PROCESSING' and lease_owner=p_worker_id and lease_expires_at>clock_timestamp();
  end if;
end $$;

create function public.admit_chain_writer(p_job_family text,p_job_id uuid,p_worker_id text,p_chain_id bigint,p_relayer text,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path='' as $$
declare active_job boolean; acquired boolean;
begin
  if p_job_family not in ('legacy','fan_action') or p_relayer !~ '^0x[0-9a-f]{40}$'
    or p_chain_id<>91342 or p_lease_seconds not between 30 and 900 then raise exception 'CHAIN_WRITER_INVALID'; end if;
  if p_job_family='legacy' then
    select exists(select 1 from public.blockchain_jobs where id=p_job_id and status='PROCESSING' and lease_owner=p_worker_id
      and lease_expires_at>clock_timestamp()) into active_job;
  else
    select exists(select 1 from public.fan_action_outbox q join public.fan_action_bindings b on b.id=q.binding_id
      where q.id=p_job_id and q.status='PROCESSING' and q.lease_owner=p_worker_id and q.lease_expires_at>clock_timestamp()
        and b.chain_id=p_chain_id and (case when q.operation_kind='import_historical' then b.migrator_relayer else b.relayer end)=p_relayer) into active_job;
  end if;
  if not active_job then raise exception 'STALE_JOB_LEASE'; end if;
  -- A persisted transaction with unresolved inclusion can still consume its nonce.
  -- Even FAILED jobs remain blockers until explicit receipt recovery resolves them.
  if exists(select 1 from public.fan_action_outbox q join public.fan_action_bindings b on b.id=q.binding_id
    where b.chain_id=p_chain_id and (case when q.operation_kind='import_historical' then b.migrator_relayer else b.relayer end)=p_relayer and q.signed_transaction is not null
      and q.status<>'COMPLETED' and not(p_job_family='fan_action' and q.id=p_job_id))
    or exists(select 1 from public.blockchain_jobs q where q.payload->'workerSubmission'->>'signedTransaction' is not null
      and q.status<>'COMPLETED' and not(p_job_family='legacy' and q.id=p_job_id)) then
    perform public.defer_chain_writer(p_job_family,p_job_id,p_worker_id); return false; end if;
  insert into public.chain_writer_leases as l(chain_id,relayer,job_family,job_id,worker_id,expires_at)
    values(p_chain_id,p_relayer,p_job_family,p_job_id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds))
    on conflict(chain_id,relayer) do update set job_family=excluded.job_family,job_id=excluded.job_id,
      worker_id=excluded.worker_id,expires_at=excluded.expires_at
    where l.expires_at<=clock_timestamp() or (l.job_family=p_job_family and l.job_id=p_job_id and l.worker_id=p_worker_id)
    returning true into acquired;
  if not coalesce(acquired,false) then perform public.defer_chain_writer(p_job_family,p_job_id,p_worker_id); end if;
  return coalesce(acquired,false);
end $$;
create function public.release_chain_writer(p_job_family text,p_job_id uuid,p_worker_id text,p_chain_id bigint,p_relayer text)
returns void language sql security definer set search_path='' as $$
  delete from public.chain_writer_leases where chain_id=p_chain_id and relayer=p_relayer
    and job_family=p_job_family and job_id=p_job_id and worker_id=p_worker_id;
$$;

create function public.admit_fan_action_dispatch(p_job_id uuid,p_worker_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_day date:=(clock_timestamp() at time zone 'UTC')::date; q public.fan_action_outbox;
begin
  select daily_job_limit into v_limit from public.mint_dispatch_policy where singleton for update;
  if v_limit is null then raise exception 'MINT_POLICY_MISSING'; end if;
  select * into q from public.fan_action_outbox where id=p_job_id and status='PROCESSING'
    and lease_owner=p_worker_id and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'STALE_JOB_LEASE'; end if;
  if q.signed_transaction is not null or exists(select 1 from public.fan_action_dispatch_reservations
    where budget_day=v_day and outbox_id=p_job_id) then return true; end if;
  if (select count(*) from public.mint_dispatch_budget_reservations where budget_day=v_day)
    +(select count(*) from public.fan_action_dispatch_reservations where budget_day=v_day)>=v_limit then
    update public.fan_action_outbox set status='RETRYING',attempts=greatest(attempts-1,0),
      next_attempt_at=((v_day+1)::timestamp at time zone 'UTC'),lease_owner=null,lease_expires_at=null,
      last_error_code='MINT_DAILY_DISPATCH_LIMIT',last_error_message='Daily mint dispatch limit reached'
      where id=q.id;
    return false;
  end if;
  insert into public.fan_action_dispatch_reservations values(v_day,p_job_id);
  return true;
end $$;

create function public.complete_fan_action_job(p_job_id uuid,p_worker_id text,p_receipt jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare q public.fan_action_outbox; c public.fan_action_credentials; r jsonb; n integer; b public.fan_action_bindings;
begin
  select * into q from public.fan_action_outbox where id=p_job_id for update;
  if not found then raise exception 'FAN_ACTION_NOT_FOUND'; end if;
  if q.status='COMPLETED' then
    if not exists(select 1 from public.fan_action_chain_receipts where outbox_id=q.id and receipt=p_receipt) then
      raise exception 'FAN_ACTION_RECEIPT_CONFLICT'; end if;
    return;
  end if;
  if q.status<>'PROCESSING' or q.lease_owner is distinct from p_worker_id or q.lease_expires_at<=clock_timestamp() then
    raise exception 'STALE_JOB_LEASE'; end if;
  select * into b from public.fan_action_bindings where id=q.binding_id;
  if q.tx_hash is null or p_receipt->>'txHash' is distinct from q.tx_hash
    or jsonb_typeof(p_receipt->'credentials') is distinct from 'array'
    or coalesce(p_receipt->>'inclusionStatus','included')<>'included' then raise exception 'FAN_ACTION_RECEIPT_MISMATCH'; end if;
  select count(*) into n from public.fan_action_credentials where outbox_id=q.id;
  if jsonb_array_length(p_receipt->'credentials')<>n then raise exception 'FAN_ACTION_CREDENTIAL_COUNT'; end if;
  for c in select * from public.fan_action_credentials where outbox_id=q.id for update loop
    select count(*),min(value::text)::jsonb into n,r from jsonb_array_elements(p_receipt->'credentials')
      where (value->>'kind')::integer=c.credential_kind and value->>'issuanceKey'=c.issuance_key;
    if n<>1 or r->>'tokenId' is null or (r->>'tokenId')::numeric<=0 or r->>'metadataUri' is null
      or lower(r->>'nftContract') is distinct from lower(b.assets->>c.credential_kind::text)
      or coalesce(r->>'linkOrigin','') not in ('0','1') then raise exception 'FAN_ACTION_CREDENTIAL_MISMATCH'; end if;
    update public.fan_action_credentials set token_id=(r->>'tokenId')::numeric,
      nft_contract=lower(r->>'nftContract'),metadata_uri=r->>'metadataUri',link_origin=case r->>'linkOrigin' when '0' then 'MINTED_NOW' else 'LINKED_EXISTING' end where id=c.id;
  end loop;
  insert into public.fan_action_chain_receipts(outbox_id,tx_hash,block_number,block_hash,eas_uid,record_hash,credential_refs_hash,receipt)
    values(q.id,q.tx_hash,(p_receipt->>'blockNumber')::numeric,p_receipt->>'blockHash',p_receipt->>'easUid',
      p_receipt->>'recordHash',p_receipt->>'credentialRefsHash',p_receipt);
  update public.fan_action_outbox set status='COMPLETED',lease_owner=null,lease_expires_at=null where id=q.id;
end $$;

-- Existing owner projections keep the same minted/processing fields while the
-- explicit outbox association identifies the execution lane.
create function public.reconcile_credential_from_fan_action() returns trigger
language plpgsql security definer set search_path='' as $$
declare c record; v_table text; v_status public.credential_mint_status;
begin
  if old.status is not distinct from new.status then return new; end if;
  v_status:=case new.status when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  for c in select * from public.fan_action_credentials where outbox_id=new.id and legacy_job_id is null loop
    v_table:=case c.entity_type when 'passport' then 'fan_passports' when 'stamp' then 'stamps'
      when 'reaction' then 'fan_reactions' when 'collectible' then 'live_collectible_claims' when 'community_stamp' then 'community_stamps' end;
    execute format('update public.%I set mint_status=$1,tx_hash=$2,token_id=$3 where id=$4 and fan_action_outbox_id=$5',v_table)
      using v_status,case when new.status='COMPLETED' then new.tx_hash end,
        case when new.status='COMPLETED' then c.token_id end,c.entity_id,new.id;
  end loop;
  return new;
end $$;
create trigger fan_action_outbox_reconcile after update of status on public.fan_action_outbox
for each row execute function public.reconcile_credential_from_fan_action();

create function public.list_fan_action_receipts(p_limit integer default 100,p_after_job_id uuid default null)
returns table(job_id uuid,payload jsonb,receipt jsonb,inclusion_status text)
language plpgsql security definer set search_path='' as $$
begin
  if p_limit not between 1 and 1000 then raise exception 'FAN_ACTION_INVALID_LIMIT'; end if;
  return query select q.id,q.payload,r.receipt,r.inclusion_status
    from public.fan_action_chain_receipts r join public.fan_action_outbox q on q.id=r.outbox_id
    where p_after_job_id is null or q.id>p_after_job_id
    order by q.id limit p_limit;
end $$;
create function public.set_fan_action_finality(p_job_id uuid,p_expected_block_hash text,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
  if p_status not in ('included','safe','finalized','orphaned') then raise exception 'FAN_ACTION_INVALID_FINALITY'; end if;
  update public.fan_action_chain_receipts set inclusion_status=p_status
    where outbox_id=p_job_id and block_hash=p_expected_block_hash returning true into changed;
  return coalesce(changed,false);
end $$;

create function public.replace_fan_action_receipt(p_job_id uuid,p_expected_block_hash text,p_receipt jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.fan_action_chain_receipts; q public.fan_action_outbox;
begin
  select * into r from public.fan_action_chain_receipts where outbox_id=p_job_id and block_hash=p_expected_block_hash
    and inclusion_status='orphaned' for update;
  if not found then return false; end if;
  select * into strict q from public.fan_action_outbox where id=p_job_id;
  if p_receipt->>'txHash' is distinct from q.tx_hash or p_receipt->>'recordHash' is distinct from r.record_hash
    or p_receipt->>'credentialRefsHash' is distinct from r.credential_refs_hash
    or (select jsonb_agg(v-'logIndex' order by v->>'issuanceKey') from jsonb_array_elements(p_receipt->'credentials') v)
      is distinct from (select jsonb_agg(v-'logIndex' order by v->>'issuanceKey') from jsonb_array_elements(r.receipt->'credentials') v) then
    raise exception 'FAN_ACTION_REORG_RESULT_MISMATCH'; end if;
  update public.fan_action_chain_receipts set block_number=(p_receipt->>'blockNumber')::numeric,
    block_hash=p_receipt->>'blockHash',eas_uid=p_receipt->>'easUid',receipt=p_receipt,inclusion_status='included'
    where outbox_id=p_job_id;
  return true;
end $$;

-- Operator-only handoff of a reviewed dry-run item. The Hub independently
-- enforces the immutable timelock-approved Merkle root and mint allowance.
-- This RPC does not infer eligibility from a legacy job's status.
create function public.enqueue_historical_fan_action(
  p_binding_id uuid,p_app_user_id uuid,p_creator_id uuid,p_campaign_id uuid,
  p_source_snapshot jsonb,p_item_hash text,p_classification text,p_reason text,p_evidence jsonb,
  p_credentials jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.fan_action_bindings; o public.fan_action_occurrences; q public.fan_action_outbox;
  c jsonb; recipient text; item public.fan_action_migration_items; legacy public.blockchain_jobs;
begin
  select * into strict b from public.fan_action_bindings where id=p_binding_id;
  select lower(address) into strict recipient from public.user_wallets where app_user_id=p_app_user_id
    and chain_id=b.chain_id and provider='privy' and wallet_type='embedded';
  if b.migrator_relayer is null or p_classification not in ('H1','H2','H3') or nullif(btrim(p_reason),'') is null
    or p_evidence->>'sourceVerified' is distinct from 'true'
    or p_evidence->>'publicContextApproved' is distinct from 'true'
    or p_evidence->>'unresolvedSubmissions' is distinct from '0'
    or p_source_snapshot->>'origin' is distinct from 'HISTORICAL'
    or p_source_snapshot->>'operationKind' is distinct from 'IMPORT_HISTORICAL'
    or p_source_snapshot->>'revision' is distinct from '1'
    or p_source_snapshot->>'migrationBatchId' is null
    or p_source_snapshot->>'migrationBatchId'='0x'||repeat('0',64)
    or (p_source_snapshot->>'chainId')::bigint is distinct from b.chain_id
    or lower(p_source_snapshot->>'hubProxy') is distinct from b.hub_proxy
    or p_source_snapshot->>'environmentId' is distinct from b.environment_id
    or p_source_snapshot->>'schemaUid' is distinct from b.schema_uid
    or (p_source_snapshot->>'schemaVersion')::integer is distinct from b.schema_version
    or (p_source_snapshot->>'bindingVersion')::integer is distinct from b.binding_version
    or lower(p_source_snapshot->>'recipient') is distinct from recipient
    or (p_source_snapshot->>'sourceOccurredAt')::timestamptz>clock_timestamp()
    or jsonb_typeof(p_source_snapshot->'credentials') is distinct from 'array'
    or jsonb_typeof(p_credentials) is distinct from 'array'
    or jsonb_typeof(p_source_snapshot->'migrationProof') is distinct from 'array' then
    raise exception 'FAN_ACTION_HISTORICAL_NOT_APPROVED'; end if;
  if p_classification='H1' and (jsonb_array_length(p_source_snapshot->'credentials')=0
    or exists(select 1 from jsonb_array_elements(p_source_snapshot->'credentials') v where v->>'mode'<>'LINK_EXISTING'))
    or p_classification='H2' and not exists(select 1 from jsonb_array_elements(p_source_snapshot->'credentials') v where v->>'mode'='MINT')
    or p_classification='H3' and jsonb_array_length(p_source_snapshot->'credentials')<>0
    or jsonb_array_length(p_source_snapshot->'credentials')<>jsonb_array_length(p_credentials) then
    raise exception 'FAN_ACTION_HISTORICAL_CLASSIFICATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fan-action-source:'||(p_source_snapshot->>'sourceNamespace')||':'||(p_source_snapshot->>'canonicalSourceKey'),0));
  select * into item from public.fan_action_migration_items where batch_id=p_source_snapshot->>'migrationBatchId' and item_hash=p_item_hash;
  if found then
    select * into q from public.fan_action_outbox where id=item.outbox_id;
    if q.source_snapshot is distinct from p_source_snapshot or item.evidence is distinct from p_evidence then
      raise exception 'FAN_ACTION_MANIFEST_CONFLICT'; end if;
    return q.id;
  end if;
  insert into public.fan_action_occurrences(source_namespace,canonical_source_key,app_user_id,creator_id,campaign_id,source_occurred_at)
    values(p_source_snapshot->>'sourceNamespace',p_source_snapshot->>'canonicalSourceKey',p_app_user_id,p_creator_id,p_campaign_id,
      (p_source_snapshot->>'sourceOccurredAt')::timestamptz)
    on conflict(source_namespace,canonical_source_key) do nothing;
  select * into strict o from public.fan_action_occurrences where source_namespace=p_source_snapshot->>'sourceNamespace'
    and canonical_source_key=p_source_snapshot->>'canonicalSourceKey';
  if o.app_user_id is distinct from p_app_user_id or o.creator_id is distinct from p_creator_id
    or o.campaign_id is distinct from p_campaign_id or o.source_occurred_at is distinct from (p_source_snapshot->>'sourceOccurredAt')::timestamptz then
    raise exception 'FAN_ACTION_SOURCE_CONFLICT'; end if;
  if exists(select 1 from public.fan_action_outbox where occurrence_row_id=o.id) then raise exception 'FAN_ACTION_ALREADY_ROUTED'; end if;
  insert into public.fan_action_outbox(occurrence_row_id,binding_id,operation_kind,source_snapshot)
    values(o.id,b.id,'import_historical',p_source_snapshot) returning * into q;
  for c in select value from jsonb_array_elements(p_credentials) loop
    if c->>'legacyJobId' is not null then
      select * into strict legacy from public.blockchain_jobs where id=(c->>'legacyJobId')::uuid for update;
      if legacy.entity_type is distinct from c->>'entityType' or legacy.entity_id is distinct from (c->>'entityId')::uuid
        or lower(legacy.payload->>'recipient') is distinct from recipient
        or legacy.status='PROCESSING'
        or (legacy.status<>'COMPLETED' and (legacy.tx_hash is not null or legacy.payload->'workerSubmission' is not null)) then
        raise exception 'FAN_ACTION_LEGACY_SUBMISSION_UNRESOLVED'; end if;
    end if;
    insert into public.fan_action_credentials(outbox_id,entity_type,entity_id,credential_kind,issuance_key,legacy_job_id)
      values(q.id,c->>'entityType',(c->>'entityId')::uuid,(c->>'kind')::integer,c->>'issuanceKey',(c->>'legacyJobId')::uuid);
  end loop;
  insert into public.fan_action_migration_items(batch_id,item_hash,source_namespace,canonical_source_key,classification,reason,evidence,outbox_id)
    values(p_source_snapshot->>'migrationBatchId',p_item_hash,o.source_namespace,o.canonical_source_key,p_classification,p_reason,p_evidence,q.id);
  return q.id;
end $$;

-- Only internal RPCs may mutate the ledger. No user wallet or source evidence is public.
do $$ declare t text; f record; begin
  foreach t in array array['fan_action_bindings','fan_action_producer_routes','fan_action_occurrences','fan_action_outbox',
    'fan_action_credentials','fan_action_chain_receipts','fan_action_migration_items','chain_writer_leases','fan_action_dispatch_reservations','fan_action_receipt_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('claim_fan_action_jobs','prepare_fan_action_job','record_prepared_fan_action_job','retry_fan_action_job',
      'admit_chain_writer','release_chain_writer','reject_fan_action_identity_mutation','admit_fan_action_dispatch',
      'complete_fan_action_job','reconcile_credential_from_fan_action','list_fan_action_receipts','set_fan_action_finality','enqueue_historical_fan_action','replace_fan_action_receipt','defer_chain_writer','preserve_fan_action_receipt_history') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.signature::text not like '%reject_fan_action%' and f.signature::text not like '%reconcile_credential_from_fan_action%'
      and f.signature::text not like '%defer_chain_writer%' and f.signature::text not like '%preserve_fan_action_receipt_history%' then
      execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;

-- Both lanes reserve against the same locked daily budget.
create or replace function public.admit_mint_dispatch(
  p_job_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_job_limit integer;
  v_now timestamptz;
  v_budget_day date;
  v_reserved_count bigint;
  v_job_id uuid;
begin
  select policy.daily_job_limit
    into v_daily_job_limit
  from public.mint_dispatch_policy policy
  where policy.singleton
  for update;

  if not found then
    raise exception 'mint dispatch policy is missing' using errcode = 'P0001';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_budget_day := (v_now at time zone 'UTC')::date;

  select job.id
    into v_job_id
  from public.blockchain_jobs job
  where job.id = p_job_id
    and job.status = 'PROCESSING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > v_now
  for update;

  if not found then
    raise exception 'job lease is not active for this worker' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.mint_dispatch_budget_reservations reservation
    where reservation.budget_day = v_budget_day
      and reservation.job_id = v_job_id
  ) then
    return true;
  end if;

  select pg_catalog.count(*) + (select count(*) from public.fan_action_dispatch_reservations where budget_day=v_budget_day)
    into v_reserved_count
  from public.mint_dispatch_budget_reservations reservation
  where reservation.budget_day = v_budget_day;

  if v_reserved_count < v_daily_job_limit then
    insert into public.mint_dispatch_budget_reservations (budget_day, job_id, reserved_at)
    values (v_budget_day, v_job_id, v_now);
    return true;
  end if;

  update public.blockchain_jobs job
  set status = 'RETRYING',
      attempts = case when job.attempts > 0 then job.attempts - 1 else 0 end,
      next_attempt_at = ((v_budget_day + 1)::timestamp at time zone 'UTC'),
      last_error_code = 'MINT_DAILY_DISPATCH_LIMIT',
      last_error_message = 'Daily mint dispatch limit reached',
      lease_owner = null,
      lease_expires_at = null
  where job.id = v_job_id;

  return false;
end;
$$;

-- Prioritize legacy signed recovery so a busy unsigned batch cannot starve the nonce blocker.
create or replace function public.claim_blockchain_jobs(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_entity_types text[]
) returns setof public.blockchain_jobs language plpgsql security definer set search_path='' as $$
begin
  if p_worker_id is null or length(pg_catalog.btrim(p_worker_id))=0 then
    raise exception 'worker id is required'; end if;
  if p_batch_size<1 or p_batch_size>100 then
    raise exception 'batch size must be between 1 and 100'; end if;
  if p_lease_seconds<30 or p_lease_seconds>900 then
    raise exception 'lease seconds must be between 30 and 900'; end if;
  if p_entity_types is null or pg_catalog.cardinality(p_entity_types)=0
    or exists(select 1 from pg_catalog.unnest(p_entity_types) kind
      where kind not in ('passport','stamp','reaction','collectible','community_stamp')) then
    raise exception 'supported entity types are invalid';
  end if;
  return query with candidates as (
    select id from public.blockchain_jobs
    where ((status in ('PENDING','RETRYING') and next_attempt_at<=pg_catalog.now())
        or (status='PROCESSING' and lease_expires_at<=pg_catalog.now()))
      and (attempts<max_attempts or payload->'workerSubmission'->>'signedTransaction' is not null)
      and entity_type=any(p_entity_types)
      and not exists(select 1 from public.fan_action_credentials c join public.fan_action_outbox a on a.id=c.outbox_id
        where c.legacy_job_id=blockchain_jobs.id and a.operation_kind='import_historical')
    order by (payload->'workerSubmission'->>'signedTransaction' is not null) desc,next_attempt_at,created_at,id for update skip locked limit p_batch_size
  ) update public.blockchain_jobs jobs set
    status='PROCESSING',attempts=jobs.attempts+1,lease_owner=p_worker_id,
    lease_expires_at=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),
    last_error_code=null,last_error_message=null
  from candidates where jobs.id=candidates.id returning jobs.*;
end $$;
