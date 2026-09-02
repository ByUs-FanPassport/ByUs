-- Phase 2: attach a completed Reaction to a later Passport without minting it
-- again. The derived Stamp explicitly points at Reaction chain evidence and
-- never owns a blockchain job.

alter type public.fan_activity_type add value if not exists 'first_reaction';

create table public.first_reaction_stamps (
  id uuid primary key default extensions.gen_random_uuid(),
  reaction_id uuid not null unique references public.fan_reactions(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  passport_id uuid not null,
  activity_id uuid not null unique,
  business_status text not null default 'issued' check (business_status='issued'),
  blockchain_source_type text not null default 'reaction' check (blockchain_source_type='reaction'),
  blockchain_source_id uuid not null,
  mint_status public.credential_mint_status not null,
  tx_hash text,
  token_id numeric(78,0),
  issued_at timestamptz not null default now(),
  constraint first_reaction_stamp_owner_fk foreign key(passport_id,app_user_id,celebrity_id)
    references public.fan_passports(id,app_user_id,celebrity_id) on delete restrict,
  constraint first_reaction_stamp_activity_fk foreign key(activity_id,app_user_id,celebrity_id)
    references public.fan_activities(id,app_user_id,celebrity_id) on delete restrict,
  constraint first_reaction_stamp_source_fk foreign key(blockchain_source_id,app_user_id,celebrity_id)
    references public.fan_reactions(id,app_user_id,celebrity_id) on delete restrict,
  constraint first_reaction_stamp_source_identity check (blockchain_source_id=reaction_id),
  constraint first_reaction_stamp_mint_result check (
    (mint_status='minted' and tx_hash ~ '^0x[0-9a-fA-F]{64}$' and token_id>0)
    or (mint_status<>'minted' and tx_hash is null and token_id is null)
  )
);
create index first_reaction_stamps_passport_idx on public.first_reaction_stamps(passport_id,issued_at desc);

create function public.reject_first_reaction_stamp_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'first reaction stamp is immutable'; end if;
  if new.id<>old.id or new.reaction_id<>old.reaction_id or new.app_user_id<>old.app_user_id
    or new.celebrity_id<>old.celebrity_id or new.passport_id<>old.passport_id
    or new.activity_id<>old.activity_id or new.business_status<>old.business_status
    or new.blockchain_source_type<>old.blockchain_source_type or new.blockchain_source_id<>old.blockchain_source_id
    or new.issued_at<>old.issued_at then raise exception 'first reaction stamp is immutable'; end if;
  if old.mint_status='minted' and new is distinct from old then raise exception 'minted first reaction stamp is immutable'; end if;
  return new;
end $$;
create trigger first_reaction_stamps_immutable before update or delete on public.first_reaction_stamps
for each row execute function public.reject_first_reaction_stamp_mutation();

create function public.attach_reaction_to_new_passport()
returns trigger language plpgsql security definer set search_path='' as $$
declare reaction public.fan_reactions%rowtype; activity_id uuid:=extensions.gen_random_uuid();
begin
  select * into reaction from public.fan_reactions r
  where r.app_user_id=new.app_user_id and r.celebrity_id=new.celebrity_id for update;
  if not found then return new; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
    values(activity_id,new.app_user_id,new.celebrity_id,'first_reaction','fan_reaction',reaction.id,reaction.completed_at)
    on conflict(activity_type,source_type,source_id) do nothing;
  select a.id into strict activity_id from public.fan_activities a
    where a.activity_type='first_reaction' and a.source_type='fan_reaction' and a.source_id=reaction.id
      and a.app_user_id=new.app_user_id and a.celebrity_id=new.celebrity_id;
  insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,
    blockchain_source_id,mint_status,tx_hash,token_id)
  values(reaction.id,new.app_user_id,new.celebrity_id,new.id,activity_id,reaction.id,
    reaction.mint_status,reaction.tx_hash,reaction.token_id)
  on conflict(reaction_id) do nothing;
  if not exists(select 1 from public.first_reaction_stamps s where s.reaction_id=reaction.id
    and s.passport_id=new.id and s.activity_id=activity_id)
  then raise exception 'reaction passport attachment conflict'; end if;
  return new;
end $$;
create trigger fan_passports_attach_first_reaction after insert on public.fan_passports
for each row execute function public.attach_reaction_to_new_passport();

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
    update public.fan_passports set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='stamp' then
    update public.stamps set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
  elsif new.entity_type='reaction' then
    update public.fan_reactions set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end where id=new.entity_id and blockchain_job_id=new.id;
    update public.first_reaction_stamps set mint_status=expected,tx_hash=case when new.status='COMPLETED' then new.tx_hash end,
      token_id=case when new.status='COMPLETED' then new.token_id end where reaction_id=new.entity_id;
  end if;
  get diagnostics affected=row_count;
  if new.entity_type='reaction' then
    if not exists(select 1 from public.fan_reactions where id=new.entity_id and blockchain_job_id=new.id)
      then raise exception 'linked blockchain job credential mismatch'; end if;
  elsif affected<>1 then raise exception 'linked blockchain job credential mismatch'; end if;
  return new;
end $$;

alter table public.first_reaction_stamps enable row level security;
alter table public.first_reaction_stamps force row level security;
revoke all on table public.first_reaction_stamps from public,anon,authenticated,service_role;
revoke all on function public.attach_reaction_to_new_passport(),public.reject_first_reaction_stamp_mutation()
  from public,anon,authenticated,service_role;
