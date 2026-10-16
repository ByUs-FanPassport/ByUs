import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {CID} from 'multiformats/cid';
import {create as digest} from 'multiformats/hashes/digest';
import {parseAbi,encodeEventTopics,encodeAbiParameters,encodeFunctionData} from 'viem';
import {EXISTING_NFT_DEPLOYMENT as d,trustedActionContext as context,privateJson,zeroHash} from './migrate-existing-nfts-giwa.mjs';
import {directHistoryDigest,assertDirectHistory,assertDirectSource,directLegacyMetadata,directAbsenceSql,assertDirectAbsence,
  verifyDirectHistory,verifyDirectSource} from './direct-legacy-nfts-giwa.mjs';
import {buildFollowupPlan,validateFollowupPlan,replacementPlanHash,directSourceFromEntry,directReconciliationSql,
  followupAssetPreflight,followupUniquenessSql,pendingReplacementEntries,finalizedReplacement} from './replace-existing-nfts-giwa.mjs';

const h=n=>'0x'+n.toString(16).padStart(64,'0'),owner='0x'+'11'.repeat(20);
const artifact=JSON.parse(fs.readFileSync(new URL('../contracts/out/KyaaCredentialMigrator.sol/KyaaCredentialMigrator.json',import.meta.url)));
const mint=parseAbi(['function mint(address to,bytes32 issuanceKey,string metadataUri)',
  'event StampMinted(bytes32 indexed issuanceId,uint256 indexed tokenId,address indexed to,string metadataUri)']);
const linked=parseAbi(['event CredentialLinked(bytes32 indexed actionId,address indexed nftContract,uint256 indexed tokenId,uint8 credentialKind,bytes32 issuanceKey,uint8 linkOrigin)']);
export function directFixture(){
  const document={schema:'https://byus.kr/schemas/credential-metadata-v1.json',version:1,name:'ByUs Knowledge Stamp',
    description:'A soulbound ByUs Knowledge Stamp credential.',image:'ipfs://oldart/image.png',attributes:[
      {trait_type:'Credential',value:'Knowledge Stamp'},{trait_type:'Celebrity',value:'example'},
      {trait_type:'Transferability',value:'Soulbound'},{trait_type:'Metadata Version',value:'1'}]};
  const metadata=doc=>{const raw=JSON.stringify(doc),sha256=createHash('sha256').update(raw).digest();return {
    uri:'ipfs://'+CID.createV1(0x55,digest(0x12,sha256)),raw,sha256:sha256.toString('hex'),document:doc};};
  const originalMetadata=metadata(document);
  const source={sourceKind:'direct_legacy',kind:1,contract:d.oldStamp,tokenId:'7',issuanceKey:h(2),owner,
    metadataUri:originalMetadata.uri,transactionHash:h(3),blockNumber:'31213600',blockHash:h(4),
    mintProof:{txHash:h(3),blockNumber:'31213600',blockHash:h(4),minter:d.admin,authorizedMinter:true,directCall:true,canonical:true,finalized:true},originalMetadata};
  const snapshot={blockNumber:'35954885',blockHash:h(5),timestamp:'1800000000'};
  const hubHistory={hubs:[context.legacyHub,d.hub],fromBlock:'35954883',toBlock:snapshot.blockNumber,
    blockHash:snapshot.blockHash,chunkSize:1000,ranges:[['35954883','35954885']],
    targets:[{contract:d.oldStamp,tokenId:'7'}],references:[]};hubHistory.digest=directHistoryDigest(hubHistory);
  const evidence={snapshot,hubHistory},head={number:35955885n,hash:h(6),timestamp:1800001000n};
  const receipt={status:'success',transactionHash:source.transactionHash,blockNumber:31213600n,blockHash:source.blockHash,
    from:d.admin,to:d.oldStamp,logs:[{address:d.oldStamp,transactionHash:source.transactionHash,blockNumber:31213600n,blockHash:source.blockHash,removed:false,
      topics:encodeEventTopics({abi:mint,eventName:'StampMinted',args:{issuanceId:source.issuanceKey,tokenId:7n,to:owner}}),
      data:encodeAbiParameters([{type:'string'}],[source.metadataUri])}]};
  const transaction={hash:source.transactionHash,to:d.oldStamp,from:d.admin,value:0n,
    input:encodeFunctionData({abi:mint,functionName:'mint',args:[owner,source.issuanceKey,source.metadataUri]})};
  const state={logs:[],authorized:true,balance:1n,supply:1n,key:7n,uri:source.metadataUri,receipt,transaction};
  const scans=[];
  const client={getChainId:async()=>d.chainId,getTransactionReceipt:async()=>state.receipt,getTransaction:async()=>state.transaction,
    getBlock:async({blockNumber})=>({hash:blockNumber===31213600n?source.blockHash:blockNumber===35954885n?snapshot.blockHash:head.hash}),
    getLogs:async request=>{scans.push(request);return state.logs;},
    readContract:async({functionName})=>{switch(functionName){
      case 'hasRole':return state.authorized;case 'tokenByIssuanceId':return state.key;case 'balanceOf':return state.balance;
      case 'totalSupply':return state.supply;case 'uri':return state.uri;default:throw Error('UNEXPECTED_READ');}},
  };
  const verified={format:'kyaa-direct-legacy-verified-v1',...evidence,items:[source]},newDocument=directLegacyMetadata(source);
  const published=metadata(newDocument),documentHash=replacementPlanHash(newDocument);
  const outputMetadata={format:'kyaa-direct-legacy-metadata-v1',snapshotBlockHash:snapshot.blockHash,
    documents:[{digest:documentHash,...published}],items:[{contract:d.oldStamp,tokenId:'7',documentHash}]};
  const plan=JSON.parse(privateJson(buildFollowupPlan(artifact,verified,outputMetadata,10,172800n,1900000000n,'direct_legacy')));
  const historyLog={address:context.legacyHub,blockNumber:head.number,blockHash:head.hash,removed:false,
    topics:encodeEventTopics({abi:linked,eventName:'CredentialLinked',args:{actionId:h(9),nftContract:d.oldStamp,tokenId:7n}}),
    data:encodeAbiParameters([{type:'uint8'},{type:'bytes32'},{type:'uint8'}],[1,source.issuanceKey,1])};
  return {source,evidence,head,client,state,scans,plan,verified,outputMetadata,metadata,historyLog};
}

