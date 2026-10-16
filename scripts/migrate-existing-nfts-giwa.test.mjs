import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {encodeAbiParameters,encodeEventTopics,keccak256} from 'viem';
import {actionHubAbi} from '../apps/worker/dist/action-abi.js';
import {inventoryRanges,reconcileInventory,preferredSource,parseSourceReceiptHints,verifyCurrentInventory,refComponents,
  zeroHash,EXISTING_NFT_DEPLOYMENT,trustedActionContext} from './migrate-existing-nfts-giwa.mjs';

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

const hash=n=>'0x'+n.toString(16).padStart(64,'0');
function correctedSource(firstKind=0){
  const db=fixture(),hub=trustedActionContext.legacyHub,originalId=hash(1),latestId=hash(2),occurrenceId=hash(3);
  const receiptTx=hash(4),receiptHash=hash(5),snapshotHash=hash(6),currentAsset={...asset,contract:EXISTING_NFT_DEPLOYMENT.oldStamp};
  const refs=[{nftContract:EXISTING_NFT_DEPLOYMENT.oldPassport,tokenId:8n,kind:firstKind,issuanceKey:firstKind===2?zeroHash:hash(8),linkOrigin:1},
    {nftContract:currentAsset.contract,tokenId:7n,kind:1,issuanceKey:key,linkOrigin:1}];
  const record={actionId:latestId,occurrenceId,fan:owner,status:2,easUID:hash(9),refUID:zeroHash,
    schemaUID:trustedActionContext.schemaUid,revision:2,actionCode:1,schemaVersion:1,policyVersion:1,origin:0,migrationBatchId:zeroHash};
  const refsHash=keccak256(encodeAbiParameters([{type:'tuple[]',components:refComponents}],[refs]));
  const data=encodeAbiParameters(['bytes32','bytes32','uint32','uint16','uint16','uint32','bytes32','bytes32','bytes32',
    'uint32','uint8','bytes32','bytes32','bytes32'].map(type=>({type})),
  [occurrenceId,latestId,record.revision,record.actionCode,record.schemaVersion,record.policyVersion,
    trustedActionContext.environmentId,zeroHash,zeroHash,1,record.origin,zeroHash,refsHash,zeroHash]);
  record.recordHash=keccak256(data);
  const attestation={uid:record.easUID,schema:record.schemaUID,attester:hub,recipient:owner,refUID:zeroHash,
    data,revocationTime:0n,expirationTime:0n};
  const log=(ref,actionId=latestId)=>({address:hub,transactionHash:receiptTx,blockNumber:90n,blockHash:receiptHash,removed:false,
    topics:encodeEventTopics({abi:actionHubAbi,eventName:'CredentialLinked',args:{actionId,nftContract:ref.nftContract,tokenId:ref.tokenId}}),
    data:encodeAbiParameters([{type:'uint8'},{type:'bytes32'},{type:'uint8'}],[ref.kind,ref.issuanceKey,ref.linkOrigin])});
  const receipt={status:'success',transactionHash:receiptTx,blockNumber:90n,blockHash:receiptHash,logs:refs.toReversed().map(ref=>log(ref))};
  const credential={id:'native',entity_type:'reaction',entity_id:'reaction',nft_contract:currentAsset.contract,token_id:'7',
    credential_kind:1,issuance_key:key,link_origin:'LINKED_EXISTING',hub_proxy:hub,chain_id:EXISTING_NFT_DEPLOYMENT.chainId,
    environment_id:trustedActionContext.environmentId,schema_uid:trustedActionContext.schemaUid,
    action_id:originalId,occurrence_id:occurrenceId,occurrence_owner:'user'};
  db.credentials=[credential];
  const chain={blockNumber:'100',blockHash:snapshotHash,timestamp:'1000',assets:[currentAsset]};
  const calls={receipts:0};
  const client={
    getTransactionReceipt:async({hash})=>{calls.receipts++;assert.equal(hash,receiptTx);return receipt;},
    getBlock:async({blockNumber})=>({hash:blockNumber===100n?snapshotHash:receiptHash}),
    readContract:async({functionName,args,blockNumber})=>{
      assert.equal(blockNumber,100n);
      switch(functionName){
        case 'getAction': return args[0]===originalId?{...record,actionId:originalId,status:3}:record;
        case 'latestActionId': return latestId;
        case 'getAttestation': return attestation;
        case 'isAttestationValid': return true;
        case 'eas': return trustedActionContext.easAddress;
        case 'environmentId': return trustedActionContext.environmentId;
        default: throw Error(`Unexpected read ${functionName}`);
      }
    },
  };
  return {client,chain,db,record,attestation,refs,receipt,log,calls,credential,hints:[{hub,actionId:latestId,txHash:receiptTx}]};
}

