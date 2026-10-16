import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,parseAbi} from 'viem';
import {buildKyaaPlan,assertKyaaEnvelope,confirmedKyaaReceipt,KYAA_DEPLOYMENT} from './migrate-kyaa-giwa.mjs';
const artifacts=Object.fromEntries(['passport','stamp','implementation'].map(k=>[k,{abi:[{type:'constructor',inputs:Array.from({length:k==='implementation'?3:2},(_,i)=>({name:'arg'+i,type:'address'})),stateMutability:'nonpayable'}],bytecode:{object:'0x6000'},deployedBytecode:{object:'0x6000',immutableReferences:{}}}]));
test('deterministic plan preserves old Hub and gives the Timelock exact binding-2 initializer',()=>{
 const plan=buildKyaaPlan(artifacts,42,172800n);
 assert.equal(plan.chainId,91342);assert.equal(plan.steps.length,4);
 assert.deepEqual(plan.steps.map(s=>s.nonce),[42,43,44,45]);
 assert.equal(plan.steps[3].to,KYAA_DEPLOYMENT.timelock);
 const schedule=decodeFunctionData({abi:parseAbi(['function schedule(address,uint256,bytes,bytes32,bytes32,uint256)']),data:plan.steps[3].data});
 assert.equal(schedule.args[0].toLowerCase(),KYAA_DEPLOYMENT.hub);assert.equal(schedule.args[5],172800n);
 const upgrade=decodeFunctionData({abi:parseAbi(['function upgradeToAndCall(address,bytes)']),data:schedule.args[2]});
 assert.equal(upgrade.args[0].toLowerCase(),plan.addresses.implementation.toLowerCase());
 assert.equal(decodeFunctionData({abi:parseAbi(['function initializeKyaaBinding()']),data:upgrade.args[1]}).functionName,'initializeKyaaBinding');
 assert.deepEqual(buildKyaaPlan(artifacts,42,172800n),plan);
 assert.throws(()=>buildKyaaPlan(artifacts,42,0n),/TIMELOCK_DELAY/);
});
test('receipt-ahead-of-block RPC lag retries only reads and rejects a persistently noncanonical block',async()=>{
 let reads=0;const receipt={transactionHash:'0xtx',blockNumber:99n,blockHash:'0xcanonical'};
 const c={waitForTransactionReceipt:async()=>receipt,getBlock:async()=>{if(reads++===0)throw Object.assign(new Error(),{name:'BlockNotFoundError'});return {hash:receipt.blockHash};}};
 assert.equal(await confirmedKyaaReceipt(c,'0xtx'),receipt);assert.equal(reads,2);
 let mismatches=0;
 await assert.rejects(confirmedKyaaReceipt({...c,getBlock:async()=>{mismatches++;return {hash:'0xwrong'};}},'0xtx'),/NONCANONICAL_RECEIPT/);
 assert.equal(mismatches,6);
});
for(const moved of [false,true])test(`same transaction is reread after a transient block mismatch${moved?' and canonical re-inclusion':''}`,async()=>{
 const original={transactionHash:'0xtx',blockNumber:99n,blockHash:'0xinitial'};
 const canonical=moved?{transactionHash:'0xtx',blockNumber:101n,blockHash:'0xcanonical'}:original;
 const requests=[];let reads=0;
 const c={waitForTransactionReceipt:async options=>{requests.push(options);return requests.length===1?original:canonical;},
  getBlock:async({blockNumber})=>{assert.equal(blockNumber,reads===0?99n:canonical.blockNumber);return {hash:reads++===0?'0xother':canonical.blockHash};}};
 assert.equal(await confirmedKyaaReceipt(c,'0xtx'),canonical);
 assert.equal(requests.length,2);assert(requests.every(r=>r.hash==='0xtx'&&r.checkReplacement===false));
});
test('receipt for another transaction is rejected without retry',async()=>{
 let reads=0;
 const c={waitForTransactionReceipt:async()=>{reads++;return {transactionHash:'0xother',blockNumber:99n,blockHash:'0xcanonical'};},getBlock:async()=>({hash:'0xcanonical'})};
 await assert.rejects(confirmedKyaaReceipt(c,'0xtx'),/TRANSACTION_RECEIPT_HASH_MISMATCH/);assert.equal(reads,1);
});
test('unrelated RPC errors are not converted into canonical receipt retries',async()=>{
 let reads=0;const failure=Error('RPC_AUTHENTICATION_FAILED');
 const c={waitForTransactionReceipt:async()=>{reads++;throw failure;}};
 await assert.rejects(confirmedKyaaReceipt(c,'0xtx'),e=>e===failure);assert.equal(reads,1);
});
test('signed envelope cannot redirect, change nonce, calldata, value, chain or fee cap',()=>{
 const p=buildKyaaPlan(artifacts,42,172800n),s=p.steps[3];
 const tx={chainId:91342,type:'eip1559',nonce:s.nonce,to:s.to,data:s.data,value:0n,gas:BigInt(s.gas),maxFeePerGas:1000000n,maxPriorityFeePerGas:0n};
 assertKyaaEnvelope(tx,s);
 for(const change of [{chainId:1},{nonce:99},{to:KYAA_DEPLOYMENT.admin},{data:'0x'},{value:1n},{gas:1n},{maxFeePerGas:100000001n},{maxPriorityFeePerGas:2000000n}]) assert.throws(()=>assertKyaaEnvelope({...tx,...change},s),/ENVELOPE/);
});
