#!/usr/bin/env node
// Private, resumable GIWA replacement batches; signed transactions are never recreated on uncertainty.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {encodeDeployData,encodeFunctionData,encodeAbiParameters,getContractAddress,keccak256,
  parseAbi,parseTransaction,recoverTransactionAddress,decodeEventLog,concatHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {EXISTING_NFT_DEPLOYMENT as d,trustedActionContext as context,refComponents,
  privateJson,writePrivate,inventoryClient,zeroHash,zeroAddress} from './migrate-existing-nfts-giwa.mjs';
import {assertKyaaEnvelope,checkPrivate,persist,readReceipt,confirmedKyaaReceipt,runtimeMatches} from './migrate-kyaa-giwa.mjs';

const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
const hash=v=>keccak256(new TextEncoder().encode(privateJson(v)));
const textHash=v=>keccak256(new TextEncoder().encode(v));
const role=textHash('MINTER_ROLE');
const tl=parseAbi(['function getMinDelay() view returns(uint256)','function hasRole(bytes32,address) view returns(bool)',
  'function getTimestamp(bytes32) view returns(uint256)','function isOperationReady(bytes32) view returns(bool)',
  'function isOperationDone(bytes32) view returns(bool)',
  'function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)',
  'function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable']);
const nft=parseAbi(['function grantRole(bytes32,address)','function hasRole(bytes32,address) view returns(bool)',
  'function defaultAdmin() view returns(address)','function tokenByPassportId(bytes32) view returns(uint256)',
  'function tokenByIssuanceId(bytes32) view returns(uint256)','function ownerOf(uint256) view returns(address)',
  'function balanceOf(address,uint256) view returns(uint256)','function totalSupply(uint256) view returns(uint256)',
  'function tokenURI(uint256) view returns(string)','function uri(uint256) view returns(string)']);
export const itemComponents=[{name:'batchId',type:'bytes32'},{name:'kind',type:'uint8'},
  {name:'oldTokenId',type:'uint256'},{name:'issuanceKey',type:'bytes32'},{name:'recipient',type:'address'},
  {name:'oldUriHash',type:'bytes32'},{name:'newUriHash',type:'bytes32'},
  {name:'sourceHub',type:'address'},{name:'sourceActionId',type:'bytes32'}];
