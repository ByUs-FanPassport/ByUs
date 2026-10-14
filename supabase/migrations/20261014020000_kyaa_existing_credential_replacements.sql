-- Replacement evidence is additive; original business rows, jobs, rewards and EAS refs stay intact.
create table public.nft_credential_replacement_batches (
  batch_id text primary key check(batch_id ~ '^0x[0-9a-f]{64}$'),
  chain_id bigint not null check(chain_id=91342),
  migrator text not null check(migrator ~ '^0x[0-9a-f]{40}$'),
  environment_id text not null check(environment_id ~ '^0x[0-9a-f]{64}$'),
  merkle_root text not null check(merkle_root ~ '^0x[0-9a-f]{64}$'),
  manifest_hash text not null check(manifest_hash ~ '^0x[0-9a-f]{64}$'),
  max_items integer not null check(max_items between 1 and 10000),
  max_mints integer not null check(max_mints between 0 and max_items),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.nft_credential_replacements (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id text not null references public.nft_credential_replacement_batches(batch_id),
  leaf_hash text not null unique check(leaf_hash ~ '^0x[0-9a-f]{64}$'),
  credential_kind smallint not null check(credential_kind in (0,1)),
  old_contract text not null check(old_contract ~ '^0x[0-9a-f]{40}$'),
  old_token_id numeric(78,0) not null check(old_token_id>0),
  old_metadata_uri text not null check(length(old_metadata_uri) between 1 and 2048),
  old_tx_hash text not null check(old_tx_hash ~ '^0x[0-9a-f]{64}$'),
  new_contract text not null check(new_contract ~ '^0x[0-9a-f]{40}$' and new_contract<>old_contract),
  new_token_id numeric(78,0) not null check(new_token_id>0),
  new_metadata_uri text not null check(new_metadata_uri ~ '^ipfs://' and length(new_metadata_uri)<=2048),
  issuance_key text not null check(issuance_key ~ '^0x[0-9a-f]{64}$'),
  recipient text not null check(recipient ~ '^0x[0-9a-f]{40}$'),
  source_action_id text not null check(source_action_id ~ '^0x[0-9a-f]{64}$'),
  source_hub text not null check(source_hub ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78,0) not null check(block_number>=0),
  block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
  finalized_block_number numeric(78,0) not null check(finalized_block_number>=block_number),
  finalized_block_hash text not null check(finalized_block_hash ~ '^0x[0-9a-f]{64}$'),
  minted boolean not null,
  verified_at timestamptz not null default clock_timestamp(),
  unique(old_contract,old_token_id),unique(new_contract,new_token_id)
);
create table public.nft_credential_replacement_entities (
  entity_type text not null check(entity_type in ('passport','stamp','reaction','community_stamp','first_reaction_stamp')),
  entity_id uuid not null,
  app_user_id uuid not null references public.app_users(id),
  replacement_id uuid not null references public.nft_credential_replacements(id),
  original_tx_hash text not null check(original_tx_hash ~ '^0x[0-9a-f]{64}$'),
  primary key(entity_type,entity_id)
);
create index nft_replacement_entities_owner on public.nft_credential_replacement_entities(app_user_id,replacement_id);
alter table public.nft_credential_replacement_batches enable row level security;
alter table public.nft_credential_replacements enable row level security;
alter table public.nft_credential_replacement_entities enable row level security;
revoke all on public.nft_credential_replacement_batches,public.nft_credential_replacements,
  public.nft_credential_replacement_entities from public,anon,authenticated,service_role;

alter function public.effective_fan_action_mint(uuid,text,uuid,text,text,text) rename to original_fan_action_mint;
create function public.effective_fan_action_mint(p_app_user_id uuid,p_entity_type text,p_entity_id uuid,
  p_base_status text,p_base_tx_hash text,p_base_token_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare original jsonb; replacement public.nft_credential_replacements;
begin
  original:=public.original_fan_action_mint(p_app_user_id,p_entity_type,p_entity_id,p_base_status,p_base_tx_hash,p_base_token_id);
  if original->>'status'<>'minted' then return original; end if;
  select r.* into replacement from public.nft_credential_replacement_entities e
    join public.nft_credential_replacements r on r.id=e.replacement_id
    where e.app_user_id=p_app_user_id and e.entity_type=p_entity_type and e.entity_id=p_entity_id
      and e.original_tx_hash=lower(original->>'txHash') and r.old_token_id::text=original->>'tokenId';
  if not found then return original; end if;
  if not exists(select 1 from public.user_wallets where app_user_id=p_app_user_id
    and chain_id=91342 and address=replacement.recipient) then return original; end if;
  if p_entity_type='stamp' and exists(select 1 from public.stamps where id=p_entity_id and stamp_type='membership')
    and not exists(select 1 from public.stamps s join public.fan_activities a on a.id=s.activity_id
      join public.certification_submissions cs on a.source_type='certification_submission' and cs.id=a.source_id
      where s.id=p_entity_id and cs.status='approved') then return original; end if;
  return jsonb_build_object('status','minted','txHash',replacement.tx_hash,'tokenId',replacement.new_token_id::text,
    'nftContract',replacement.new_contract,'metadataUri',replacement.new_metadata_uri,
    'originalAsset',jsonb_build_object('nftContract',replacement.old_contract,'tokenId',replacement.old_token_id::text,
      'metadataUri',replacement.old_metadata_uri,'txHash',replacement.old_tx_hash),
    'replacement',jsonb_build_object('batchId',replacement.batch_id,'sourceActionId',replacement.source_action_id,'sourceHub',replacement.source_hub,
      'blockNumber',replacement.block_number::text,'blockHash',replacement.block_hash));
end $$;
revoke all on function public.effective_fan_action_mint(uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;

create function public.assert_nft_replacement_entity() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text:=new.entity_type; entity uuid:=new.entity_id; owner_id uuid;
  status text; tx text; token text; facts jsonb; replacement public.nft_credential_replacements;
begin
  if kind='first_reaction_stamp' then
    select reaction_id into entity from public.first_reaction_stamps where id=entity
      and app_user_id=new.app_user_id and blockchain_source_id=reaction_id;
    kind:='reaction';
  end if;
  case kind
    when 'passport' then select app_user_id,mint_status::text,tx_hash,token_id::text into owner_id,status,tx,token from public.fan_passports where id=entity;
    when 'stamp' then select app_user_id,mint_status::text,tx_hash,token_id::text into owner_id,status,tx,token from public.stamps where id=entity;
    when 'reaction' then select app_user_id,mint_status::text,tx_hash,token_id::text into owner_id,status,tx,token from public.fan_reactions where id=entity;
    when 'community_stamp' then select app_user_id,mint_status::text,tx_hash,token_id::text into owner_id,status,tx,token from public.community_stamps where id=entity;
    else raise exception 'unsupported replacement entity';
  end case;
  select * into strict replacement from public.nft_credential_replacements where id=new.replacement_id;
  facts:=public.original_fan_action_mint(new.app_user_id,kind,entity,status,tx,token);
  if owner_id is distinct from new.app_user_id or facts->>'status' is distinct from 'minted'
    or lower(facts->>'txHash') is distinct from new.original_tx_hash
    or facts->>'tokenId' is distinct from replacement.old_token_id::text
    or replacement.credential_kind<>(case when kind='passport' then 0 else 1 end)
    or not exists(select 1 from public.user_wallets where app_user_id=new.app_user_id and chain_id=91342 and address=replacement.recipient)
  then raise exception 'replacement entity owner or original credential mismatch'; end if;
  return new;
end $$;
create trigger nft_replacement_entity_valid before insert on public.nft_credential_replacement_entities
  for each row execute function public.assert_nft_replacement_entity();
create function public.reject_nft_replacement_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'finalized NFT replacement evidence is immutable'; end $$;
create trigger nft_replacement_batch_immutable before update or delete on public.nft_credential_replacement_batches
  for each row execute function public.reject_nft_replacement_mutation();
create trigger nft_replacement_immutable before update or delete on public.nft_credential_replacements
  for each row execute function public.reject_nft_replacement_mutation();
create trigger nft_replacement_entity_immutable before update or delete on public.nft_credential_replacement_entities
  for each row execute function public.reject_nft_replacement_mutation();
revoke all on function public.assert_nft_replacement_entity(),public.reject_nft_replacement_mutation() from public,anon,authenticated,service_role;

-- First-reaction is a separate projection of the same reaction NFT, not a new issuance.
alter function public.get_owned_passport_detail(uuid,uuid,public.content_locale) rename to get_owned_passport_detail_before_nft_replacement;
create function public.get_owned_passport_detail(p_passport_id uuid,p_app_user_id uuid,p_locale public.content_locale)
returns setof jsonb language sql stable security definer set search_path='' as $$
  select case when item->'firstReaction' is not null and item->'firstReaction'<>'null'::jsonb then
    jsonb_set(item,'{firstReaction}',item->'firstReaction'||jsonb_build_object(
      'mint',reaction_mint,'mintStatus',reaction_mint->>'status','txHash',reaction_mint->>'txHash'))
    else item end
  from public.get_owned_passport_detail_before_nft_replacement(p_passport_id,p_app_user_id,p_locale) item
  left join lateral (select public.effective_fan_action_mint(p_app_user_id,'reaction',r.id,r.mint_status::text,r.tx_hash,r.token_id::text) reaction_mint
    from public.fan_reactions r where r.id=(item->'firstReaction'->>'reactionId')::uuid and r.app_user_id=p_app_user_id) reaction on true
$$;
alter function public.get_owned_reaction(uuid,text) rename to get_owned_reaction_before_nft_replacement;
create function public.get_owned_reaction(p_app_user_id uuid,p_celebrity_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when item is null then null else item||jsonb_build_object('mintStatus',facts->>'status','mint',facts) end
  from (select public.get_owned_reaction_before_nft_replacement(p_app_user_id,p_celebrity_slug) item) base
  left join lateral (select public.effective_fan_action_mint(p_app_user_id,'reaction',r.id,r.mint_status::text,r.tx_hash,r.token_id::text) facts
    from public.fan_reactions r where r.id=(item->>'reactionId')::uuid and r.app_user_id=p_app_user_id) reaction on true
$$;
revoke all on function public.get_owned_passport_detail_before_nft_replacement(uuid,uuid,public.content_locale),
  public.get_owned_reaction_before_nft_replacement(uuid,text),
  public.get_owned_passport_detail(uuid,uuid,public.content_locale),public.get_owned_reaction(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_owned_passport_detail(uuid,uuid,public.content_locale),
  public.get_owned_reaction(uuid,text) to service_role;
