import { createHash } from 'node:crypto';
import { encodeDeployData, encodeFunctionData, getContractAddress, keccak256, padHex } from 'viem';

export const CUTOVER_SOURCE = Object.freeze({
  chainId: 91342,
  admin: '0xeee82f960476c888950c798c444c1fd92cbbfe50',
  writer: '0xd0f5dd0885ca87f2c9f4d1017fa1714dd98dc815',
  previousHub: '0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d',
  previousRegistry: '0xc25bb560bd308e17810d6241af67f62c4227fa10',
  timelock: '0x40eaeb0b73c50da5053502eb3b836a6effe54642',
  implementation: '0x049b758b3d1cc0c66408b264c7f9a96ea479860b',
  codec: '0x4e44a1c183bac430f30033bd1a639c696b93612a',
  eas: '0x4200000000000000000000000000000000000021',
  schemaRegistry: '0x4200000000000000000000000000000000000020',
  schema: '0xbd97671d89c9f4bb246e33369389332486f406ab821a0c7f88860034759c5c0b',
  environment: '0xd5bc532db275cd70e5f55280b01cd2acc6b30b90d5aaa451adeb4b9a8f02c264',
  passport: '0x17f9fb7658a326dd88db523739c227faf50fca20',
  stamp: '0x1adcde3473c4e884e60205b397ece744d8892285',
});
export const CUTOVER_RUNTIME_HASHES = Object.freeze({
  timelock: '0x0e3a4d6350ada4a2eb17e084770058b2b6f5bb487036eb19b0de7f1363f63900',
  codec: '0xe3095c9a1847be6e857e06f7182d417597094331c3a2ab5b2058253ab248bc39',
  implementation: '0x3e50e0def7b3823e63bca919f5ecc1a09a709b4b62eb7dae1c710cb1c20d17d9',
  proxy: '0x2373de27ebdd05a3665c30eb6afdc555833cb5e0f60a663ff23f0f2825a412a7',
});
export const CUTOVER_FEES = Object.freeze({ maxFeePerGas: '100000000', maxPriorityFeePerGas: '100000000', maxTotalExecutionFee: '200000000000000' });
const ZERO_ADDRESS = '0x' + '00'.repeat(20);
export function cutoverPlanHash(plan) { return '0x' + createHash('sha256').update(JSON.stringify(plan)).digest('hex'); }
function code(artifact, field) { const value=artifact?.[field]?.object; if(!/^0x[0-9a-fA-F]+$/.test(value??'')||value.length<4)throw Error('MISSING_ARTIFACT_CODE');return value; }
function registryRuntime(artifact) {
  let body=code(artifact,'deployedBytecode').slice(2);
  const refs=Object.values(artifact.deployedBytecode.immutableReferences??{});
  if(refs.length!==1||refs[0].length===0)throw Error('UNEXPECTED_REGISTRY_IMMUTABLES');
  for(const ref of refs[0]){if(ref.length!==32||ref.start<0||(ref.start+32)*2>body.length)throw Error('INVALID_IMMUTABLE_REFERENCE');const i=ref.start*2;body=body.slice(0,i)+padHex(CUTOVER_SOURCE.timelock,{size:32}).slice(2)+body.slice(i+64);}
  return '0x'+body;
}
export function prepareActionHubCutover(nonce, artifacts) {
  if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('INVALID_NONCE');
  const source=CUTOVER_SOURCE;
  const registry=getContractAddress({from:source.admin,nonce:BigInt(nonce)}).toLowerCase();
  const hub=getContractAddress({from:source.admin,nonce:BigInt(nonce+1)}).toLowerCase();
  const initialization={admin:source.timelock,writer:source.writer,migrator:source.admin,corrector:source.admin,pauser:source.admin,easAddress:source.eas,environmentId:source.environment,schemaUID:source.schema,passport:source.passport,stamp:source.stamp,collectible:ZERO_ADDRESS,codec:source.codec,contextRegistry:registry};
  const initializeData=encodeFunctionData({abi:artifacts.hub.abi,functionName:'initialize',args:[initialization]});
  const proxyHash=keccak256(code(artifacts.proxy,'deployedBytecode'));
  if(proxyHash!==CUTOVER_RUNTIME_HASHES.proxy)throw Error('PROXY_RUNTIME_CHANGED');
  const steps=[
    {id:'deploy-registry-v3',nonce,to:null,value:'0',gas:'700000',data:encodeDeployData({abi:artifacts.registry.abi,bytecode:code(artifacts.registry,'bytecode'),args:[source.timelock,source.admin]}),expectedAddress:registry,runtimeHash:keccak256(registryRuntime(artifacts.registry))},
    {id:'deploy-hub-v3-proxy',nonce:nonce+1,to:null,value:'0',gas:'750000',data:encodeDeployData({abi:artifacts.proxy.abi,bytecode:code(artifacts.proxy,'bytecode'),args:[source.implementation,initializeData]}),expectedAddress:hub,runtimeHash:proxyHash},
  ];
  if(steps.reduce((n,s)=>n+BigInt(s.gas)*BigInt(CUTOVER_FEES.maxFeePerGas),0n)>BigInt(CUTOVER_FEES.maxTotalExecutionFee))throw Error('TOTAL_FEE_CAP');
  return {format:'byus-immediate-context-cutover-v1',source:{...source},fees:{...CUTOVER_FEES},startNonce:nonce,addresses:{registry,hub},initialization,steps};
}
export function validateCutoverPlan(plan, artifacts, approvedHash) {
  if(cutoverPlanHash(plan)!==approvedHash)throw Error('APPROVED_PLAN_CHANGED');
  const expected=prepareActionHubCutover(plan.startNonce,artifacts);
  if(JSON.stringify(plan)!==JSON.stringify(expected))throw Error('PLAN_ARTIFACT_OR_SCOPE_CHANGED');
  return plan;
}
export function assertCutoverNonce(step, latest, pending) {
  if(latest!==pending||latest!==step.nonce)throw Error('NONCE_NOT_EXCLUSIVE');
}
export function assertCutoverFees(step, gasEstimate, maxFeePerGas, maxPriorityFeePerGas) {
  if(gasEstimate>BigInt(step.gas)||maxFeePerGas>BigInt(CUTOVER_FEES.maxFeePerGas)||maxPriorityFeePerGas>BigInt(CUTOVER_FEES.maxPriorityFeePerGas)||maxPriorityFeePerGas>maxFeePerGas||maxFeePerGas<=0n||maxPriorityFeePerGas<0n)throw Error('TRANSACTION_FEE_CAP');
}