const artifact=()=>JSON.parse(fs.readFileSync(new URL('../contracts/out/KyaaCredentialMigrator.sol/KyaaCredentialMigrator.json',import.meta.url)));
export const replacementPlanHash=hash;
export const assetIdentity=(address,tokenId)=>keccak256(encodeAbiParameters([{type:'address'},{type:'uint256'}],[address,BigInt(tokenId)]));
export function replacementLeaf(migrator,item){
  return keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'bytes32'},
    {type:'address'},{type:'address'},{type:'tuple',components:itemComponents}],
  [BigInt(d.chainId),migrator,context.environmentId,item.kind===0?d.oldPassport:d.oldStamp,
    item.kind===0?d.newPassport:d.newStamp,{...item,oldTokenId:BigInt(item.oldTokenId)}])));
}
const pair=(a,b)=>keccak256(concatHex(a.toLowerCase()<b.toLowerCase()?[a,b]:[b,a]));
export function replacementTree(leaves){
  assert(leaves.length>0&&new Set(leaves).size===leaves.length,'INVALID_LEAVES');
  const levels=[leaves];
  while(levels.at(-1).length>1){const last=levels.at(-1),next=[];
    for(let i=0;i<last.length;i+=2)next.push(i+1<last.length?pair(last[i],last[i+1]):last[i]);levels.push(next);}
  return {root:levels.at(-1)[0],proofs:leaves.map((_leaf,index)=>{
    const proof=[];for(const level of levels.slice(0,-1)){const sibling=index^1;if(sibling<level.length)proof.push(level[sibling]);index=Math.floor(index/2);}return proof;
  })};
}
export function buildReplacementPlan(a,verified,metadata,nonce,delay,expiresAt){
  assert(verified.format==='kyaa-existing-nft-verified-v1'&&metadata.format==='kyaa-existing-nft-metadata-v1'
    &&metadata.snapshotBlockHash===verified.blockHash,'INVENTORY_BINDING');
  assert(Number.isSafeInteger(nonce)&&nonce>=0&&delay>=172800n,'NONCE_OR_TIMELOCK');
  const migrator=getContractAddress({from:d.admin,nonce:BigInt(nonce)}).toLowerCase();
  const docs=new Map(metadata.documents.map(doc=>[doc.digest,doc]));
  const uris=new Map(metadata.items.map(item=>[`${item.contract}:${item.tokenId}`,docs.get(item.documentHash)?.uri]));
  const sources=verified.items.filter(item=>item.classification==='ELIGIBLE');
  assert(sources.length>0&&sources.length<=10000,'ITEM_LIMIT');
  const entries=sources.map(source=>{
    const metadataUri=uris.get(`${source.contract}:${source.tokenId}`),entity=source.entities[0];
    assert(source.entities.length===1&&source.issues.length===0&&source.owner===entity.wallet.toLowerCase()
      &&/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[^\s]*)?$/.test(metadataUri),'SOURCE_OR_METADATA');
    return {item:{kind:source.kind,oldTokenId:source.tokenId,issuanceKey:source.issuanceKey,recipient:source.owner,
      oldUriHash:textHash(source.metadataUri),newUriHash:textHash(metadataUri),sourceHub:source.sourceHub,sourceActionId:source.sourceActionId},
    oldContract:source.contract,oldMetadataUri:source.metadataUri,oldTxHash:source.transactionHash,metadataUri,
    sourceRefs:source.sourceRefs,entity:{type:entity.entity_type,id:entity.entity_id,owner:entity.app_user_id,
      artworkType:entity.artwork_type,businessStatus:entity.business_status},aliases:source.aliases.map(alias=>alias.id)};
  });
  const batchId=hash({release:'kyaa-existing-nft-v1',migrator,snapshot:verified.blockHash,entries});
  for(const entry of entries)entry.item={batchId,...entry.item};
  const leaves=entries.map(e=>replacementLeaf(migrator,e.item)),tree=replacementTree(leaves);
  entries.forEach((e,i)=>{e.leaf=leaves[i];e.proof=tree.proofs[i];});
  const manifestHash=hash({batchId,snapshot:verified.blockHash,entries});
  const constructorArgs=[d.timelock,d.admin,d.hub,context.legacyHub,d.oldPassport,d.oldStamp,d.newPassport,d.newStamp];
  const deploy={id:'deploy',nonce,gas:'5000000',data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args:constructorArgs})};
  const targets=[d.newPassport,d.newStamp,migrator],values=[0n,0n,0n],payloads=[
    ...targets.slice(0,2).map(()=>encodeFunctionData({abi:nft,functionName:'grantRole',args:[role,migrator]})),
    encodeFunctionData({abi:a.abi,functionName:'registerBatch',args:[batchId,tree.root,manifestHash,entries.length,entries.length,BigInt(expiresAt)]}),
  ];
  const salt=hash({batchId,manifestHash,root:tree.root});
  const operation=keccak256(encodeAbiParameters([{type:'address[]'},{type:'uint256[]'},{type:'bytes[]'},{type:'bytes32'},{type:'bytes32'}],[targets,values,payloads,zeroHash,salt]));
  return {format:'kyaa-existing-nft-plan-v1',chainId:d.chainId,operator:d.admin,migrator,constructorArgs,
    creationHash:keccak256(a.bytecode.object),runtimeHash:keccak256(a.deployedBytecode.object),
    snapshot:{blockNumber:verified.blockNumber,blockHash:verified.blockHash},batchId,root:tree.root,manifestHash,
    maxItems:entries.length,maxMints:entries.length,expiresAt:String(expiresAt),delay:String(delay),entries,operation,
    steps:[deploy,{id:'schedule',nonce:nonce+1,to:d.timelock,gas:'600000',data:encodeFunctionData({abi:tl,functionName:'scheduleBatch',args:[targets,values,payloads,zeroHash,salt,delay]})}],
    activate:{id:'activate',to:d.timelock,gas:'600000',data:encodeFunctionData({abi:tl,functionName:'executeBatch',args:[targets,values,payloads,zeroHash,salt]})},
    maxFeePerGas:'100000000',mintGasCap:'1000000',maximumExposureWei:String((6200000n+BigInt(entries.length)*1000000n)*100000000n)};
}
export function validateReplacementPlan(plan,a){
  assert(plan.format==='kyaa-existing-nft-plan-v1'&&plan.chainId===d.chainId&&plan.operator===d.admin
    &&plan.creationHash===keccak256(a.bytecode.object)&&plan.runtimeHash===keccak256(a.deployedBytecode.object),'PLAN_OR_ARTIFACT_CHANGED');
  const verified={format:'kyaa-existing-nft-verified-v1',...plan.snapshot,items:plan.entries.map(e=>({
    classification:'ELIGIBLE',kind:e.item.kind,tokenId:e.item.oldTokenId,issuanceKey:e.item.issuanceKey,
    owner:e.item.recipient,metadataUri:e.oldMetadataUri,contract:e.oldContract,transactionHash:e.oldTxHash,
    sourceHub:e.item.sourceHub,sourceActionId:e.item.sourceActionId,sourceRefs:e.sourceRefs,issues:[],
    entities:[{entity_type:e.entity.type,entity_id:e.entity.id,app_user_id:e.entity.owner,wallet:e.item.recipient,
      artwork_type:e.entity.artworkType,business_status:e.entity.businessStatus}],aliases:e.aliases.map(id=>({id}))}))};
  const metadata={format:'kyaa-existing-nft-metadata-v1',snapshotBlockHash:plan.snapshot.blockHash,
    documents:plan.entries.map((e,i)=>({digest:String(i),uri:e.metadataUri})),
    items:plan.entries.map((e,i)=>({contract:e.oldContract,tokenId:e.item.oldTokenId,documentHash:String(i)}))};
  assert(isDeepStrictEqual(plan,JSON.parse(privateJson(buildReplacementPlan(a,verified,metadata,plan.steps[0].nonce,BigInt(plan.delay),plan.expiresAt)))),'MANIFEST_CHANGED');
}
function database(envFile,sql,write=false){
  const env=parseEnv(fs.readFileSync(envFile,'utf8'));
  assert(env.SUPABASE_PROD_PROJECT_REF&&env.SUPABASE_PROD_DB_PASSWORD,'DATABASE_ENV_MISSING');
  return execFileSync('psql',['-XAt','-h','aws-1-ap-northeast-2.pooler.supabase.com','-p','5432',
    '-U',`postgres.${env.SUPABASE_PROD_PROJECT_REF}`,'-d','postgres','-v','ON_ERROR_STOP=1'],{
    input:sql,encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe'],
    env:{...process.env,PGPASSWORD:env.SUPABASE_PROD_DB_PASSWORD,PGSSLMODE:'require',
      PGOPTIONS:`-c default_transaction_read_only=${write?'off':'on'} -c statement_timeout=30000`}}).trim();
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function preflightSql(entry){
  const type=entry.entity.type,tables={passport:'fan_passports',stamp:'stamps',reaction:'fan_reactions',community_stamp:'community_stamps'};
  assert(tables[type]&&/^[0-9a-f-]{36}$/.test(entry.entity.id),'INVALID_ENTITY');
  return `select jsonb_build_object('owner',b.app_user_id,'wallet',w.address,
    'businessStatus',${['passport','stamp'].includes(type)?'b.business_status':quote(type==='reaction'?'completed':'issued')},
    'artworkType',${type==='stamp'?'b.stamp_type':type==='community_stamp'?"'community/'||b.kind::text":quote(type)},
    'eligible',${type==='stamp'?"case when b.stamp_type='membership' then exists(select 1 from public.fan_activities a join public.certification_submissions cs on cs.id=a.source_id where a.id=b.activity_id and a.source_type='certification_submission' and cs.status='approved') else true end":'true'},
    'original',public.original_fan_action_mint(b.app_user_id,${quote(type)},b.id,b.mint_status::text,b.tx_hash,b.token_id::text),
    'aliases',coalesce(${type==='reaction'?`(select jsonb_agg(s.id order by s.id) from public.first_reaction_stamps s where s.reaction_id=b.id and s.blockchain_source_id=b.id and s.app_user_id=b.app_user_id)`:'null'},'[]'::jsonb))
    from public.${tables[type]} b join public.user_wallets w on w.app_user_id=b.app_user_id and w.chain_id=91342 where b.id=${quote(entry.entity.id)}::uuid;`;
}
export function assertPreflight(entry,facts){
  assert(facts&&facts.owner===entry.entity.owner&&facts.wallet?.toLowerCase()===entry.item.recipient
    &&facts.businessStatus===entry.entity.businessStatus&&facts.artworkType===entry.entity.artworkType&&facts.eligible===true
    &&facts.original?.status==='minted'&&facts.original.tokenId===entry.item.oldTokenId
    &&/^0x[0-9a-f]{64}$/.test(facts.original.txHash)
    &&entry.aliases.every(id=>facts.aliases.includes(id)),'DATABASE_ELIGIBILITY_CHANGED');
  return facts;
}
async function verifyDeployment(client,plan,a,blockNumber){
  assert(runtimeMatches(await client.getBytecode({address:plan.migrator,blockNumber}),a),'MIGRATOR_RUNTIME');
  for(const [i,name] of ['timelock','operator','hub','legacyHub','oldPassport','oldStamp','newPassport','newStamp'].entries())
    assert((await client.readContract({address:plan.migrator,abi:a.abi,functionName:name,blockNumber})).toLowerCase()===plan.constructorArgs[i],'MIGRATOR_CONTEXT');
  assert(await client.readContract({address:plan.migrator,abi:a.abi,functionName:'environmentId',blockNumber})===context.environmentId,'MIGRATOR_ENVIRONMENT');
}
export async function finalizedReplacement(client,plan,entry,receipt,a){
  const head=await client.getBlock({blockTag:'finalized'});
  assert(head.number>=receipt.blockNumber,'RECEIPT_NOT_FINALIZED');
  assert(receipt.status==='success'&&(await client.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'NONCANONICAL_REPLACEMENT');
  const events=receipt.logs.filter(log=>log.address.toLowerCase()===plan.migrator).flatMap(log=>{
    try{const event=decodeEventLog({abi:a.abi,data:log.data,topics:log.topics});return event.eventName==='CredentialReplaced'?[event.args]:[];}catch{return [];}
  });
  assert(events.length===1,'REPLACEMENT_EVENT_COUNT');const event=events[0];
  const target=entry.item.kind===0?d.newPassport:d.newStamp,tokenId=event.newTokenId;
  assert(event.batchId===plan.batchId&&event.oldContract.toLowerCase()===entry.oldContract
    &&event.oldTokenId===BigInt(entry.item.oldTokenId)&&event.newContract.toLowerCase()===target
    &&event.recipient.toLowerCase()===entry.item.recipient&&event.issuanceKey===entry.item.issuanceKey
    &&event.metadataHash===entry.item.newUriHash&&event.sourceHub.toLowerCase()===entry.item.sourceHub
    &&event.sourceActionId===entry.item.sourceActionId&&event.leaf===entry.leaf,'REPLACEMENT_EVENT_MISMATCH');
  const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args,blockNumber:head.number});
  const sourceId=assetIdentity(entry.oldContract,entry.item.oldTokenId);
  const [mapping,reverse,key,owner,uri]=await Promise.all([
    read(plan.migrator,a.abi,'replacements',[sourceId]),read(plan.migrator,a.abi,'sourceByTarget',[assetIdentity(target,tokenId)]),
    read(target,nft,entry.item.kind===0?'tokenByPassportId':'tokenByIssuanceId',[entry.item.issuanceKey]),
    read(target,nft,entry.item.kind===0?'ownerOf':'balanceOf',entry.item.kind===0?[tokenId]:[entry.item.recipient,tokenId]),
    read(target,nft,entry.item.kind===0?'tokenURI':'uri',[tokenId]),
  ]);
  assert(mapping[0]===entry.leaf&&mapping[1]===plan.batchId&&mapping[2]===tokenId
    &&mapping[3].toLowerCase()===entry.item.recipient&&mapping[4]===entry.item.newUriHash
    &&mapping[5].toLowerCase()===entry.item.sourceHub&&mapping[6]===entry.item.sourceActionId
    &&mapping[7]===event.minted&&reverse===sourceId&&key===tokenId
    &&(entry.item.kind===0?owner.toLowerCase()===entry.item.recipient:owner===1n)&&uri===entry.metadataUri,'FINALIZED_ASSET_MISMATCH');
  if(entry.item.kind===1)assert(await read(target,nft,'totalSupply',[tokenId])===1n,'TARGET_SUPPLY');
  assert((await client.getBlock({blockNumber:head.number})).hash===head.hash,'FINALIZED_SNAPSHOT_CHANGED');
  return {event,head,target};
}
export function reconciliationSql(plan,entry,receipt,proof,facts){
  const batch={batch_id:plan.batchId,chain_id:d.chainId,migrator:plan.migrator,environment_id:context.environmentId,
    merkle_root:plan.root,manifest_hash:plan.manifestHash,max_items:plan.maxItems,max_mints:plan.maxMints,
    expires_at:new Date(Number(plan.expiresAt)*1000).toISOString()};
  const replacement={batch_id:plan.batchId,leaf_hash:entry.leaf,credential_kind:entry.item.kind,old_contract:entry.oldContract,
    old_token_id:entry.item.oldTokenId,old_metadata_uri:entry.oldMetadataUri,old_tx_hash:entry.oldTxHash,
    new_contract:proof.target,new_token_id:String(proof.event.newTokenId),new_metadata_uri:entry.metadataUri,
    issuance_key:entry.item.issuanceKey,recipient:entry.item.recipient,source_action_id:entry.item.sourceActionId,source_hub:entry.item.sourceHub,
    tx_hash:receipt.transactionHash,block_number:String(receipt.blockNumber),block_hash:receipt.blockHash,
    finalized_block_number:String(proof.head.number),finalized_block_hash:proof.head.hash,minted:proof.event.minted};
  const aliases=[{entity_type:entry.entity.type,entity_id:entry.entity.id},...facts.aliases.map(id=>({entity_type:'first_reaction_stamp',entity_id:id}))]
    .map(entity=>({...entity,app_user_id:entry.entity.owner,original_tx_hash:facts.original.txHash}));
  const insert=(table,value,extra='')=>{
    const keys=Object.keys(value);return `insert into public.${table} (${keys.join(',')}) select ${keys.join(',')} from jsonb_populate_record(null::public.${table},${quote(privateJson(value))}::jsonb) ${extra};`;
  };
  return `begin; select pg_advisory_xact_lock(hashtext('kyaa-nft-replacements'));
    ${insert('nft_credential_replacement_batches',batch,'on conflict(batch_id) do nothing')}
    do $reconcile$ declare current_row public.nft_credential_replacements; batch_row public.nft_credential_replacement_batches; begin
      select * into strict batch_row from public.nft_credential_replacement_batches where batch_id=${quote(plan.batchId)};
      if not (to_jsonb(batch_row) @> (to_jsonb(jsonb_populate_record(null::public.nft_credential_replacement_batches,${quote(privateJson(batch))}::jsonb))-'created_at')) then raise exception 'batch mismatch'; end if;
      ${insert('nft_credential_replacements',replacement,'on conflict(old_contract,old_token_id) do nothing')}
      select * into strict current_row from public.nft_credential_replacements where old_contract=${quote(entry.oldContract)} and old_token_id=${quote(entry.item.oldTokenId)}::numeric;
      if not (to_jsonb(current_row) @> (to_jsonb(jsonb_populate_record(null::public.nft_credential_replacements,${quote(privateJson(replacement))}::jsonb))-'id'-'verified_at'-'finalized_block_number'-'finalized_block_hash')) then raise exception 'replacement mismatch'; end if;
      insert into public.nft_credential_replacement_entities(entity_type,entity_id,app_user_id,replacement_id,original_tx_hash)
        select entity_type,entity_id::uuid,app_user_id::uuid,current_row.id,original_tx_hash
        from jsonb_to_recordset(${quote(privateJson(aliases))}::jsonb) as x(entity_type text,entity_id text,app_user_id text,original_tx_hash text)
        on conflict(entity_type,entity_id) do nothing;
      if exists(select 1 from jsonb_to_recordset(${quote(privateJson(aliases))}::jsonb) as x(entity_type text,entity_id text,app_user_id text,original_tx_hash text)
        left join public.nft_credential_replacement_entities e on e.entity_type=x.entity_type and e.entity_id=x.entity_id::uuid
        where e.replacement_id is distinct from current_row.id or e.app_user_id is distinct from x.app_user_id::uuid or e.original_tx_hash is distinct from x.original_tx_hash)
      then raise exception 'entity mapping mismatch'; end if;
    end $reconcile$; commit;`;
}
export function pendingReplacementEntries(plan,journal,mode,limit,onlyLeaf){
  assert(['migrate','reconcile'].includes(mode)&&Number.isSafeInteger(limit)&&limit>0&&limit<=100,'LIMIT_1_TO_100_REQUIRED');
  if(onlyLeaf!==undefined)assert(limit===1&&/^0x[0-9a-f]{64}$/.test(onlyLeaf)
    &&plan.entries.some(entry=>entry.leaf===onlyLeaf),'EXACT_REVIEWED_LEAF_AND_LIMIT_1_REQUIRED');
  return plan.entries.filter(entry=>{
    if(onlyLeaf!==undefined&&entry.leaf!==onlyLeaf)return false;
    const saved=journal.steps.find(s=>s.id==='mint-'+entry.leaf);
    return !saved?.reconciled&&(mode==='migrate'?!saved?.receipt:!!saved);
  }).slice(0,limit);
}
export async function signStep(client,step,journal,journalFile){
  let saved=journal.steps.find(s=>s.id===step.id),receipt;
  if(saved){
    assert(keccak256(saved.signed)===saved.hash&&(await recoverTransactionAddress({serializedTransaction:saved.signed})).toLowerCase()===d.admin,'JOURNAL_SIGNATURE');
    assertKyaaEnvelope(parseTransaction(saved.signed),step);receipt=await readReceipt(client,saved.hash);
    if(!receipt){let tx;try{tx=await client.getTransaction({hash:saved.hash});}catch(e){if(e.name!=='TransactionNotFoundError')throw e;}
      assert(tx,'SIGNED_TRANSACTION_UNCERTAIN_DO_NOT_RESIGN');}
  }else{
    assert(journal.steps.every(s=>Number.isSafeInteger(s.nonce)&&step.nonce>s.nonce),'SIGNED_NONCE_REUSE');
    const [latest,pending,fees,estimate,balance]=await Promise.all([client.getTransactionCount({address:d.admin}),
      client.getTransactionCount({address:d.admin,blockTag:'pending'}),client.estimateFeesPerGas(),
      client.estimateGas({account:d.admin,data:step.data,value:0n,...(step.to?{to:step.to}:{})}),client.getBalance({address:d.admin})]);
    assert(latest===pending&&pending===step.nonce,'ADMIN_NONCE_CHANGED');assert(estimate<=BigInt(step.gas),'GAS_CAP');
    assert(balance>=BigInt(step.gas)*100000000n,'ADMIN_BALANCE');
    const tx={chainId:d.chainId,type:'eip1559',nonce:step.nonce,gas:BigInt(step.gas),data:step.data,value:0n,
      maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas,...(step.to?{to:step.to}:{})};assertKyaaEnvelope(tx,step);
    let key=execFileSync('/Users/jewel/.local/share/byus-admin-keychain/keychain-helper',['read'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
    assert(/^0x[0-9a-fA-F]{64}$/.test(key),'KEYCHAIN_FORMAT');const account=privateKeyToAccount(key);key='';
    assert(account.address.toLowerCase()===d.admin,'SIGNER_CHANGED');
    const signed=await account.signTransaction(tx);saved={id:step.id,nonce:step.nonce,signed,hash:keccak256(signed)};
    journal.steps.push(saved);persist(journalFile,journal);
    assert(await client.sendRawTransaction({serializedTransaction:signed})===saved.hash,'BROADCAST_HASH');
  }
  receipt=await confirmedKyaaReceipt(client,saved.hash);
  assert(receipt.status==='success'&&receipt.from.toLowerCase()===d.admin&&(receipt.to?.toLowerCase()??null)===(step.to??null),'TRANSACTION_RECEIPT');
  saved.receipt={hash:saved.hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash};persist(journalFile,journal);
  console.log(privateJson({step:step.id,...saved.receipt}));return receipt;
}
async function main(){
  const args=process.argv.slice(2),mode=args[0],get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
  assert(['prepare','inspect','deploy-and-schedule','activate','migrate','reconcile'].includes(mode),'UNKNOWN_MODE');
  const onlyLeaf=get('--leaf');
  assert(!args.includes('--leaf')||(['migrate','reconcile'].includes(mode)&&/^0x[0-9a-f]{64}$/.test(onlyLeaf??'')),'LEAF_REQUIRES_MIGRATE_OR_RECONCILE');
  const file=get('--manifest'),rpcFile=get('--rpc-file'),envFile=get('--database-env');assert(file&&rpcFile,'MANIFEST_AND_RPC_REQUIRED');
  const client=inventoryClient(fs.readFileSync(rpcFile,'utf8').trim()),a=artifact();
  assert(await client.getChainId()===d.chainId,'WRONG_CHAIN');
  const delay=await client.readContract({address:d.timelock,abi:tl,functionName:'getMinDelay'});
  if(mode==='prepare'){
    const [latest,pending,head]=await Promise.all([client.getTransactionCount({address:d.admin}),client.getTransactionCount({address:d.admin,blockTag:'pending'}),client.getBlock()]);
    assert(latest===pending,'PENDING_ADMIN_TRANSACTION');
    const plan=buildReplacementPlan(a,JSON.parse(fs.readFileSync(get('--verified'))),JSON.parse(fs.readFileSync(get('--metadata'))),pending,delay,head.timestamp+30n*86400n);
    writePrivate(file,plan);console.log(privateJson({prepared:true,manifest:file,reviewHash:hash(plan),migrator:plan.migrator,
      batchId:plan.batchId,items:plan.maxItems,delay:plan.delay,maximumExposureWei:plan.maximumExposureWei}));return;
  }
  checkPrivate(file);const plan=JSON.parse(fs.readFileSync(file));validateReplacementPlan(plan,a);
  assert(delay===BigInt(plan.delay),'TIMELOCK_DELAY_CHANGED');
  const reviewHash=hash(plan),timestamp=await client.readContract({address:d.timelock,abi:tl,functionName:'getTimestamp',args:[plan.operation]});
  if(mode==='inspect'){
    const deployed=!!await client.getBytecode({address:plan.migrator});if(deployed)await verifyDeployment(client,plan,a);
    console.log(privateJson({reviewHash,migrator:plan.migrator,deployed,batchId:plan.batchId,items:plan.maxItems,
      operation:plan.operation,timestamp,readyAt:timestamp>1n?new Date(Number(timestamp)*1000).toISOString():null,done:timestamp===1n}));return;
  }
  assert(get('--approved-hash')===reviewHash,'REVIEWED_MANIFEST_HASH_REQUIRED');
  for(const name of ['PROPOSER_ROLE','EXECUTOR_ROLE'])assert(await client.readContract({address:d.timelock,abi:tl,functionName:'hasRole',args:[textHash(name),d.admin]}),'TIMELOCK_ROLE_CHANGED');
  const common=path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()),dir=path.join(common,'byus-admin-transactions');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const lock=path.join(dir,'kyaa-migration.lock');fs.closeSync(fs.openSync(lock,'wx',0o600));
  const journalFile=path.join(dir,reviewHash+'.json');checkPrivate(journalFile);
  try{
    const journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile)):{manifestHash:reviewHash,steps:[]};
    assert(journal.manifestHash===reviewHash,'JOURNAL_MANIFEST');
    if(mode==='deploy-and-schedule'){
      for(const step of plan.steps){
        if(step.id==='schedule')await verifyDeployment(client,plan,a);
        const receipt=await signStep(client,step,journal,journalFile);
        if(step.id==='deploy')assert(receipt.contractAddress?.toLowerCase()===plan.migrator,'DEPLOYED_ADDRESS');
      }
      await verifyDeployment(client,plan,a);
      const ready=await client.readContract({address:d.timelock,abi:tl,functionName:'getTimestamp',args:[plan.operation]});assert(ready>1n,'NOT_SCHEDULED');
      writePrivate(file+'.schedule.json',{migrator:plan.migrator,operation:plan.operation,readyAt:new Date(Number(ready)*1000).toISOString(),transactions:journal.steps.map(({id,receipt})=>({id,...receipt}))});return;
    }
    await verifyDeployment(client,plan,a);
    if(mode==='activate'){
      if(timestamp!==1n){
        assert(await client.readContract({address:d.timelock,abi:tl,functionName:'isOperationReady',args:[plan.operation]}),'TIMELOCK_NOT_READY');
        await signStep(client,{...plan.activate,nonce:journal.steps.find(s=>s.id==='activate')?.nonce??await client.getTransactionCount({address:d.admin})},journal,journalFile);
      }
      const batch=await client.readContract({address:plan.migrator,abi:a.abi,functionName:'batches',args:[plan.batchId]});
      assert(batch[0]===plan.root&&batch[1]===plan.manifestHash&&batch[2]===BigInt(plan.expiresAt)&&batch[3]===plan.maxItems&&batch[4]===plan.maxMints&&!batch[7],'BATCH_MISMATCH');
      for(const address of [d.newPassport,d.newStamp])assert(await client.readContract({address,abi:nft,functionName:'hasRole',args:[role,plan.migrator]}),'MIGRATOR_MINTER');return;
    }
    assert(envFile&&timestamp===1n,'DATABASE_ENV_AND_ACTIVE_BATCH_REQUIRED');
    const limit=Number(get('--limit'));
    let processed=0;
    for(const entry of pendingReplacementEntries(plan,journal,mode,limit,onlyLeaf)){
      const id='mint-'+entry.leaf,saved=journal.steps.find(s=>s.id===id);
      const facts=assertPreflight(entry,JSON.parse(database(envFile,preflightSql(entry))||'null'));
      let receipt;
      if(mode==='migrate'){
        const refs=entry.sourceRefs.map(ref=>({...ref,tokenId:BigInt(ref.tokenId)}));
        const step={id,to:plan.migrator,gas:plan.mintGasCap,nonce:saved?.nonce??await client.getTransactionCount({address:d.admin}),
          data:encodeFunctionData({abi:a.abi,functionName:'migrate',args:[{...entry.item,oldTokenId:BigInt(entry.item.oldTokenId)},entry.metadataUri,entry.proof,refs]})};
        receipt=await signStep(client,step,journal,journalFile);
        // Reconcile separately so finality does not serialize thousands of otherwise independent mints.
        processed++;continue;
      }else receipt=await readReceipt(client,saved.hash);
      assert(receipt,'RECONCILIATION_RECEIPT_MISSING');
      const proof=await finalizedReplacement(client,plan,entry,receipt,a);
      const freshFacts=assertPreflight(entry,JSON.parse(database(envFile,preflightSql(entry))||'null'));
      assert(freshFacts.original.txHash===facts.original.txHash,'ORIGINAL_REFERENCE_CHANGED');
      database(envFile,reconciliationSql(plan,entry,receipt,proof,freshFacts),true);
      journal.steps.find(s=>s.id===id).reconciled=true;persist(journalFile,journal);
      processed++;
    }
    console.log(privateJson({processed,mode,reconciled:journal.steps.filter(s=>s.reconciled).length,total:plan.entries.length}));
  }finally{fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  console.error(privateJson({stopped:true,reason:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:error.name}));process.exitCode=1;
});
