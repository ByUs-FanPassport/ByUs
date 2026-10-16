#!/usr/bin/env node
// Explicit read-only proofs for assets without a business entity; never infer this lane from a missing row.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {CID} from 'multiformats/cid';
import {parseAbi,decodeEventLog,decodeFunctionData,toEventSelector,keccak256,parseTransaction,recoverTransactionAddress} from 'viem';
import {renderMetadata,assertPiiFree} from '../apps/worker/dist/metadata.js';
import {kyaaCredentialImage,KYAA_CREDENTIAL_ASSET_BASE_URI} from '../apps/worker/dist/kyaa-credential-assets.js';
import {EXISTING_NFT_DEPLOYMENT as d,trustedActionContext as context,inventoryRanges,inventoryClient,
  privateJson,writePrivate,zeroHash,zeroAddress} from './migrate-existing-nfts-giwa.mjs';

const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
const hash=v=>keccak256(new TextEncoder().encode(privateJson(v)));
const hex32=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&v!==zeroAddress;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const uint=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const exact=(v,keys)=>v&&isDeepStrictEqual(Object.keys(v).sort(),keys.split(',').sort());
const mintAbi=parseAbi(['event PassportMinted(bytes32 indexed passportId,uint256 indexed tokenId,address indexed to,string metadataUri)',
  'event StampMinted(bytes32 indexed issuanceId,uint256 indexed tokenId,address indexed to,string metadataUri)',
  'function mint(address to,bytes32 issuanceKey,string metadataUri)']);
const linkedAbi=parseAbi(['event CredentialLinked(bytes32 indexed actionId,address indexed nftContract,uint256 indexed tokenId,uint8 credentialKind,bytes32 issuanceKey,uint8 linkOrigin)']);
const nftAbi=parseAbi(['function hasRole(bytes32,address) view returns(bool)',
  'function tokenByPassportId(bytes32) view returns(uint256)','function tokenByIssuanceId(bytes32) view returns(uint256)',
  'function ownerOf(uint256) view returns(address)','function balanceOf(address,uint256) view returns(uint256)',
  'function totalSupply(uint256) view returns(uint256)','function tokenURI(uint256) view returns(string)','function uri(uint256) view returns(string)']);
const minterRole=keccak256(new TextEncoder().encode('MINTER_ROLE'));