test('receipt hints recover a corrected historical source only through the complete canonical EAS ref hash',async()=>{
  const f=correctedSource(),before=structuredClone(f.db);
  const result=await verifyCurrentInventory(f.client,f.chain,f.db,f.hints);
  assert.equal(result.items[0].classification,'ELIGIBLE');
  assert.equal(result.items[0].sourceHub,f.hints[0].hub);
  assert.equal(result.items[0].sourceActionId,f.hints[0].actionId);
  assert.deepEqual(result.items[0].sourceRefs,f.refs);
  assert.equal(f.calls.receipts,1);assert.deepEqual(f.db,before);
});

test('complete EAS ref hashing preserves collectible refs alongside the target NFT',async()=>{
  const f=correctedSource(2);
  const result=await verifyCurrentInventory(f.client,f.chain,f.db,f.hints);
  assert.equal(result.items[0].classification,'ELIGIBLE');assert.deepEqual(result.items[0].sourceRefs,f.refs);
});

test('valid complete DB refs retain the existing no-hint path',async()=>{
  const f=correctedSource();
  f.db.credentials.push(...f.refs.map((ref,index)=>({...f.credential,id:`complete-${index}`,action_id:f.hints[0].actionId,
    nft_contract:ref.nftContract,token_id:String(ref.tokenId),credential_kind:ref.kind,issuance_key:ref.issuanceKey})));
  const result=await verifyCurrentInventory(f.client,f.chain,f.db);
  assert.equal(result.items[0].classification,'ELIGIBLE');assert.deepEqual(result.items[0].sourceRefs,f.refs);
  assert.equal(f.calls.receipts,0);
});

test('without an exact latest-action and Hub hint the missing source stays held',async()=>{
  for(const hint of [undefined,{...correctedSource().hints[0],actionId:hash(90)},
    {...correctedSource().hints[0],hub:EXISTING_NFT_DEPLOYMENT.hub}]){
    const f=correctedSource();
    const result=await verifyCurrentInventory(f.client,f.chain,f.db,hint?[hint]:[]);
    assert.equal(result.items[0].classification,'HOLD');assert.equal(f.calls.receipts,0);
  }
});

test('receipt hints never override partial or malformed DB refs',async()=>{
  for(const malformed of [false,true]){
    const f=correctedSource();
    f.db.credentials.push({...f.credential,id:'partial',action_id:f.hints[0].actionId,
      ...(malformed?{issuance_key:null}:{})});
    await assert.rejects(verifyCurrentInventory(f.client,f.chain,f.db,f.hints),
      malformed?/INCOMPLETE_SOURCE_REFS/:/SOURCE_ATTESTATION_MISMATCH/);
    assert.equal(f.calls.receipts,0);
  }
});

test('inactive latest actions and entity-less assets cannot use receipt hints',async()=>{
  for(const missingEntity of [false,true]){
    const f=correctedSource();if(missingEntity)f.db.entities=[];else f.record.status=3;
    const result=await verifyCurrentInventory(f.client,f.chain,f.db,f.hints);
    assert.equal(result.items[0].classification,'HOLD');assert.equal(f.calls.receipts,0);
  }
});

