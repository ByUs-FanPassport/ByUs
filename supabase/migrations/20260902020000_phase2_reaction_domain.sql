-- Phase 2: Passport-less first Reaction with an independent business identity
-- and one canonical on-chain job. The deployed ByUsStamp contract is reused
-- only as a generic mint adapter; a Reaction is never modeled as a Stamp.

alter table public.blockchain_jobs drop constraint blockchain_jobs_entity_type_check;
alter table public.blockchain_jobs add constraint blockchain_jobs_entity_type_check
  check (entity_type in ('passport', 'stamp', 'reaction'));

create table public.fan_reactions (
  id uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  business_status text not null default 'completed' check (business_status='completed'),
  mint_status public.credential_mint_status not null default 'queued',
  blockchain_job_id uuid not null unique references public.blockchain_jobs(id) on delete restrict,
  tx_hash text,
  token_id numeric(78,0),
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(app_user_id,celebrity_id),
  unique(id,app_user_id,celebrity_id),
  constraint fan_reactions_mint_result_consistent check (
    (mint_status='minted' and tx_hash ~ '^0x[0-9a-fA-F]{64}$' and token_id>0)
    or (mint_status<>'minted' and tx_hash is null and token_id is null)
  )
);
create index fan_reactions_owner_idx on public.fan_reactions(app_user_id,celebrity_id);
create trigger fan_reactions_set_updated_at before update on public.fan_reactions
for each row execute function public.set_updated_at();

create function public.assert_reaction_blockchain_job_link(
  p_reaction_id uuid,p_owner_id uuid,p_celebrity_id uuid,
  p_mint_status public.credential_mint_status,p_job_id uuid,
  p_tx_hash text,p_token_id numeric
) returns void language plpgsql set search_path='' as $$
declare job public.blockchain_jobs%rowtype; slug text; expected public.credential_mint_status;
begin
  select * into job from public.blockchain_jobs where id=p_job_id;
  if not found or job.entity_type<>'reaction' or job.entity_id<>p_reaction_id
    or job.operation_key<>'byus:reaction:v1:'||p_reaction_id::text or job.payload_version<>1
  then raise exception 'reaction blockchain job identity mismatch'; end if;
  select c.slug into strict slug from public.celebrities c where c.id=p_celebrity_id;
  if jsonb_typeof(job.payload)<>'object'
    or not (job.payload ?& array['recipient','celebritySlug','issuanceId','reactionType'])
    or job.payload->>'celebritySlug'<>slug
    or job.payload->>'reactionType'<>'FirstReaction'
    or coalesce(job.payload->>'issuanceId','') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(job.payload->>'recipient','') !~ '^0x[0-9a-fA-F]{40}$'
    or not exists(select 1 from public.user_wallets w where w.app_user_id=p_owner_id
      and w.chain_id=91342 and w.provider='privy' and w.wallet_type='embedded'
      and w.address=lower(job.payload->>'recipient'))
  then raise exception 'reaction blockchain job payload mismatch'; end if;
  expected:=case job.status when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if p_mint_status<>expected then raise exception 'reaction mint status mismatch'; end if;
  if job.status='COMPLETED' and (p_tx_hash is distinct from job.tx_hash or p_token_id is distinct from job.token_id)
  then raise exception 'reaction mint result mismatch'; end if;
end $$;

create function public.validate_reaction_blockchain_job_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_reaction_blockchain_job_link(new.id,new.app_user_id,new.celebrity_id,
    new.mint_status,new.blockchain_job_id,new.tx_hash,new.token_id);
  return new;
end $$;
create trigger fan_reactions_validate_job before insert or update of blockchain_job_id,mint_status,tx_hash,token_id
on public.fan_reactions for each row execute function public.validate_reaction_blockchain_job_link();

create function public.reject_reaction_business_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or new.id<>old.id or new.app_user_id<>old.app_user_id
    or new.celebrity_id<>old.celebrity_id or new.business_status<>old.business_status
    or new.blockchain_job_id<>old.blockchain_job_id or new.completed_at<>old.completed_at
  then raise exception 'fan reaction is append-only'; end if;
  if old.mint_status='minted' and new is distinct from old then raise exception 'minted reaction is immutable'; end if;
  return new;
end $$;
create trigger fan_reactions_business_immutable before update or delete on public.fan_reactions
for each row execute function public.reject_reaction_business_mutation();

