#!/usr/bin/env node
// All production reads are pinned to one finalized block; inventories stay private.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {createPublicClient,http,parseAbi,decodeEventLog,decodeAbiParameters,encodeAbiParameters,keccak256,toEventSelector} from 'viem';
import {KYAA_DEPLOYMENT} from './migrate-kyaa-giwa.mjs';

export const EXISTING_NFT_DEPLOYMENT=Object.freeze({...KYAA_DEPLOYMENT,
  newPassport:'0xb6c5f48d770a732deb374226eda1e5be209b7ed4',
  newStamp:'0x527a70c0f7cf129650dc282b709327c5958a4ccf',fromBlock:31213597n});
const d=EXISTING_NFT_DEPLOYMENT;
const mintAbi=parseAbi([
  'event PassportMinted(bytes32 indexed passportId,uint256 indexed tokenId,address indexed to,string metadataUri)',
  'event StampMinted(bytes32 indexed issuanceId,uint256 indexed tokenId,address indexed to,string metadataUri)',
]);
const nftAbi=parseAbi(['function tokenByPassportId(bytes32) view returns(uint256)',
  'function tokenByIssuanceId(bytes32) view returns(uint256)','function ownerOf(uint256) view returns(address)',
  'function balanceOf(address,uint256) view returns(uint256)','function totalSupply(uint256) view returns(uint256)',
  'function tokenURI(uint256) view returns(string)','function uri(uint256) view returns(string)']);
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
export const zeroHash='0x'+'00'.repeat(32),zeroAddress='0x'+'00'.repeat(20);
export const trustedActionContext={legacyHub:'0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d',
  environmentId:'0xd5bc532db275cd70e5f55280b01cd2acc6b30b90d5aaa451adeb4b9a8f02c264',
  schemaUid:'0xbd97671d89c9f4bb246e33369389332486f406ab821a0c7f88860034759c5c0b',
  easAddress:'0x4200000000000000000000000000000000000021'};
export const refComponents=[{name:'nftContract',type:'address'},{name:'tokenId',type:'uint256'},
  {name:'kind',type:'uint8'},{name:'issuanceKey',type:'bytes32'},{name:'linkOrigin',type:'uint8'}];