test('malicious or incomplete hinted receipts fail closed',async t=>{
  const cases=[
    ['wrong transaction',f=>{f.receipt.transactionHash=hash(99);},/INVALID_SOURCE_RECEIPT/],
    ['reverted',f=>{f.receipt.status='reverted';},/INVALID_SOURCE_RECEIPT/],
    ['unfinalized',f=>{f.receipt.blockNumber=101n;},/INVALID_SOURCE_RECEIPT/],
    ['reorg',f=>{f.client.getBlock=async()=>({hash:hash(99)});},/SOURCE_RECEIPT_REORG/],
    ['missing logs',f=>{f.receipt.logs=[];},/SOURCE_RECEIPT_REFS_MISSING/],
    ['malformed event data',f=>{f.receipt.logs[0].data='0x';},Error],
    ['wrong Hub logs',f=>{f.receipt.logs=f.receipt.logs.map(l=>({...l,address:EXISTING_NFT_DEPLOYMENT.hub}));},/SOURCE_RECEIPT_REFS_MISSING/],
    ['old action logs',f=>{f.receipt.logs=f.refs.map(r=>f.log(r,f.credential.action_id));},/SOURCE_RECEIPT_REFS_MISSING/],
    ['partial refs',f=>{f.receipt.logs.pop();},/SOURCE_ATTESTATION_MISMATCH/],
    ['duplicate refs',f=>{f.receipt.logs.push(f.receipt.logs[0]);},/DUPLICATE_SOURCE_RECEIPT_REF/],
    ['log transaction mismatch',f=>{f.receipt.logs[0].transactionHash=hash(99);},/SOURCE_RECEIPT_LOG_MISMATCH/],
    ['log block mismatch',f=>{f.receipt.logs[0].blockNumber=89n;},/SOURCE_RECEIPT_LOG_MISMATCH/],
    ['log hash mismatch',f=>{f.receipt.logs[0].blockHash=hash(99);},/SOURCE_RECEIPT_LOG_MISMATCH/],
    ['removed log',f=>{f.receipt.logs[0].removed=true;},/SOURCE_RECEIPT_LOG_MISMATCH/],
    ['invalid kind',f=>{f.receipt.logs[0]=f.log({...f.refs[1],kind:3});},/INVALID_SOURCE_RECEIPT_REF/],
    ['invalid origin',f=>{f.receipt.logs[0]=f.log({...f.refs[1],linkOrigin:2});},/INVALID_SOURCE_RECEIPT_REF/],
    ['zero issuance key',f=>{f.receipt.logs[0]=f.log({...f.refs[1],issuanceKey:zeroHash});},/INVALID_SOURCE_RECEIPT_REF/],
    ['zero token',f=>{f.receipt.logs[0]=f.log({...f.refs[1],tokenId:0n});},/INVALID_SOURCE_RECEIPT_REF/],
    ['zero contract',f=>{f.receipt.logs[0]=f.log({...f.refs[1],nftContract:'0x'+'00'.repeat(20)});},/INVALID_SOURCE_RECEIPT_REF/],
    ['wrong owner',f=>{f.record.fan='0x'+'55'.repeat(20);},/SOURCE_ATTESTATION_MISMATCH/],
    ['revoked EAS',f=>{f.attestation.revocationTime=1n;},null],
  ];
  for(const [name,change,expected] of cases)await t.test(name,async()=>{
    const f=correctedSource();change(f);
    if(expected)await assert.rejects(verifyCurrentInventory(f.client,f.chain,f.db,f.hints),expected);
    else assert.equal((await verifyCurrentInventory(f.client,f.chain,f.db,f.hints)).items[0].classification,'HOLD');
  });
});

test('hint format, trusted Hub, hex fields, and case-normalized uniqueness are validated',()=>{
  const f=correctedSource(),proof={format:'kyaa-source-receipt-hints-v1',hints:f.hints};
  assert.deepEqual(parseSourceReceiptHints(proof),f.hints);
  for(const invalid of [null,{...proof,format:'unknown'},{...proof,hints:[]},{...proof,extra:true},
    {...proof,hints:[{...f.hints[0],hub:owner}]},{...proof,hints:[{...f.hints[0],actionId:'0x1234'}]},
    {...proof,hints:[{...f.hints[0],txHash:zeroHash}]},{...proof,hints:[{...f.hints[0],extra:true}]},
    {...proof,hints:[f.hints[0],{...f.hints[0],hub:f.hints[0].hub.toUpperCase().replace('0X','0x')}]}])
    assert.throws(()=>parseSourceReceiptHints(invalid));
});

test('invalid direct-call hints fail before any RPC reads',async()=>{
  const client=new Proxy({},{get(){throw Error('RPC_BEFORE_HINT_VALIDATION');}});
  await assert.rejects(verifyCurrentInventory(client,null,null,null),/INVALID_SOURCE_RECEIPT_HINTS/);
  await assert.rejects(verifyCurrentInventory(client,null,null,[{...correctedSource().hints[0],hub:owner}]),/UNTRUSTED_SOURCE_RECEIPT_HUB/);
});

test('invalid CLI hint flags fail before database or RPC inputs are read',()=>{
  for(const [args,reason] of [
    [['inventory','--source-receipts','missing-private.json'],'SOURCE_RECEIPTS_VERIFY_ONLY'],
    [['metadata','--source-receipts','missing-private.json'],'SOURCE_RECEIPTS_VERIFY_ONLY'],
    [['verify','--source-receipts'],'SOURCE_RECEIPTS_ARGUMENT'],
    [['verify','--source-receipts',''],'SOURCE_RECEIPTS_ARGUMENT'],
    [['verify','--source-receipts='],'SOURCE_RECEIPTS_ARGUMENT'],
    [['verify','--source-receipts','--output','unused'],'SOURCE_RECEIPTS_ARGUMENT'],
    [['verify','--source-receipts','one','--source-receipts','two'],'SOURCE_RECEIPTS_ARGUMENT'],
  ]){
    const result=spawnSync(process.execPath,[new URL('./migrate-existing-nfts-giwa.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).reason,reason);
  }
});