create or replace function public.enforce_linked_blockchain_job_immutability()
returns trigger language plpgsql set search_path='' as $$
declare is_linked boolean; worker_submission_key_count integer;
begin
  select exists(
    select 1 from public.fan_passports where blockchain_job_id=old.id union all
    select 1 from public.stamps where blockchain_job_id=old.id union all
    select 1 from public.fan_reactions where blockchain_job_id=old.id
  ) into is_linked;
  if not is_linked then return new; end if;
  if new.entity_type is distinct from old.entity_type or new.entity_id is distinct from old.entity_id
    or new.operation_key is distinct from old.operation_key or new.payload_version is distinct from old.payload_version
    or new.idempotency_key is distinct from old.idempotency_key
  then raise exception 'linked blockchain job business identity is immutable'; end if;
  if new.payload ? 'workerSubmission' and new.tx_hash is distinct from new.payload->'workerSubmission'->>'txHash'
  then raise exception 'linked blockchain job transaction hash conflicts with prepared submission'; end if;
  if new.payload=old.payload then return new; end if;
  if old.payload ? 'workerSubmission' or not(new.payload ? 'workerSubmission')
    or new.payload-'workerSubmission'<>old.payload or jsonb_typeof(new.payload->'workerSubmission')<>'object'
  then raise exception 'linked blockchain job payload is immutable'; end if;
  select count(*) into worker_submission_key_count from jsonb_object_keys(new.payload->'workerSubmission');
  if worker_submission_key_count<>2 or not((new.payload->'workerSubmission') ?& array['txHash','signedTransaction'])
    or coalesce(new.payload->'workerSubmission'->>'txHash','') !~ '^0x[0-9a-fA-F]{64}$'
    or coalesce(new.payload->'workerSubmission'->>'signedTransaction','') !~ '^0x[0-9a-fA-F]+$'
    or length(coalesce(new.payload->'workerSubmission'->>'signedTransaction',''))>262144
    or new.payload->'workerSubmission'->>'txHash' is distinct from new.tx_hash
  then raise exception 'linked blockchain job payload is immutable'; end if;
  return new;
end $$;

create or replace function public.reconcile_credential_from_blockchain_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected public.credential_mint_status; linked_count integer; affected integer;
begin
  select (select count(*) from public.fan_passports where blockchain_job_id=new.id)
    +(select count(*) from public.stamps where blockchain_job_id=new.id)
    +(select count(*) from public.fan_reactions where blockchain_job_id=new.id) into linked_count;
  if linked_count=0 then return new; end if;
  if linked_count<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  expected:=case new.status when 'PENDING' then 'queued'::public.credential_mint_status
    when 'PROCESSING' then 'processing'::public.credential_mint_status
    when 'RETRYING' then 'retryable'::public.credential_mint_status
    when 'FAILED' then 'permanent_failure'::public.credential_mint_status
    when 'COMPLETED' then 'minted'::public.credential_mint_status end;
  if new.entity_type='passport' then
    update public.fan_passports set mint_status=expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='stamp' then
    update public.stamps set mint_status=expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='reaction' then
    update public.fan_reactions set mint_status=expected,
      tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end
      where id=new.entity_id and blockchain_job_id=new.id;
  end if;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  return new;
end $$;

create function public.react_to_creator(
  p_app_user_id uuid,p_celebrity_id uuid,p_reaction_id uuid,p_job_id uuid,p_issuance_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.fan_reactions%rowtype; slug text; recipient text; payload jsonb;
begin
  if p_reaction_id is null or p_job_id is null or coalesce(p_issuance_id,'') !~ '^0x[0-9a-f]{64}$'
  then raise exception 'P2_REACTION_INPUT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reaction:'||p_app_user_id::text||':'||p_celebrity_id::text,0));
  perform 1 from public.app_users u where u.id=p_app_user_id and u.status='active' for update;
  if not found then raise exception 'P2_USER_UNAVAILABLE' using errcode='42501'; end if;
  select * into existing from public.fan_reactions r where r.app_user_id=p_app_user_id and r.celebrity_id=p_celebrity_id;
  if found then return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'created',false,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id)); end if;
  select c.slug into slug from public.celebrities c where c.id=p_celebrity_id and c.status='published' and c.archived_at is null for key share;
  if not found then raise exception 'P2_CREATOR_NOT_FOUND' using errcode='P0002'; end if;
  select w.address into recipient from public.user_wallets w where w.app_user_id=p_app_user_id and w.chain_id=91342
    and w.provider='privy' and w.wallet_type='embedded' for key share;
  if not found then raise exception 'P2_WALLET_NOT_READY' using errcode='55000'; end if;
  payload:=jsonb_build_object('recipient',recipient,'celebritySlug',slug,'issuanceId',p_issuance_id,'reactionType','FirstReaction');
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload)
    values(p_job_id,'reaction',p_reaction_id,'byus:reaction:v1:'||p_reaction_id::text,1,payload);
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id)
    values(p_reaction_id,p_app_user_id,p_celebrity_id,p_job_id) returning * into existing;
  return jsonb_build_object('reactionId',existing.id,'status',existing.business_status,
    'mintStatus',existing.mint_status,'blockchainJobId',existing.blockchain_job_id,'created',true,
    'passportExists',exists(select 1 from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=p_celebrity_id));
end $$;

alter table public.fan_reactions enable row level security;
alter table public.fan_reactions force row level security;
revoke all on table public.fan_reactions from public,anon,authenticated,service_role;
revoke all on function public.react_to_creator(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.react_to_creator(uuid,uuid,uuid,uuid,text) to service_role;
revoke all on function public.assert_reaction_blockchain_job_link(uuid,uuid,uuid,public.credential_mint_status,uuid,text,numeric),
  public.validate_reaction_blockchain_job_link(),public.reject_reaction_business_mutation() from public,anon,authenticated,service_role;
