import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryRanges,reconcileInventory,preferredSource,EXISTING_NFT_DEPLOYMENT,trustedActionContext} from './migrate-existing-nfts-giwa.mjs';

const owner='0x'+'11'.repeat(20),key='0x'+'22'.repeat(32),tx='0x'+'33'.repeat(32);
const asset={contract:'0x'+'44'.repeat(20),kind:1,tokenId:'7',issuanceKey:key,owner,transactionHash:tx};
function fixture(){return {entities:[{entity_type:'reaction',entity_id:'reaction',app_user_id:'user',
  artwork_type:'reaction',wallet:owner,blockchain_job_id:'job',mint_status:'minted',token_id:'7',tx_hash:tx,
  legacy_job:{entity_type:'reaction',entity_id:'reaction',status:'COMPLETED',token_id:'7',tx_hash:tx,payload:{issuanceId:key,recipient:owner}}}],
  credentials:[],aliases:[{id:'alias',reaction_id:'reaction',blockchain_source_id:'reaction',app_user_id:'user'}]};}

test('scan covers the inclusive end without gaps, including a short final range',()=>{
  assert.deepEqual(inventoryRanges(100n,2100n),[[100n,1099n],[1100n,2099n],[2100n,2100n]]);
  assert.throws(()=>inventoryRanges(1n,0n));assert.throws(()=>inventoryRanges(0n,1n,0n));
});
test('reaction alias and H1 references do not create a second NFT',()=>{
  const db=fixture();db.credentials=[{id:'c',entity_type:'reaction',entity_id:'reaction',nft_contract:asset.contract,token_id:'7'}];
  const result=reconcileInventory(db,[asset]);assert.equal(result.items.length,1);
  assert.equal(result.items[0].aliases.length,1);assert.equal(result.items[0].classification,'VERIFY_CURRENT_ACTION');
  assert.deepEqual(result.items[0].issues,[]);
});
test('H2 onchain credential is retained even while the business mint is pending',()=>{
  const db=fixture();db.entities[0].legacy_job=null;db.entities[0].mint_status='queued';
  db.credentials=[{id:'h2',entity_type:'reaction',entity_id:'reaction',nft_contract:asset.contract,token_id:'7',link_origin:'MINTED_NOW'}];
  assert.equal(reconcileInventory(db,[asset]).items[0].classification,'VERIFY_CURRENT_ACTION');
});
test('wallet drift, broken aliases, orphan tokens, and ambiguous owners are held',()=>{
  const db=fixture();db.entities[0].wallet='0x'+'55'.repeat(20);db.aliases[0].blockchain_source_id='other';
  const result=reconcileInventory(db,[asset,{...asset,tokenId:'8',issuanceKey:'0x'+'66'.repeat(32)}]);
  assert.equal(result.items[0].classification,'HOLD');assert.ok(result.items[0].issues.includes('WALLET_MISMATCH'));
  assert.ok(result.items[0].issues.includes('REACTION_ALIAS_MISMATCH'));
  assert.ok(result.items[1].issues.includes('MISSING_DATABASE_RECORD'));
});
test('same numeric token in different contracts is not deduplicated',()=>{
  const second={...asset,contract:'0x'+'77'.repeat(20),kind:0};
  assert.equal(reconcileInventory(fixture(),[asset,second]).items.length,2);
});
test('unconfirmed old jobs remain visible for catch-up',()=>{
  const db=fixture();db.entities[0].legacy_job.status='RETRYING';
  assert.equal(reconcileInventory(db,[]).unresolved[0].reason,'NOT_YET_MINTED');
});
test('a revoked or corrected current-Hub copy cannot fall back to an active older Hub',()=>{
  const current=EXISTING_NFT_DEPLOYMENT.hub,legacy=trustedActionContext.legacyHub;
  const older={hub:legacy},next={hub:current};
  assert.equal(preferredSource([{hub_proxy:current},{hub_proxy:legacy}],[older]),undefined);
  assert.equal(preferredSource([{hub_proxy:current},{hub_proxy:legacy}],[older,next]),next);
  assert.equal(preferredSource([{hub_proxy:legacy}],[older]),older);
});
