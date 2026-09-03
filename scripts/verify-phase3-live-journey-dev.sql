\set ON_ERROR_STOP on

begin;

do $$
declare
  selected_claim public.live_collectible_claims%rowtype;
  completion_count bigint;
  ticket_count bigint;
  claim_count bigint;
  idempotency_count bigint;
  job_count bigint;
  expected_claim_id uuid := 'ec0ad5b8-159e-44f0-a828-45a70acbee21';
  expected_tx_hash text := '0xbd8443510fc3d0a5819f7ec3a295517997f9c71f7b6a50d35e61de54ec753853';
  before_projection jsonb;
  after_projection jsonb;
  fake_event_id uuid := extensions.gen_random_uuid();
  delete_rejected boolean := false;
begin
  select claim.* into strict selected_claim
  from public.live_collectible_claims claim
  join public.live_events live on live.id = claim.live_event_id
  where live.slug = 'p3-collectible-20260904';

  select count(*) into completion_count
  from public.live_journey_completions completion
  where completion.app_user_id = selected_claim.app_user_id
    and completion.live_event_id = selected_claim.live_event_id;

  select count(*) into ticket_count
  from public.live_journey_completions completion
  join public.fan_ticket_ledger ledger
    on ledger.id = completion.ticket_ledger_id
   and ledger.app_user_id = completion.app_user_id
   and ledger.source_type = 'journey_completion'
   and ledger.source_id = completion.id
   and ledger.entry_kind = 'credit'
   and ledger.amount = completion.bonus_ticket_amount
  where completion.app_user_id = selected_claim.app_user_id
    and completion.live_event_id = selected_claim.live_event_id;

  select count(*) into claim_count
  from public.live_collectible_claims claim
  where claim.id = selected_claim.id;

  select count(*) into idempotency_count
  from public.live_collectible_claim_idempotency keyed
  where keyed.claim_id = selected_claim.id;

  select count(*) into job_count
  from public.blockchain_jobs job
  where job.id = selected_claim.blockchain_job_id
    and job.entity_type = 'collectible'
    and job.entity_id = selected_claim.id
    and job.operation_key = 'byus:collectible:v1:' || selected_claim.id::text
    and job.status = 'COMPLETED'
    and job.tx_hash = expected_tx_hash
    and job.token_id = 1
    and job.payload->>'claimId' = expected_claim_id::text
    and job.payload->'workerSubmission'->>'txHash' = expected_tx_hash;

  if selected_claim.id <> expected_claim_id
     or selected_claim.business_status <> 'claimed'
     or selected_claim.mint_status <> 'minted'
     or selected_claim.tx_hash <> expected_tx_hash
     or selected_claim.token_id <> 1
     or completion_count <> 1 or ticket_count <> 1 or claim_count <> 1
     or idempotency_count <> 1 or job_count <> 1 then
    raise exception 'PHASE3_DEV_SETTLEMENT_FAILED claim=% mint_status=% tx=% token=% completion=% ticket=% claim_count=% idempotency=% job=%',
      selected_claim.id, selected_claim.mint_status, selected_claim.tx_hash,
      selected_claim.token_id, completion_count, ticket_count, claim_count,
      idempotency_count, job_count;
  end if;

  before_projection := public.get_owned_live_journey(
    selected_claim.app_user_id, 'p3-collectible-20260904'
  );

  insert into public.fan_product_events(
    id, schema_version, event_name, app_user_id, source,
    idempotency_key, occurred_at, properties, live_event_id
  ) values (
    fake_event_id, 1, 'journey_completed', selected_claim.app_user_id,
    'phase3.dev.tamper-proof', 'phase3-dev-tamper-' || fake_event_id::text,
    pg_catalog.statement_timestamp(), '{}'::jsonb, selected_claim.live_event_id
  );

  after_projection := public.get_owned_live_journey(
    selected_claim.app_user_id, 'p3-collectible-20260904'
  );
  if after_projection is distinct from before_projection then
    raise exception 'PHASE3_PRODUCT_EVENT_CHANGED_ELIGIBILITY';
  end if;

  begin
    delete from public.fan_product_events where id = fake_event_id;
  exception when others then
    if sqlerrm like '%append-only%' then
      delete_rejected := true;
    else
      raise;
    end if;
  end;
  if not delete_rejected then
    raise exception 'PHASE3_PRODUCT_EVENT_DELETE_NOT_REJECTED';
  end if;
end $$;

select jsonb_build_object(
  'status', 'PASS',
  'liveSlug', 'p3-collectible-20260904',
  'journeyCompletions', (
    select count(*) from public.live_journey_completions completion
    join public.live_events live on live.id = completion.live_event_id
    where live.slug = 'p3-collectible-20260904'
  ),
  'ticketSources', (
    select count(*) from public.fan_ticket_ledger ledger
    join public.live_journey_completions completion on completion.ticket_ledger_id = ledger.id
    join public.live_events live on live.id = completion.live_event_id
    where live.slug = 'p3-collectible-20260904'
      and ledger.source_type = 'journey_completion'
  ),
  'claims', (
    select count(*) from public.live_collectible_claims claim
    join public.live_events live on live.id = claim.live_event_id
    where live.slug = 'p3-collectible-20260904'
  ),
  'idempotencyRows', (
    select count(*) from public.live_collectible_claim_idempotency keyed
    where keyed.claim_id = 'ec0ad5b8-159e-44f0-a828-45a70acbee21'
  ),
  'mintStatus', (
    select claim.mint_status from public.live_collectible_claims claim
    where claim.id = 'ec0ad5b8-159e-44f0-a828-45a70acbee21'
  ),
  'txHash', (
    select claim.tx_hash from public.live_collectible_claims claim
    where claim.id = 'ec0ad5b8-159e-44f0-a828-45a70acbee21'
  ),
  'tokenId', (
    select claim.token_id from public.live_collectible_claims claim
    where claim.id = 'ec0ad5b8-159e-44f0-a828-45a70acbee21'
  ),
  'operationKeys', (
    select count(*) from public.blockchain_jobs job
    join public.live_collectible_claims claim on claim.blockchain_job_id = job.id
    join public.live_events live on live.id = claim.live_event_id
    where live.slug = 'p3-collectible-20260904'
      and job.operation_key = 'byus:collectible:v1:' || claim.id::text
  ),
  'productEventInsertionChangedEligibility', false,
  'productEventDeletionRejected', true
) as phase3_dev_reconciliation;

rollback;