export function directHistoryDigest(history){const {digest:_,...core}=history;return hash(core);}
export function assertDirectHistory(evidence){
  assert(exact(evidence,'snapshot,hubHistory'),'DIRECT_EVIDENCE_FORMAT');
  const {snapshot:s,hubHistory:h}=evidence;
  assert(exact(s,'blockNumber,blockHash,timestamp')&&uint(s.blockNumber)&&uint(s.timestamp)&&hex32(s.blockHash),'DIRECT_SNAPSHOT');
  assert(exact(h,'hubs,fromBlock,toBlock,blockHash,chunkSize,ranges,targets,references,digest')
    &&isDeepStrictEqual(h.hubs,[context.legacyHub,d.hub])&&h.fromBlock==='35954883'
    &&h.toBlock===s.blockNumber&&h.blockHash===s.blockHash&&h.chunkSize===1000
    &&isDeepStrictEqual(h.ranges,inventoryRanges(BigInt(h.fromBlock),BigInt(h.toBlock)).map(r=>r.map(String)))
    &&Array.isArray(h.references)&&h.references.length===0&&h.digest===directHistoryDigest(h),'DIRECT_HISTORY_BASELINE');
  assert(Array.isArray(h.targets)&&h.targets.length>0&&h.targets.length<=10000
    &&h.targets.every(t=>exact(t,'contract,tokenId')&&[d.oldPassport,d.oldStamp].includes(t.contract)&&uint(t.tokenId))
    &&new Set(h.targets.map(t=>`${t.contract}:${t.tokenId}`)).size===h.targets.length,'DIRECT_HISTORY_TARGETS');
  return evidence;
}
export function assertDirectSource(source,evidence){
  assert(exact(source,'sourceKind,kind,contract,tokenId,issuanceKey,owner,metadataUri,transactionHash,blockNumber,blockHash,mintProof,originalMetadata'+(Object.hasOwn(source,'orphanCompletedJob')?',orphanCompletedJob':''))
    &&source.sourceKind==='direct_legacy'&&[0,1].includes(source.kind)
    &&source.contract===(source.kind===0?d.oldPassport:d.oldStamp)&&uint(source.tokenId)
    &&hex32(source.issuanceKey)&&source.issuanceKey!==zeroHash&&address(source.owner)
    &&hex32(source.transactionHash)&&uint(source.blockNumber)&&hex32(source.blockHash)
    &&typeof source.metadataUri==='string'&&source.metadataUri.startsWith('ipfs://'),'DIRECT_SOURCE_FORMAT');
  const p=source.mintProof;
  assert(exact(p,'txHash,blockNumber,blockHash,minter,authorizedMinter,directCall,canonical,finalized')
    &&p.txHash===source.transactionHash&&p.blockNumber===source.blockNumber&&p.blockHash===source.blockHash
    &&address(p.minter)&&p.authorizedMinter===true&&p.directCall===true&&p.canonical===true&&p.finalized===true
    &&BigInt(source.blockNumber)<=BigInt(evidence.snapshot.blockNumber),'DIRECT_MINT_PROOF');
  assert(evidence.hubHistory.targets.some(t=>t.contract===source.contract&&t.tokenId===source.tokenId),'DIRECT_UNAUDITED_ASSET');
  if(Object.hasOwn(source,'orphanCompletedJob'))assertOrphanCompletedJob(source);
  return source;
}
export function assertRawMetadata(proof,uri){
  assert(exact(proof,'uri,raw,sha256,document')&&proof.uri===uri&&typeof proof.raw==='string'
    &&/^[0-9a-f]{64}$/.test(proof.sha256),'DIRECT_METADATA_PROOF');
  const cid=CID.parse(proof.uri.slice(7)),digest=createHash('sha256').update(proof.raw).digest('hex');
  assert(cid.code===0x55&&cid.multihash.code===0x12&&digest===proof.sha256
    &&Buffer.from(cid.multihash.digest).toString('hex')===digest,'DIRECT_METADATA_CID');
  const doc=JSON.parse(proof.raw);
  assert(isDeepStrictEqual(doc,proof.document),'DIRECT_METADATA_DOCUMENT');return doc;
}
export function directLegacyMetadata(source){
  const doc=assertRawMetadata(source.originalMetadata,source.metadataUri);
  assert(exact(doc,'schema,version,name,description,image,attributes')
    &&doc.schema==='https://byus.kr/schemas/credential-metadata-v1.json'&&doc.version===1
    &&Array.isArray(doc.attributes)&&doc.attributes.length===4,'DIRECT_METADATA_DOCUMENT');
  assert(doc.attributes.every(a=>exact(a,'trait_type,value')&&typeof a.value==='string')
    &&new Set(doc.attributes.map(a=>a.trait_type)).size===4,'DIRECT_METADATA_TRAITS');
  const traits=Object.fromEntries(doc.attributes.map(a=>[a.trait_type,a.value]));
  assert(isDeepStrictEqual(Object.keys(traits).sort(),['Celebrity','Credential','Metadata Version','Transferability'])
    &&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(traits.Celebrity)&&traits.Celebrity.length<=80
    &&traits.Transferability==='Soulbound'&&traits['Metadata Version']==='1','DIRECT_METADATA_TRAITS');
  const types={'Fan Passport':['passport',null,0],'First Reaction':['reaction',null,1],
    'Knowledge Stamp':['stamp','Knowledge',1],'Fan Verification Stamp':['stamp','Knowledge',1],
    'Reservation Stamp':['stamp','Reservation',1],'Attendance Stamp':['stamp','Attendance',1],'Survey Stamp':['stamp','Survey',1]};
  const type=types[traits.Credential];
  assert(type&&type[2]===source.kind&&['ByUs','kyaa'].some(brand=>doc.name===`${brand} ${traits.Credential}`
    &&doc.description===`A soulbound ${brand} ${traits.Credential} credential.`)
    &&/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[a-zA-Z0-9/._-]+)?$/.test(doc.image)
    &&!/(?:0x[0-9a-f]{40}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[^\s]+@[^\s]+)/i.test(JSON.stringify(doc)),'UNSUPPORTED_DIRECT_METADATA');
  assertPiiFree(doc);
  const payload={celebritySlug:traits.Celebrity,...(type[1]?{stampType:type[1]}:{})};
  const rendered=renderMetadata({entityType:type[0]},payload,KYAA_CREDENTIAL_ASSET_BASE_URI);
  rendered.image=kyaaCredentialImage(type[0],payload,KYAA_CREDENTIAL_ASSET_BASE_URI);
  rendered.attributes=doc.attributes;
  assertPiiFree(rendered);return rendered;
}
// Fingerprint reviewed private evidence independently of JSON object insertion order.
export function orphanCompletedJobFingerprint(snapshot){
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}
export function assertOrphanCompletedJob(source){
  const e=source.orphanCompletedJob,j=e?.jobSnapshot;
  assert(exact(e,'format,jobId,ownerAppUserId,jobSnapshot,jobFingerprint')&&e.format==='kyaa-orphan-completed-job-v1'
    &&uuid(e.jobId)&&uuid(e.ownerAppUserId)&&exact(j,'id,entity_type,entity_id,operation_key,payload_version,payload,status,attempts,max_attempts,idempotency_key,tx_hash,token_id,last_error_code,last_error_message,next_attempt_at,lease_owner,lease_expires_at,created_at,updated_at,completed_at')
    &&e.jobFingerprint===orphanCompletedJobFingerprint(j),'ORPHAN_JOB_EVIDENCE');
  const traits=Object.fromEntries(assertRawMetadata(source.originalMetadata,source.metadataUri).attributes.map(a=>[a.trait_type,a.value]));
  assert(source.kind===0&&traits.Credential==='Fan Passport'&&j.id===e.jobId&&uuid(j.entity_id)&&uuid(j.idempotency_key)
    &&j.status==='COMPLETED'&&j.entity_type==='passport'&&j.payload_version===1
    &&Number.isSafeInteger(j.token_id)&&j.token_id>0&&String(j.token_id)===source.tokenId
    &&Number.isSafeInteger(j.attempts)&&j.attempts>=0&&Number.isSafeInteger(j.max_attempts)&&j.max_attempts>=1&&j.max_attempts<=32
    &&j.lease_owner===null&&j.lease_expires_at===null&&typeof j.completed_at==='string'&&Number.isFinite(Date.parse(j.completed_at))
    &&['created_at','updated_at','next_attempt_at'].every(k=>typeof j[k]==='string'&&Number.isFinite(Date.parse(j[k])))
    &&[j.last_error_code,j.last_error_message].every(v=>v===null||typeof v==='string')
    &&j.tx_hash===source.transactionHash&&exact(j.payload,'recipient,passportId,celebritySlug'+(Object.hasOwn(j.payload,'workerSubmission')?',workerSubmission':''))
    &&typeof j.payload.recipient==='string'&&j.payload.recipient.toLowerCase()===source.owner&&j.payload.passportId===source.issuanceKey&&j.payload.celebritySlug===traits.Celebrity
    &&j.operation_key===`byus:passport:v1:${e.ownerAppUserId}:${traits.Celebrity}`,'ORPHAN_JOB_BINDING');
  if(Object.hasOwn(j.payload,'workerSubmission')){
    const w=j.payload.workerSubmission;
    assert(exact(w,'txHash,signedTransaction')&&w.txHash===source.transactionHash
      &&typeof w.signedTransaction==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(w.signedTransaction)
      &&keccak256(w.signedTransaction)===source.transactionHash,'ORPHAN_SIGNED_TRANSACTION');
    const tx=parseTransaction(w.signedTransaction),call=decodeFunctionData({abi:mintAbi,data:tx.data});
    assert(tx.chainId===d.chainId&&tx.to?.toLowerCase()===source.contract&&(tx.value??0n)===0n
      &&Number.isSafeInteger(tx.nonce)&&tx.nonce>=0&&call.functionName==='mint'&&call.args[0].toLowerCase()===source.owner
      &&call.args[1]===source.issuanceKey&&call.args[2]===source.metadataUri,'ORPHAN_SIGNED_ENVELOPE');
  }
  return e;
}
function orphanCompletedJobPredicate(source){
  const e=assertOrphanCompletedJob(source),j=e.jobSnapshot,id=quote(e.jobId),entity=quote(j.entity_id),key=quote(source.issuanceKey),tx=quote(source.transactionHash);
  return `exists(select 1 from public.blockchain_jobs j where j.id=${id}::uuid and to_jsonb(j)=${quote(privateJson(j))}::jsonb)
    and (select count(*) from public.user_wallets where address=${quote(source.owner)})=1
    and exists(select 1 from public.user_wallets w join public.app_users u on u.id=w.app_user_id
      where w.address=${quote(source.owner)} and w.chain_id=${d.chainId} and w.provider='privy' and w.wallet_type='embedded' and u.id=${quote(e.ownerAppUserId)}::uuid and u.status='active')
    and not exists(select 1 from public.blockchain_jobs where id<>${id}::uuid and
      (lower(tx_hash)=${tx} or lower(payload->>'issuanceId')=${key} or lower(payload->>'passportId')=${key}
      or (entity_type='passport' and token_id=${source.tokenId}::numeric) or entity_id=${entity}::uuid or operation_key=${quote(j.operation_key)} or idempotency_key=${quote(j.idempotency_key)}::uuid))
    and ${['fan_passports','stamps','fan_reactions','community_stamps','live_collectible_claims'].map(t=>`not exists(select 1 from public.${t}
      where id=${entity}::uuid or blockchain_job_id=${id}::uuid or lower(tx_hash)=${tx})`).join(' and ')}
    and not exists(select 1 from public.fan_passports where token_id=${source.tokenId}::numeric)
    and not exists(select 1 from public.first_reaction_stamps where id=${entity}::uuid or passport_id=${entity}::uuid
      or reaction_id=${entity}::uuid or blockchain_source_id=${entity}::uuid or activity_id=${entity}::uuid or lower(tx_hash)=${tx})
    and not exists(select 1 from public.fan_action_credentials where legacy_job_id=${id}::uuid or entity_id=${entity}::uuid)
    and not exists(select 1 from public.fan_action_outbox o where
      exists(select 1 from jsonb_array_elements(o.payload->'intents') r where jsonb_typeof(r)<>'object'
        or lower(r->>'legacyJobId')=${id} or lower(r->>'entityId')=${entity})
      or exists(select 1 from jsonb_array_elements(o.source_snapshot->'credentials') r where jsonb_typeof(r)<>'object'
        or lower(r->>'legacyJobId')=${id} or lower(r->>'entityId')=${entity}
        or r#>>'{metadata,operationKey}'=${quote(j.operation_key)}
        or lower(r#>>'{metadata,legacyPayload,passportId}')=${key}
        or lower(r#>>'{metadata,legacyPayload,issuanceId}')=${key}
        or lower(r#>>'{metadata,legacyPayload,workerSubmission,txHash}')=${tx}))`;
}
export function directAbsencePredicate(source){
  assert(source.sourceKind==='direct_legacy'&&hex32(source.transactionHash)&&hex32(source.issuanceKey)
    &&[d.oldPassport,d.oldStamp].includes(source.contract)&&uint(source.tokenId),'DIRECT_SOURCE_FORMAT');
  const tx=quote(source.transactionHash),key=quote(source.issuanceKey);
  const jobGuard=Object.hasOwn(source,'orphanCompletedJob')?orphanCompletedJobPredicate(source)
    :`not exists(select 1 from public.blockchain_jobs where tx_hash=${tx} or payload->>'issuanceId'=${key} or payload->>'passportId'=${key})`;
  return `not exists(select 1 from public.fan_action_credentials where
    (nft_contract=${quote(source.contract)} and token_id=${source.tokenId}::numeric) or issuance_key=${key})
    and ${Object.hasOwn(source,'orphanCompletedJob')?`(${jobGuard})`:jobGuard}
    and not exists(select 1 from public.fan_action_outbox o where o.tx_hash=${tx}
      or exists(select 1 from jsonb_array_elements(o.payload->'intents') r where jsonb_typeof(r)<>'object'
        or lower(r->>'issuanceKey')=${key} or (lower(r->>'nftContract')=${quote(source.contract)} and r->>'tokenId'=${quote(source.tokenId)}))
      or exists(select 1 from jsonb_array_elements(o.source_snapshot->'credentials') r where jsonb_typeof(r)<>'object'
        or lower(r->>'issuanceKey')=${key} or (lower(r->>'nftContract')=${quote(source.contract)}
          and (r->>'tokenId'=${quote(source.tokenId)} or r->>'existingTokenId'=${quote(source.tokenId)}))))
    and not exists(select 1 from public.fan_passports where tx_hash=${tx})
    and not exists(select 1 from public.stamps where tx_hash=${tx})
    and not exists(select 1 from public.fan_reactions where tx_hash=${tx})
    and not exists(select 1 from public.community_stamps where tx_hash=${tx})
    and not exists(select 1 from public.first_reaction_stamps where tx_hash=${tx})
    and not exists(select 1 from public.first_reaction_stamps a join public.fan_reactions r
      on r.id=a.reaction_id or r.id=a.blockchain_source_id where r.tx_hash=${tx})`;
}
export const directAbsenceSql=source=>`select jsonb_build_object('absent',(${directAbsencePredicate(source)}));`;
export function assertDirectAbsence(facts){assert(facts?.absent===true,'DIRECT_DATABASE_ASSOCIATION');return facts;}

