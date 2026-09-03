-- Phase 3 Journey-completion Collectible claim. Claim eligibility uses only
-- operational Journey completion and an immutable, first-observed LIVE end.

alter table public.live_journey_requirement_revisions
  add column claim_window_duration_hours integer not null default 48,
  add constraint live_journey_claim_window_duration_bounded
    check (claim_window_duration_hours between 1 and 720);

alter table public.blockchain_jobs drop constraint blockchain_jobs_entity_type_check;
alter table public.blockchain_jobs add constraint blockchain_jobs_entity_type_check
  check (entity_type in ('passport', 'stamp', 'reaction', 'collectible'));

create table public.live_collectible_claim_windows (
  live_event_id uuid primary key references public.live_events(id) on delete restrict,
  schedule_revision integer not null check (schedule_revision > 0),
  opens_at timestamptz not null,
  frozen_at timestamptz not null default pg_catalog.statement_timestamp(),
  unique (live_event_id, schedule_revision),
  constraint live_collectible_window_freeze_order check (frozen_at >= opens_at)
);

create table public.live_collectible_claims (
  id uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  journey_completion_id uuid not null,
  requirement_revision_id uuid not null,
  frozen_ends_at timestamptz not null,
  claim_window_until timestamptz not null,
  business_status text not null default 'claimed' check (business_status = 'claimed'),
  mint_status public.credential_mint_status not null default 'queued',
  blockchain_job_id uuid not null unique references public.blockchain_jobs(id) on delete restrict,
  tx_hash text,
  token_id numeric(78,0),
  claimed_at timestamptz not null default pg_catalog.statement_timestamp(),
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  unique (app_user_id, live_event_id),
  unique (journey_completion_id),
  unique (id, app_user_id, live_event_id),
  foreign key (journey_completion_id, app_user_id, live_event_id)
    references public.live_journey_completions(id, app_user_id, live_event_id) on delete restrict,
  foreign key (requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id) on delete restrict,
  constraint live_collectible_claim_window_shape check (
    frozen_ends_at < claim_window_until and claimed_at >= frozen_ends_at and claimed_at < claim_window_until
  ),
  constraint live_collectible_mint_result_shape check (
    (mint_status = 'minted' and tx_hash ~ '^0x[0-9a-fA-F]{64}$' and token_id > 0)
    or (mint_status <> 'minted' and tx_hash is null and token_id is null)
  )
);