test('explicit direct proof preserves known traits and uses existing kyaa artwork without an entity',async()=>{
  const f=directFixture();assertDirectHistory(f.evidence);assertDirectSource(f.source,f.evidence);
  await verifyDirectHistory(f.client,f.evidence,f.head);await verifyDirectSource(f.client,f.source,f.evidence,f.head);
  assert.equal(f.scans.length,1);assert.equal(f.scans[0].fromBlock,35954886n);assert.equal(f.scans[0].toBlock,f.head.number);
  const doc=directLegacyMetadata(f.source);assert.deepEqual(doc.attributes,f.source.originalMetadata.document.attributes);
  assert.equal(doc.name,'kyaa Fan Verification Stamp');assert.match(doc.image,/\/knowledge.png$/);
  validateFollowupPlan(f.plan,artifact);assert.equal(f.plan.entries[0].entity,undefined);
  assert.deepEqual(directSourceFromEntry(f.plan.entries[0]),f.source);
});
test('direct input never infers a lane from a missing entity or a zero source Hub',()=>{
  const f=directFixture();
  for(const change of [{sourceKind:undefined},{sourceKind:'entity'},{entities:[{}]},{aliases:['alias']},{sourceHub:d.hub}])
    assert.throws(()=>assertDirectSource({...f.source,...change},f.evidence),/DIRECT_SOURCE_FORMAT/);
  assert.throws(()=>buildFollowupPlan(artifact,f.verified,f.outputMetadata,10,172800n,1900000000n),/EXPLICIT_SOURCE_KIND_REQUIRED/);
});
test('baseline coverage, filters and fingerprint cannot drift or contain a prior Hub reference',()=>{
  for(const change of [h=>{h.ranges=[];},h=>{h.ranges[0][0]='35954884';},h=>{h.toBlock='35954884';},
    history=>{history.blockHash=h(99);},h=>{h.targets=[];},h=>{h.references=[{}];},h=>{h.digest=zeroHash;},h=>{h.hubs.reverse();}]){
    const f=directFixture();change(f.evidence.hubHistory);assert.throws(()=>assertDirectHistory(f.evidence));
  }
});
test('CID bytes, closed types, qualification and PII are verified rather than trusted flags',()=>{
  const f=directFixture();
  assert.throws(()=>directLegacyMetadata({...f.source,originalMetadata:{...f.source.originalMetadata,raw:'{}'}}),/DIRECT_METADATA_CID/);
  for(const mutate of [d=>{d.attributes[0].value='Membership Stamp';d.name='ByUs Membership Stamp';d.description='A soulbound ByUs Membership Stamp credential.';},
    d=>{d.email='member@example.invalid';},d=>{d.attributes[1].value='member@example.invalid';},d=>{d.attributes[2].value='Transferable';},
    d=>{d.attributes.push({...d.attributes[0]});},d=>{d.description='An unverified claim';}]){
    const doc=structuredClone(f.source.originalMetadata.document);mutate(doc);const originalMetadata=f.metadata(doc);
    assert.throws(()=>directLegacyMetadata({...f.source,metadataUri:originalMetadata.uri,originalMetadata}));
  }
});
test('new metadata cannot substitute an unrelated CID for the expected rendered document',()=>{
  const f=directFixture(),changed=structuredClone(f.outputMetadata);
  changed.documents[0].uri=f.source.metadataUri;
  assert.throws(()=>buildFollowupPlan(artifact,f.verified,changed,10,172800n,1900000000n,'direct_legacy'),/DIRECT_METADATA_CID/);
  const plan=structuredClone(f.plan);plan.entries[0].newMetadata.raw='{}';
  assert.throws(()=>validateFollowupPlan(plan,artifact),/DIRECT_METADATA_CID/);
});
test('metadata CLI writes only deterministic documents and requires explicit local inputs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'direct-legacy-metadata-'));
  try{
    const source=path.join(dir,'verified.json'),output=path.join(dir,'documents.json'),f=directFixture();
    fs.writeFileSync(source,privateJson(f.verified),{mode:0o600});
    const script=new URL('./direct-legacy-nfts-giwa.mjs',import.meta.url).pathname;
    const run=spawnSync(process.execPath,[script,'metadata','--verified',source,'--output',output],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(fs.readFileSync(output));assert.equal(result.documents.length,1);
    assert.equal(result.format,'kyaa-direct-legacy-metadata-documents-v1');
    assert.equal(result.documents[0].sha256,createHash('sha256').update(result.documents[0].raw).digest('hex'));
    assert.deepEqual(result.documents[0].document.attributes,f.source.originalMetadata.document.attributes);
    const invalid=spawnSync(process.execPath,[script,'verify'],{encoding:'utf8'});
    assert.equal(invalid.status,1);assert.match(invalid.stderr,/DIRECT_ARGUMENTS_REQUIRED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('original receipt, calldata, minter, ownership, key, supply and URI each fail closed',async t=>{
  for(const [name,mutate] of [
    ['reverted',f=>{f.state.receipt.status='reverted';}],['wrong receipt',f=>{f.state.receipt.transactionHash=h(99);}],
    ['unfinalized',f=>{f.head.number=1n;}],['wrong sender',f=>{f.state.receipt.from=owner;}],
    ['different calldata',f=>{f.state.transaction.input=encodeFunctionData({abi:mint,functionName:'mint',args:[owner,h(99),f.source.metadataUri]});}],
    ['missing event',f=>{f.state.receipt.logs=[];}],['removed event',f=>{f.state.receipt.logs[0].removed=true;}],
    ['unauthorized minter',f=>{f.state.authorized=false;}],['wrong owner',f=>{f.state.balance=0n;}],
    ['wrong key',f=>{f.state.key=9n;}],['wrong supply',f=>{f.state.supply=2n;}],['wrong URI',f=>{f.state.uri='ipfs://changed';}],
    ['noncanonical mint',f=>{f.client.getBlock=async()=>({hash:h(99)});}],
  ])await t.test(name,async()=>{const f=directFixture();mutate(f);await assert.rejects(verifyDirectSource(f.client,f.source,f.evidence,f.head));});
});
test('new Hub refs and baseline/finalized reorgs block direct issuance',async()=>{
  const f=directFixture();f.state.logs=[f.historyLog];
  await assert.rejects(verifyDirectHistory(f.client,f.evidence,f.head),/DIRECT_HUB_REFERENCE_FOUND/);
  f.state.logs=[];f.client.getBlock=async()=>({hash:h(99)});
  await assert.rejects(verifyDirectHistory(f.client,f.evidence,f.head),/DIRECT_BASELINE_REORG/);
});
test('followup mapping and existing-target reuse are guarded before any signature',async()=>{
  const f=directFixture(),entry=f.plan.entries[0];let target=0n,leaf=zeroHash,reverse=zeroHash,uri=entry.metadataUri;
  const client={getBlock:async()=>f.head,readContract:async r=>{
    if(r.functionName==='replacements')return [leaf,zeroHash,leaf===zeroHash?0n:8n];
    if(r.functionName==='sourceByTarget')return reverse;
    if(r.address===d.oldStamp)return f.client.readContract(r);
    if(r.functionName==='tokenByIssuanceId')return target;
    if(r.functionName==='balanceOf'||r.functionName==='totalSupply')return 1n;
    if(r.functionName==='uri')return uri;throw Error('UNEXPECTED_READ');
  }};
  assert.equal(await followupAssetPreflight(client,f.plan,entry,artifact,f.head),0n);
  target=8n;assert.equal(await followupAssetPreflight(client,f.plan,entry,artifact,f.head),8n);
  uri='ipfs://changed';await assert.rejects(followupAssetPreflight(client,f.plan,entry,artifact,f.head),/FOLLOWUP_ASSET_CHANGED/);
  uri=entry.metadataUri;reverse=h(8);await assert.rejects(followupAssetPreflight(client,f.plan,entry,artifact,f.head),/TARGET_ALREADY_REPLACED/);
  reverse=zeroHash;leaf=h(8);await assert.rejects(followupAssetPreflight(client,f.plan,entry,artifact,f.head),/SOURCE_ALREADY_REPLACED/);
  assert.match(followupUniquenessSql(entry,8n),/new_token_id=8/);assert.match(followupUniquenessSql(entry),/issuance_key=/);
});
test('direct reconciliation contains only replacement evidence writes and retries the same mined journal entry',async()=>{
  const f=directFixture(),entry=f.plan.entries[0],receipt={transactionHash:h(20),blockNumber:35955880n,blockHash:h(21)},
    proof={target:d.newStamp,event:{newTokenId:8n,minted:true},head:f.head};
  const sql=directReconciliationSql(f.plan,entry,receipt,proof);
  assert.match(sql,/DIRECT_DATABASE_ASSOCIATION/);assert.match(sql,/DIRECT_ENTITY_MAPPING_EXISTS/);
  assert.equal((sql.match(/insert into public\./g)??[]).length,2);
  assert.doesNotMatch(sql,/insert into public\.nft_credential_replacement_entities|update public\.|delete from public\./);
  assert.match(directAbsenceSql(f.source),/blockchain_jobs/);assert.throws(()=>assertDirectAbsence({absent:false}));
  const journal={steps:[{id:'mint-'+entry.leaf,receipt:{},signed:'same-signed-bytes'}]};
  assert.deepEqual(pendingReplacementEntries(f.plan,journal,'migrate',1),[]);
  assert.deepEqual(pendingReplacementEntries(f.plan,journal,'reconcile',1),[entry]);
  await assert.rejects(finalizedReplacement({getBlock:async()=>({number:1n})},f.plan,entry,receipt,artifact),/RECEIPT_NOT_FINALIZED/);
});

// Opt in only for the disposable migration harness; it never accepts an existing DB connection.
test('isolated DB direct append, duplicate/cross-batch protection and failed-write recovery',{
  skip:process.env.RUN_DIRECT_LEGACY_DB_TEST!=='1'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'direct-legacy-sql-'));
  try{
    const launcher=path.join(dir,'assert.sh');fs.writeFileSync(launcher,'exec node "$DIRECT_LEGACY_TEST_FILE"\n',{mode:0o700});
    const result=spawnSync('bash',['scripts/verify-clean-migration-chain.sh'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
      env:{...process.env,PATH:`/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH}`,BYUS_CLEAN_DB_PORT:'55484',
        BYUS_CLEAN_DB_ASSERTION_FILE:'',BYUS_CLEAN_DB_SHELL_ASSERTION_FILE:launcher,DIRECT_LEGACY_SQL_CHILD:'1',
        DIRECT_LEGACY_TEST_FILE:new URL('./direct-legacy-nfts-giwa.test.mjs',import.meta.url).pathname}});
    assert.equal(result.status,0,result.stderr.slice(-6000));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

if(process.env.DIRECT_LEGACY_SQL_CHILD==='1'){
  assert.equal(process.env.PGDATABASE,'byus_clean');assert.equal(process.env.PGPORT,'55484');
  assert.match(process.env.PGHOST??'',/\/byus-clean-db\.[^/]+\/socket$/);
  const args=['-X','-qAt','-v','ON_ERROR_STOP=1'];
  const sql=q=>execFileSync('psql',args,{input:q,encoding:'utf8'}).trim();
  const attempt=q=>spawnSync('psql',args,{input:q,encoding:'utf8'});
  const f=directFixture(),entry=f.plan.entries[0],receipt={transactionHash:h(20),blockNumber:35955880n,blockHash:h(21)},
    proof={target:d.newStamp,event:{newTokenId:8n,minted:true},head:f.head};
  const statement=directReconciliationSql(f.plan,entry,receipt,proof);
  sql(`create function public.direct_test_fail() returns trigger language plpgsql as $$ begin raise exception 'TEST_DB_FAILURE'; end $$;
    create trigger direct_test_fail before insert on public.nft_credential_replacements for each row execute function public.direct_test_fail();`);
  assert.notEqual(attempt(statement).status,0);assert.equal(sql('select count(*) from public.nft_credential_replacement_batches'),'0');
  sql('drop trigger direct_test_fail on public.nft_credential_replacements;drop function public.direct_test_fail()');
  sql(statement);sql(statement);
  assert.equal(sql('select count(*) from public.nft_credential_replacements'),'1');
  assert.equal(sql('select count(*) from public.nft_credential_replacement_entities'),'0');
  const other=structuredClone(f.plan);other.batchId=h(90);other.manifestHash=h(91);
  assert.notEqual(attempt(directReconciliationSql(other,entry,receipt,proof)).status,0);
  assert.equal(sql('select count(*) from public.nft_credential_replacement_batches'),'1');
  const second=structuredClone(entry);second.item.oldTokenId='99';second.leaf=h(92);
  assert.notEqual(attempt(directReconciliationSql(f.plan,second,receipt,proof)).status,0);
  assert.equal(sql('select count(*) from public.nft_credential_replacements'),'1');
  const user='fa170000-0000-4000-8000-000000000001',binding='fa170000-0000-4000-8000-000000000002',
    occurrence='fa170000-0000-4000-8000-000000000003',job='fa170000-0000-4000-8000-000000000004';
  sql(`insert into public.app_users(id,privy_user_id,verified_email,status) values('${user}','did:privy:direct-test','direct@test.invalid','active');
    insert into public.fan_action_bindings(id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,binding_version,asset_base_uri,assets)
    values('${binding}',91342,'${context.environmentId}','${d.hub}','${d.admin}','${context.schemaUid}',1,1,'ipfs://test','{}');
    insert into public.fan_action_occurrences(id,source_namespace,canonical_source_key,app_user_id,source_occurred_at)
    values('${occurrence}','direct_test','missing-credential','${user}',clock_timestamp());
    insert into public.fan_action_outbox(id,occurrence_row_id,binding_id,operation_kind,source_snapshot)
    values('${job}','${occurrence}','${binding}','record_and_issue','{"credentials":[{"issuanceKey":"${f.source.issuanceKey}"}]}');`);
  assert.equal(JSON.parse(sql(directAbsenceSql(f.source))).absent,false,'pending native source without a credential row must block direct');
  const blocked=attempt(statement);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/DIRECT_DATABASE_ASSOCIATION/);
  assert.equal(sql('select count(*) from public.nft_credential_replacements'),'1');
  assert.equal(sql('select count(*) from public.nft_credential_replacement_entities'),'0');
  process.exit(0);
}
