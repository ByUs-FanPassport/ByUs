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
test('receipt-ahead-of-block RPC lag retries only reads and rejects a noncanonical block',async()=>{
 let reads=0;const receipt={blockNumber:99n,blockHash:'0xcanonical'};
 const c={waitForTransactionReceipt:async()=>receipt,getBlock:async()=>{if(reads++===0)throw Object.assign(new Error(),{name:'BlockNotFoundError'});return {hash:receipt.blockHash};}};
 assert.equal(await confirmedKyaaReceipt(c,'0xtx'),receipt);assert.equal(reads,2);
 await assert.rejects(confirmedKyaaReceipt({...c,getBlock:async()=>({hash:'0xwrong'})},'0xtx'),/NONCANONICAL_RECEIPT/);
});
test('signed envelope cannot redirect, change nonce, calldata, value, chain or fee cap',()=>{
 const p=buildKyaaPlan(artifacts,42,172800n),s=p.steps[3];
 const tx={chainId:91342,type:'eip1559',nonce:s.nonce,to:s.to,data:s.data,value:0n,gas:BigInt(s.gas),maxFeePerGas:1000000n,maxPriorityFeePerGas:0n};
 assertKyaaEnvelope(tx,s);
 for(const change of [{chainId:1},{nonce:99},{to:KYAA_DEPLOYMENT.admin},{data:'0x'},{value:1n},{gas:1n},{maxFeePerGas:100000001n},{maxPriorityFeePerGas:2000000n}]) assert.throws(()=>assertKyaaEnvelope({...tx,...change},s),/ENVELOPE/);
});
