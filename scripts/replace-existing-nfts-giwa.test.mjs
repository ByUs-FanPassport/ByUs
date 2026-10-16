import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {keccak256,concatHex,encodeAbiParameters,decodeFunctionData,parseAbi} from 'viem';
import {EXISTING_NFT_DEPLOYMENT as d,trustedActionContext as context,privateJson,zeroHash,zeroAddress} from './migrate-existing-nfts-giwa.mjs';
import {buildReplacementPlan,validateReplacementPlan,replacementTree,replacementLeaf,itemComponents,
  assertPreflight,preflightSql,finalizedReplacement,reconciliationSql,pendingReplacementEntries,signStep,
  buildFollowupPlan,validateFollowupPlan,FOLLOWUP_MIGRATOR,verifyFollowupDeployment} from './replace-existing-nfts-giwa.mjs';
const hash=x=>'0x'+x.repeat(64),owner='0x'+'1'.repeat(40);
const a=JSON.parse(fs.readFileSync(new URL('../contracts/out/KyaaCredentialMigrator.sol/KyaaCredentialMigrator.json',import.meta.url)));
function fixture(builder=buildReplacementPlan){
  const source={classification:'ELIGIBLE',issues:[],kind:1,tokenId:'7',issuanceKey:hash('2'),owner,
    contract:d.oldStamp,transactionHash:hash('3'),metadataUri:'ipfs://old',sourceHub:zeroAddress,
    sourceActionId:zeroHash,sourceRefs:[],entities:[{entity_type:'reaction',entity_id:'00000000-0000-4000-8000-000000000001',
      app_user_id:'00000000-0000-4000-8000-000000000002',wallet:owner,artwork_type:'reaction',business_status:'completed'}],aliases:[{id:'00000000-0000-4000-8000-000000000003'}]};
  const verified={format:'kyaa-existing-nft-verified-v1',blockHash:hash('4'),blockNumber:'123',items:[source]};
  const metadata={format:'kyaa-existing-nft-metadata-v1',snapshotBlockHash:hash('4'),documents:[{digest:'doc',uri:'ipfs://new'}],items:[{contract:d.oldStamp,tokenId:'7',documentHash:'doc'}]};
  return JSON.parse(privateJson(builder(a,verified,metadata,10,172800n,1900000000n,'entity')));
}
test('manifest reconstructs every call, root and predicted deployment, and detects edits',()=>{
  const plan=fixture();validateReplacementPlan(plan,a);
  assert.equal(plan.steps.length,2);assert.equal(plan.entries.length,1);
  assert.equal(plan.root,plan.entries[0].leaf);assert.deepEqual(plan.entries[0].proof,[]);
  const changed=structuredClone(plan);changed.activate.gas='600001';assert.throws(()=>validateReplacementPlan(changed,a),/MANIFEST_CHANGED/);
  const swapped=structuredClone(plan);swapped.entries[0].metadataUri='ipfs://other';assert.throws(()=>validateReplacementPlan(swapped,a),/MANIFEST_CHANGED/);
});
test('leaf matches Solidity double-hashed ABI domain and changes with chain context',()=>{
  const plan=fixture(),item=plan.entries[0].item;
  const inner=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes32'},
    {type:'address'},{type:'address'},{type:'tuple',components:itemComponents}],
  [91342n,plan.migrator,context.environmentId,d.oldStamp,d.newStamp,{...item,oldTokenId:7n}]));
  assert.equal(replacementLeaf(plan.migrator,item),keccak256(inner));
  assert.notEqual(replacementLeaf(owner,item),plan.root);
});
test('all Merkle proofs validate for singleton, even, and odd sets; duplicates rejected',()=>{
  const pair=(a,b)=>keccak256(concatHex(a<b?[a,b]:[b,a]));
  for(const count of [1,2,3,7,8,17]){
    const leaves=Array.from({length:count},(_,i)=>keccak256(new TextEncoder().encode(String(i))));
    const tree=replacementTree(leaves);leaves.forEach((leaf,i)=>assert.equal(tree.proofs[i].reduce(pair,leaf),tree.root));
  }
  assert.throws(()=>replacementTree([]));assert.throws(()=>replacementTree([hash('1'),hash('1')]));
});
test('runtime DB guard rejects changed wallet, qualification, token and alias',()=>{
  const entry=fixture().entries[0],facts={owner:entry.entity.owner,wallet:owner,businessStatus:'completed',
    artworkType:'reaction',eligible:true,original:{status:'minted',tokenId:'7',txHash:hash('3')},aliases:entry.aliases};
  assert.equal(assertPreflight(entry,facts),facts);
  for(const bad of [{wallet:d.admin},{eligible:false},{aliases:[]},{original:{...facts.original,tokenId:'8'}},{businessStatus:'revoked'}])
    assert.throws(()=>assertPreflight(entry,{...facts,...bad}),/DATABASE_ELIGIBILITY_CHANGED/);
  assert.match(preflightSql(entry),/original_fan_action_mint/);
  assert.throws(()=>preflightSql({...entry,entity:{...entry.entity,type:'invalid'}}));
});
test('unfinalized and orphaned receipts never reach DB mapping',async()=>{
  const plan=fixture(),entry=plan.entries[0],receipt={status:'success',blockNumber:11n,blockHash:hash('5'),logs:[]};
  await assert.rejects(finalizedReplacement({getBlock:async()=>({number:10n,hash:hash('6')})},plan,entry,receipt,a),/RECEIPT_NOT_FINALIZED/);
  await assert.rejects(finalizedReplacement({getBlock:async args=>args.blockTag?{number:12n,hash:hash('6')}:{hash:hash('7')}},plan,entry,receipt,a),/NONCANONICAL_REPLACEMENT/);
});
test('bounded mint batches skip mined receipts and leave uncertain signatures for recovery',()=>{
  const plan={entries:Array.from({length:105},(_,i)=>({leaf:String(i)}))};
  const journal={steps:[{id:'mint-0',reconciled:true,receipt:{}},{id:'mint-1',receipt:{}},{id:'mint-2',signed:'uncertain'}]};
  const mint=pendingReplacementEntries(plan,journal,'migrate',100);
  assert.equal(mint.length,100);assert.equal(mint[0].leaf,'2');assert.equal(mint.at(-1).leaf,'101');
  assert.deepEqual(pendingReplacementEntries(plan,journal,'reconcile',100).map(e=>e.leaf),['1','2']);
  for(const limit of [0,101,NaN])assert.throws(()=>pendingReplacementEntries(plan,journal,'migrate',limit));
});
test('a reorg cannot reuse a mined but unfinalized signed nonce for another leaf',async()=>{
  const journal={steps:[{id:'mint-first',nonce:12,signed:'saved',receipt:{blockNumber:'123'}}]};
  for(const nonce of [11,12])await assert.rejects(signStep({}, {id:'mint-next',nonce},journal,'unused'),/SIGNED_NONCE_REUSE/);
  assert.equal(journal.steps.length,1);
});
test('a canary selects only its reviewed leaf without changing manifest order or falling back',()=>{
  const plan={entries:[{leaf:hash('1')},{leaf:hash('2')}]},before=structuredClone(plan),journal={steps:[]};
  assert.deepEqual(pendingReplacementEntries(plan,journal,'migrate',1,hash('2')),[plan.entries[1]]);
  assert.deepEqual(plan,before);
  for(const [limit,leaf] of [[100,hash('2')],[1,hash('3')],[1,'invalid']])
    assert.throws(()=>pendingReplacementEntries(plan,journal,'migrate',limit,leaf),/EXACT_REVIEWED_LEAF_AND_LIMIT_1_REQUIRED/);
});
test('selected canaries keep signed recovery, mined receipt and reconciled skip semantics',()=>{
  const plan={entries:[{leaf:hash('1')},{leaf:hash('2')}]},leaf=hash('2');
  for(const [saved,migrateCount,reconcileCount] of [
    [{signed:'uncertain'},1,1],[{receipt:{}},0,1],[{receipt:{},reconciled:true},0,0],
  ]){
    const journal={steps:[{id:'mint-'+leaf,...saved}]};
    assert.equal(pendingReplacementEntries(plan,journal,'migrate',1,leaf).length,migrateCount);
    assert.equal(pendingReplacementEntries(plan,journal,'reconcile',1,leaf).length,reconcileCount);
  }
});
test('CLI rejects missing, malformed or misplaced leaf selectors before reading RPC configuration',()=>{
  const script=new URL('./replace-existing-nfts-giwa.mjs',import.meta.url);
  for(const args of [['migrate','--leaf'],['migrate','--leaf',''],['migrate','--leaf','bad'],['activate','--leaf',hash('2')]]){
    const result=spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/LEAF_REQUIRES_MIGRATE_OR_RECONCILE/);
  }
});
test('reconcile SQL preserves large numeric tokens, apostrophes and atomic aliases',()=>{
  const plan=fixture(),entry=plan.entries[0];entry.item.oldTokenId='100000000000000000000000000000';entry.oldMetadataUri="ipfs://old'quote";
  const sql=reconciliationSql(plan,entry,{transactionHash:hash('8'),blockNumber:123n,blockHash:hash('9')},
    {target:d.newStamp,event:{newTokenId:999999999999999999999999n,minted:true},head:{number:124n,hash:hash('a')}},
    {original:{txHash:hash('3')},aliases:entry.aliases});
  assert.match(sql,/100000000000000000000000000000/);assert.match(sql,/999999999999999999999999/);
  assert.match(sql,/old''quote/);assert.match(sql,/begin; select pg_advisory_xact_lock/);
  assert.match(sql,/entity mapping mismatch/);assert.match(sql,/commit;/);
});
test('followup entity batches schedule exactly one registerBatch on the existing Migrator',()=>{
  const plan=fixture(buildFollowupPlan);validateFollowupPlan(plan,a);
  assert.equal(plan.migrator,FOLLOWUP_MIGRATOR);assert.equal(plan.steps.length,1);
  assert.equal(plan.sourceKind,'entity');assert.equal(plan.entries[0].sourceKind,'entity');
  assert.equal(plan.entries[0].item.sourceHub,zeroAddress,'entity-backed legacy remains entity-backed');
  const timelock=parseAbi(['function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)',
    'function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable']);
  const scheduled=decodeFunctionData({abi:timelock,data:plan.steps[0].data});
  assert.equal(scheduled.functionName,'scheduleBatch');assert.deepEqual(scheduled.args[0].map(a=>a.toLowerCase()),[FOLLOWUP_MIGRATOR]);
  assert.deepEqual(scheduled.args[1],[0n]);assert.equal(scheduled.args[2].length,1);assert.equal(scheduled.args[5],172800n);
  const call=decodeFunctionData({abi:a.abi,data:scheduled.args[2][0]});assert.equal(call.functionName,'registerBatch');
  assert.equal(call.args[0],plan.batchId);assert.equal(call.args[1],plan.root);
  assert.deepEqual(decodeFunctionData({abi:timelock,data:plan.activate.data}).args[0].map(a=>a.toLowerCase()),[FOLLOWUP_MIGRATOR]);
  for(const mutate of [p=>{p.migrator=owner;},p=>{p.entries[0].sourceKind='direct_legacy';},p=>{p.steps[0].data='0x';},
    p=>{p.delay='172799';},p=>{p.entries.push(structuredClone(p.entries[0]));}]){
    const changed=structuredClone(plan);mutate(changed);assert.throws(()=>validateFollowupPlan(changed,a));
  }
});
test('followup deployment verifies exact runtime, immutable context and both existing mint roles',async()=>{
  const plan=fixture(buildFollowupPlan);let authorized=true,contextChanged=false;
  const names=['timelock','operator','hub','legacyHub','oldPassport','oldStamp','newPassport','newStamp'];
  const client={getBytecode:async()=>a.deployedBytecode.object,readContract:async({functionName,blockNumber})=>{
    assert.equal(blockNumber,123n);
    if(functionName==='hasRole')return authorized;
    if(functionName==='environmentId')return context.environmentId;
    return contextChanged?owner:plan.constructorArgs[names.indexOf(functionName)];
  }};
  await verifyFollowupDeployment(client,plan,a,123n);
  authorized=false;await assert.rejects(verifyFollowupDeployment(client,plan,a,123n),/MIGRATOR_MINTER/);
  authorized=true;contextChanged=true;await assert.rejects(verifyFollowupDeployment(client,plan,a,123n),/MIGRATOR_CONTEXT/);
  contextChanged=false;client.getBytecode=async()=>'0x';await assert.rejects(verifyFollowupDeployment(client,plan,a,123n),/MIGRATOR_RUNTIME/);
});
test('followup preparation requires an explicit lane before any RPC or signing input',()=>{
  for(const sourceKind of [undefined,'unknown']){
    const result=spawnSync(process.execPath,[new URL('./replace-existing-nfts-giwa.mjs',import.meta.url).pathname,
      'prepare-followup',...(sourceKind?['--source-kind',sourceKind]:[])],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/EXPLICIT_SOURCE_KIND_REQUIRED/);
  }
});
