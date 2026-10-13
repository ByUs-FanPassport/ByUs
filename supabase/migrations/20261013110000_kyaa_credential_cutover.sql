-- Keep receipt/finality processing active while an operator stops new transmission.
-- No binding or producer route is activated by this migration.
alter table public.mint_dispatch_policy add column transmission_paused boolean not null default false;
comment on column public.mint_dispatch_policy.transmission_paused is
  'DB-owner-only transmission stop; receipt reconciliation continues. Wait for active invocations and writer leases before operational cutover.';

create or replace function public.admit_fan_action_dispatch(p_job_id uuid,p_worker_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_paused boolean; v_limit integer; v_day date:=(clock_timestamp() at time zone 'UTC')::date; q public.fan_action_outbox;
begin
  select daily_job_limit,transmission_paused into v_limit,v_paused from public.mint_dispatch_policy where singleton for update;
  if v_limit is null then raise exception 'MINT_POLICY_MISSING'; end if;
  select * into q from public.fan_action_outbox where id=p_job_id and status='PROCESSING'
    and lease_owner=p_worker_id and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'STALE_JOB_LEASE'; end if;
  if v_paused then
    update public.fan_action_outbox set status='RETRYING',attempts=greatest(attempts-1,0),
      next_attempt_at=clock_timestamp()+interval '1 minute',lease_owner=null,lease_expires_at=null,
      last_error_code='MINT_TRANSMISSION_PAUSED',last_error_message='Mint transmission paused' where id=q.id;
    return false;
  end if;
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
  v_paused boolean;
  v_now timestamptz;
  v_budget_day date;
  v_reserved_count bigint;
  v_job_id uuid;
begin
  select policy.daily_job_limit,policy.transmission_paused
    into v_daily_job_limit,v_paused
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

  if v_paused then
    update public.blockchain_jobs set status='RETRYING',attempts=greatest(attempts-1,0),
      next_attempt_at=clock_timestamp()+interval '1 minute',lease_owner=null,lease_expires_at=null,
      last_error_code='MINT_TRANSMISSION_PAUSED',last_error_message='Mint transmission paused' where id=v_job_id;
    return false;
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

create or replace function public.enqueue_fan_action_source(
  p_namespace text,p_source_key text,p_app_user_id uuid,p_creator_id uuid,p_campaign_id uuid,
  p_occurred_at timestamptz,p_action_code integer,p_credentials jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_binding public.fan_action_bindings%rowtype;
  v_route public.fan_action_producer_routes%rowtype;
  v_occurrence public.fan_action_occurrences%rowtype;
  v_outbox public.fan_action_outbox%rowtype;
  v_recipient text;
  v_snapshot_credentials jsonb;
  v_snapshot jsonb;
  v_descriptor jsonb;
  v_entity_type text;
  v_entity_id uuid;
  v_kind integer;
  v_issuance_key text;
  v_operation_key text;
  v_legacy_payload jsonb;
  v_nft_contract text;
  v_zero text:= '0x'||repeat('0',64);
begin
  if p_namespace is null or p_namespace !~ '^[a-z][a-z0-9_]{1,62}$'
    or p_source_key is null or length(p_source_key) not between 1 and 240
    or p_app_user_id is null or p_occurred_at is null or p_action_code not between 1 and 11
    or jsonb_typeof(p_credentials) is distinct from 'array' then
    raise exception 'FAN_ACTION_INVALID_SOURCE';
  end if;

  if p_creator_id is not null and not exists(
    select 1 from public.celebrities creator
    where creator.id=p_creator_id and creator.status='published' and creator.archived_at is null
  ) then
    raise exception 'FAN_ACTION_CREATOR_NOT_PUBLIC';
  end if;
  if p_campaign_id is not null and (
    p_creator_id is null or not exists(
      select 1 from public.live_events campaign
      where campaign.id=p_campaign_id and campaign.celebrity_id=p_creator_id
        and campaign.publication_status='published' and campaign.archived_at is null
    )
  ) then
    raise exception 'FAN_ACTION_CAMPAIGN_NOT_PUBLIC';
  end if;

  select route.* into v_route from public.fan_action_producer_routes route
    where route.action_code=p_action_code and route.enabled for update;
  if not found then raise exception 'FAN_ACTION_ROUTE_DISABLED'; end if;
  insert into public.fan_action_occurrences(source_namespace,canonical_source_key,app_user_id,creator_id,campaign_id,source_occurred_at)
    values(p_namespace,p_source_key,p_app_user_id,p_creator_id,p_campaign_id,p_occurred_at)
    on conflict(source_namespace,canonical_source_key) do nothing;
  select * into strict v_occurrence from public.fan_action_occurrences occurrence
    where occurrence.source_namespace=p_namespace and occurrence.canonical_source_key=p_source_key for update;
  if v_occurrence.app_user_id<>p_app_user_id or v_occurrence.creator_id is distinct from p_creator_id
    or v_occurrence.campaign_id is distinct from p_campaign_id or v_occurrence.source_occurred_at<>p_occurred_at then
    raise exception 'FAN_ACTION_SOURCE_CONFLICT';
  end if;

  -- An occurrence keeps its original contract and policy after routes change.
  select * into v_outbox from public.fan_action_outbox
    where occurrence_row_id=v_occurrence.id and revision=1 for update;
  if found then
    v_route.binding_id:=v_outbox.binding_id;
    v_route.policy_version:=(v_outbox.source_snapshot->>'policyVersion')::integer;
  end if;
  select binding.* into strict v_binding from public.fan_action_bindings binding
    where binding.id=v_route.binding_id for key share;

  select lower(wallet.address) into strict v_recipient from public.user_wallets wallet
    where wallet.app_user_id=p_app_user_id and wallet.chain_id=91342
      and wallet.provider='privy' and wallet.wallet_type='embedded';
  if v_recipient !~ '^0x[0-9a-f]{40}$' then raise exception 'FAN_ACTION_WALLET_INVALID'; end if;

  if jsonb_array_length(p_credentials)>2 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;
  v_snapshot_credentials:='[]'::jsonb;
  for v_descriptor in select value from jsonb_array_elements(p_credentials) loop
    if jsonb_typeof(v_descriptor)<>'object'
      or (select count(*) from jsonb_object_keys(v_descriptor))<>6
      or not (v_descriptor ?& array['entityType','entityId','kind','issuanceKey','operationKey','legacyPayload']) then
      raise exception 'FAN_ACTION_INVALID_CREDENTIAL';
    end if;
    begin v_entity_id:=(v_descriptor->>'entityId')::uuid; exception when others then raise exception 'FAN_ACTION_INVALID_CREDENTIAL'; end;
    v_entity_type:=v_descriptor->>'entityType';
    begin v_kind:=(v_descriptor->>'kind')::integer; exception when others then raise exception 'FAN_ACTION_INVALID_CREDENTIAL'; end;
    v_issuance_key:=lower(v_descriptor->>'issuanceKey');
    v_operation_key:=v_descriptor->>'operationKey';
    v_legacy_payload:=v_descriptor->'legacyPayload';
    if v_entity_type not in ('passport','stamp','reaction','collectible','community_stamp')
      or v_kind not between 0 and 2
      or (v_issuance_key is null) is distinct from (v_entity_type='collectible' and v_kind=2)
      or (v_issuance_key is not null and v_issuance_key !~ '^0x[0-9a-f]{64}$')
      or nullif(btrim(v_operation_key),'') is null or length(v_operation_key)>300
      or jsonb_typeof(v_legacy_payload) is distinct from 'object'
      or (v_entity_type='passport') is distinct from (v_kind=0)
      or (v_entity_type='collectible') is distinct from (v_kind=2) then
      raise exception 'FAN_ACTION_INVALID_CREDENTIAL';
    end if;
    v_nft_contract:=lower(v_binding.assets->>v_kind::text);
    if v_nft_contract is null or v_nft_contract !~ '^0x[0-9a-f]{40}$' then
      raise exception 'FAN_ACTION_BINDING_ASSET_INVALID';
    end if;
    v_snapshot_credentials:=v_snapshot_credentials||jsonb_build_array(jsonb_build_object(
      'kind',v_kind,'nftContract',v_nft_contract,'issuanceKey',v_issuance_key,'mode','MINT',
      'metadata',jsonb_build_object('operationKey',v_operation_key,'legacyEntityType',v_entity_type,'legacyPayload',v_legacy_payload)
    ));
  end loop;
  if p_action_code=1 and jsonb_array_length(p_credentials)<>2 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;
  if p_action_code<>1 and jsonb_array_length(p_credentials)<>1 then raise exception 'FAN_ACTION_INVALID_CREDENTIALS'; end if;


  v_snapshot:=jsonb_build_object(
    'version',1,'chainId',v_binding.chain_id,'environmentId',v_binding.environment_id,
    'hubProxy',v_binding.hub_proxy,'schemaUid',v_binding.schema_uid,'schemaVersion',v_binding.schema_version,
    'bindingVersion',v_binding.binding_version,'operationKind','RECORD_AND_ISSUE',
    'sourceNamespace',p_namespace,'canonicalSourceKey',p_source_key,'revision',1,
    'actionCode',p_action_code,'policyVersion',v_route.policy_version,'recipient',v_recipient,
    'creatorId',case when p_creator_id is null then v_zero else '0x'||lpad(replace(p_creator_id::text,'-',''),64,'0') end,
    'campaignId',case when p_campaign_id is null then v_zero else '0x'||lpad(replace(p_campaign_id::text,'-',''),64,'0') end,
    'sourceOccurredAt',to_jsonb(p_occurred_at)#>>'{}','origin','NATIVE',
    'evidenceCommitment','0x'||encode(extensions.digest(encode(v_occurrence.evidence_salt,'hex')||jsonb_build_object('namespace',p_namespace,'sourceKey',p_source_key,
      'appUserId',p_app_user_id,'creatorId',p_creator_id,'campaignId',p_campaign_id,'occurredAt',p_occurred_at)::text,'sha256'),'hex'),
    'migrationBatchId',v_zero,'assetBaseUri',v_binding.asset_base_uri,
    'credentials',v_snapshot_credentials,'migrationProof','[]'::jsonb
  );
  insert into public.fan_action_outbox(occurrence_row_id,binding_id,revision,operation_kind,source_snapshot)
    values(v_occurrence.id,v_binding.id,1,'record_and_issue',v_snapshot)
    on conflict(occurrence_row_id,revision) do nothing;
  select * into strict v_outbox from public.fan_action_outbox outbox
    where outbox.occurrence_row_id=v_occurrence.id and outbox.revision=1 for update;
  if v_outbox.binding_id<>v_binding.id or v_outbox.operation_kind<>'record_and_issue'
    or v_outbox.source_snapshot is distinct from v_snapshot then raise exception 'FAN_ACTION_SOURCE_CONFLICT'; end if;

  for v_descriptor in select value from jsonb_array_elements(p_credentials) loop
    insert into public.fan_action_credentials(outbox_id,entity_type,entity_id,credential_kind,issuance_key)
      values(v_outbox.id,v_descriptor->>'entityType',(v_descriptor->>'entityId')::uuid,
        (v_descriptor->>'kind')::integer,lower(v_descriptor->>'issuanceKey'))
      on conflict(outbox_id,entity_type,entity_id) do nothing;
  end loop;
  if (select count(*) from public.fan_action_credentials credential where credential.outbox_id=v_outbox.id)
      <>jsonb_array_length(p_credentials) then raise exception 'FAN_ACTION_CREDENTIAL_CONFLICT'; end if;
  return v_outbox.id;
end $$;

create or replace function public.fan_action_native_enabled(p_action_code integer, p_app_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_binding_version integer;
begin
  if p_action_code not between 1 and 11 then
    raise exception 'FAN_ACTION_INVALID_CODE';
  end if;

  select route.enabled,binding.binding_version
    into v_enabled,v_binding_version
  from public.fan_action_producer_routes route
  join public.fan_action_bindings binding on binding.id=route.binding_id
  where route.action_code = p_action_code
  for update of route;

  v_enabled:=coalesce(v_enabled,false) and (not exists (
      select 1 from public.fan_action_canary_scope scope
      where scope.action_code = p_action_code
    ) or (
      p_app_user_id is not null and exists (
        select 1 from public.fan_action_canary_scope scope
        where scope.action_code = p_action_code
          and scope.app_user_id = p_app_user_id
      )
    ));
  if not v_enabled and v_binding_version>=2 then raise exception 'FAN_ACTION_ROUTE_REQUIRED'; end if;
  return v_enabled;
end;
$$;

create or replace function public.fan_action_native_enabled(
  p_action_code integer,
  p_app_user_id uuid,
  p_creator_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_binding_id uuid;
begin
  v_enabled := public.fan_action_native_enabled(p_action_code, p_app_user_id);
  if not v_enabled then
    return false;
  end if;

  if p_action_code not in (1, 6, 8, 10) then
    return true;
  end if;

  select route.binding_id
    into v_binding_id
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code;

  v_enabled:=p_creator_id is not null and exists (
    select 1
    from public.fan_action_verified_creators verified
    where verified.binding_id = v_binding_id
      and verified.creator_id = p_creator_id
  );
  if not v_enabled and exists(select 1 from public.fan_action_bindings where id=v_binding_id and binding_version>=2) then
    raise exception 'FAN_ACTION_CONTEXT_NOT_VERIFIED';
  end if;
  return v_enabled;

end;
$$;

create or replace function public.fan_action_native_enabled(
  p_action_code integer,
  p_app_user_id uuid,
  p_creator_id uuid,
  p_campaign_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_binding_id uuid;
begin
  if p_action_code not in (2, 3, 4, 5) then
    return public.fan_action_native_enabled(p_action_code, p_app_user_id, p_creator_id);
  end if;

  -- The existing actor-aware helper locks the route before this lookup. Keep
  -- that lock order so canary configuration cannot race this decision.
  v_enabled := public.fan_action_native_enabled(p_action_code, p_app_user_id);
  if not v_enabled then
    return false;
  end if;

  select route.binding_id
    into v_binding_id
  from public.fan_action_producer_routes route
  where route.action_code = p_action_code;

  v_enabled:=p_creator_id is not null
    and p_campaign_id is not null
    and exists (
      select 1
      from public.fan_action_verified_campaigns verified
      where verified.binding_id = v_binding_id
        and verified.campaign_id = p_campaign_id
        and verified.creator_id = p_creator_id
    );
  if not v_enabled and exists(select 1 from public.fan_action_bindings where id=v_binding_id and binding_version>=2) then
    raise exception 'FAN_ACTION_CONTEXT_NOT_VERIFIED';
  end if;
  return v_enabled;

end;
$$;
