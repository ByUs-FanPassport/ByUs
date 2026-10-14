begin;
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
declare caught boolean:=false; begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Unexpected error %, wanted %',sqlerrm,expected; end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error missing: %',expected; end if;
end $$;
do $$
declare owner_id uuid:=extensions.gen_random_uuid(); creator uuid:=extensions.gen_random_uuid();
  reaction uuid:=extensions.gen_random_uuid(); job uuid:=extensions.gen_random_uuid(); replacement uuid;
  old_tx text:='0x'||repeat('1',64); new_tx text:='0x'||repeat('2',64); batch text:='0x'||repeat('3',64);
  wallet text:='0x'||repeat('1',40); original jsonb; facts jsonb;
begin
  insert into public.app_users(id,privy_user_id,verified_email,status)
    values(owner_id,'did:privy:nft-replacement-fixture','nft-replacement@example.test','active');
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(creator,'nft-replacement-fixture','published','/fixture.webp',now(),'{artist}','idol');
  insert into public.user_wallets(app_user_id,chain_id,address) values(owner_id,91342,wallet);
  insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload,status,tx_hash,token_id,completed_at)
    values(job,'reaction',reaction,'byus:reaction:v1:'||reaction,1,jsonb_build_object('recipient',wallet,
      'celebritySlug','nft-replacement-fixture','issuanceId',batch,'reactionType','FirstReaction'),
      'COMPLETED',old_tx,7,clock_timestamp());
  insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,mint_status,tx_hash,token_id)
    values(reaction,owner_id,creator,job,'minted',old_tx,7);
  select to_jsonb(r) into original from public.fan_reactions r where id=reaction;
  insert into public.nft_credential_replacement_batches(batch_id,chain_id,migrator,environment_id,merkle_root,
    manifest_hash,max_items,max_mints,expires_at)
    values(batch,91342,'0x'||repeat('2',40),batch,batch,batch,1,1,now()+interval '7 days');
  insert into public.nft_credential_replacements(batch_id,leaf_hash,credential_kind,old_contract,old_token_id,
    old_metadata_uri,old_tx_hash,new_contract,new_token_id,new_metadata_uri,issuance_key,recipient,source_action_id,
    tx_hash,block_number,block_hash,finalized_block_number,finalized_block_hash,minted,source_hub)
    values(batch,batch,1,'0x1adcde3473c4e884e60205b397ece744d8892285',7,'ipfs://old',old_tx,
      '0x527a70c0f7cf129650dc282b709327c5958a4ccf',9,'ipfs://new',batch,wallet,'0x'||repeat('0',64),
      new_tx,100,batch,110,batch,true,'0x'||repeat('0',40)) returning id into replacement;
  perform pg_temp.expect_error(format('insert into public.nft_credential_replacement_entities values(%L,%L,%L,%L,%L)',
    'reaction',reaction,owner_id,replacement,new_tx),'original credential mismatch');
  insert into public.nft_credential_replacement_entities values('reaction',reaction,owner_id,replacement,old_tx);
  facts:=public.effective_fan_action_mint(owner_id,'reaction',reaction,'minted',old_tx,'7');
  perform pg_temp.assert(facts->>'tokenId'='9' and facts->>'txHash'=new_tx and facts->'originalAsset'->>'tokenId'='7',
    'representative and original facts missing');
  perform pg_temp.assert(public.effective_fan_action_mint(extensions.gen_random_uuid(),'reaction',reaction,'minted',old_tx,'7')->>'tokenId'='7',
    'replacement leaked across owners');
  perform pg_temp.assert(public.effective_fan_action_mint(owner_id,'reaction',reaction,'minted',old_tx,'8')->>'tokenId'='8',
    'unmatched original token received replacement');
  perform pg_temp.assert(public.effective_fan_action_mint(owner_id,'reaction',reaction,'queued',null,null)->>'status'='queued',
    'pending original was revived');
  perform pg_temp.assert((public.get_owned_reaction(owner_id,'nft-replacement-fixture')->'mint'->>'tokenId')='9',
    'owned reaction missed representative asset');
  perform pg_temp.assert((select to_jsonb(r)=original from public.fan_reactions r where id=reaction),'original reaction changed');
  perform pg_temp.expect_error(format('update public.nft_credential_replacements set new_token_id=10 where id=%L',replacement),'immutable');
  perform pg_temp.expect_error(format('delete from public.nft_credential_replacement_entities where entity_id=%L',reaction),'immutable');
  perform pg_temp.assert(not has_table_privilege('service_role','public.nft_credential_replacements','INSERT'), 'service role may forge replacements');
  perform pg_temp.assert(not has_table_privilege('authenticated','public.nft_credential_replacement_entities','SELECT'), 'private mapping readable by client');
  perform pg_temp.assert(not has_function_privilege('anon','public.effective_fan_action_mint(uuid,text,uuid,text,text,text)','EXECUTE'), 'anonymous resolver exposed');
end $$;
rollback;