export const privateJson=v=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?String(x):x,2);
export function writePrivate(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(file,privateJson(value)+'\n',{flag:'wx',mode:0o600});
}
export function inventoryRanges(start,end,size=1000n){
  assert(start>=0n&&end>=start&&size>0n,'INVALID_SCAN_RANGE');
  const ranges=[];for(let from=start;from<=end;from+=size)ranges.push([from,from+size-1n>end?end:from+size-1n]);
  return ranges;
}
export function readDatabaseInventory(envFile){
  const env=parseEnv(fs.readFileSync(envFile,'utf8'));
  assert(env.SUPABASE_PROD_PROJECT_REF&&env.SUPABASE_PROD_DB_PASSWORD,'DATABASE_ENV_MISSING');
  return JSON.parse(execFileSync('psql',['-XAt','-h','aws-1-ap-northeast-2.pooler.supabase.com',
    '-p','5432','-U',`postgres.${env.SUPABASE_PROD_PROJECT_REF}`,'-d','postgres','-v','ON_ERROR_STOP=1',
    '-f',fileURLToPath(new URL('./existing-nft-inventory.sql',import.meta.url))],{encoding:'utf8',
    maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,
      PGPASSWORD:env.SUPABASE_PROD_DB_PASSWORD,PGSSLMODE:'require',
      PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=30000'}}));
}
export function inventoryClient(rpcUrl){
  let nextRequest=0;
  return createPublicClient({transport:http(rpcUrl,{timeout:30000,retryCount:2,
    batch:{batchSize:64,wait:10},fetchFn:async(input,init)=>{
      const body=JSON.parse(String(init.body));
      const units=(Array.isArray(body)?body:[body]).reduce((sum,r)=>sum+(r.method==='eth_getLogs'?66:26),0);
      const wait=Math.max(0,nextRequest-Date.now());nextRequest=Date.now()+wait+Math.ceil(units/2);
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      return fetch(input,init);
    }})});
}
export function reconcileInventory(db,assets){
  const entities=new Map(db.entities.map(e=>[`${e.entity_type}:${e.entity_id}`,e]));
  const candidates=new Map(),unresolved=[];
  const add=(asset,entity,lane,credential)=>{
    const key=`${asset.contract}:${asset.tokenId}`;
    if(!candidates.has(key))candidates.set(key,{...asset,entities:[],credentials:[],issues:[]});
    const item=candidates.get(key);
    if(entity&&!item.entities.some(e=>e.entity_type===entity.entity_type&&e.entity_id===entity.entity_id))item.entities.push(entity);
    if(credential)item.credentials.push(credential);
    if(!entity)item.issues.push('MISSING_BUSINESS_ENTITY');
    else{
      if(entity.wallet?.toLowerCase()!==asset.owner)item.issues.push('WALLET_MISMATCH');
      if(entity.artwork_type==='membership'&&entity.eligibility!=='approved')item.issues.push('MEMBERSHIP_NOT_APPROVED');
      if(entity.blockchain_job_id&&entity.fan_action_outbox_id)item.issues.push('TWO_BUSINESS_LANES');
      if(lane==='legacy'){
        const j=entity.legacy_job;
        if(j?.entity_id!==entity.entity_id||j?.entity_type!==entity.entity_type||j?.status!=='COMPLETED'
          ||entity.mint_status!=='minted'||String(j.token_id)!==asset.tokenId||String(entity.token_id)!==asset.tokenId
          ||j.tx_hash?.toLowerCase()!==asset.transactionHash||entity.tx_hash?.toLowerCase()!==asset.transactionHash
          ||j.payload?.recipient?.toLowerCase()!==asset.owner)item.issues.push('LEGACY_RESULT_MISMATCH');
      }
    }
  };
  const byKey=new Map(assets.map(a=>[`${a.kind}:${a.issuanceKey}`,a]));
  const byAsset=new Map(assets.map(a=>[`${a.contract}:${a.tokenId}`,a]));
  for(const entity of db.entities){
    const job=entity.legacy_job;if(!job)continue;
    const kind=entity.entity_type==='passport'?0:1,key=job.payload?.[kind===0?'passportId':'issuanceId']?.toLowerCase();
    const asset=byKey.get(`${kind}:${key}`);
    if(asset)add(asset,entity,'legacy');
    else unresolved.push({entity_type:entity.entity_type,entity_id:entity.entity_id,reason:job.status==='COMPLETED'?'LEGACY_TOKEN_MISSING':'NOT_YET_MINTED'});
  }
  for(const credential of db.credentials){
    if(!credential.nft_contract||!credential.token_id)continue;
    const asset=byAsset.get(`${credential.nft_contract.toLowerCase()}:${credential.token_id}`);
    if(asset)add(asset,entities.get(`${credential.entity_type}:${credential.entity_id}`),'native',credential);
    else unresolved.push({credential_id:credential.id,reason:'CREDENTIAL_OUTSIDE_OLD_FINALIZED_MINTS'});
  }
  for(const asset of assets){
    const key=`${asset.contract}:${asset.tokenId}`;
    if(!candidates.has(key))candidates.set(key,{...asset,entities:[],credentials:[],issues:['MISSING_DATABASE_RECORD']});
  }
  const items=[...candidates.values()].map(item=>{
    const aliases=db.aliases.filter(a=>item.entities.some(e=>e.entity_type==='reaction'&&e.entity_id===a.reaction_id));
    if(aliases.some(a=>a.blockchain_source_id!==a.reaction_id||!item.entities.some(e=>e.app_user_id===a.app_user_id)))item.issues.push('REACTION_ALIAS_MISMATCH');
    if(item.entities.length!==1)item.issues.push('AMBIGUOUS_BUSINESS_ENTITY');
    return {...item,aliases,issues:[...new Set(item.issues)],classification:item.issues.length?'HOLD':item.credentials.length?'VERIFY_CURRENT_ACTION':'LEGACY_CANDIDATE'};
  });
  return {items,unresolved,summary:{onchainAssets:assets.length,businessEntities:db.entities.length,
    credentialRows:db.credentials.length,aliases:db.aliases.length,
    classifications:items.reduce((sum,i)=>({...sum,[i.classification]:(sum[i.classification]??0)+1}),{}),
    unresolved:unresolved.reduce((sum,i)=>({...sum,[i.reason]:(sum[i.reason]??0)+1}),{})}};
}
export async function captureChainInventory(client,progress=()=>{}){
  assert(await client.getChainId()===d.chainId,'WRONG_CHAIN');
  const block=await client.getBlock({blockTag:'finalized'}),ranges=inventoryRanges(d.fromBlock,block.number),logs=[];
  for(let offset=0;offset<ranges.length;offset+=16){
    const chunk=await Promise.all(ranges.slice(offset,offset+16).map(([fromBlock,toBlock])=>client.getLogs({
      address:[d.oldPassport,d.oldStamp],events:mintAbi,fromBlock,toBlock,strict:true})));
    logs.push(...chunk.flat());if(offset%512===0)progress({scanRanges:Math.min(offset+16,ranges.length),totalRanges:ranges.length,mints:logs.length});
  }
  const assets=[];
  for(let offset=0;offset<logs.length;offset+=16){
    assets.push(...await Promise.all(logs.slice(offset,offset+16).map(async log=>{
      const contract=log.address.toLowerCase(),kind=contract===d.oldPassport?0:1;
      const {args}=decodeEventLog({abi:mintAbi,data:log.data,topics:log.topics});
      const issuanceKey=(kind===0?args.passportId:args.issuanceId).toLowerCase(),tokenId=args.tokenId;
      const read=(address,functionName,args)=>client.readContract({address,abi:nftAbi,functionName,args,blockNumber:block.number});
      const [keyToken,ownerOrBalance,metadataUri,newToken]=await Promise.all([
        read(contract,kind===0?'tokenByPassportId':'tokenByIssuanceId',[issuanceKey]),
        read(contract,kind===0?'ownerOf':'balanceOf',kind===0?[tokenId]:[args.to,tokenId]),
        read(contract,kind===0?'tokenURI':'uri',[tokenId]),
        read(kind===0?d.newPassport:d.newStamp,kind===0?'tokenByPassportId':'tokenByIssuanceId',[issuanceKey]),
      ]);
      assert(keyToken===tokenId&&(kind===0?ownerOrBalance.toLowerCase()===args.to.toLowerCase():ownerOrBalance===1n),'SOURCE_OWNERSHIP_OR_KEY');
      if(kind===1)assert(await read(contract,'totalSupply',[tokenId])===1n,'SOURCE_SUPPLY');
      assert(metadataUri===args.metadataUri,'SOURCE_URI_CHANGED');
      return {contract,kind,tokenId:String(tokenId),issuanceKey,owner:args.to.toLowerCase(),metadataUri,
        transactionHash:log.transactionHash.toLowerCase(),blockNumber:String(log.blockNumber),blockHash:log.blockHash,
        existingNewTokenId:String(newToken)};
    })));
  }
  assert(new Set(assets.map(a=>`${a.contract}:${a.tokenId}`)).size===assets.length,'DUPLICATE_MINT_EVENT');
  assert((await client.getBlock({blockNumber:block.number})).hash===block.hash,'SNAPSHOT_REORG');
  return {chainId:d.chainId,blockNumber:String(block.number),blockHash:block.hash,timestamp:String(block.timestamp),
    fromBlock:String(d.fromBlock),rangesScanned:ranges.length,assets};
}
export function sourceRefs(rows){
  return rows.map(c=>{
    assert(c.nft_contract&&c.token_id&&c.issuance_key&&['MINTED_NOW','LINKED_EXISTING'].includes(c.link_origin),'INCOMPLETE_SOURCE_REFS');
    return {nftContract:c.nft_contract,tokenId:BigInt(c.token_id),kind:c.credential_kind,
      issuanceKey:c.issuance_key,linkOrigin:c.link_origin==='MINTED_NOW'?0:1};
  }).sort((a,b)=>BigInt(a.nftContract)<BigInt(b.nftContract)?-1:BigInt(a.nftContract)>BigInt(b.nftContract)?1:a.tokenId<b.tokenId?-1:a.tokenId>b.tokenId?1:0);
}
export function preferredSource(credentials,validProofs){
  // A current-Hub invalidation must not fall back to an older Hub's still-active copy.
  return credentials.some(c=>c.hub_proxy===d.hub)?validProofs.find(p=>p.hub===d.hub):validProofs[0];
}
export function parseSourceReceiptHints(proof){
  assert(proof&&proof.format==='kyaa-source-receipt-hints-v1'&&Object.keys(proof).sort().join(',')==='format,hints'
    &&Array.isArray(proof.hints)&&proof.hints.length>0,'INVALID_SOURCE_RECEIPT_HINTS');
  const seen=new Set();
  return proof.hints.map(hint=>{
    assert(hint&&Object.keys(hint).sort().join(',')==='actionId,hub,txHash'
      &&typeof hint.hub==='string'&&/^0x[0-9a-fA-F]{40}$/.test(hint.hub)
      &&typeof hint.actionId==='string'&&/^0x[0-9a-fA-F]{64}$/.test(hint.actionId)&&hint.actionId.toLowerCase()!==zeroHash
      &&typeof hint.txHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(hint.txHash)&&hint.txHash.toLowerCase()!==zeroHash,'INVALID_SOURCE_RECEIPT_HINT');
    const normalized={hub:hint.hub.toLowerCase(),actionId:hint.actionId.toLowerCase(),txHash:hint.txHash.toLowerCase()};
    assert([d.hub,trustedActionContext.legacyHub].includes(normalized.hub),'UNTRUSTED_SOURCE_RECEIPT_HUB');
    const key=`${normalized.hub}:${normalized.actionId}`;
    assert(!seen.has(key),'DUPLICATE_SOURCE_RECEIPT_HINT');seen.add(key);return normalized;
  });
}
export async function verifyCurrentInventory(client,chain,db,hints=[]){
  assert(Array.isArray(hints),'INVALID_SOURCE_RECEIPT_HINTS');
  if(hints.length)hints=parseSourceReceiptHints({format:'kyaa-source-receipt-hints-v1',hints});
  const {actionHubAbi,easAbi}=await import('../apps/worker/dist/action-abi.js');
  const blockNumber=BigInt(chain.blockNumber),cache=new Map();
  const linkedTopic=toEventSelector(actionHubAbi.find(event=>event.type==='event'&&event.name==='CredentialLinked'));
  const read=(address,abi,functionName,args)=>client.readContract({address,abi,functionName,args,blockNumber});
  const groups=new Map();for(const c of db.credentials){const key=`${c.hub_proxy}:${c.action_id}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  const verify=c=>{
    const key=`${c.hub_proxy}:${c.action_id}`;
    if(!cache.has(key))cache.set(key,(async()=>{
      assert([d.hub,trustedActionContext.legacyHub].includes(c.hub_proxy)&&c.chain_id===d.chainId
        &&c.environment_id===trustedActionContext.environmentId&&c.schema_uid===trustedActionContext.schemaUid,'UNTRUSTED_ACTION_BINDING');
      const original=await read(c.hub_proxy,actionHubAbi,'getAction',[c.action_id]);
      assert(original.actionId.toLowerCase()===c.action_id&&original.occurrenceId.toLowerCase()===c.occurrence_id,'SOURCE_ACTION_IDENTITY');
      const latestId=(await read(c.hub_proxy,actionHubAbi,'latestActionId',[original.occurrenceId])).toLowerCase();
      const record=latestId===c.action_id?original:await read(c.hub_proxy,actionHubAbi,'getAction',[latestId]);
      if(record.status!==2)return {valid:false,reason:'SOURCE_ACTION_INACTIVE'};
      let rows=groups.get(`${c.hub_proxy}:${latestId}`);
      if(!rows?.length){
        const hint=hints.find(hint=>hint.hub===c.hub_proxy&&hint.actionId===latestId);
        if(!hint)return {valid:false,reason:'LATEST_ACTION_REFS_MISSING'};
        const receipt=await client.getTransactionReceipt({hash:hint.txHash});
        assert(receipt.status==='success'&&receipt.transactionHash?.toLowerCase()===hint.txHash
          &&typeof receipt.blockNumber==='bigint'&&receipt.blockNumber>=0n&&receipt.blockNumber<=blockNumber
          &&/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash),'INVALID_SOURCE_RECEIPT');
        assert((await client.getBlock({blockNumber:receipt.blockNumber})).hash?.toLowerCase()===receipt.blockHash.toLowerCase(),'SOURCE_RECEIPT_REORG');
        rows=[];const assets=new Set();
        for(const log of receipt.logs){
          if(log.address?.toLowerCase()!==c.hub_proxy||log.topics?.[0]?.toLowerCase()!==linkedTopic)continue;
          const {args}=decodeEventLog({abi:actionHubAbi,eventName:'CredentialLinked',data:log.data,topics:log.topics,strict:true});
          if(args.actionId.toLowerCase()!==latestId)continue;
          assert(log.removed!==true&&log.transactionHash?.toLowerCase()===hint.txHash&&log.blockNumber===receipt.blockNumber
            &&log.blockHash?.toLowerCase()===receipt.blockHash.toLowerCase(),'SOURCE_RECEIPT_LOG_MISMATCH');
          assert(args.nftContract.toLowerCase()!==zeroAddress&&args.tokenId>0n
            &&[0,1,2].includes(args.credentialKind)&&[0,1].includes(args.linkOrigin)
            &&(args.credentialKind===2||args.issuanceKey.toLowerCase()!==zeroHash),'INVALID_SOURCE_RECEIPT_REF');
          const asset=`${args.nftContract.toLowerCase()}:${args.tokenId}`;
          assert(!assets.has(asset),'DUPLICATE_SOURCE_RECEIPT_REF');assets.add(asset);
          rows.push({nft_contract:args.nftContract.toLowerCase(),token_id:String(args.tokenId),credential_kind:args.credentialKind,
            issuance_key:args.issuanceKey.toLowerCase(),link_origin:args.linkOrigin===0?'MINTED_NOW':'LINKED_EXISTING'});
        }
        assert(rows.length>0,'SOURCE_RECEIPT_REFS_MISSING');
      }
      const refs=sourceRefs(rows);
      const [attestation,valid,eas,environment]=await Promise.all([
        read(trustedActionContext.easAddress,easAbi,'getAttestation',[record.easUID]),
        read(trustedActionContext.easAddress,easAbi,'isAttestationValid',[record.easUID]),
        read(c.hub_proxy,actionHubAbi,'eas',[]),read(c.hub_proxy,actionHubAbi,'environmentId',[]),
      ]);
      const data=decodeAbiParameters(['bytes32','bytes32','uint32','uint16','uint16','uint32','bytes32','bytes32','bytes32','uint32','uint8','bytes32','bytes32','bytes32'].map(type=>({type})),attestation.data);
      assert(eas.toLowerCase()===trustedActionContext.easAddress&&environment.toLowerCase()===trustedActionContext.environmentId
        &&record.actionId.toLowerCase()===latestId&&record.occurrenceId.toLowerCase()===c.occurrence_id
        &&record.schemaUID.toLowerCase()===trustedActionContext.schemaUid
        &&attestation.uid===record.easUID&&attestation.schema===record.schemaUID
        &&attestation.attester.toLowerCase()===c.hub_proxy&&attestation.recipient.toLowerCase()===record.fan.toLowerCase()
        &&attestation.refUID===record.refUID&&keccak256(attestation.data)===record.recordHash
        &&data[0]===record.occurrenceId&&data[1]===record.actionId&&data[2]===record.revision
        &&data[3]===record.actionCode&&data[4]===record.schemaVersion&&data[5]===record.policyVersion
        &&data[6].toLowerCase()===trustedActionContext.environmentId&&data[10]===record.origin
        &&data[12]===keccak256(encodeAbiParameters([{type:'tuple[]',components:refComponents}],[refs]))
        &&data[13]===record.migrationBatchId,'SOURCE_ATTESTATION_MISMATCH');
      if(!valid||attestation.revocationTime!==0n||(attestation.expirationTime!==0n&&attestation.expirationTime<=BigInt(chain.timestamp)))return {valid:false,reason:'SOURCE_ATTESTATION_INACTIVE'};
      return {valid:true,hub:c.hub_proxy,actionId:latestId,recipient:record.fan.toLowerCase(),refs,actionCode:record.actionCode};
    })());return cache.get(key);
  };
  const result=reconcileInventory(db,chain.assets),items=[];
  for(let offset=0;offset<result.items.length;offset+=16)items.push(...await Promise.all(result.items.slice(offset,offset+16).map(async item=>{
    if(item.classification==='HOLD')return item;
    if(!item.credentials.length)return {...item,classification:'ELIGIBLE',sourceHub:zeroAddress,sourceActionId:zeroHash,sourceRefs:[]};
    const proofs=await Promise.all(item.credentials.map(c=>verify(c)));
    const valid=proofs.filter(p=>p.valid&&p.recipient===item.owner&&p.refs.some(r=>r.nftContract.toLowerCase()===item.contract
      &&String(r.tokenId)===item.tokenId&&r.issuanceKey===item.issuanceKey&&r.kind===item.kind));
    const source=preferredSource(item.credentials,valid);
    if(!source)return {...item,classification:'HOLD',issues:[...item.issues,...new Set(proofs.filter(p=>!p.valid).map(p=>p.reason)),'NO_CURRENT_ATTESTED_SOURCE']};
    assert(item.credentials.every(c=>c.occurrence_owner===item.entities[0].app_user_id),'ACTION_OWNER_MISMATCH');
    return {...item,classification:'ELIGIBLE',sourceHub:source.hub,sourceActionId:source.actionId,sourceRefs:source.refs,actionCode:source.actionCode};
  })));
  assert((await client.getBlock({blockNumber})).hash===chain.blockHash,'SNAPSHOT_REORG');
  return {...result,items,summary:{...result.summary,classifications:items.reduce((sum,i)=>({...sum,[i.classification]:(sum[i.classification]??0)+1}),{})}};
}
export async function replacementMetadata(item){
  assert(item.classification==='ELIGIBLE'&&item.entities.length===1,'INELIGIBLE_METADATA_ITEM');
  const [{renderMetadata,assertPiiFree},{renderActionMetadata},{kyaaCredentialImage,KYAA_CREDENTIAL_ASSET_BASE_URI}]=await Promise.all([
    import('../apps/worker/dist/metadata.js'),import('../apps/worker/dist/action-builder.js'),import('../apps/worker/dist/kyaa-credential-assets.js'),
  ]);
  const entity=item.entities[0],slug=entity.creator_slug;
  assert(slug===null||/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),'INVALID_CREATOR_SLUG');
  const payload={celebritySlug:slug};
  if(entity.entity_type==='stamp')payload.stampType=entity.artwork_type[0].toUpperCase()+entity.artwork_type.slice(1);
  if(entity.entity_type==='community_stamp')payload.stampKind=entity.artwork_type.split('/')[1];
  let document=renderMetadata({entityType:entity.entity_type},payload,KYAA_CREDENTIAL_ASSET_BASE_URI);
  if(item.actionCode)document=renderActionMetadata(document,item.actionCode,1);
  document.image=kyaaCredentialImage(entity.entity_type,payload,KYAA_CREDENTIAL_ASSET_BASE_URI,item.actionCode);
  assertPiiFree(document);return document;
}
async function pinReplacementMetadata(verified,envFile,output){
  const {PinataMetadataAdapter}=await import('../apps/worker/dist/adapters/pinata.js');
  const env=parseEnv(fs.readFileSync(envFile,'utf8'));assert(env.PINATA_PROD_JWT,'PINATA_ENV_MISSING');
  const adapter=new PinataMetadataAdapter('https://api.pinata.cloud',env.PINATA_PROD_JWT),documents=new Map(),items=[];
  for(const item of verified.items.filter(i=>i.classification==='ELIGIBLE')){
    const document=await replacementMetadata(item),digest=keccak256(new TextEncoder().encode(privateJson(document)));
    documents.set(digest,document);items.push({contract:item.contract,tokenId:item.tokenId,documentHash:digest});
  }
  const dir=output+'.documents';fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const pinned=[];
  for(const [digest,document] of documents){
    const file=path.join(dir,digest+'.json');let saved;
    if(fs.existsSync(file)){
      saved=JSON.parse(fs.readFileSync(file));assert(privateJson(saved.document)===privateJson(document),'METADATA_DOCUMENT_CHANGED');
    }else{
      const uri=await adapter.pin(document,`existing-nft-${digest.slice(2)}`);saved={digest,uri,document};writePrivate(file,saved);
    }
    const response=await fetch(saved.uri.replace('ipfs://','https://gateway.pinata.cloud/ipfs/'),{signal:AbortSignal.timeout(30000)});
    assert(response.ok,'PUBLISHED_METADATA_UNAVAILABLE');
    const published=await response.json();assert(isDeepStrictEqual(published,document),'PUBLISHED_METADATA_MISMATCH');
    pinned.push(saved);
  }
  const result={format:'kyaa-existing-nft-metadata-v1',snapshotBlockHash:verified.blockHash,documents:pinned,items};
  writePrivate(output,result);console.log(privateJson({output,items:items.length,uniqueDocuments:pinned.length}));
}
async function main(){
  const args=process.argv.slice(2),get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
  assert(['inventory','verify','metadata'].includes(args[0]),'USAGE_INVENTORY_VERIFY_OR_METADATA');
  assert(!args.some(arg=>arg.startsWith('--source-receipts=')),'SOURCE_RECEIPTS_ARGUMENT');
  let hints=[];
  if(args.includes('--source-receipts')){
    assert(args[0]==='verify','SOURCE_RECEIPTS_VERIFY_ONLY');
    const file=get('--source-receipts');
    assert(args.filter(arg=>arg==='--source-receipts').length===1&&file?.trim()&&!file.startsWith('--'),'SOURCE_RECEIPTS_ARGUMENT');
    hints=parseSourceReceiptHints(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  const output=get('--output'),rpcFile=get('--rpc-file'),envFile=get('--database-env');
  if(args[0]==='metadata'){
    assert(output&&get('--verified')&&get('--pinata-env'),'METADATA_ARGUMENTS');assert(!fs.existsSync(output),'OUTPUT_EXISTS');
    const verified=JSON.parse(fs.readFileSync(get('--verified')));assert(verified.format==='kyaa-existing-nft-verified-v1','VERIFIED_INVENTORY_REQUIRED');
    await pinReplacementMetadata(verified,get('--pinata-env'),output);return;
  }
  assert(output&&rpcFile&&envFile,'INVENTORY_ARGUMENTS');assert(!fs.existsSync(output),'OUTPUT_EXISTS');
  const db=readDatabaseInventory(envFile);writePrivate(output+'.database.json',db);
  if(args[0]==='verify'){
    const chain=JSON.parse(fs.readFileSync(get('--chain'))),client=inventoryClient(fs.readFileSync(rpcFile,'utf8').trim());
    assert(await client.getChainId()===d.chainId,'WRONG_CHAIN');
    const result={format:'kyaa-existing-nft-verified-v1',...chain,assets:undefined,...await verifyCurrentInventory(client,chain,db,hints)};
    writePrivate(output,result);console.log(privateJson({output,...result.summary}));return;
  }
  const chain=await captureChainInventory(inventoryClient(fs.readFileSync(rpcFile,'utf8').trim()),p=>console.log(privateJson(p)));
  writePrivate(output+'.chain.json',chain);
  const result={format:'kyaa-existing-nft-inventory-v1',...chain,assets:undefined,...reconcileInventory(db,chain.assets)};
  writePrivate(output,result);console.log(privateJson({output,blockNumber:chain.blockNumber,blockHash:chain.blockHash,...result.summary}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{
  console.error(privateJson({stopped:true,reason:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:e.name}));process.exitCode=1;
});
