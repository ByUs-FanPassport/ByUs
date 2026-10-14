#!/usr/bin/env node
// Exact GIWA migration: deploy three contracts, schedule once, execute only after the real delay.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createPublicClient,http,encodeDeployData,encodeFunctionData,encodeAbiParameters,getContractAddress,keccak256,parseAbi,parseTransaction,recoverTransactionAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

export const KYAA_DEPLOYMENT=Object.freeze({chainId:91342,admin:'0xeee82f960476c888950c798c444c1fd92cbbfe50',hub:'0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956',timelock:'0x40eaeb0b73c50da5053502eb3b836a6effe54642',oldImplementation:'0x049b758b3d1cc0c66408b264c7f9a96ea479860b',oldRuntimeHash:'0x3e50e0def7b3823e63bca919f5ecc1a09a709b4b62eb7dae1c710cb1c20d17d9',oldPassport:'0x17f9fb7658a326dd88db523739c227faf50fca20',oldStamp:'0x1adcde3473c4e884e60205b397ece744d8892285'});
const d=KYAA_DEPLOYMENT,zero='0x'+'00'.repeat(32),slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const tl=parseAbi(['function getMinDelay() view returns(uint256)','function hasRole(bytes32,address) view returns(bool)','function getTimestamp(bytes32) view returns(uint256)','function isOperationReady(bytes32) view returns(bool)','function isOperationDone(bytes32) view returns(bool)','function schedule(address,uint256,bytes,bytes32,bytes32,uint256)','function execute(address,uint256,bytes,bytes32,bytes32) payable']);
const hubAbi=parseAbi(['function getAssetBinding(uint32,uint8) view returns(address)','function initializeKyaaBinding()','function upgradeToAndCall(address,bytes) payable']);
const nftAbi=parseAbi(['function defaultAdmin() view returns(address)','function hasRole(bytes32,address) view returns(bool)','function name() view returns(string)','function symbol() view returns(string)']);
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
const json=v=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?String(x):x,2);
const hash=v=>keccak256(new TextEncoder().encode(json(v)));
const paths={passport:'KyaaPassport',stamp:'KyaaStamp',implementation:'KyaaActionHub'};
function artifacts(){return Object.fromEntries(Object.entries(paths).map(([key,name])=>[key,JSON.parse(fs.readFileSync(`contracts/out/${name}.sol/${name}.json`))]));}
export function buildKyaaPlan(a,nonce,delay){
 assert(Number.isSafeInteger(nonce)&&nonce>=0,'INVALID_NONCE');assert(delay>=172800n,'TIMELOCK_DELAY');
 const addresses=Object.fromEntries(Object.keys(paths).map((key,i)=>[key,getContractAddress({from:d.admin,nonce:BigInt(nonce+i)}).toLowerCase()]));
 const fingerprints=Object.fromEntries(Object.entries(a).map(([key,v])=>[key,{creationHash:keccak256(v.bytecode.object),runtimeHash:keccak256(v.deployedBytecode.object),runtimeBytes:(v.deployedBytecode.object.length-2)/2}]));
 assert(Object.values(fingerprints).every(v=>v.runtimeBytes<=24576),'RUNTIME_SIZE');
 const steps=Object.entries(paths).map(([key],i)=>({id:key,nonce:nonce+i,gas:key==='implementation'?'6000000':'3500000',data:encodeDeployData({abi:a[key].abi,bytecode:a[key].bytecode.object,args:key==='implementation'?[d.hub,addresses.passport,addresses.stamp]:[d.timelock,d.hub]})}));
 const upgrade=encodeFunctionData({abi:hubAbi,functionName:'upgradeToAndCall',args:[addresses.implementation,encodeFunctionData({abi:hubAbi,functionName:'initializeKyaaBinding'})]});
 const salt=hash({release:'kyaa-credential-binding-2',addresses,fingerprints});
 const operation=keccak256(encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bytes'},{type:'bytes32'},{type:'bytes32'}],[d.hub,0n,upgrade,zero,salt]));
 steps.push({id:'schedule',nonce:nonce+3,to:d.timelock,gas:'500000',data:encodeFunctionData({abi:tl,functionName:'schedule',args:[d.hub,0n,upgrade,zero,salt,delay]})});
 return {format:'kyaa-giwa-binding-2-v1',...d,addresses,fingerprints,delay:String(delay),operation,steps,execute:{id:'execute',to:d.timelock,gas:'500000',data:encodeFunctionData({abi:tl,functionName:'execute',args:[d.hub,0n,upgrade,zero,salt]})},maxFeePerGas:'100000000',maximumExposureWei:'1400000000000000'};
}
export function assertKyaaEnvelope(tx,step){
 assert(tx.type==='eip1559'&&tx.chainId===91342&&tx.nonce===step.nonce&&(tx.to?.toLowerCase()??null)===(step.to??null)&&tx.data===step.data&&(tx.value??0n)===0n&&tx.gas===BigInt(step.gas)&&tx.maxFeePerGas>0n&&tx.maxFeePerGas<=100000000n&&tx.maxPriorityFeePerGas>=0n&&tx.maxPriorityFeePerGas<=tx.maxFeePerGas,'TRANSACTION_ENVELOPE');
}
export function checkPrivate(p){if(fs.existsSync(p)){const s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'UNSAFE_JOURNAL');}}
export function persist(p,v){checkPrivate(p);const tmp=p+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,json(v));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,p);}
export async function readReceipt(c,txHash){try{return await c.getTransactionReceipt({hash:txHash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;return null;}}
export async function confirmedKyaaReceipt(c,txHash){
 for(let attempt=0;attempt<6;attempt++){
  try{
   const receipt=await c.waitForTransactionReceipt({hash:txHash,pollingInterval:1000,timeout:55000});
   assert((await c.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'NONCANONICAL_RECEIPT');
   return receipt;
  }catch(e){
   if(e.name!=='BlockNotFoundError'||attempt===5)throw e;
   // GIWA receipt RPC can briefly lead its block RPC; retry reads, never transmission.
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }
}
export function runtimeMatches(actual,artifact){
 if(!actual||actual.length!==artifact.deployedBytecode.object.length)return false;
 let expected=artifact.deployedBytecode.object;
 for(const refs of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const {start,length} of refs){const from=2+start*2,to=from+length*2;expected=expected.slice(0,from)+actual.slice(from,to)+expected.slice(to);}
 return expected.toLowerCase()===actual.toLowerCase();
}
async function verifyNewContracts(c,plan,a){
 for(const key of Object.keys(paths))assert(runtimeMatches(await c.getBytecode({address:plan.addresses[key]}),a[key]),'DEPLOYED_RUNTIME');
  for(const key of ['passport','stamp']){
   assert((await c.readContract({address:plan.addresses[key],abi:nftAbi,functionName:'defaultAdmin'})).toLowerCase()===d.timelock,'NFT_ADMIN');
   assert(await c.readContract({address:plan.addresses[key],abi:nftAbi,functionName:'hasRole',args:[keccak256(new TextEncoder().encode('MINTER_ROLE')),d.hub]}),'NFT_MINTER');
  }
  assert(await c.readContract({address:plan.addresses.passport,abi:nftAbi,functionName:'name'})==='kyaa Fan Passport'&&await c.readContract({address:plan.addresses.passport,abi:nftAbi,functionName:'symbol'})==='KYAAPASS','NFT_BRAND');
}
async function main(){
 const args=process.argv.slice(2),mode=args[0],get=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
 assert(['prepare','deploy-and-schedule','execute-upgrade','inspect'].includes(mode),'USAGE_PREPARE_DEPLOY_AND_SCHEDULE_EXECUTE_UPGRADE_INSPECT');
 const file=get('--manifest');assert(file,'MANIFEST_REQUIRED');
 const c=createPublicClient({transport:http('https://sepolia-rpc.giwa.io',{timeout:15000,retryCount:1})}),a=artifacts();
 assert(await c.getChainId()===d.chainId,'WRONG_CHAIN');
 const delay=await c.readContract({address:d.timelock,abi:tl,functionName:'getMinDelay'});
 for(const role of ['PROPOSER_ROLE','EXECUTOR_ROLE'])assert(await c.readContract({address:d.timelock,abi:tl,functionName:'hasRole',args:[keccak256(new TextEncoder().encode(role)),d.admin]}),'TIMELOCK_ROLE_CHANGED');
 const currentImplementation='0x'+(await c.getStorageAt({address:d.hub,slot})).slice(-40);
 if(mode==='prepare'){
  assert(currentImplementation===d.oldImplementation&&keccak256(await c.getBytecode({address:d.oldImplementation}))===d.oldRuntimeHash,'OLD_IMPLEMENTATION_CHANGED');
  const latest=await c.getTransactionCount({address:d.admin}),pending=await c.getTransactionCount({address:d.admin,blockTag:'pending'});assert(latest===pending,'PENDING_ADMIN_TRANSACTION');
  const plan=buildKyaaPlan(a,pending,delay);fs.writeFileSync(file,json(plan)+'\n',{flag:'wx',mode:0o644});
  console.log(json({prepared:true,manifest:file,hash:hash(plan),addresses:plan.addresses,delay:String(delay),maximumExposureWei:plan.maximumExposureWei}));return;
 }
 const plan=JSON.parse(fs.readFileSync(file));
 assert(json(plan)===json(buildKyaaPlan(a,plan.steps[0].nonce,BigInt(plan.delay))),'MANIFEST_OR_ARTIFACT_CHANGED');
 assert(delay===BigInt(plan.delay),'TIMELOCK_DELAY_CHANGED');
 const manifestHash=hash(plan),completed=await c.readContract({address:d.timelock,abi:tl,functionName:'isOperationDone',args:[plan.operation]});
 assert(currentImplementation===(completed?plan.addresses.implementation:d.oldImplementation),'HUB_IMPLEMENTATION_CHANGED');
 for(let i=0;i<2;i++)assert((await c.readContract({address:d.hub,abi:hubAbi,functionName:'getAssetBinding',args:[1,i]})).toLowerCase()===(i===0?d.oldPassport:d.oldStamp),'OLD_BINDING_CHANGED');
 if(mode==='inspect'){console.log(json({operation:plan.operation,timestamp:await c.readContract({address:d.timelock,abi:tl,functionName:'getTimestamp',args:[plan.operation]}),completed,currentImplementation}));return;}
 assert(get('--approved-hash')===manifestHash,'REVIEWED_MANIFEST_HASH_REQUIRED');
 const common=path.resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()),dir=path.join(common,'byus-admin-transactions');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const lock=path.join(dir,'kyaa-migration.lock');fs.closeSync(fs.openSync(lock,'wx',0o600));
 const journalFile=path.join(dir,manifestHash+'.json');checkPrivate(journalFile);
 try{
  const journal=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile)):{manifestHash,steps:[]};assert(journal.manifestHash===manifestHash,'JOURNAL_MANIFEST');
  let steps=plan.steps;
  if(mode==='execute-upgrade'){
   await verifyNewContracts(c,plan,a);
   assert(completed||await c.readContract({address:d.timelock,abi:tl,functionName:'isOperationReady',args:[plan.operation]}),'TIMELOCK_NOT_READY');
   const saved=journal.steps.find(s=>s.id==='execute');
   steps=[{...plan.execute,nonce:saved?.nonce??await c.getTransactionCount({address:d.admin})}];
  }
  for(const step of steps){
   let saved=journal.steps.find(s=>s.id===step.id),receipt;
   if(saved){
    assert(keccak256(saved.signed)===saved.hash&&(await recoverTransactionAddress({serializedTransaction:saved.signed})).toLowerCase()===d.admin,'JOURNAL_SIGNATURE');assertKyaaEnvelope(parseTransaction(saved.signed),step);
    receipt=await readReceipt(c,saved.hash);
    if(!receipt){let tx;try{tx=await c.getTransaction({hash:saved.hash});}catch(e){if(e.name!=='TransactionNotFoundError')throw e;}assert(tx,'SIGNED_TRANSACTION_UNCERTAIN_DO_NOT_RESIGN');}
   }else{
    const [latest,pending,fees,estimate,balance]=await Promise.all([c.getTransactionCount({address:d.admin}),c.getTransactionCount({address:d.admin,blockTag:'pending'}),c.estimateFeesPerGas(),c.estimateGas({account:d.admin,data:step.data,value:0n,...(step.to?{to:step.to}:{})}),c.getBalance({address:d.admin})]);
    assert(latest===pending&&pending===step.nonce,'ADMIN_NONCE_CHANGED');assert(estimate<=BigInt(step.gas),'GAS_CAP');assert(balance>=BigInt(step.gas)*100000000n,'ADMIN_BALANCE');
    const tx={chainId:91342,type:'eip1559',nonce:step.nonce,gas:BigInt(step.gas),data:step.data,value:0n,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas,...(step.to?{to:step.to}:{})};assertKyaaEnvelope(tx,step);
    let key=execFileSync('/Users/jewel/.local/share/byus-admin-keychain/keychain-helper',['read'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();assert(/^0x[0-9a-fA-F]{64}$/.test(key),'KEYCHAIN_FORMAT');const account=privateKeyToAccount(key);key='';assert(account.address.toLowerCase()===d.admin,'SIGNER_CHANGED');
    const signed=await account.signTransaction(tx);saved={id:step.id,nonce:step.nonce,signed,hash:keccak256(signed)};journal.steps.push(saved);persist(journalFile,journal);
    assert(await c.sendRawTransaction({serializedTransaction:signed})===saved.hash,'BROADCAST_HASH');
   }
   receipt=await confirmedKyaaReceipt(c,saved.hash);
   assert(receipt.status==='success'&&receipt.from.toLowerCase()===d.admin&&(receipt.to?.toLowerCase()??null)===(step.to??null),'CANONICAL_RECEIPT');
   if(a[step.id])assert(receipt.contractAddress?.toLowerCase()===plan.addresses[step.id]&&runtimeMatches(await c.getBytecode({address:plan.addresses[step.id]}),a[step.id]),'DEPLOYED_RUNTIME');
   saved.receipt={hash:saved.hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash};persist(journalFile,journal);console.log(json({step:step.id,...saved.receipt}));
  }
  await verifyNewContracts(c,plan,a);
  const timestamp=await c.readContract({address:d.timelock,abi:tl,functionName:'getTimestamp',args:[plan.operation]});assert(timestamp>0n,'OPERATION_NOT_SCHEDULED');
  if(mode==='execute-upgrade')for(let i=0;i<2;i++)assert((await c.readContract({address:d.hub,abi:hubAbi,functionName:'getAssetBinding',args:[2,i]})).toLowerCase()===plan.addresses[i===0?'passport':'stamp'],'NEW_BINDING');
  const publicResult={manifestHash,addresses:plan.addresses,operation:plan.operation,timestamp:String(timestamp),readyAt:timestamp>1n?new Date(Number(timestamp)*1000).toISOString():null,transactions:journal.steps.map(s=>({id:s.id,...s.receipt}))};
  fs.writeFileSync(file+'.receipts.json',json(publicResult)+'\n');console.log(json(publicResult));
 }finally{fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(json({stopped:true,reason:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:e.name}));process.exitCode=1;});