create table public.live_collectible_claim_idempotency (
  idempotency_key uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  claim_id uuid not null references public.live_collectible_claims(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

create index live_collectible_claims_owner_idx on public.live_collectible_claims(app_user_id, claimed_at desc);
create index live_collectible_idempotency_owner_idx on public.live_collectible_claim_idempotency(app_user_id, live_event_id);
create trigger live_collectible_claims_set_updated_at before update on public.live_collectible_claims
for each row execute function public.set_updated_at();

create function public.reject_live_collectible_business_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or new.id<>old.id or new.app_user_id<>old.app_user_id
    or new.live_event_id<>old.live_event_id or new.journey_completion_id<>old.journey_completion_id
    or new.requirement_revision_id<>old.requirement_revision_id or new.frozen_ends_at<>old.frozen_ends_at
    or new.claim_window_until<>old.claim_window_until or new.business_status<>old.business_status
    or new.blockchain_job_id<>old.blockchain_job_id or new.claimed_at<>old.claimed_at
  then raise exception 'Collectible claim business identity is immutable'; end if;
  if old.mint_status='minted' and new is distinct from old then raise exception 'minted Collectible claim is immutable'; end if;
  return new;
end $$;
create trigger live_collectible_claims_business_immutable before update or delete on public.live_collectible_claims
for each row execute function public.reject_live_collectible_business_mutation();
create trigger live_collectible_claims_reject_truncate before truncate on public.live_collectible_claims
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_collectible_windows_immutable before update or delete on public.live_collectible_claim_windows
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_collectible_windows_reject_truncate before truncate on public.live_collectible_claim_windows
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_collectible_idempotency_immutable before update or delete on public.live_collectible_claim_idempotency
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_collectible_idempotency_reject_truncate before truncate on public.live_collectible_claim_idempotency
for each statement execute function public.reject_live_journey_immutable_mutation();

create function public.project_live_collectible_claim(p_claim_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id', claim.id,
    'liveEventId', claim.live_event_id,
    'journeyCompletionId', claim.journey_completion_id,
    'businessStatus', claim.business_status,
    'claimedAt', claim.claimed_at,
    'mint', jsonb_build_object(
      'status', claim.mint_status,
      'txHash', claim.tx_hash,
      'tokenId', case when claim.token_id is null then null else claim.token_id::text end
    )
  ) from public.live_collectible_claims claim where claim.id=p_claim_id
$$;

create function public.freeze_live_collectible_window(p_live_event_id uuid, p_observed_at timestamptz)
returns public.live_collectible_claim_windows language plpgsql security definer set search_path='' as $$
declare live_record public.live_events%rowtype; frozen public.live_collectible_claim_windows%rowtype;
  override_ended_at timestamptz; delayed_override_end timestamptz; authoritative_ended_at timestamptz;
begin
  select * into live_record from public.live_events where id=p_live_event_id for update;
  if not found or public.live_effective_status_at(p_live_event_id,p_observed_at)<>'ended' then
    raise exception 'P3_COLLECTIBLE_WINDOW_NOT_OPEN' using errcode='55000';
  end if;
  select override.effective_from into override_ended_at from public.live_status_overrides override
  where override.live_event_id=p_live_event_id and override.effective_status='ended'
    and override.effective_from<=p_observed_at
    and (override.effective_until is null or p_observed_at<override.effective_until)
  order by override.effective_from desc,override.created_at desc,override.id desc limit 1;
  select pg_catalog.max(override.effective_until) into delayed_override_end from public.live_status_overrides override
  where override.live_event_id=p_live_event_id and override.effective_status in ('scheduled','live')
    and override.effective_until is not null and override.effective_until<=p_observed_at;
  authoritative_ended_at:=case when override_ended_at is not null then override_ended_at
    else greatest(live_record.ends_at,delayed_override_end) end;
  insert into public.live_collectible_claim_windows(live_event_id,schedule_revision,opens_at,frozen_at)
  values(live_record.id,live_record.schedule_revision,authoritative_ended_at,p_observed_at)
  on conflict (live_event_id) do nothing;
  select * into strict frozen from public.live_collectible_claim_windows where live_event_id=p_live_event_id;
  return frozen;
end $$;

create function public.get_owned_live_collectible(p_app_user_id uuid,p_live_slug text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare live_record public.live_events%rowtype; completion public.live_journey_completions%rowtype;
  requirement public.live_journey_requirement_revisions%rowtype; frozen public.live_collectible_claim_windows%rowtype;
  claim public.live_collectible_claims%rowtype; observed_at timestamptz:=pg_catalog.statement_timestamp();
  from_at timestamptz; until_at timestamptz; eligible boolean;
begin
  if p_app_user_id is null or p_live_slug is null or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  perform 1 from public.app_users where id=p_app_user_id and status='active'; if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select * into live_record from public.live_events where slug=p_live_slug and publication_status='published' and archived_at is null;
  if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select * into completion from public.live_journey_completions where app_user_id=p_app_user_id and live_event_id=live_record.id;
  if found then select * into strict requirement from public.live_journey_requirement_revisions where id=completion.requirement_revision_id; end if;
  select * into frozen from public.live_collectible_claim_windows where live_event_id=live_record.id;
  if not found and public.live_effective_status_at(live_record.id,observed_at)='ended' then frozen:=public.freeze_live_collectible_window(live_record.id,observed_at); end if;
  from_at:=coalesce(frozen.opens_at,live_record.ends_at);
  until_at:=from_at+pg_catalog.make_interval(hours=>coalesce(requirement.claim_window_duration_hours,48));
  select * into claim from public.live_collectible_claims where app_user_id=p_app_user_id and live_event_id=live_record.id;
  eligible:=completion.id is not null and frozen.live_event_id is not null and claim.id is null and observed_at>=from_at and observed_at<until_at;
  return jsonb_build_object('eligible',eligible,'claimWindow',jsonb_build_object('from',from_at,'until',until_at),
    'claim',case when claim.id is null then null else public.project_live_collectible_claim(claim.id) end);
end $$;

create function public.assert_collectible_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare job public.blockchain_jobs%rowtype; expected public.credential_mint_status; live_slug text; celebrity_slug text; key_count integer;
begin
  select * into strict job from public.blockchain_jobs where id=new.blockchain_job_id;
  select live.slug,celebrity.slug into strict live_slug,celebrity_slug from public.live_events live join public.celebrities celebrity on celebrity.id=live.celebrity_id where live.id=new.live_event_id;
  if job.entity_type<>'collectible' or job.entity_id<>new.id or job.operation_key<>'byus:collectible:v1:'||new.id::text or job.payload_version<>1 then raise exception 'Collectible blockchain job identity mismatch'; end if;
  select count(*) into key_count from jsonb_object_keys(job.payload);
  if key_count not in (5,6) or not(job.payload ?& array['recipient','celebritySlug','liveSlug','claimId','metadataVersion'])
    or job.payload->>'celebritySlug'<>celebrity_slug or job.payload->>'liveSlug'<>live_slug or job.payload->>'claimId'<>new.id::text
    or job.payload->>'metadataVersion'<>'1' or coalesce(job.payload->>'recipient','') !~ '^0x[0-9a-fA-F]{40}$'
    or not exists(select 1 from public.user_wallets w where w.app_user_id=new.app_user_id and w.chain_id=91342 and w.provider='privy' and w.wallet_type='embedded' and w.address=lower(job.payload->>'recipient'))
  then raise exception 'Collectible blockchain job payload mismatch'; end if;
  expected:=case job.status when 'PENDING' then 'queued'::public.credential_mint_status when 'PROCESSING' then 'processing'::public.credential_mint_status when 'RETRYING' then 'retryable'::public.credential_mint_status when 'FAILED' then 'permanent_failure'::public.credential_mint_status when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.mint_status<>expected then raise exception 'Collectible mint status mismatch'; end if;
  if job.status='COMPLETED' and (new.tx_hash is distinct from job.tx_hash or new.token_id is distinct from job.token_id) then raise exception 'Collectible mint result mismatch'; end if;
  return new;
end $$;
create trigger live_collectible_claim_validate_job before insert or update of blockchain_job_id,mint_status,tx_hash,token_id on public.live_collectible_claims
for each row execute function public.assert_collectible_blockchain_job_link();

create function public.claim_owned_live_collectible(p_app_user_id uuid,p_live_slug text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare live_record public.live_events%rowtype; completion public.live_journey_completions%rowtype; requirement public.live_journey_requirement_revisions%rowtype;
  frozen public.live_collectible_claim_windows%rowtype; existing_key public.live_collectible_claim_idempotency%rowtype;
  existing_claim public.live_collectible_claims%rowtype; recipient text; celebrity_slug text; claim_id uuid:=extensions.gen_random_uuid(); job_id uuid:=extensions.gen_random_uuid();
  observed_at timestamptz:=pg_catalog.statement_timestamp(); until_at timestamptz; payload jsonb;
begin
  if p_app_user_id is null or p_idempotency_key is null or p_live_slug is null or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collectible:idempotency:'||p_idempotency_key::text,0));
  select * into existing_key from public.live_collectible_claim_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if existing_key.app_user_id<>p_app_user_id or not exists(select 1 from public.live_events where id=existing_key.live_event_id and slug=p_live_slug) then raise exception 'P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
    return jsonb_build_object('claim',public.project_live_collectible_claim(existing_key.claim_id),'replayed',true);
  end if;
  perform 1 from public.app_users where id=p_app_user_id and status='active' for share; if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select live.* into live_record from public.live_events live where live.slug=p_live_slug and live.publication_status='published' and live.archived_at is null;
  if not found then raise exception 'P3_COLLECTIBLE_NOT_FOUND'; end if;
  select slug into strict celebrity_slug from public.celebrities where id=live_record.celebrity_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collectible:target:'||p_app_user_id::text||':'||live_record.id::text,0));
  select * into existing_claim from public.live_collectible_claims where app_user_id=p_app_user_id and live_event_id=live_record.id;
  if found then raise exception 'P3_COLLECTIBLE_IDEMPOTENCY_CONFLICT' using errcode='23514'; end if;
  select * into completion from public.live_journey_completions where app_user_id=p_app_user_id and live_event_id=live_record.id;
  if not found then raise exception 'P3_COLLECTIBLE_JOURNEY_INCOMPLETE' using errcode='55000'; end if;
  select * into strict requirement from public.live_journey_requirement_revisions where id=completion.requirement_revision_id;
  select * into frozen from public.live_collectible_claim_windows where live_event_id=live_record.id;
  if not found then frozen:=public.freeze_live_collectible_window(live_record.id,observed_at); end if;
  until_at:=frozen.opens_at+pg_catalog.make_interval(hours=>requirement.claim_window_duration_hours);
  if observed_at>=until_at then raise exception 'P3_COLLECTIBLE_WINDOW_EXPIRED' using errcode='55000'; end if;
  select address into recipient from public.user_wallets where app_user_id=p_app_user_id and chain_id=91342 and provider='privy' and wallet_type='embedded' for key share;
  if not found then raise exception 'P3_COLLECTIBLE_WALLET_NOT_READY' using errcode='55000'; end if;
  payload:=jsonb_build_object('recipient',recipient,'celebritySlug',celebrity_slug,'liveSlug',live_record.slug,'claimId',claim_id::text,'metadataVersion',1);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload) values(job_id,'collectible',claim_id,'byus:collectible:v1:'||claim_id::text,1,payload);
  insert into public.live_collectible_claims(id,app_user_id,live_event_id,journey_completion_id,requirement_revision_id,frozen_ends_at,claim_window_until,blockchain_job_id,claimed_at)
  values(claim_id,p_app_user_id,live_record.id,completion.id,completion.requirement_revision_id,frozen.opens_at,until_at,job_id,observed_at) returning * into existing_claim;
  insert into public.live_collectible_claim_idempotency values(p_idempotency_key,p_app_user_id,live_record.id,claim_id,observed_at);
  return jsonb_build_object('claim',public.project_live_collectible_claim(claim_id),'replayed',false);
end $$;

create or replace function public.enforce_linked_blockchain_job_immutability()
returns trigger language plpgsql set search_path='' as $$
declare is_linked boolean; worker_submission_key_count integer;
begin
  select exists(select 1 from public.fan_passports where blockchain_job_id=old.id union all select 1 from public.stamps where blockchain_job_id=old.id union all select 1 from public.fan_reactions where blockchain_job_id=old.id union all select 1 from public.live_collectible_claims where blockchain_job_id=old.id) into is_linked;
  if not is_linked then return new; end if;
  if new.entity_type is distinct from old.entity_type or new.entity_id is distinct from old.entity_id or new.operation_key is distinct from old.operation_key or new.payload_version is distinct from old.payload_version or new.idempotency_key is distinct from old.idempotency_key then raise exception 'linked blockchain job business identity is immutable'; end if;
  if new.payload ? 'workerSubmission' and new.tx_hash is distinct from new.payload->'workerSubmission'->>'txHash' then raise exception 'linked blockchain job transaction hash conflicts with prepared submission'; end if;
  if new.payload=old.payload then return new; end if;
  if old.payload ? 'workerSubmission' or not(new.payload ? 'workerSubmission') or new.payload-'workerSubmission'<>old.payload or jsonb_typeof(new.payload->'workerSubmission')<>'object' then raise exception 'linked blockchain job payload is immutable'; end if;
  select count(*) into worker_submission_key_count from jsonb_object_keys(new.payload->'workerSubmission');
  if worker_submission_key_count<>2 or not((new.payload->'workerSubmission') ?& array['txHash','signedTransaction']) or coalesce(new.payload->'workerSubmission'->>'txHash','') !~ '^0x[0-9a-fA-F]{64}$' or coalesce(new.payload->'workerSubmission'->>'signedTransaction','') !~ '^0x[0-9a-fA-F]+$' or length(coalesce(new.payload->'workerSubmission'->>'signedTransaction',''))>262144 or new.payload->'workerSubmission'->>'txHash' is distinct from new.tx_hash then raise exception 'linked blockchain job payload is immutable'; end if;
  return new;
end $$;

create or replace function public.reconcile_credential_from_blockchain_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected public.credential_mint_status; linked_count integer; affected integer;
begin
  select (select count(*) from public.fan_passports where blockchain_job_id=new.id)+(select count(*) from public.stamps where blockchain_job_id=new.id)+(select count(*) from public.fan_reactions where blockchain_job_id=new.id)+(select count(*) from public.live_collectible_claims where blockchain_job_id=new.id) into linked_count;
  if linked_count=0 then return new; end if; if linked_count<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  expected:=case new.status when 'PENDING' then 'queued'::public.credential_mint_status when 'PROCESSING' then 'processing'::public.credential_mint_status when 'RETRYING' then 'retryable'::public.credential_mint_status when 'FAILED' then 'permanent_failure'::public.credential_mint_status when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.entity_type='passport' then update public.fan_passports set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='stamp' then update public.stamps set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='reaction' then update public.fan_reactions set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='collectible' then update public.live_collectible_claims set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id; end if;
  get diagnostics affected=row_count; if affected<>1 then raise exception 'linked blockchain job credential mismatch'; end if; return new;
end $$;

-- Capability-aware claim prevents an old/partially configured worker from
-- consuming Collectible attempts before its contract binding is available.
create index blockchain_jobs_capability_dispatch_idx on public.blockchain_jobs(entity_type,next_attempt_at,created_at)
where status in ('PENDING','RETRYING');

create function public.claim_blockchain_jobs(
  p_worker_id text,p_batch_size integer,p_lease_seconds integer,p_entity_types text[]
) returns setof public.blockchain_jobs language plpgsql security definer set search_path='' as $$
begin
  if p_worker_id is null or length(pg_catalog.btrim(p_worker_id))=0 then raise exception 'worker id is required'; end if;
  if p_batch_size<1 or p_batch_size>100 then raise exception 'batch size must be between 1 and 100'; end if;
  if p_lease_seconds<30 or p_lease_seconds>900 then raise exception 'lease seconds must be between 30 and 900'; end if;
  if p_entity_types is null or pg_catalog.cardinality(p_entity_types)=0
    or exists(select 1 from pg_catalog.unnest(p_entity_types) kind where kind not in ('passport','stamp','reaction','collectible'))
  then raise exception 'supported entity types are invalid'; end if;
  return query with candidates as (
    select id from public.blockchain_jobs where status in ('PENDING','RETRYING') and next_attempt_at<=pg_catalog.now()
      and attempts<max_attempts and entity_type=any(p_entity_types)
    order by next_attempt_at,created_at for update skip locked limit p_batch_size
  ) update public.blockchain_jobs jobs set status='PROCESSING',attempts=jobs.attempts+1,lease_owner=p_worker_id,
    lease_expires_at=pg_catalog.now()+pg_catalog.make_interval(secs=>p_lease_seconds),last_error_code=null,last_error_message=null
  from candidates where jobs.id=candidates.id returning jobs.*;
end $$;

create or replace function public.claim_blockchain_jobs(
  p_worker_id text,p_batch_size integer default 10,p_lease_seconds integer default 120
) returns setof public.blockchain_jobs language sql security definer set search_path='' as $$
  select * from public.claim_blockchain_jobs(
    p_worker_id,p_batch_size,p_lease_seconds,array['passport','stamp','reaction']::text[]
  )
$$;

alter table public.live_collectible_claim_windows enable row level security; alter table public.live_collectible_claim_windows force row level security;
alter table public.live_collectible_claims enable row level security; alter table public.live_collectible_claims force row level security;
alter table public.live_collectible_claim_idempotency enable row level security; alter table public.live_collectible_claim_idempotency force row level security;
revoke all on table public.live_collectible_claim_windows,public.live_collectible_claims,public.live_collectible_claim_idempotency from public,anon,authenticated,service_role;
revoke all on function public.get_owned_live_collectible(uuid,text),public.claim_owned_live_collectible(uuid,text,uuid),public.project_live_collectible_claim(uuid),public.freeze_live_collectible_window(uuid,timestamptz),public.assert_collectible_blockchain_job_link(),public.reject_live_collectible_business_mutation() from public,anon,authenticated,service_role;
revoke all on function public.claim_blockchain_jobs(text,integer,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_live_collectible(uuid,text),public.claim_owned_live_collectible(uuid,text,uuid) to service_role;
grant execute on function public.claim_blockchain_jobs(text,integer,integer,text[]) to service_role;