export async function verifyDirectHistory(client,evidence,head){
  assertDirectHistory(evidence);
  assert(typeof head.number==='bigint'&&hex32(head.hash)&&typeof head.timestamp==='bigint'
    &&head.timestamp>=BigInt(evidence.snapshot.timestamp),'DIRECT_CURRENT_SNAPSHOT');
  const h=evidence.hubHistory;
  assert(head.number>=BigInt(h.toBlock)&&(await client.getBlock({blockNumber:BigInt(h.toBlock)})).hash===h.blockHash,'DIRECT_BASELINE_REORG');
  const targets=new Set(h.targets.map(t=>`${t.contract}:${t.tokenId}`));
  if(head.number>BigInt(h.toBlock))for(const [fromBlock,toBlock] of inventoryRanges(BigInt(h.toBlock)+1n,head.number)){
    const logs=await client.getLogs({address:h.hubs,event:linkedAbi[0],args:{nftContract:[d.oldPassport,d.oldStamp],
      tokenId:[...new Set(h.targets.map(t=>BigInt(t.tokenId)))]},fromBlock,toBlock,strict:true});
    for(const log of logs){
      assert(h.hubs.includes(log.address.toLowerCase())&&log.blockNumber>=fromBlock&&log.blockNumber<=toBlock
        &&log.removed!==true&&(await client.getBlock({blockNumber:log.blockNumber})).hash===log.blockHash,'DIRECT_HISTORY_LOG');
      const {args}=decodeEventLog({abi:linkedAbi,data:log.data,topics:log.topics,strict:true});
      assert(!targets.has(`${args.nftContract.toLowerCase()}:${args.tokenId}`),'DIRECT_HUB_REFERENCE_FOUND');
    }
  }
  assert((await client.getBlock({blockNumber:head.number})).hash===head.hash,'DIRECT_SNAPSHOT_REORG');
}
export async function verifyDirectSource(client,source,evidence,head){
  assertDirectSource(source,evidence);directLegacyMetadata(source);
  const [receipt,tx]=await Promise.all([client.getTransactionReceipt({hash:source.transactionHash}),client.getTransaction({hash:source.transactionHash})]);
  assert(receipt.status==='success'&&receipt.transactionHash===source.transactionHash
    &&receipt.blockNumber===BigInt(source.blockNumber)&&receipt.blockHash===source.blockHash&&receipt.blockNumber<=head.number
    &&receipt.to?.toLowerCase()===source.contract&&receipt.from.toLowerCase()===source.mintProof.minter
    &&tx.hash===source.transactionHash&&tx.to?.toLowerCase()===source.contract&&tx.from.toLowerCase()===source.mintProof.minter
    &&(tx.value??0n)===0n&&(await client.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'DIRECT_ORIGINAL_RECEIPT');
  if(source.orphanCompletedJob?.jobSnapshot.payload.workerSubmission){
    const signed=source.orphanCompletedJob.jobSnapshot.payload.workerSubmission.signedTransaction;
    assert((await recoverTransactionAddress({serializedTransaction:signed})).toLowerCase()===source.mintProof.minter
      &&parseTransaction(signed).data===tx.input,'ORPHAN_SIGNED_SENDER');
  }
  const call=decodeFunctionData({abi:mintAbi,data:tx.input});
  assert(call.functionName==='mint'&&call.args[0].toLowerCase()===source.owner
    &&call.args[1]===source.issuanceKey&&call.args[2]===source.metadataUri,'DIRECT_ORIGINAL_CALL');
  const event=mintAbi.find(e=>e.type==='event'&&e.name===(source.kind===0?'PassportMinted':'StampMinted'));
  const logs=receipt.logs.filter(l=>l.address.toLowerCase()===source.contract&&l.topics[0]===toEventSelector(event));
  assert(logs.length===1,'DIRECT_MINT_EVENT_COUNT');
  const log=logs[0],{args}=decodeEventLog({abi:mintAbi,data:log.data,topics:log.topics,strict:true});
  assert(log.transactionHash===source.transactionHash&&log.blockNumber===receipt.blockNumber&&log.blockHash===receipt.blockHash
    &&log.removed!==true&&(args.passportId??args.issuanceId)===source.issuanceKey&&args.tokenId===BigInt(source.tokenId)
    &&args.to.toLowerCase()===source.owner&&args.metadataUri===source.metadataUri,'DIRECT_MINT_EVENT');
  assert(await client.readContract({address:source.contract,abi:nftAbi,functionName:'hasRole',args:[minterRole,source.mintProof.minter],
    blockNumber:receipt.blockNumber}),'DIRECT_ORIGINAL_MINTER');
  const read=(functionName,args)=>client.readContract({address:source.contract,abi:nftAbi,functionName,args,blockNumber:head.number});
  const [key,owner,uri]=await Promise.all([read(source.kind===0?'tokenByPassportId':'tokenByIssuanceId',[source.issuanceKey]),
    read(source.kind===0?'ownerOf':'balanceOf',source.kind===0?[BigInt(source.tokenId)]:[source.owner,BigInt(source.tokenId)]),
    read(source.kind===0?'tokenURI':'uri',[BigInt(source.tokenId)])]);
  assert(key===BigInt(source.tokenId)&&(source.kind===0?owner.toLowerCase()===source.owner:owner===1n)&&uri===source.metadataUri,'DIRECT_ORIGINAL_ASSET');
  if(source.kind===1)assert(await read('totalSupply',[BigInt(source.tokenId)])===1n,'DIRECT_ORIGINAL_SUPPLY');
  assert((await client.getBlock({blockNumber:head.number})).hash===head.hash,'DIRECT_SNAPSHOT_REORG');
}

async function main(){
  const args=process.argv.slice(2),mode=args[0],get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
  assert(['verify','metadata'].includes(mode),'DIRECT_VERIFY_OR_METADATA_REQUIRED');
  const required=mode==='metadata'?['--verified','--output']:['--proof','--original-metadata','--rpc-file','--database-env','--output'];
  assert(required.every(flag=>args.includes(flag)&&get(flag)?.trim()&&!get(flag).startsWith('--')),'DIRECT_ARGUMENTS_REQUIRED');
  const output=get('--output');assert(args.includes('--output')&&output,'DIRECT_OUTPUT_REQUIRED');
  assert(!fs.existsSync(output),'OUTPUT_EXISTS');
  if(mode==='metadata'){
    const verified=JSON.parse(fs.readFileSync(get('--verified')));
    assert(verified.format==='kyaa-direct-legacy-verified-v1','DIRECT_VERIFIED_FORMAT');
    const evidence=assertDirectHistory({snapshot:verified.snapshot,hubHistory:verified.hubHistory});
    assert(Array.isArray(verified.items)&&verified.items.length>0&&verified.items.length<=10000,'DIRECT_PROOF_ITEMS');
    const documents=new Map(),items=verified.items.map(source=>{
      assertDirectSource(source,evidence);
      const document=directLegacyMetadata(source),digest=hash(document),raw=JSON.stringify(document);
      documents.set(digest,{digest,document,raw,sha256:createHash('sha256').update(raw).digest('hex')});
      return {contract:source.contract,tokenId:source.tokenId,documentHash:digest};
    });
    writePrivate(output,{format:'kyaa-direct-legacy-metadata-documents-v1',snapshotBlockHash:verified.snapshot.blockHash,documents:[...documents.values()],items});return;
  }
  const proof=JSON.parse(fs.readFileSync(get('--proof'))),metadata=JSON.parse(fs.readFileSync(get('--original-metadata')));
  assert(exact(proof,'format,snapshot,hubHistory,items')&&proof.format==='kyaa-direct-legacy-proof-v1'
    &&metadata.format==='kyaa-direct-legacy-original-metadata-v1'&&Array.isArray(metadata.documents),'DIRECT_PROOF_FORMAT');
  const evidence=assertDirectHistory({snapshot:proof.snapshot,hubHistory:proof.hubHistory});
  assert(Array.isArray(proof.items)&&proof.items.length>0&&new Set(proof.items.map(s=>`${s.contract}:${s.tokenId}`)).size===proof.items.length,'DIRECT_PROOF_ITEMS');
  const client=inventoryClient(fs.readFileSync(get('--rpc-file'),'utf8').trim());
  assert(await client.getChainId()===d.chainId,'WRONG_CHAIN');
  const head=await client.getBlock({blockTag:'finalized'});await verifyDirectHistory(client,evidence,head);
  const {database}=await import('./replace-existing-nfts-giwa.mjs');
  assert(proof.items.filter(s=>Object.hasOwn(s,'orphanCompletedJob')).length<=1,'ORPHAN_EXCEPTION_LIMIT');
  const items=[];
  for(const raw of proof.items){
    const docs=metadata.documents.filter(m=>m.uri===raw.metadataUri);assert(docs.length===1,'DIRECT_METADATA_UNIQUE');
    const source={...raw,originalMetadata:docs[0]};assertDirectSource(source,evidence);
    assertDirectAbsence(JSON.parse(database(get('--database-env'),directAbsenceSql(source))));
    await verifyDirectSource(client,source,evidence,head);items.push(source);
  }
  writePrivate(output,{format:'kyaa-direct-legacy-verified-v1',...evidence,items});
  console.log(privateJson({verified:true,items:items.length,snapshot:head.number}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  console.error(privateJson({stopped:true,reason:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:error.name}));process.exitCode=1;
});
